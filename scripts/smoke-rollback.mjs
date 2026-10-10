import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { check, RollbackFailure, parseArguments, localDockerEndpoint, readJarTar, singleFileTar, sha256 } from "./rollback-helpers.mjs";

// Provider-independent binary rollback rehearsal. Never builds/pulls/deploys,
// uses an existing DB/storage/account, repairs history or reverses migrations.
// Media metadata is a controlled SQL fixture; originals live in a separate owned
// tmpfs container. This verifies preservation, not R2 upload/playback acceptance.
let options;
try { options = parseArguments(process.argv.slice(2)); }
catch (failure) { console.error("Rollback smoke: " + failure.message); process.exit(2); }
if (options.help) {
  console.log("Usage: node scripts/smoke-rollback.mjs --candidate-image sha256:<64hex> --previous-image sha256:<64hex> [--incompatible-image sha256:<64hex>]");
  console.log("Requires existing distinct application JARs, candidate readiness schema-check console, exact bundled migration equality and existing postgres:17. Tags and remote Docker are refused; all fixtures are disposable and synthetic.");
  process.exit(0);
}

const dockerBin = process.env.DOCKER_BIN || "docker";
const runId = randomUUID(), prefix = "memory-archive-rollback-" + runId;
const labelKey = "com.memoryarchive.rollback-smoke", label = labelKey + "=" + runId;
const network = prefix + "-network", database = prefix + "-db", originals = prefix + "-originals";
const candidateApp = prefix + "-candidate", previousApp = prefix + "-previous";
const origin = "https://rollback-smoke.invalid", username = "synthetic-operator";
const password = randomBytes(32).toString("hex"), databasePassword = randomBytes(32).toString("hex");
// Only Docker's local runtime settings survive. Ambient provider/app credentials
// are not inherited by any fixture process, even if present in the caller shell.
const environment = {};
for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA",
  "LOCALAPPDATA", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
  if (process.env[name] !== undefined) environment[name] = process.env[name];
}
Object.assign(environment, { POSTGRES_DB: "rollback_smoke", POSTGRES_USER: "synthetic_rollback", POSTGRES_PASSWORD: databasePassword,
  PGPASSWORD: databasePassword, PGDATA: "/var/lib/postgresql/data", SPRING_PROFILES_ACTIVE: "staging", PORT: "10000",
  MEMORY_ARCHIVE_ENVIRONMENT: "staging", MEMORY_ARCHIVE_STORAGE_ENABLED: "false", MEMORY_ARCHIVE_AUDIO_ENABLED: "false",
  MEMORY_ARCHIVE_RETENTION_ENABLED: "false", MEMORY_ARCHIVE_PUBLIC_ORIGIN: origin, MEMORY_ARCHIVE_REVEALED: "true",
  MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET: randomBytes(32).toString("hex"),
  MEMORY_ARCHIVE_DB_URL: "jdbc:postgresql://" + database + ":5432/rollback_smoke", MEMORY_ARCHIVE_DB_USERNAME: "synthetic_rollback",
  MEMORY_ARCHIVE_DB_PASSWORD: databasePassword, MEMORY_ARCHIVE_STAGING_USERNAME: username,
  MEMORY_ARCHIVE_STAGING_PASSWORD: password, MEMORY_ARCHIVE_STAGING_ORIGIN: origin,
  JAVA_TOOL_OPTIONS: "-Xms64m -Xmx1g -XX:+ExitOnOutOfMemoryError" });
const appEnv = Object.keys(environment).filter(name => name.startsWith("MEMORY_ARCHIVE_") || ["SPRING_PROFILES_ACTIVE", "PORT", "JAVA_TOOL_OPTIONS"].includes(name));
const cancellation = new AbortController(), attemptedContainers = [];
let interrupted = false, networkAttempted = false, base, guardNumber = 0, rollbackStarts = 0;
const interrupt = () => { interrupted = true; cancellation.abort(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));

function docker(args, description, { allowFailure = false, cleanup = false, bytes = false, input } = {}) {
  return new Promise((done, fail) => {
    const child = execFile(dockerBin, args, { env: environment, windowsHide: true, shell: false, encoding: null,
      timeout: 60000, maxBuffer: bytes ? 128 * 1024 * 1024 : 1024 * 1024,
      ...(cleanup ? {} : { signal: cancellation.signal }) }, (error, stdout, stderr) => {
      if (error && !allowFailure) fail(new RollbackFailure(description + " failed; inspect Docker privately."));
      else done({ ok: !error, output: bytes ? stdout : stdout.toString("utf8").trim(),
        stderr: stderr.toString("utf8").trim(),
        missingFile: Boolean(error) && /could not find the file|no such file or directory/i.test(stderr.toString("utf8")) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function owner(name, cleanup = false) {
  const result = await docker(["container", "inspect", "--format", "{{index .Config.Labels \"" + labelKey + "\"}}", name],
    "Temporary container ownership check", { allowFailure: true, cleanup });
  return result.ok && result.output === runId;
}
async function create(name, args) {
  attemptedContainers.push(name);
  await docker(["container", "create", "--pull=never", "--name", name, "--label", label, ...args], "Owned temporary container creation");
  check(await owner(name), "A temporary container does not belong to this rehearsal.");
  const inspected = JSON.parse((await docker(["container", "inspect", "--format", "{{json .Mounts}}", name], "Temporary mount check")).output);
  check(!inspected.some(mount => mount.Type === "bind" || mount.Type === "volume"), "Temporary containers cannot use existing bind mounts or volumes.");
}
async function cleanupOwnedResources() {
  if (!attemptedContainers.length && !networkAttempted) return true;
  let complete = true;
  for (const name of [...attemptedContainers].reverse()) {
    if (await owner(name, true)) {
      if (!(await docker(["container", "rm", "--force", "--volumes", name], "Owned container cleanup", { allowFailure: true, cleanup: true })).ok) complete = false;
    } else {
      const found = await docker(["container", "ls", "-a", "--filter", "name=^/" + name + "$", "--format", "{{.Names}}"],
        "Temporary container absence check", { allowFailure: true, cleanup: true });
      if (!found.ok || found.output) complete = false;
    }
  }
  if (networkAttempted) {
    const owned = await docker(["network", "inspect", "--format", "{{index .Labels \"" + labelKey + "\"}}", network],
      "Temporary network ownership check", { allowFailure: true, cleanup: true });
    if (owned.ok && owned.output === runId) {
      if (!(await docker(["network", "rm", network], "Owned network cleanup", { allowFailure: true, cleanup: true })).ok) complete = false;
    } else {
      const found = await docker(["network", "ls", "--filter", "name=^" + network + "$", "--format", "{{.Name}}"],
        "Temporary network absence check", { allowFailure: true, cleanup: true });
      if (!found.ok || found.output) complete = false;
    }
  }
  const remaining = await docker(["container", "ls", "-a", "--filter", "label=" + label, "--format", "{{.Names}}"],
    "Final owned-container absence check", { allowFailure: true, cleanup: true });
  const networks = await docker(["network", "ls", "--filter", "label=" + label, "--format", "{{.Name}}"],
    "Final owned-network absence check", { allowFailure: true, cleanup: true });
  return complete && remaining.ok && !remaining.output && networks.ok && !networks.output;
}
async function resolveImage(reference) {
  const id = (await docker(["image", "inspect", "--format", "{{.Id}}", reference], "Existing local image check")).output;
  check(/^sha256:[0-9a-f]{64}$/.test(id), "A local image did not resolve to a complete immutable ID.");
  return id;
}
async function artifact(reference, role) {
  const id = await resolveImage(reference), name = prefix + "-inspect-" + role;
  const user = (await docker(["image", "inspect", "--format", "{{.Config.User}}", id], "Application image user check")).output;
  check(user === "10001:10001", "Application images must declare nonroot UID/GID 10001.");
  await create(name, ["--network", "none", "--read-only", "--entrypoint", "sleep", id, "1"]);
  const jar = readJarTar((await docker(["container", "cp", name + ":/app/app.jar", "-"], "Immutable application JAR copy", { bytes: true })).output);
  const revision = (await docker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", id],
    "Optional application revision label check")).output;
  console.log("Rollback artifact: " + role + " image=" + id + " jar-sha256=" + sha256(jar)
    + (/^[0-9a-f]{40,64}$/.test(revision) ? " revision=" + revision : " revision=unavailable"));
  return { id, jar };
}
async function sql(statement) {
  check(await owner(database), "The database operation must target this run's disposable owned database.");
  return (await docker(["container", "exec", "-e", "PGPASSWORD", database, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-U", "synthetic_rollback", "-d", "rollback_smoke", "-A", "-t", "-c", statement],
    "Disposable database fixture operation")).output;
}
async function history() {
  return await sql("SELECT COALESCE(json_agg(h ORDER BY installed_rank),'[]'::json)::text FROM flyway_schema_history h;");
}
async function readinessReport(candidate, fixture) {
  const name = prefix + "-report";
  await create(name, ["--network", network, "--read-only", "--memory", "1g", "--memory-swap", "1g",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777", ...appEnv.flatMap(key => ["-e", key]),
    "--entrypoint", "java", candidate.id, "-Dloader.main=com.kevinmel.archive.operations.ReadinessAdministration",
    "-cp", "/app/app.jar", "org.springframework.boot.loader.launch.PropertiesLauncher", "--expect-environment", "staging", "report"]);
  const result = await docker(["container", "start", "--attach", name], "Packaged read-only disposable readiness report", { allowFailure: true });
  const expected = ["OPERATIONS_OBSERVED_CHECKS_PASS", "DATABASE_AVAILABLE", "SCHEMA_REVIEWED", "UPLOAD_ADMISSION_OPEN",
    "NOTE_ADMISSION_HAS_NO_UPLOAD_PAUSE_GATE", "REVEAL_CONFIGURED_OPEN", "AUDIO_ADMISSION_CONFIGURED_DISABLED", "STORAGE_DISABLED",
    "RETENTION_CONFIGURED_DISABLED_JOB_UNCHECKED", "RETENTION_INTERVAL_MILLIS 300000",
    "ORIGINAL_RESERVATION_BYTES " + fixture.media.reduce((total, item) => total + item.bytes.length, 0) + " LIMIT 7500000000 STATUS BELOW_WARNING",
    "STAGING_RESERVATION_BYTES 0 LIMIT 7500000000 STATUS BELOW_WARNING", "PENDING_MEDIA 0", "FAILED_MEDIA 0", "LIVE_UPLOAD_GRANTS 0",
    "OVERDUE_RETENTION 0", "UNFINISHED_DELETION_PLANS 0",
    "PROVIDER_BYTES_AND_INTEGRITY_UNCHECKED; RETENTION_JOB_HEALTH_UNCHECKED; BACKUPS_AND_RPO_RTO_UNCHECKED; RELEASE_READINESS_NOT_ESTABLISHED"];
  check(result.ok, "The packaged readiness console did not confirm the disposable observations.");
  same(result.output.split(/\r?\n/), expected, "The packaged readiness console changed its fixed gates, aggregates or unchecked limitations.");
  const ports = (await docker(["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", name], "Offline report listener check")).output;
  check(ports === "{}" || ports === "null", "The offline readiness report must not expose an HTTP port.");
  console.log("Rollback smoke: packaged read-only report passed; exact fixture aggregates, storage disabled, job/backup/provider checks explicitly unchecked.");
}
async function schemaGuard(candidate, priorJar, expectedMatch) {
  const name = prefix + "-guard-" + ++guardNumber, file = "rollback-prior-" + runId + ".jar";
  // Docker copies only our confirmed-absent JAR path into this exclusive writable
  // layer. The non-web console uses read-only DB transactions; app layers remain
  // read-only. No guard shares a host directory, existing container or volume.
  await create(name, ["--network", network, "--memory", "1g", "--memory-swap", "1g",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777", ...appEnv.flatMap(key => ["-e", key]),
    "--entrypoint", "java", candidate.id, "-Dloader.main=com.kevinmel.archive.operations.ReadinessAdministration",
    "-cp", "/app/app.jar", "org.springframework.boot.loader.launch.PropertiesLauncher", "--expect-environment", "staging",
    "schema-check", "--prior-jar", "/" + file]);
  const absent = await docker(["container", "cp", name + ":/" + file, "-"], "New guard fixture path absence check", { allowFailure: true, bytes: true });
  check(!absent.ok && absent.missingFile, "The guard JAR destination must be confirmed absent before copying.");
  await docker(["container", "cp", "-", name + ":/"], "Owned guard JAR fixture copy", { input: singleFileTar(file, priorJar) });
  const result = await docker(["container", "start", "--attach", name], "Read-only offline rollback schema guard", { allowFailure: true });
  check(expectedMatch ? result.ok && result.output === "ROLLBACK_SCHEMA_MATCH"
    : !result.ok && (result.output === "ROLLBACK_SCHEMA_UNCONFIRMED"
      || result.stderr.split(/\r?\n/).at(-1) === "ROLLBACK_SCHEMA_UNCONFIRMED"),
  expectedMatch ? "The prior artifact or current history is incompatible; previous application was not started."
    : "The schema guard did not explicitly reject the incompatible fixture.");
  const ports = (await docker(["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", name], "Offline guard listener check")).output;
  check(ports === "{}" || ports === "null", "The offline guard must not expose an HTTP port.");
}
async function startApp(name, image) {
  if (!attemptedContainers.includes(name)) await create(name, ["--network", network, "--read-only", "--memory", "2g", "--memory-swap", "2g",
    "--cpus", "1", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777", "--publish", "127.0.0.1::10000",
    ...appEnv.flatMap(key => ["-e", key]), image]);
  await docker(["container", "start", name], "Disposable application startup");
  const port = (await docker(["container", "port", name, "10000/tcp"], "Loopback-only app port discovery")).output;
  check(/^127\.0\.0\.1:\d+$/.test(port), "Applications must expose only one IPv4 loopback port.");
  base = "http://" + port;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !interrupted) {
    check((await docker(["container", "inspect", "--format", "{{.State.Running}}", name], "Application startup state check")).output === "true",
      "The application stopped before startup completed.");
    try { if ((await fetch(base + "/api/health", { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(1500)]) })).status === 200) return; }
    catch { /* Retry only within the bounded startup deadline. */ }
    await pause(500);
  }
  throw new RollbackFailure("The disposable application did not become healthy within three minutes.");
}
const forwarded = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "rollback-smoke.invalid", "X-Forwarded-Port": "443",
  Authorization: "Basic " + Buffer.from(username + ":" + password).toString("base64"), "X-Api-Contract": "1" };
async function request(path, { cookie, ...options } = {}) {
  try { return await fetch(base + path, { ...options, redirect: "manual", headers: { ...forwarded, ...(cookie ? { Cookie: cookie } : {}),
    ...options.headers }, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)]) }); }
  catch { throw new RollbackFailure("A local application HTTP check did not complete."); }
}
async function json(response, status = 200) {
  check(response.status === status && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") || ""),
    "An API fixture check returned an unexpected status or content type.");
  check(response.headers.get("cache-control") === "no-store", "Private fixture API responses must be no-store.");
  try { return await response.json(); } catch { throw new RollbackFailure("An API fixture response is not valid JSON."); }
}
async function error(response, status, code) { check((await json(response, status)).error?.code === code, "An API boundary returned an unexpected error."); }
function cookieOf(response) {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("MEMORY_ARCHIVE_SESSION="));
  if (!cookie) return undefined;
  check(/;\s*Secure(?:;|$)/i.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(cookie) && /;\s*SameSite=Lax(?:;|$)/i.test(cookie),
    "Synthetic sessions must preserve staging cookie protections.");
  return cookie.split(";", 1)[0];
}
async function session(cookie) {
  const response = await request("/api/session", { cookie });
  return { cookie: cookieOf(response) || cookie, body: await json(response) };
}
async function login() {
  const anonymous = await session();
  check(anonymous.body.authenticated === false, "Staging admission must not grant private couple access.");
  const response = await request("/api/session", { method: "POST", cookie: anonymous.cookie,
    headers: { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": anonymous.body.csrfToken },
    body: JSON.stringify({ username: "synthetic-couple", password: "synthetic-auth-container-passphrase" }) });
  const body = await json(response), cookie = cookieOf(response);
  check(body.authenticated && cookie && cookie !== anonymous.cookie && body.csrfToken !== anonymous.body.csrfToken,
    "Couple authentication must rotate session identity and CSRF.");
  return { cookie, body };
}
async function logout(couple) {
  const response = await request("/api/session", { method: "DELETE", cookie: couple.cookie, headers: { Origin: origin, "X-CSRF-Token": couple.body.csrfToken } });
  check(response.status === 204, "Synthetic couple logout must succeed.");
  await error(await request("/api/memories", { cookie: couple.cookie }), 401, "AUTH_REQUIRED");
}
const submit = (key, payload) => request("/api/contributions", { method: "POST", headers: {
  Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload) });
async function receipt(id, key) { return await json(await request("/api/contributions/" + id + "/receipt", { headers: { "Idempotency-Key": key } })); }
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message);
async function review(couple, id, status) {
  const detail = await json(await request("/api/memories/" + id, { cookie: couple.cookie }));
  const response = await request("/api/memories/" + id + "/review", { method: "PATCH", cookie: couple.cookie,
    headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": couple.body.csrfToken, "If-Match": '"' + detail.revision + '"' },
    body: JSON.stringify({ reviewStatus: status }) });
  const changed = await json(response);
  check(changed.revision === detail.revision + 1 && changed.reviewStatus === status && changed.visibility === "COUPLE_ONLY",
    "Candidate review mutations must preserve private identity and increment revisions.");
  return changed;
}
async function copyOriginal(name, bytes) {
  check(/^[0-9a-f-]{36}$/.test(name) && await owner(originals), "Original fixture writes must target only a generated asset path in the owned isolated container.");
  await docker(["container", "exec", originals, "test", "!", "-e", "/fixtures/" + name], "New original fixture path absence check");
  // Docker cp attempts to write the read-only container layer even for tmpfs.
  // A nonroot process writes only this confirmed-absent owned tmpfs fixture.
  await docker(["container", "exec", "--interactive", originals, "dd", "of=/fixtures/" + name, "status=none"], "Owned original tmpfs fixture write", { input: bytes });
}
async function originalBytes(assetId) {
  check(/^[0-9a-f-]{36}$/.test(assetId) && await owner(originals), "Original fixture reads must use a generated asset identifier.");
  return (await docker(["container", "exec", originals, "cat", "/fixtures/" + assetId], "Owned original byte verification", { bytes: true })).output;
}
async function seedMedia(type) {
  const contributionId = randomUUID(), memoryId = randomUUID(), assetId = randomUUID(), key = randomUUID(), clientId = randomUUID();
  let bytes;
  if (type === "PHOTO") {
    bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
    await copyOriginal(assetId, bytes);
  } else {
    await docker(["container", "exec", originals, "ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:a", "libopus", "-f", "ogg", "/fixtures/" + assetId], "Synthetic original audio fixture creation");
    bytes = await originalBytes(assetId);
  }
  const mime = type === "PHOTO" ? "image/png" : "audio/ogg", hash = sha256(bytes), audio = type === "AUDIO";
  await sql("BEGIN; INSERT INTO contribution(id,event_key,guest_name,idempotency_key) VALUES ('" + contributionId + "','kevin-mel-wedding',NULL,'" + key + "'); "
    + "INSERT INTO memory(id,contribution_id,memory_type,client_item_id,caption,item_position) VALUES ('" + memoryId + "','" + contributionId + "','" + type
    + "','" + clientId + "','Synthetic rollback original',0); INSERT INTO media_asset(id,memory_id,object_key,original_filename,detected_format,byte_size,checksum_sha256,upload_state,"
    + "declared_content_type,expected_byte_size,expected_checksum_sha256,expected_duration_ms,audio_duration_ms,audio_codec,audio_container) VALUES ('" + assetId + "','"
    + memoryId + "','originals/" + assetId + "','synthetic." + (audio ? "ogg" : "png") + "','" + mime + "'," + bytes.length + ",'" + hash + "','UPLOADED','" + mime
    + "'," + bytes.length + ",'" + hash + "'," + (audio ? "1000,1000,'opus','ogg'" : "NULL,NULL,NULL,NULL") + "); COMMIT;");
  return { contributionId, memoryId, assetId, key, bytes, hash };
}
async function dataSnapshot() {
  return await sql("SELECT json_build_object('contribution',(SELECT json_agg(c ORDER BY id) FROM contribution c),"
    + "'memory',(SELECT json_agg(m ORDER BY id) FROM memory m),'media_asset',(SELECT json_agg(a ORDER BY id) FROM media_asset a),"
    + "'review_audit',(SELECT json_agg(r ORDER BY memory_id,after_revision) FROM review_audit r))::text;");
}
async function verifyFixture(fixture, oldCookie) {
  if (oldCookie) check(!(await session(oldCookie)).body.authenticated, "A restarted binary must not inherit the previous in-memory session.");
  await error(await request("/api/memories"), 401, "AUTH_REQUIRED");
  const couple = await login();
  for (const expected of fixture.details) {
    same(await json(await request("/api/memories/" + expected.memoryId, { cookie: couple.cookie })), expected,
      "A binary swap changed a mixed memory's identity, original metadata, review revision or recovery deadline.");
  }
  for (const status of ["PENDING", "KEEP", "ARCHIVED", "DELETE"]) {
    const page = await json(await request("/api/memories?reviewStatus=" + status, { cookie: couple.cookie }));
    same(page.items.map(item => item.memoryId).sort(), fixture.details.filter(item => item.reviewStatus === status).map(item => item.memoryId).sort(),
      "A binary swap changed a private mixed inbox filter.");
  }
  for (const item of fixture.receipts) same(await receipt(item.id, item.key), item.receipt, "A binary swap changed a committed guest receipt.");
  for (const item of fixture.notes) {
    same(await json(await submit(item.key, item.payload)), item.receipt, "A post-swap same-key retry did not replay its exact existing receipt.");
    await error(await submit(item.key, { ...item.payload, message: "Changed synthetic rollback text." }), 409, "IDEMPOTENCY_CONFLICT");
  }
  for (const original of fixture.media) {
    const bytes = await originalBytes(original.assetId);
    check(bytes.equals(original.bytes) && sha256(bytes) === original.hash, "A binary swap changed an independent original byte fixture.");
  }
  // Storage is disabled intentionally. Deleted media must be unavailable before
  // any storage call; preserved photo metadata still requires real provider IO.
  await error(await request("/api/memories/" + fixture.media[1].memoryId + "/playback", { cookie: couple.cookie }), 404, "NOT_FOUND");
  same(await dataSnapshot(), fixture.snapshot, "A binary swap or retry altered candidate-written fixture rows.");
  await logout(couple);
  return couple.cookie;
}

let failure, cleanupComplete = false;
try {
  const endpoint = (await docker(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
    "--format", "{{.Endpoints.docker.Host}}"], "Local Docker endpoint check")).output;
  check(localDockerEndpoint(endpoint) && (!process.env.DOCKER_HOST || localDockerEndpoint(process.env.DOCKER_HOST)), "Rollback smoke requires a local Docker endpoint.");
  console.log("Rollback smoke: freezing existing images and distinct executable JARs.");
  const candidate = await artifact(options.candidate, "candidate"), previous = await artifact(options.previous, "previous");
  check(candidate.id !== previous.id && sha256(candidate.jar) !== sha256(previous.jar), "Candidate and previous must be distinct images and distinct application binaries.");
  const incompatible = options.incompatible ? await artifact(options.incompatible, "incompatible") : null;
  check(!incompatible || ![candidate.id, previous.id].includes(incompatible.id), "The incompatible artifact must resolve to a distinct image.");
  const postgres = await resolveImage("postgres:17");
  const postgresEnv = JSON.parse((await docker(["image", "inspect", "--format", "{{json .Config.Env}}", postgres], "Existing PostgreSQL major-version check")).output);
  check(Array.isArray(postgresEnv) && postgresEnv.includes("PG_MAJOR=17"), "The existing approved database image must declare PostgreSQL 17.");
  console.log("Rollback artifact: postgres image=" + postgres);
  networkAttempted = true;
  // Docker Desktop does not assign published ports on an --internal bridge.
  // This exclusive bridge permits only our apps' IPv4 loopback publications;
  // the DB has no host port, storage/retention stay disabled, and no provider
  // settings are inherited. No existing app network is joined.
  await docker(["network", "create", "--driver", "bridge", "--label", label, network], "Owned isolated bridge creation");
  await create(database, ["--network", network, "--memory", "512m", "--memory-swap", "512m", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m", ...["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "PGDATA"].flatMap(key => ["-e", key]), postgres]);
  check(["{}", "null"].includes((await docker(["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", database], "Database listener isolation check")).output),
    "The disposable database must not publish a host port.");
  await docker(["container", "start", database], "Owned tmpfs database startup");
  check((await docker(["container", "exec", database, "stat", "--file-system", "--format", "%T", "/var/lib/postgresql/data"], "Database tmpfs verification")).output === "tmpfs",
    "Disposable database data must remain on tmpfs.");
  let ready = false;
  for (let index = 0; index < 120 && !interrupted; index++) {
    if ((await docker(["container", "exec", database, "pg_isready", "-U", "synthetic_rollback", "-d", "rollback_smoke"], "Database readiness check", { allowFailure: true })).ok) { ready = true; break; }
    await pause(500);
  }
  check(ready, "The owned database did not become ready.");
  await create(originals, ["--network", "none", "--read-only", "--memory", "256m", "--memory-swap", "256m", "--tmpfs", "/fixtures:rw,nosuid,nodev,noexec,size=16m,mode=1777",
    "--entrypoint", "sleep", candidate.id, "1800"]);
  await docker(["container", "start", originals], "Owned offline original fixture startup");
  console.log("Rollback smoke: starting previous then candidate against only the disposable database.");
  await startApp(previousApp, previous.id);
  await docker(["container", "stop", "--time", "5", previousApp], "Previous baseline stop");
  await startApp(candidateApp, candidate.id);
  const baselineHistory = await history();
  const notes = [];
  for (const guestName of [" Synthetic Rollback Guest ", " "]) {
    const key = randomUUID(), payload = { guestName, message: " Synthetic rollback note " + notes.length + ". " };
    const created = await json(await submit(key, payload), 201);
    check(created.completion === "COMPLETE" && created.memories.length === 1 && created.memories[0].memoryType === "TEXT",
      "Candidate must commit the synthetic notes through its actual HTTP API.");
    same(await json(await submit(key, payload)), created, "Candidate same-key retry changed its newly committed receipt.");
    notes.push({ key, payload, id: created.contributionId, memoryId: created.memories[0].memoryId });
  }
  const media = [await seedMedia("PHOTO"), await seedMedia("AUDIO")];
  await sql("INSERT INTO archive_account(username,display_name,password_hash,role,enabled) VALUES ('synthetic-couple','Synthetic Couple',"
    + "'{bcrypt}$2a$04$wzmk5ETbKnNeNERXKff2ZuhBkdnCKIlCI8Mml0tFgEkMdWcZgQ3g6','COUPLE',true);");
  let couple = await login();
  await error(await request("/api/memories/" + notes[0].memoryId + "/review", { method: "PATCH", cookie: couple.cookie,
    headers: { Origin: origin, "Content-Type": "application/json", "If-Match": '"1"' }, body: '{"reviewStatus":"KEEP"}' }), 403, "CSRF_INVALID");
  await review(couple, notes[0].memoryId, "KEEP");
  await review(couple, media[0].memoryId, "ARCHIVED");
  await review(couple, media[1].memoryId, "DELETE");
  const details = [];
  for (const id of [...notes.map(item => item.memoryId), ...media.map(item => item.memoryId)]) details.push(await json(await request("/api/memories/" + id, { cookie: couple.cookie })));
  const receipts = [];
  for (const item of [...notes, ...media.map(item => ({ id: item.contributionId, key: item.key }))]) {
    const saved = await receipt(item.id, item.key); item.receipt = saved; receipts.push({ id: item.id, key: item.key, receipt: saved });
  }
  await logout(couple); couple = await login();
  const fixture = { notes, media, details, receipts, snapshot: await dataSnapshot() };
  await docker(["container", "stop", "--time", "5", candidateApp], "Candidate quiescence before guard");
  await readinessReport(candidate, fixture);
  same(await history(), baselineHistory, "The read-only report must not change migration history.");
  same(await dataSnapshot(), fixture.snapshot, "The read-only report must not change candidate-written fixture rows.");
  console.log("Rollback smoke: proving changed, failed and unknown history is refused before rollback traffic.");
  const firstMigration = JSON.parse(baselineHistory).find(row => row.version === "1");
  check(Number.isSafeInteger(firstMigration?.checksum), "The disposable baseline requires a validated V1 checksum.");
  for (const [mutation, restore] of [
    ["UPDATE flyway_schema_history SET checksum=" + (firstMigration.checksum === 0 ? 1 : 0) + " WHERE version='1';", "UPDATE flyway_schema_history SET checksum=" + firstMigration.checksum + " WHERE version='1';"],
    ["UPDATE flyway_schema_history SET success=false WHERE version='1';", "UPDATE flyway_schema_history SET success=true WHERE version='1';"],
    ["INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,checksum,installed_by,execution_time,success) SELECT max(installed_rank)+1,'999999','synthetic rollback rejection','SQL','V999999__synthetic_rollback_rejection.sql',0,'synthetic_rollback',0,true FROM flyway_schema_history;",
      "DELETE FROM flyway_schema_history WHERE version='999999' AND script='V999999__synthetic_rollback_rejection.sql';"],
  ]) {
    await sql(mutation);
    await schemaGuard(candidate, previous.jar, false);
    check(rollbackStarts === 0 && (await docker(["container", "inspect", "--format", "{{.State.Running}}", previousApp], "Refused rollback process-state check")).output === "false",
      "Incompatible history must leave the previous binary stopped before traffic.");
    await sql(restore); same(await history(), baselineHistory, "Synthetic negative-case history cleanup failed.");
  }
  if (incompatible) await schemaGuard(candidate, incompatible.jar, false);
  await schemaGuard(candidate, previous.jar, true);
  same(await history(), baselineHistory, "The offline compatibility guard must not change migration history.");
  console.log("Rollback smoke: verifying candidate-written mixed identities with the previous binary, then the candidate again.");
  rollbackStarts++;
  await startApp(previousApp, previous.id);
  const priorCookie = await verifyFixture(fixture, couple.cookie);
  same(await history(), baselineHistory, "The previous binary must not reverse, repair or alter validated migrations.");
  await docker(["container", "stop", "--time", "5", previousApp], "Previous binary quiescence");
  await startApp(candidateApp, candidate.id);
  await verifyFixture(fixture, priorCookie);
  same(await history(), baselineHistory, "The final candidate restart must preserve the same validated migration history.");
} catch (caught) {
  failure = caught instanceof RollbackFailure ? caught.message : "An unexpected rollback fixture check failed; inspect diagnostics privately.";
} finally {
  try { cleanupComplete = await cleanupOwnedResources(); } catch { cleanupComplete = false; }
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
if (!cleanupComplete) {
  console.error("Rollback smoke could not confirm cleanup. Inspect only this run's labeled resources privately: " + prefix); process.exitCode = 1;
} else if (interrupted) {
  console.error("Rollback smoke interrupted; all owned temporary resources were removed."); process.exitCode = 130;
} else if (failure) {
  console.error("Rollback smoke failed: " + failure + " All owned temporary resources were removed."); process.exitCode = 1;
} else {
  console.log("Rollback smoke passed: distinct frozen JARs, previous/candidate/previous/candidate binaries on one owned database, packaged read-only readiness report, strict offline schema guards, candidate-written mixed private identities, text retries, original-byte preservation, review/deletion/session invariants and verified cleanup. SQL media fixtures and independent tmpfs originals do not establish R2 acceptance.");
}
