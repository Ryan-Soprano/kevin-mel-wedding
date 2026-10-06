import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Uses the operator's configured test DB, with storage disabled and no submission writes.
const root = fileURLToPath(new URL("../", import.meta.url));
const jar = resolve(root, "backend/target/memory-archive-0.0.1-SNAPSHOT.jar");
await access(jar);
for (const name of ["MEMORY_ARCHIVE_DB_URL", "MEMORY_ARCHIVE_DB_USERNAME", "MEMORY_ARCHIVE_DB_PASSWORD"]) {
  assert.ok(process.env[name], "Supply the test database environment before running the packaged smoke check.");
}
const socket = createServer();
await new Promise((done, fail) => { socket.once("error", fail); socket.listen(0, "127.0.0.1", done); });
const port = socket.address().port;
await new Promise((done) => socket.close(done));

const origin = "https://packaged-smoke.invalid";
const username = "synthetic-operator";
const password = "synthetic-local-smoke-password-0123456789";
const environment = { ...process.env, SPRING_PROFILES_ACTIVE: "staging",
  MEMORY_ARCHIVE_ENVIRONMENT: "staging", MEMORY_ARCHIVE_PUBLIC_ORIGIN: origin,
  MEMORY_ARCHIVE_REVEALED: "false",
  MEMORY_ARCHIVE_STORAGE_ENABLED: "false", MEMORY_ARCHIVE_STAGING_USERNAME: username,
  MEMORY_ARCHIVE_STAGING_PASSWORD: password, MEMORY_ARCHIVE_STAGING_ORIGIN: origin };
for (const name of Object.keys(environment)) if (name.startsWith("MEMORY_ARCHIVE_R2_")) delete environment[name];
const child = spawn("java", ["-Djava.awt.headless=true", "-jar", jar,
  "--server.address=127.0.0.1", "--server.port=" + port],
{ cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
// Consume startup diagnostics without printing secrets, SQL parameters or private content.
child.stdout.resume(); child.stderr.resume();
let exited = false;
child.once("exit", () => { exited = true; });
let closed = false;
const childClosed = new Promise((done) => child.once("close", () => { closed = true; done(); }));
let spawnFailure;
child.once("error", (error) => { spawnFailure = error; });
const interrupt = () => { if (child.pid && !closed) child.kill(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function waitForClose(milliseconds) {
  let timer;
  const finished = await Promise.race([childClosed.then(() => true),
    new Promise((done) => { timer = setTimeout(() => done(false), milliseconds); })]);
  clearTimeout(timer);
  return finished;
}
const headers = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "packaged-smoke.invalid",
  "X-Forwarded-Port": "443", Authorization: "Basic " + Buffer.from(username + ":" + password).toString("base64") };
const request = (path, options = {}) => fetch("http://127.0.0.1:" + port + path,
  { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(5000) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.ok(!exited && !spawnFailure, "Packaged app failed to start; inspect the configured test DB/toolchain privately.");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Startup is bounded below. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, "Packaged app did not become ready within the smoke timeout.");
  const unauthenticated = await request("/", { headers: { Authorization: "" } });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate"), /^Basic /);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
  assert.equal((await request("/", { headers: { "X-Forwarded-Host": "unapproved.invalid" } })).status, 403);
  assert.equal((await request("/", { headers: { "X-Forwarded-Proto": "http" } })).status, 403);
  const index = await request("/");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type"), /^text\/html/);
  const html = await index.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((path) => path.endsWith(".js")) && assets.some((path) => path.endsWith(".css")));
  for (const path of assets) assert.equal((await request(path)).status, 200);
  for (const path of ["/contract-preview.html", "/.env", "/backend/pom.xml", "/src/main.jsx", "/missing.js", "/api/missing-route"]) {
    const response = await request(path);
    assert.equal(response.status, 401, "Excluded or unknown paths must be denied before resource resolution.");
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(response.headers.get("content-type") || "", /^text\/html/, "Unknown API/assets cannot fall back to the app.");
  }
  const mutation = { method: "POST", headers: { "Content-Type": "application/json", "X-Api-Contract": "1",
    "Idempotency-Key": crypto.randomUUID(), Origin: origin }, body: JSON.stringify({ message: "" }) };
  const sameOrigin = await request("/api/contributions", mutation);
  assert.equal(sameOrigin.status, 400);
  assert.equal((await sameOrigin.json()).error.code, "VALIDATION_FAILED");
  const crossOrigin = await request("/api/contributions", { ...mutation, headers: { ...mutation.headers, Origin: "https://other.invalid" } });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "ORIGIN_INVALID");
  console.log("Packaged staging smoke passed: health, access, HTTPS/host, HTML/assets, exclusions and same-origin API validation. No submission or R2 writes.");
} finally {
  try {
    if (child.pid && !closed) {
      child.kill();
      if (!await waitForClose(5000)) {
        child.kill("SIGKILL");
        assert.ok(await waitForClose(3000), "Could not confirm termination of the temporary smoke process.");
      }
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
