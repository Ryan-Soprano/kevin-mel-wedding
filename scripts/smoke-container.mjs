import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

// This script never builds or pulls images, uses an existing database, or enables R2.
// Usage: node scripts/smoke-container.mjs [kevin-mel-wedding:verify]
// DOCKER_BIN may name docker.exe directly on Windows. No host shell is invoked.
class SmokeFailure extends Error {}
const check = (condition, message) => { if (!condition) throw new SmokeFailure(message); };
const arguments_ = process.argv.slice(2);
check(arguments_.length <= 1, "Supply at most one existing application image name.");
const image = arguments_[0] || "kevin-mel-wedding:verify";
check(image.length > 0 && !image.startsWith("-"), "Supply an existing application image name.");
const dockerBin = process.env.DOCKER_BIN || "docker";
const runId = randomUUID();
const prefix = "memory-archive-smoke-" + runId;
const network = prefix + "-network";
const database = prefix + "-db";
const application = prefix + "-app";
const labelKey = "com.memoryarchive.container-smoke";
const label = labelKey + "=" + runId;
const origin = "https://container-smoke.invalid";
const username = "synthetic-operator";
const password = randomBytes(32).toString("hex");
const databasePassword = randomBytes(32).toString("hex");
const environment = { ...process.env, POSTGRES_DB: "container_smoke", POSTGRES_USER: "synthetic_smoke",
  POSTGRES_PASSWORD: databasePassword, PGPASSWORD: databasePassword, PGDATA: "/var/lib/postgresql/data",
  SPRING_PROFILES_ACTIVE: "staging", PORT: "10000", MEMORY_ARCHIVE_STORAGE_ENABLED: "false",
  MEMORY_ARCHIVE_ENVIRONMENT: "staging", MEMORY_ARCHIVE_PUBLIC_ORIGIN: origin,
  MEMORY_ARCHIVE_REVEALED: "true", MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET: randomBytes(32).toString("hex"),
  MEMORY_ARCHIVE_DB_URL: "jdbc:postgresql://" + database + ":5432/container_smoke",
  MEMORY_ARCHIVE_DB_USERNAME: "synthetic_smoke", MEMORY_ARCHIVE_DB_PASSWORD: databasePassword,
  MEMORY_ARCHIVE_STAGING_USERNAME: username, MEMORY_ARCHIVE_STAGING_PASSWORD: password,
  MEMORY_ARCHIVE_STAGING_ORIGIN: origin,
  JAVA_TOOL_OPTIONS: "-Xms64m -Xmx1g -XX:+ExitOnOutOfMemoryError" };
for (const name of Object.keys(environment)) if (name.startsWith("MEMORY_ARCHIVE_R2_")) delete environment[name];
const cancellation = new AbortController();
let interrupted = false;
let networkAttempted = false;
const attemptedContainers = [];
let base;
const interrupt = () => { interrupted = true; cancellation.abort(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

function docker(args, description, { allowFailure = false, cleanup = false } = {}) {
  return new Promise((done, fail) => {
    execFile(dockerBin, args, { env: environment, windowsHide: true, shell: false,
      timeout: 30000, maxBuffer: 1024 * 1024, ...(cleanup ? {} : { signal: cancellation.signal }) },
    (error, stdout) => {
      // Docker errors can repeat arguments, environment values or application logs.
      // Keep all such diagnostics private; expose only our fixed operation description.
      if (error && !allowFailure) fail(new SmokeFailure(description + " failed; check Docker privately."));
      else done({ ok: !error, output: stdout.trim() });
    });
  });
}

async function cleanupOwnedResources() {
  let complete = true;
  for (const name of [...attemptedContainers].reverse()) {
    const owner = await docker(["container", "inspect", "--format", "{{index .Config.Labels \"" + labelKey + "\"}}", name],
      "Temporary container ownership check", { allowFailure: true, cleanup: true });
    if (!owner.ok) {
      const existing = await docker(["container", "ls", "-a", "--filter", "name=^/" + name + "$", "--format", "{{.Names}}"],
        "Temporary container existence check", { allowFailure: true, cleanup: true });
      if (!existing.ok || existing.output) complete = false;
      continue;
    }
    if (owner.output !== runId) { complete = false; continue; }
    // -v also removes any anonymous volumes owned by this container. The PG data
    // mount is tmpfs, overriding postgres:17's declared data volume entirely.
    if (!(await docker(["container", "rm", "--force", "--volumes", name], "Temporary container cleanup",
      { allowFailure: true, cleanup: true })).ok) complete = false;
  }
  if (networkAttempted) {
    const owner = await docker(["network", "inspect", "--format", "{{index .Labels \"" + labelKey + "\"}}", network],
      "Temporary network ownership check", { allowFailure: true, cleanup: true });
    if (owner.ok && owner.output === runId) {
      if (!(await docker(["network", "rm", network], "Temporary network cleanup", { allowFailure: true, cleanup: true })).ok) complete = false;
    } else if (owner.ok) complete = false;
    else {
      const existing = await docker(["network", "ls", "--filter", "name=^" + network + "$", "--format", "{{.Name}}"],
        "Temporary network existence check", { allowFailure: true, cleanup: true });
      if (!existing.ok || existing.output) complete = false;
    }
  }
  return complete;
}

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const forwarded = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "container-smoke.invalid", "X-Forwarded-Port": "443" };
const authenticated = { ...forwarded, Authorization: "Basic " + Buffer.from(username + ":" + password).toString("base64") };
async function request(path, { admitted = true, ...options } = {}) {
  try {
    return await fetch(base + path, { ...options, redirect: "manual",
      headers: { ...(admitted ? authenticated : forwarded), ...options.headers },
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)]) });
  } catch { throw new SmokeFailure("A container HTTP check did not complete."); }
}
async function json(response) {
  check(/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || ""), "Expected a JSON response.");
  try { return await response.json(); }
  catch { throw new SmokeFailure("A container response did not contain valid JSON."); }
}
async function expectError(response, status, code) {
  check(response.status === status, "An access or API error returned an unexpected status.");
  const body = await json(response);
  check(typeof body.error?.code === "string" && (!code || body.error.code === code), "An access or API error returned an unexpected error code.");
  check(response.headers.get("cache-control") === "no-store", "Staging errors must be marked no-store.");
}
async function waitForApp() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !interrupted) {
    const state = await docker(["container", "inspect", "--format", "{{.State.Running}}", application], "App startup state check");
    check(state.output === "true", "The temporary application stopped before becoming healthy.");
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(1500)]) });
      if (response.status === 200) return;
    } catch { /* Startup remains bounded by the deadline. */ }
    await pause(500);
  }
  throw new SmokeFailure("The temporary application did not become healthy within three minutes.");
}
async function setAddress() {
  const port = await docker(["container", "port", application, "10000/tcp"], "Loopback port discovery");
  check(/^127\.0\.0\.1:\d+$/.test(port.output), "The temporary app must expose exactly one IPv4 loopback port.");
  base = "http://" + port.output;
}
const apiHeaders = (key) => ({ "Content-Type": "application/json", "X-Api-Contract": "1", "Idempotency-Key": key, Origin: origin });
const submit = (key, payload) => request("/api/contributions", { method: "POST", headers: apiHeaders(key), body: JSON.stringify(payload) });
async function sql(statement) {
  return (await docker(["container", "exec", "-e", "PGPASSWORD", database, "psql", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-U", "synthetic_smoke", "-d", "container_smoke", "-A", "-t", "-c", statement],
    "Synthetic authentication database fixture operation")).output;
}
const sessionCookie = (response) => {
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find((value) => value.startsWith("MEMORY_ARCHIVE_SESSION="));
  if (cookie) {
    check(/;\s*Secure(?:;|$)/i.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(cookie)
      && /;\s*SameSite=Lax(?:;|$)/i.test(cookie), "Staging session cookies require Secure, HttpOnly and SameSite=Lax.");
    return cookie.split(";")[0];
  }
};
async function currentSession(cookie) {
  const response = await request("/api/session", { headers: { "X-Api-Contract": "1", ...(cookie ? { Cookie: cookie } : {}) } });
  check(response.status === 200 && response.headers.get("cache-control") === "no-store", "Session discovery must be successful and private.");
  const body = await json(response);
  check(typeof body.csrfToken === "string" && body.csrfToken.length > 0, "Session discovery must supply a CSRF token.");
  return { cookie: sessionCookie(response) || cookie, body };
}
async function coupleLogin() {
  const anonymous = await currentSession();
  check(anonymous.body.authenticated === false && anonymous.body.user === null, "Staging admission must not grant couple authority.");
  const response = await request("/api/session", { method: "POST", headers: { "Content-Type": "application/json",
    "X-Api-Contract": "1", "X-CSRF-Token": anonymous.body.csrfToken, Cookie: anonymous.cookie, Origin: origin },
    body: JSON.stringify({ username: "synthetic-couple", password: "synthetic-auth-container-passphrase" }) });
  check(response.status === 200, "The disposable enabled couple must sign in through the real account repository.");
  const cookie = sessionCookie(response);
  const body = await json(response);
  check(cookie && cookie !== anonymous.cookie && body.csrfToken !== anonymous.body.csrfToken,
    "Authentication must rotate both the session identifier and CSRF token.");
  check(body.authenticated === true && body.user.displayName === "Synthetic Couple"
    && JSON.stringify(body.user.roles) === '["COUPLE"]'
    && JSON.stringify(Object.keys(body.user).sort()) === '["displayName","roles"]', "Session responses must expose only safe couple identity.");
  return { cookie, body };
}
const privateRequest = (cookie, id) => request("/api/memories/" + id + "/playback",
  { headers: { "X-Api-Contract": "1", ...(cookie ? { Cookie: cookie } : {}) } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function verifyReceipt(receipt) {
  check(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(["contributionId", "createdAt", "eventKey", "completion", "memories"].sort()),
    "A receipt must expose only its documented envelope fields.");
  check(uuid.test(receipt.contributionId) && receipt.eventKey === "kevin-mel-wedding" && Number.isFinite(Date.parse(receipt.createdAt))
    && receipt.completion === "COMPLETE" && Array.isArray(receipt.memories) && receipt.memories.length === 1, "Expected a complete committed text receipt.");
  const memory = receipt.memories[0];
  check(JSON.stringify(Object.keys(memory).sort()) === JSON.stringify(["memoryId", "clientItemId", "memoryType", "uploadState", "reviewStatus", "visibility"].sort()),
    "A receipt must expose only its documented memory fields.");
  check(uuid.test(memory.memoryId) && memory.clientItemId === null && memory.memoryType === "TEXT" && memory.uploadState === null
    && memory.reviewStatus === "PENDING" && memory.visibility === "COUPLE_ONLY", "Text receipts must retain private pending defaults.");
  return receipt;
}
function sameReceipt(actual, expected) {
  verifyReceipt(actual);
  check(JSON.stringify(actual) === JSON.stringify(expected), "A retry or restart must retain the complete original receipt.");
}
async function readReceipt(receipt, key) {
  const response = await request("/api/contributions/" + receipt.contributionId + "/receipt", { headers: { "X-Api-Contract": "1", "Idempotency-Key": key } });
  check(response.status === 200, "A committed receipt could not be retrieved.");
  sameReceipt(await json(response), receipt);
}
async function discardCommittedResponse(key, payload) {
  // A 201 header arrives after commit. Deliberately discard its entire receipt
  // body, then recover through a new same-key request without learning its IDs.
  const body = JSON.stringify(payload);
  return new Promise((done, fail) => {
    const outgoing = httpRequest(base + "/api/contributions", { method: "POST", headers: { ...authenticated, ...apiHeaders(key),
      "Content-Length": Buffer.byteLength(body) }, signal: cancellation.signal }, (incoming) => {
      const status = incoming.statusCode;
      incoming.destroy(); outgoing.destroy();
      if (status === 201) done();
      else fail(new SmokeFailure("The deliberately lost response did not follow a committed creation."));
    });
    outgoing.setTimeout(10000, () => outgoing.destroy());
    outgoing.once("error", () => fail(new SmokeFailure("The lost-response simulation did not complete.")));
    outgoing.end(body);
  });
}

let failure;
let cleanupComplete = false;
try {
  console.log("Container smoke: checking existing images and creating isolated temporary resources.");
  const endpoint = await docker(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
    "--format", "{{.Endpoints.docker.Host}}"], "Local Docker endpoint check");
  const localEndpoint = (value) => /^unix:\/\/\//.test(value)
    || /^npipe:\/\/\/\/(?:\.|localhost)\/pipe\//i.test(value)
    || /^tcp:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/i.test(value);
  check(localEndpoint(endpoint.output) && (!process.env.DOCKER_HOST || localEndpoint(process.env.DOCKER_HOST)),
    "Container smoke requires a local Docker endpoint; remote Docker contexts are outside its scope.");
  await docker(["image", "inspect", "--format", "{{.Id}}", image], "Existing application image check");
  await docker(["image", "inspect", "--format", "{{.Id}}", "postgres:17"], "Existing postgres:17 image check");
  const imageUser = await docker(["image", "inspect", "--format", "{{.Config.User}}", image], "Image user check");
  check(imageUser.output === "10001:10001", "The application image must declare nonroot UID/GID 10001.");
  const imageProfile = await docker(["image", "inspect", "--format", "{{range .Config.Env}}{{if eq . \"SPRING_PROFILES_ACTIVE=staging\"}}staging{{end}}{{end}}", image], "Image staging profile check");
  check(imageProfile.output === "staging", "The application image must default to the staging profile.");
  networkAttempted = true;
  // A dedicated bridge permits the app's loopback-only published port.
  // The database has no host port; neither container joins existing app networks.
  await docker(["network", "create", "--driver", "bridge", "--label", label, network], "Isolated network creation");
  attemptedContainers.push(database);
  await docker(["container", "create", "--pull=never", "--name", database, "--label", label, "--network", network,
    "--memory", "512m", "--memory-swap", "512m", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m", "-e", "POSTGRES_DB", "-e", "POSTGRES_USER",
    "-e", "POSTGRES_PASSWORD", "-e", "PGDATA", "postgres:17"], "Temporary database creation");
  const mounts = await docker(["container", "inspect", "--format", "{{json .Mounts}}", database], "Database mount check");
  const mountList = JSON.parse(mounts.output);
  const tmpfs = await docker(["container", "inspect", "--format", "{{json .HostConfig.Tmpfs}}", database], "Database tmpfs configuration check");
  check(typeof JSON.parse(tmpfs.output)?.["/var/lib/postgresql/data"] === "string"
    && !mountList.some((mount) => mount.Type === "volume"), "The disposable database must use tmpfs without anonymous volumes.");
  const databasePorts = await docker(["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", database], "Database host-port check");
  check(databasePorts.output === "{}" || databasePorts.output === "null", "The disposable database must not expose a host port.");
  await docker(["container", "start", database], "Temporary database startup");
  const dataFilesystem = await docker(["container", "exec", database, "stat", "--file-system", "--format", "%T", "/var/lib/postgresql/data"],
    "Running database filesystem check");
  check(dataFilesystem.output === "tmpfs", "The running disposable database data directory must be backed by tmpfs.");
  let databaseReady = false;
  const databaseDeadline = Date.now() + 60000;
  while (Date.now() < databaseDeadline && !interrupted) {
    const ready = await docker(["container", "exec", database, "pg_isready", "-U", "synthetic_smoke", "-d", "container_smoke"],
      "Temporary database readiness", { allowFailure: true });
    if (ready.ok) { databaseReady = true; break; }
    await pause(500);
  }
  check(databaseReady, "The disposable database did not become ready within one minute.");
  attemptedContainers.push(application);
  const applicationEnv = ["SPRING_PROFILES_ACTIVE", "PORT", "MEMORY_ARCHIVE_STORAGE_ENABLED", "MEMORY_ARCHIVE_DB_URL",
    "MEMORY_ARCHIVE_ENVIRONMENT", "MEMORY_ARCHIVE_PUBLIC_ORIGIN", "MEMORY_ARCHIVE_REVEALED", "MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET",
    "MEMORY_ARCHIVE_DB_USERNAME", "MEMORY_ARCHIVE_DB_PASSWORD", "MEMORY_ARCHIVE_STAGING_USERNAME",
    "MEMORY_ARCHIVE_STAGING_PASSWORD", "MEMORY_ARCHIVE_STAGING_ORIGIN", "JAVA_TOOL_OPTIONS"];
  await docker(["container", "create", "--pull=never", "--name", application, "--label", label, "--network", network,
    "--memory", "2g", "--memory-swap", "2g", "--cpus", "1", "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777",
    "--publish", "127.0.0.1::10000", ...applicationEnv.flatMap((name) => ["-e", name]), image], "Temporary application creation");
  const limits = await docker(["container", "inspect", "--format", "{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.ReadonlyRootfs}}", application], "App memory and filesystem limits check");
  check(limits.output === "2147483648|2147483648|true", "The temporary app must have a readonly filesystem and a 2GB memory limit without extra swap.");
  await docker(["container", "start", application], "Temporary application startup");
  await setAddress();
  await waitForApp();
  const uid = await docker(["container", "exec", application, "id", "-u"], "Runtime nonroot check");
  check(uid.output === "10001", "The application process must run as UID 10001.");
  await docker(["container", "exec", application, "test", "-r", "/app/app.jar"], "Runtime JAR readability check");
  await docker(["container", "exec", application, "touch", "/tmp/container-smoke-write-check"], "Runtime temporary-directory write check");
  await docker(["container", "exec", application, "rm", "/tmp/container-smoke-write-check"], "Runtime temporary-directory cleanup");
  check(!(await docker(["container", "exec", application, "touch", "/app/container-smoke-write-check"], "Readonly root filesystem check",
    { allowFailure: true })).ok, "The application root filesystem must remain readonly.");

  console.log("Container smoke: checking access, forwarded origin, production assets and excluded routes.");
  check((await fetch(base + "/api/health", { signal: AbortSignal.timeout(5000) })).status === 200, "Public liveness must return 200 without authentication.");
  await expectError(await request("/", { admitted: false }), 401, "STAGING_AUTH_REQUIRED");
  await expectError(await request("/", { headers: { "X-Forwarded-Proto": "http" } }), 403, "STAGING_HTTPS_REQUIRED");
  await expectError(await request("/", { headers: { "X-Forwarded-Host": "unapproved.invalid" } }), 403, "STAGING_ORIGIN_INVALID");
  const index = await request("/");
  check(index.status === 200 && /^text\/html/.test(index.headers.get("content-type") || ""), "An admitted root request must return production HTML.");
  const html = await index.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map((match) => match[1]))];
  check(assets.some((path) => path.endsWith(".js")) && assets.some((path) => path.endsWith(".css")), "Production HTML must reference both JS and CSS assets.");
  for (const path of assets) {
    await expectError(await request(path, { admitted: false }), 401, "STAGING_AUTH_REQUIRED");
    const asset = await request(path);
    check(asset.status === 200 && !/^text\/html/.test(asset.headers.get("content-type") || ""), "An admitted asset request must return the packaged asset.");
    await asset.arrayBuffer();
  }
  for (const path of ["/contract-preview.html", "/.env", "/backend/pom.xml", "/src/main.jsx", "/missing.js", "/api/missing-route"]) {
    const response = await request(path);
    await expectError(response, 401, "AUTH_REQUIRED"); // The AUTH default-deny boundary runs before resource resolution.
    check(response.headers.get("cache-control") === "no-store", "Unknown staging paths must be marked no-store.");
  }
  const invalidKey = randomUUID();
  await expectError(await submit(invalidKey, { message: "" }), 400, "VALIDATION_FAILED");
  await expectError(await request("/api/contributions", { method: "POST", headers: { ...apiHeaders(invalidKey), Origin: "https://other.invalid" },
    body: JSON.stringify({ message: "" }) }), 403, "ORIGIN_INVALID");

  console.log("Container smoke: checking committed private text, normalized retry replay and conflict.");
  const namedKey = randomUUID();
  const namedPayload = { guestName: " \u00a0Synthetic Container Guest\u00a0 ", message: " \nSynthetic named container smoke text.\n " };
  const created = await submit(namedKey, namedPayload);
  check(created.status === 201, "The first valid text request must create a committed contribution.");
  const namedReceipt = verifyReceipt(await json(created));
  for (const payload of [namedPayload, { guestName: "Synthetic Container Guest", message: "Synthetic named container smoke text." }]) {
    const replay = await submit(namedKey, payload);
    check(replay.status === 200, "An equivalent text retry must replay the committed contribution.");
    sameReceipt(await json(replay), namedReceipt);
  }
  await expectError(await submit(namedKey, { ...namedPayload, message: "Different synthetic text." }), 409, "IDEMPOTENCY_CONFLICT");
  await readReceipt(namedReceipt, namedKey);
  await expectError(await request("/api/contributions/" + namedReceipt.contributionId + "/receipt", { admitted: false,
    headers: { "X-Api-Contract": "1", "Idempotency-Key": namedKey } }), 401, "STAGING_AUTH_REQUIRED");
  await expectError(await request("/api/contributions/" + namedReceipt.contributionId + "/receipt",
    { headers: { "X-Api-Contract": "1", "Idempotency-Key": randomUUID() } }), 404, "NOT_FOUND");

  console.log("Container smoke: checking concurrent creation and recovery after a discarded committed response.");
  const concurrentKey = randomUUID();
  const concurrentPayload = { guestName: " \u00a0 ", message: "Synthetic concurrent container smoke text." };
  const concurrent = await Promise.all(Array.from({ length: 8 }, async () => {
    const response = await submit(concurrentKey, concurrentPayload);
    check(response.status === 201 || response.status === 200, "A concurrent equivalent retry must create or replay successfully.");
    return { status: response.status, receipt: verifyReceipt(await json(response)) };
  }));
  check(concurrent.filter((result) => result.status === 201).length === 1, "Exactly one concurrent request must create the contribution.");
  const concurrentReceipt = concurrent[0].receipt;
  for (const result of concurrent) sameReceipt(result.receipt, concurrentReceipt);
  const lostKey = randomUUID();
  const lostPayload = { message: "Synthetic discarded-response container smoke text." };
  await discardCommittedResponse(lostKey, lostPayload);
  const recovered = await submit(lostKey, lostPayload);
  check(recovered.status === 200, "Retry after a discarded committed response must replay, never create another row.");
  const recoveredReceipt = verifyReceipt(await json(recovered));
  await readReceipt(recoveredReceipt, lostKey);

  console.log("Container smoke: checking real SQL/bcrypt sessions, staging separation, CSRF, logout and account revocation.");
  // Fixed low-cost hash is solely for this known synthetic passphrase in this disposable database.
  await sql("INSERT INTO archive_account (username, display_name, password_hash, role, enabled) VALUES " +
    "('synthetic-couple', 'Synthetic Couple', '{bcrypt}$2a$04$wzmk5ETbKnNeNERXKff2ZuhBkdnCKIlCI8Mml0tFgEkMdWcZgQ3g6', 'COUPLE', true);");
  const missingMemory = randomUUID();
  await expectError(await privateRequest(null, missingMemory), 401, "AUTH_REQUIRED");
  const initialSession = await currentSession();
  await expectError(await request("/api/session", { method: "POST", headers: { "Content-Type": "application/json",
    "X-Api-Contract": "1", Cookie: initialSession.cookie, Origin: origin },
    body: JSON.stringify({ username: "synthetic-couple", password: "synthetic-auth-container-passphrase" }) }), 403, "CSRF_INVALID");
  let couple = await coupleLogin();
  await expectError(await privateRequest(couple.cookie, missingMemory), 404, "NOT_FOUND");
  await expectError(await request("/api/session", { admitted: false, headers: { "X-Api-Contract": "1", Cookie: couple.cookie } }),
    401, "STAGING_AUTH_REQUIRED");
  await expectError(await request("/api/session", { method: "DELETE", headers: { "X-Api-Contract": "1", Cookie: couple.cookie, Origin: origin } }),
    403, "CSRF_INVALID");
  const logout = await request("/api/session", { method: "DELETE", headers: { "X-Api-Contract": "1",
    Cookie: couple.cookie, "X-CSRF-Token": couple.body.csrfToken, Origin: origin } });
  check(logout.status === 204, "A same-origin CSRF-protected logout must invalidate the session.");
  await expectError(await privateRequest(couple.cookie, missingMemory), 401, "AUTH_REQUIRED");
  couple = await coupleLogin();
  await sql("UPDATE archive_account SET credentials_version = credentials_version + 1 WHERE username = 'synthetic-couple';");
  await expectError(await privateRequest(couple.cookie, missingMemory), 401, "AUTH_REQUIRED");
  couple = await coupleLogin();
  await sql("UPDATE archive_account SET enabled = false, credentials_version = credentials_version + 1 WHERE username = 'synthetic-couple';");
  await expectError(await privateRequest(couple.cookie, missingMemory), 401, "AUTH_REQUIRED");
  await sql("UPDATE archive_account SET enabled = true, credentials_version = credentials_version + 1 WHERE username = 'synthetic-couple';");
  couple = await coupleLogin();

  console.log("Container smoke: restarting only the temporary app and checking retained receipts and database rows.");
  await docker(["container", "restart", "--time", "5", application], "Temporary application restart");
  await setAddress();
  await waitForApp();
  check((await currentSession(couple.cookie)).body.authenticated === false, "Process restart must discard old in-memory authentication.");
  await expectError(await privateRequest(couple.cookie, missingMemory), 401, "AUTH_REQUIRED");
  couple = await coupleLogin();
  const rateLimited = await request("/api/session", { method: "POST", headers: { "Content-Type": "application/json",
    "X-Api-Contract": "1", Cookie: couple.cookie, "X-CSRF-Token": couple.body.csrfToken, Origin: origin },
    body: JSON.stringify({ username: "synthetic-couple", password: "synthetic-auth-container-passphrase" }) });
  await expectError(rateLimited, 429, "RATE_LIMITED");
  check(rateLimited.headers.get("retry-after") === "900", "The persistent login cap must supply Retry-After.");
  for (const [key, payload, receipt] of [[namedKey, namedPayload, namedReceipt], [concurrentKey, concurrentPayload, concurrentReceipt], [lostKey, lostPayload, recoveredReceipt]]) {
    await readReceipt(receipt, key);
    const replay = await submit(key, payload);
    check(replay.status === 200, "A retry after app restart must replay its committed contribution.");
    sameReceipt(await json(replay), receipt);
  }
  const totals = await docker(["container", "exec", "-e", "PGPASSWORD", database, "psql", "-h", "127.0.0.1", "-U", "synthetic_smoke", "-d", "container_smoke", "-A", "-t", "-c",
    "SELECT (SELECT count(*) FROM contribution), (SELECT count(*) FROM memory), (SELECT count(*) FROM media_asset), " +
    "(SELECT count(*) FROM memory WHERE review_status <> 'PENDING' OR visibility <> 'COUPLE_ONLY'), " +
    "(SELECT count(*) FROM contribution WHERE guest_name = 'Synthetic Container Guest'), (SELECT count(*) FROM contribution WHERE guest_name IS NULL);"],
    "Disposable database row and privacy verification");
  check(totals.output === "3|3|0|0|1|2", "Retries must retain exactly three normalized private text rows and no media rows.");
} catch (error) {
  failure = error instanceof SmokeFailure ? error.message : "An unexpected container smoke check failed; inspect diagnostics privately.";
} finally {
  try { cleanupComplete = await cleanupOwnedResources(); }
  catch { cleanupComplete = false; }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (!cleanupComplete) {
  console.error("Container smoke could not confirm complete cleanup. Inspect only this run's labeled resources privately: " + prefix);
  process.exitCode = 1;
} else if (interrupted) {
  console.error("Container smoke interrupted; its temporary containers, volumes and network were removed.");
  process.exitCode = 130;
} else if (failure) {
  console.error("Container smoke failed: " + failure + " Its temporary resources were removed.");
  process.exitCode = 1;
} else {
  console.log("Container smoke passed: isolated 2GB nonroot app, staging access/assets/API, three committed private text receipts, concurrent retries, discarded-response recovery, SQL/bcrypt couple login, Secure cookies, CSRF/session rotation, logout/version/disable revocation, restart and persistent login cap. All temporary resources removed. No R2 or existing database access.");
}
