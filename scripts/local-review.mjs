import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { check, RollbackFailure, localDockerEndpoint, readJarTar, sha256 } from "./rollback-helpers.mjs";
import { POSTGRES_17_IMAGE } from "./reception-helpers.mjs";
import { parseLocalReviewArguments, localReviewNames, assertLocalReviewOwnership, localReviewDockerEnvironment,
  LOCAL_REVIEW_LABEL, SYNTHETIC_REVIEW_ACCOUNTS, SYNTHETIC_REVIEW_PASSWORD, SYNTHETIC_REVIEW_PASSWORD_HASH } from "./local-review-helpers.mjs";

// All persistent writes belong to this UUID-labelled disposable Docker fixture.
// A standard bridge permits outbound routing; no provider settings are supplied.
let options;
try { options = parseLocalReviewArguments(process.argv.slice(2)); }
catch (error) { console.error("Local review: " + error.message); process.exit(2); }
if (options.help) {
  console.log("Usage: node scripts/local-review.mjs --image sha256:<64hex> [--minutes 1-120 | --self-check | --probe-failure-cleanup]\n       node scripts/local-review.mjs --stop <run UUID-v4>");
  console.log("Existing reviewed normal image only; no builds or pulls. Synthetic disposable TEXT archive, loopback-only app, default 30-minute lifetime. --stop removes only that run's exact labelled resources.");
  process.exit(0);
}
const runId = options.stop || randomUUID(), names = localReviewNames(runId), label = LOCAL_REVIEW_LABEL + "=" + runId;
const runtime = localReviewDockerEnvironment(process.env), dbPassword = randomBytes(32).toString("hex");
const settings = { POSTGRES_DB: "local_review", POSTGRES_USER: "synthetic_review", POSTGRES_PASSWORD: dbPassword,
  PGPASSWORD: dbPassword, PGDATA: "/var/lib/postgresql/data", SPRING_PROFILES_ACTIVE: "local", SERVER_PORT: "10000",
  MEMORY_ARCHIVE_ENVIRONMENT: "local", MEMORY_ARCHIVE_STORAGE_ENABLED: "false", MEMORY_ARCHIVE_AUDIO_ENABLED: "false",
  MEMORY_ARCHIVE_RETENTION_ENABLED: "false", MEMORY_ARCHIVE_REVEALED: "true", MEMORY_ARCHIVE_PUBLIC_ORIGIN: "",
  MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET: randomBytes(32).toString("hex"), MEMORY_ARCHIVE_DB_USERNAME: "synthetic_review",
  MEMORY_ARCHIVE_DB_PASSWORD: dbPassword, MEMORY_ARCHIVE_DB_URL: "jdbc:postgresql://" + names.db + ":5432/local_review",
  JAVA_TOOL_OPTIONS: "-Xms64m -Xmx1g -XX:+ExitOnOutOfMemoryError" };
const cancellation = new AbortController();
let base, interrupted = false, startupExpired = false, startupTimer, failure, cleanupComplete = false, probeTriggered = false, localVerified = false, dockerEndpoint;
const interrupt = () => { interrupted = true; cancellation.abort(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
function active() { check(!cancellation.signal.aborted, startupExpired ? "The five-minute review startup deadline elapsed." : "The review session was interrupted."); }
function docker(args, description, { cleanup = false, allowFailure = false, bytes = false } = {}) {
  if (!cleanup) active();
  // Do not abort a Docker mutation midway: await its bounded result, then clean up.
  return new Promise((done, fail) => execFile("docker", [...(dockerEndpoint ? ["--host", dockerEndpoint] : []), ...args], { env: { ...runtime, ...settings }, shell: false,
    windowsHide: true, encoding: null, timeout: 60000, maxBuffer: bytes ? 128 * 1024 * 1024 : 1024 * 1024 }, (error, stdout) => {
    if (error && !allowFailure) fail(new RollbackFailure(description + " failed; inspect Docker privately."));
    else done({ ok: !error, output: bytes ? stdout : stdout.toString("utf8").trim() });
  }));
}
async function owner(name, network = false, cleanup = false) {
  const result = await docker([network ? "network" : "container", "inspect", "--format",
    "{{index " + (network ? ".Labels" : ".Config.Labels") + ' "' + LOCAL_REVIEW_LABEL + '"}}', name],
  "Exact review ownership check", { cleanup, allowFailure: true });
  if (result.ok) assertLocalReviewOwnership(name, runId, result.output);
  return result.ok;
}
async function owned(name, args, description, config) {
  check(await owner(name, false, config?.cleanup), "A container operation requires this run's exact owned fixture.");
  return await docker(args, description, config);
}
async function absent(name, network, cleanup = false) {
  const result = await docker([network ? "network" : "container", "ls", ...(!network ? ["-a"] : []),
    "--filter", "name=^" + (!network ? "/" : "") + name + "$", "--format", network ? "{{.Name}}" : "{{.Names}}"],
  "Exact review absence check", { cleanup, allowFailure: true });
  return result.ok && !result.output;
}
async function cleanup() {
  check(localVerified, "Review cleanup requires a previously verified local Docker endpoint.");
  let complete = true;
  for (const name of [names.app, names.db, names.inspect, names.network]) {
    const network = name === names.network;
    try {
      if (await owner(name, network, true)) {
        await docker(network ? ["network", "rm", name] : ["container", "rm", "--force", "--volumes", name],
          "Owned review cleanup", { cleanup: true, allowFailure: true });
        // --stop and the live runner can both observe an owned resource before
        // either removes it. Only verified absence below decides completion.
      }
      if (!await absent(name, network, true)) complete = false;
    } catch { complete = false; } // A name with another owner is never removed.
  }
  for (const kind of ["container", "network"]) {
    const result = await docker([kind, "ls", ...(kind === "container" ? ["-a"] : []), "--filter", "label=" + label,
      "--format", kind === "container" ? "{{.Names}}" : "{{.Name}}"], "Final review cleanup verification", { cleanup: true, allowFailure: true });
    if (!result.ok || result.output) complete = false;
  }
  return complete;
}
async function create(name, args) {
  check(await absent(name, false), "A generated review container name already exists.");
  await docker(["container", "create", "--pull=never", "--name", name, "--label", label, ...args], "Exclusive review fixture creation");
  check(await owner(name), "A new review container lacks its exact ownership label.");
  const mounts = JSON.parse((await owned(name, ["container", "inspect", "--format", "{{json .Mounts}}", name], "Review mount exclusion check")).output);
  check(!mounts.some(mount => ["bind", "volume"].includes(mount.Type)), "Review containers must not use host bind mounts or Docker volumes.");
}
async function sql(statement) {
  return (await owned(names.db, ["container", "exec", "-e", "PGPASSWORD", names.db, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-U", "synthetic_review", "-d", "local_review", "-A", "-t", "-c", statement], "Owned disposable SQL check")).output;
}
async function request(path, { cookie, ...config } = {}) {
  active();
  try { return await fetch(base + path, { ...config, redirect: "manual", headers: { "X-Api-Contract": "1",
    ...(cookie ? { Cookie: cookie } : {}), ...config.headers }, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)]) }); }
  catch { throw new RollbackFailure("A bounded local review HTTP request failed."); }
}
async function bytes(response, maximum) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; check(length <= maximum, "A local review response exceeded its fixed size bound."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function json(response, status = 200) {
  check(response.status === status && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")
    && response.headers.get("cache-control") === "no-store", "A review API response changed its status, JSON or no-store contract.");
  try { return JSON.parse((await bytes(response, 256 * 1024)).toString("utf8")); }
  catch { throw new RollbackFailure("A bounded review API response was not valid JSON."); }
}
function cookieOf(response) {
  const value = response.headers.getSetCookie().find(cookie => cookie.startsWith("MEMORY_ARCHIVE_SESSION="));
  check(value && /;\s*HttpOnly(?:;|$)/i.test(value) && /;\s*SameSite=Lax(?:;|$)/i.test(value), "Synthetic local sessions must retain HTTP-only and SameSite protection.");
  return value.split(";", 1)[0];
}
async function login(account) {
  const anonymousResponse = await request("/api/session"), anonymous = await json(anonymousResponse), cookie = cookieOf(anonymousResponse);
  check(!anonymous.authenticated, "The review seed must begin without private access.");
  const response = await request("/api/session", { method: "POST", cookie, headers: { Origin: base,
    "Content-Type": "application/json", "X-CSRF-Token": anonymous.csrfToken }, body: JSON.stringify({ username: account.username, password: SYNTHETIC_REVIEW_PASSWORD }) });
  const session = await json(response), signedInCookie = cookieOf(response);
  check(session.authenticated && session.user?.roles?.includes("COUPLE") && signedInCookie !== cookie && session.csrfToken !== anonymous.csrfToken,
    "Synthetic couple authentication must rotate its identity and CSRF.");
  return { cookie: signedInCookie, csrf: session.csrfToken };
}
async function mutation(path, session, method, body, headers = {}, status = 200) {
  return await json(await request(path, { method, cookie: session.cookie, headers: { Origin: base, "X-CSRF-Token": session.csrf,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), status);
}
async function logout(session) {
  check((await request("/api/session", { method: "DELETE", cookie: session.cookie,
    headers: { Origin: base, "X-CSRF-Token": session.csrf } })).status === 204, "Synthetic seed logout must succeed.");
  check((await json(await request("/api/memories", { cookie: session.cookie }), 401)).error?.code === "AUTH_REQUIRED", "The seed session retained private access after logout.");
}
async function verifyPackage() {
  const response = await request("/"); check(response.status === 200, "The packaged main HTML was not served.");
  const html = (await bytes(response, 65536)).toString("utf8");
  const script = html.match(/<script\b[^>]*\bsrc="(\/assets\/[A-Za-z0-9_-]+\.js)"/);
  const css = html.match(/<link\b[^>]*\bhref="(\/assets\/[A-Za-z0-9_-]+\.css)"/);
  check(script && css && html.includes('id="root"'), "The image must contain the normal packaged main HTML and hashed assets.");
  const javascript = await request(script[1]), stylesheet = await request(css[1]);
  check(javascript.status === 200 && stylesheet.status === 200, "Packaged main assets were not available.");
  const source = (await bytes(javascript, 4 * 1024 * 1024)).toString("utf8"); await bytes(stylesheet, 1024 * 1024);
  const gallery = [...new Set(source.match(/\/assets\/couple-\d{3}-[A-Za-z0-9_-]+\.webp/g) || [])].filter(path => !/couple-\d{3}-560-/.test(path));
  check(gallery.length === 52, "The reviewed package must contain all 52 public gallery originals.");
  for (const path of gallery) {
    const asset = await request(path), data = await bytes(asset, 2 * 1024 * 1024);
    check(asset.status === 200 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP", "A packaged public gallery photo was not served as WebP.");
  }
}
async function seed() {
  check(await sql("SELECT count(*),max(version::int),bool_and(success) FROM flyway_schema_history WHERE type='SQL';") === "13|13|t", "The packaged review application requires exactly the successful V1-V13 schema.");
  await verifyPackage();
  check((await json(await request("/api/memories"), 401)).error?.code === "AUTH_REQUIRED", "Anonymous review requests acquired private access.");
  for (const account of SYNTHETIC_REVIEW_ACCOUNTS) await sql("INSERT INTO archive_account(username,display_name,password_hash,role,enabled) VALUES ('"
    + account.username + "','" + account.displayName + "','" + SYNTHETIC_REVIEW_PASSWORD_HASH + "','COUPLE',true);");
  check(await sql("SELECT count(*) FROM archive_account;") === "2", "Only the two published synthetic couple accounts may be seeded.");
  const memories = [];
  for (let index = 0; index < 24; index++) {
    const receipt = await json(await request("/api/contributions", { method: "POST", headers: { Origin: base,
      "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ guestName: index % 3 ? "Synthetic Guest " + (index + 1) : null,
      message: "Synthetic review note " + String(index + 1).padStart(2, "0") + ": a made-up memory for exploring the private archive. No real guest submitted this." }) }), 201);
    check(receipt.completion === "COMPLETE" && receipt.memories.length === 1 && receipt.memories[0].memoryType === "TEXT", "A public synthetic note did not receive a complete TEXT receipt.");
    memories.push(receipt.memories[0].memoryId);
  }
  const session = await login(SYNTHETIC_REVIEW_ACCOUNTS[0]);
  check((await json(await request("/api/exports/current", { cookie: session.cookie }), 404)).error?.code === "EXPORT_NOT_FOUND", "The disposable review must begin without an export job.");
  const privateNote = await mutation("/api/memories/contributions", session, "POST", { guestName: null,
    message: "Synthetic couple-authored note: a made-up private memory for the review session." }, { "Idempotency-Key": randomUUID() }, 201);
  check(privateNote.completion === "COMPLETE" && privateNote.memories[0].reviewStatus === "KEEP", "The private synthetic note must be complete and kept.");
  memories.push(privateNote.memories[0].memoryId);
  const dates = [[null, "UNKNOWN"], ["2017", "YEAR"], ["2020-06", "MONTH"], ["2024-02-29", "DAY"]];
  for (let index = 0; index < 4; index++) {
    let memory = await json(await request("/api/memories/" + memories[index], { cookie: session.cookie }));
    memory = await mutation("/api/memories/" + memory.memoryId + "/metadata", session, "PATCH", {
      title: "Synthetic milestone " + (index + 1), description: "Made-up review fixture with " + dates[index][1].toLowerCase() + " date precision.",
      memoryDate: dates[index][0], datePrecision: dates[index][1] }, { "If-Match": '"' + memory.revision + '"' });
    if (index < 2) await mutation("/api/memories/" + memory.memoryId + "/review", session, "PATCH", { reviewStatus: index ? "ARCHIVED" : "KEEP" }, { "If-Match": '"' + memory.revision + '"' });
  }
  for (const [kind, count] of [["albums", 2], ["timeline/events", 4], ["tags", 3]]) {
    for (let index = 0; index < count; index++) {
      const id = randomUUID(), path = "/api/" + kind + "/" + id, timeline = kind === "timeline/events";
      const body = timeline ? { title: "Synthetic event " + (index + 1), description: "Made-up milestone for review.", eventDate: dates[index][0], datePrecision: dates[index][1] }
        : { name: "Synthetic " + (kind === "albums" ? "album " : "tag ") + (index + 1) };
      let detail = await mutation(path, session, "PUT", body, { "If-None-Match": "*" }, 201);
      // Album 2 deliberately shares a note; an empty tag remains for usability review.
      const links = kind === "albums" ? [memories[0], memories[index + 1]] : kind === "tags" && index === 2 ? [] : [memories[index]];
      for (const memoryId of links) detail = await mutation(path + (timeline ? "/memories/" : "/members/") + memoryId,
        session, "PUT", undefined, { "If-Match": '"' + detail.revision + '"' });
    }
  }
  const page = await json(await request("/api/library/memories?limit=20", { cookie: session.cookie }));
  check(page.items.length === 20 && page.nextCursor, "The synthetic library must demonstrate bounded pagination.");
  const next = await json(await request("/api/library/memories?limit=20&cursor=" + encodeURIComponent(page.nextCursor), { cookie: session.cookie }));
  check(next.items.length === 5 && next.nextCursor === null, "The synthetic library's second page must contain its five remaining notes.");
  check(await sql("SELECT (SELECT count(*) FROM memory),(SELECT count(*) FROM media_asset),(SELECT count(*) FROM album),(SELECT count(*) FROM timeline_event),(SELECT count(*) FROM tag);") === "25|0|2|4|3", "The disposable review fixture must contain only 25 TEXT memories and its intended organization.");
  await logout(session);
  const second = await login(SYNTHETIC_REVIEW_ACCOUNTS[1]); await logout(second);
}

try {
  const endpoint = (await docker(["context", "inspect", ...(runtime.DOCKER_CONTEXT ? [runtime.DOCKER_CONTEXT] : []), "--format", "{{.Endpoints.docker.Host}}"], "Local Docker endpoint check")).output;
  check(localDockerEndpoint(endpoint) && (!runtime.DOCKER_HOST || localDockerEndpoint(runtime.DOCKER_HOST)), "Local review requires a local Docker endpoint.");
  // CLI context overrides DOCKER_HOST. Freeze that effective local endpoint so
  // changing the desktop's default context cannot redirect later cleanup.
  dockerEndpoint = runtime.DOCKER_CONTEXT ? endpoint : runtime.DOCKER_HOST || endpoint;
  delete runtime.DOCKER_CONTEXT; delete runtime.DOCKER_HOST;
  localVerified = true;
  console.log("Local review run: " + runId);
  if (options.stop) { cleanupComplete = await cleanup(); check(cleanupComplete, "The exact review run could not be fully cleaned up."); }
  else {
    startupTimer = setTimeout(() => { startupExpired = true; cancellation.abort(); }, 5 * 60 * 1000);
    for (const image of [options.image, POSTGRES_17_IMAGE]) check((await docker(["image", "inspect", "--format", "{{.Id}}", image], "Existing immutable image check")).output === image, "A required immutable image is not already available locally.");
    check((await docker(["image", "inspect", "--format", "{{.Config.User}}", options.image], "Packaged nonroot user check")).output === "10001:10001", "The reviewed image must declare its fixed nonroot user.");
    const declaredVolumes = JSON.parse((await docker(["image", "inspect", "--format", "{{json .Config.Volumes}}", options.image], "Packaged anonymous-volume exclusion check")).output);
    check(declaredVolumes === null || Object.keys(declaredVolumes).length === 0, "The reviewed application image must not declare Docker volumes.");
    check(JSON.parse((await docker(["image", "inspect", "--format", "{{json .Config.Env}}", POSTGRES_17_IMAGE], "Pinned PostgreSQL version check")).output).includes("PG_MAJOR=17"), "The pinned local database image must be PostgreSQL 17.");
    await create(names.inspect, ["--network", "none", "--read-only", "--entrypoint", "sleep", options.image, "1"]);
    const jarHash = sha256(readJarTar((await owned(names.inspect, ["container", "cp", names.inspect + ":/app/app.jar", "-"], "Packaged JAR inspection", { bytes: true })).output));
    await owned(names.inspect, ["container", "rm", names.inspect], "Completed inspector cleanup");
    check(await absent(names.network, true), "A generated review network name already exists.");
    await docker(["network", "create", "--driver", "bridge", "--label", label, names.network], "Exclusive review network creation");
    check(await owner(names.network, true), "The review network lacks exact ownership.");
    await create(names.db, ["--network", names.network, "--memory", "512m", "--memory-swap", "512m",
      "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m", "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
      ...["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "PGDATA"].flatMap(key => ["-e", key]), POSTGRES_17_IMAGE]);
    check(["{}", "null"].includes((await owned(names.db, ["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", names.db], "Database port exclusion check")).output), "The review database must have no host port.");
    await owned(names.db, ["container", "start", names.db], "Owned tmpfs database startup");
    check((await owned(names.db, ["container", "exec", names.db, "stat", "--file-system", "--format", "%T", "/var/lib/postgresql/data"], "Owned data tmpfs check")).output === "tmpfs", "The synthetic database data must be tmpfs.");
    while (!(await owned(names.db, ["container", "exec", names.db, "pg_isready", "-U", "synthetic_review", "-d", "local_review"], "Disposable database readiness", { allowFailure: true })).ok) await pause(500);
    const appKeys = Object.keys(settings).filter(key => key.startsWith("MEMORY_ARCHIVE_") || ["SPRING_PROFILES_ACTIVE", "SERVER_PORT", "JAVA_TOOL_OPTIONS"].includes(key));
    await create(names.app, ["--network", names.network, "--read-only", "--user", "10001:10001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--memory", "2g", "--memory-swap", "2g", "--cpus", "1", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777", "--publish", "127.0.0.1::10000",
      ...appKeys.flatMap(key => ["-e", key]), options.image]);
    await owned(names.app, ["container", "start", names.app], "Owned local application startup");
    const port = (await owned(names.app, ["container", "port", names.app, "10000/tcp"], "Loopback application port check")).output;
    check(/^127\.0\.0\.1:\d+$/.test(port), "The app must publish exactly one loopback-only port."); base = "http://" + port;
    while (true) {
      check((await owned(names.app, ["container", "inspect", "--format", "{{.State.Running}}", names.app], "Review startup process check")).output === "true", "The packaged app stopped before becoming healthy.");
      try { if ((await request("/api/health")).status === 200) break; } catch { active(); }
      await pause(500);
    }
    if (options.probeFailureCleanup) { probeTriggered = true; throw new RollbackFailure("Intentional healthy review cleanup probe."); }
    await seed(); clearTimeout(startupTimer);
    if (options.selfCheck) console.log("Local review self-check: synthetic API seeding and packaged assets passed. image=" + options.image + " jar-sha256=" + jarHash);
    else {
      const expires = Date.now() + options.durationMinutes * 60000;
      console.log("URL: " + base + "\nImage: " + options.image + "\nJAR SHA-256: " + jarHash);
      console.log("Synthetic sign-in: " + SYNTHETIC_REVIEW_ACCOUNTS.map(account => account.username).join(" / ") + "\nPublished test-only passphrase: " + SYNTHETIC_REVIEW_PASSWORD);
      console.log("Lifetime: " + options.durationMinutes + " minutes; expires " + new Date(expires).toISOString() + ". Ctrl+C or --stop " + runId + " removes this disposable session.");
      console.log("Scope: 25 made-up TEXT notes, albums/events/tags and portable TEXT export. Public gallery has 52 approved photos; photo selection is available, successful media uploads/playback and audio capture are unavailable. Standard bridge can route outbound; no provider credentials supplied. Do not enter real/private data. This is preparation, not couple acceptance or production/device/provider evidence.");
      while (!interrupted && Date.now() < expires) { await pause(1000); if (!interrupted && !await owner(names.app)) break; }
    }
  }
} catch (error) { failure = error instanceof RollbackFailure ? error.message : "The local review failed; inspect diagnostics privately."; }
finally {
  clearTimeout(startupTimer);
  if (localVerified && !cleanupComplete) cleanupComplete = await cleanup();
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
if (cleanupComplete) console.log("Local review cleanup: verified absent.");
else if (localVerified) { console.error("Local review cleanup could not verify complete absence. Retry --stop " + runId + " against the same local Docker daemon."); process.exitCode = 1; }
if (options.probeFailureCleanup && probeTriggered && failure === "Intentional healthy review cleanup probe." && cleanupComplete) console.log("Local review cleanup probe: passed before seeding.");
else if (failure && !interrupted) { console.error("Local review: " + failure); process.exitCode = 1; }
