import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
import { check, RollbackFailure, localDockerEndpoint, readJarTar, sha256 } from "./rollback-helpers.mjs";
import { POSTGRES_17_IMAGE, parseReceptionArguments, assertReceptionOwnership, receptionPool, receptionTimings } from "./reception-helpers.mjs";

// Synthetic local text-JSON rehearsal, one application process per fixture.
// This is not a browser, real network-drop, codec, media/R2, device or hosted
// reception-capacity acceptance. Production limits are never changed or reset.
let options;
try { options = parseReceptionArguments(process.argv.slice(2)); }
catch (failure) { console.error("Reception smoke: " + failure.message); process.exit(2); }
if (options.help) {
  console.log("Usage: node scripts/smoke-reception.mjs [--image sha256:<64hex>] [--probe-failure-cleanup]");
  console.log("Uses existing local images and exclusively owned disposable fixtures; no builds, pulls, provider access or existing DB. Runs 10/20 concurrent guests, 100 logical guests at concurrency 20, unchanged shared-peer and retry-key caps. Eight-minute overall deadline.");
  console.log("The optional probe deliberately fails after an owned fixture is healthy and passes only when that exact failure reaches verified complete cleanup.");
  process.exit(0);
}

const runId = randomUUID(), prefix = "archive-reception-" + runId;
const labelKey = "com.memoryarchive.reception-smoke", label = labelKey + "=" + runId, network = prefix + "-network";
const dockerBin = process.env.DOCKER_BIN || "docker", origin = "https://reception-smoke.invalid";
const operator = "synthetic-operator", operatorPassword = randomBytes(32).toString("hex"), dbPassword = randomBytes(32).toString("hex");
const throttleSecret = randomBytes(32).toString("hex"), attemptedContainers = [];
const runtime = {};
for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
  if (process.env[name] !== undefined) runtime[name] = process.env[name];
}
// Only these synthetic settings reach the app. Ambient app/provider credentials
// cannot reach any container; the database data directory is exclusively tmpfs.
const settings = { POSTGRES_DB: "reception_smoke", POSTGRES_USER: "synthetic_reception", POSTGRES_PASSWORD: dbPassword,
  PGPASSWORD: dbPassword, PGDATA: "/var/lib/postgresql/data", SPRING_PROFILES_ACTIVE: "staging", PORT: "10000",
  MEMORY_ARCHIVE_ENVIRONMENT: "staging", MEMORY_ARCHIVE_STORAGE_ENABLED: "false", MEMORY_ARCHIVE_AUDIO_ENABLED: "false",
  MEMORY_ARCHIVE_RETENTION_ENABLED: "false", MEMORY_ARCHIVE_PUBLIC_ORIGIN: origin, MEMORY_ARCHIVE_REVEALED: "true",
  MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET: throttleSecret, MEMORY_ARCHIVE_DB_USERNAME: "synthetic_reception", MEMORY_ARCHIVE_DB_PASSWORD: dbPassword,
  MEMORY_ARCHIVE_STAGING_USERNAME: operator, MEMORY_ARCHIVE_STAGING_PASSWORD: operatorPassword, MEMORY_ARCHIVE_STAGING_ORIGIN: origin,
  JAVA_TOOL_OPTIONS: "-Xms64m -Xmx1g -XX:+ExitOnOutOfMemoryError" };
const appKeys = Object.keys(settings).filter(key => key.startsWith("MEMORY_ARCHIVE_") || ["SPRING_PROFILES_ACTIVE", "PORT", "JAVA_TOOL_OPTIONS"].includes(key));
const cancellation = new AbortController();
let interrupted = false, timedOut = false, networkAttempted = false;
const interrupt = () => { interrupted = true; cancellation.abort(); };
const deadline = setTimeout(() => { timedOut = true; cancellation.abort(); }, 8 * 60 * 1000);
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function docker(args, description, { environment = {}, allowFailure = false, cleanup = false, bytes = false } = {}) {
  return new Promise((done, fail) => execFile(dockerBin, args, { env: { ...runtime, ...settings, ...environment }, windowsHide: true,
    shell: false, encoding: null, timeout: 60000, maxBuffer: bytes ? 128 * 1024 * 1024 : 1024 * 1024,
    ...(cleanup ? {} : { signal: cancellation.signal }) }, (error, stdout) => {
    if (error && !allowFailure) fail(new RollbackFailure(description + " failed; inspect Docker privately."));
    else done({ ok: !error, output: bytes ? stdout : stdout.toString("utf8").trim() });
  }));
}
async function owned(name, cleanup = false) {
  const result = await docker(["container", "inspect", "--format", "{{index .Config.Labels \"" + labelKey + "\"}}", name],
    "Exact temporary ownership check", { allowFailure: true, cleanup });
  try { assertReceptionOwnership(name, runId, result.output); return result.ok; } catch { return false; }
}
async function ownedCommand(name, args, description, options) {
  check(await owned(name, options?.cleanup), "The container operation does not target this run's exact owned resource.");
  return await docker(args, description, options);
}
async function create(name, args, environment = {}) {
  assertReceptionOwnership(name, runId, runId);
  attemptedContainers.push(name);
  await docker(["container", "create", "--pull=never", "--name", name, "--label", label, ...args], "Exclusive fixture creation", { environment });
  check(await owned(name), "The new fixture does not have this run's ownership label.");
  const mounts = JSON.parse((await docker(["container", "inspect", "--format", "{{json .Mounts}}", name], "Exclusive fixture mount check")).output);
  check(!mounts.some(mount => ["bind", "volume"].includes(mount.Type)), "Existing bind mounts and volumes cannot enter the reception fixture.");
}
async function cleanupOwnedResources() {
  if (!attemptedContainers.length && !networkAttempted) return true;
  let complete = true;
  for (const name of [...attemptedContainers].reverse()) {
    if (await owned(name, true)) {
      if (!(await docker(["container", "rm", "--force", "--volumes", name], "Owned container cleanup", { cleanup: true, allowFailure: true })).ok) complete = false;
    } else {
      const remaining = await docker(["container", "ls", "-a", "--filter", "name=^/" + name + "$", "--format", "{{.Names}}"], "Owned-container absence check", { cleanup: true, allowFailure: true });
      if (!remaining.ok || remaining.output) complete = false;
    }
  }
  if (networkAttempted) {
    const result = await docker(["network", "inspect", "--format", "{{index .Labels \"" + labelKey + "\"}}", network], "Exact network ownership check", { cleanup: true, allowFailure: true });
    try {
      assertReceptionOwnership(network, runId, result.output);
      if (!result.ok || !(await docker(["network", "rm", network], "Owned network cleanup", { cleanup: true, allowFailure: true })).ok) complete = false;
    } catch {
      const remaining = await docker(["network", "ls", "--filter", "name=^" + network + "$", "--format", "{{.Name}}"], "Owned-network absence check", { cleanup: true, allowFailure: true });
      if (!remaining.ok || remaining.output) complete = false;
    }
  }
  const [containers, networks] = await Promise.all([
    docker(["container", "ls", "-a", "--filter", "label=" + label, "--format", "{{.Names}}"], "Final container cleanup verification", { cleanup: true, allowFailure: true }),
    docker(["network", "ls", "--filter", "label=" + label, "--format", "{{.Name}}"], "Final network cleanup verification", { cleanup: true, allowFailure: true }),
  ]);
  return complete && containers.ok && !containers.output && networks.ok && !networks.output;
}
async function immutableImage(reference) {
  const id = (await docker(["image", "inspect", "--format", "{{.Id}}", reference], "Existing immutable local image check")).output;
  check(/^sha256:[0-9a-f]{64}$/.test(id) && id === reference, "The supplied image must resolve to its exact immutable local ID.");
  return id;
}
async function sql(fixture, statement) {
  check(fixture.db.endsWith("-db-load") || fixture.db.endsWith("-db-key"), "SQL must target a generated disposable reception database.");
  return (await ownedCommand(fixture.db, ["container", "exec", "-e", "PGPASSWORD", fixture.db, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
    "-U", "synthetic_reception", "-d", "reception_smoke", "-A", "-t", "-c", statement], "Disposable SQL observation")).output;
}
async function waitForApplication(fixture) {
  const port = (await ownedCommand(fixture.app, ["container", "port", fixture.app, "10000/tcp"], "Loopback-only application port check")).output;
  check(/^127\.0\.0\.1:\d+$/.test(port), "The app must publish exactly one IPv4 loopback port.");
  fixture.base = "http://" + port;
  const until = Date.now() + 180000;
  while (Date.now() < until && !cancellation.signal.aborted) {
    check((await ownedCommand(fixture.app, ["container", "inspect", "--format", "{{.State.Running}}", fixture.app], "Local startup process check")).output === "true",
      "The local application stopped before becoming healthy.");
    try { if ((await fetch(fixture.base + "/api/health", { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(1500)]) })).status === 200) return; }
    catch { /* Retry within the startup deadline only. */ }
    await pause(500);
  }
  throw new RollbackFailure("The exclusively owned application did not become healthy within three minutes.");
}
async function fixture(kind, image, postgres) {
  const instance = { db: prefix + "-db-" + kind, app: prefix + "-app-" + kind, sessions: new Set(), records: [], active: 0, peak: 0,
    createCalls: 0, peerAdmissions: 0, receiptCalls: 0, keyCalls: new Map(), receiptKeyCalls: new Map() };
  await create(instance.db, ["--network", network, "--memory", "512m", "--memory-swap", "512m",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m", "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
    ...["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "PGDATA"].flatMap(key => ["-e", key]), postgres]);
  check(["{}", "null"].includes((await docker(["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", instance.db], "Database host-port exclusion check")).output),
    "The disposable database must have no published port.");
  await ownedCommand(instance.db, ["container", "start", instance.db], "Owned tmpfs database startup");
  check((await ownedCommand(instance.db, ["container", "exec", instance.db, "stat", "--file-system", "--format", "%T", "/var/lib/postgresql/data"], "Running database tmpfs check")).output === "tmpfs",
    "The disposable database data directory must be on tmpfs.");
  let ready = false;
  for (let index = 0; index < 120 && !cancellation.signal.aborted; index++) {
    if ((await ownedCommand(instance.db, ["container", "exec", instance.db, "pg_isready", "-U", "synthetic_reception", "-d", "reception_smoke"], "Disposable database readiness", { allowFailure: true })).ok) { ready = true; break; }
    await pause(500);
  }
  check(ready, "The disposable database did not become ready within one minute.");
  const environment = { MEMORY_ARCHIVE_DB_URL: "jdbc:postgresql://" + instance.db + ":5432/reception_smoke" };
  await create(instance.app, ["--network", network, "--read-only", "--memory", "2g", "--memory-swap", "2g", "--cpus", "1",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777", "--publish", "127.0.0.1::10000", ...[...appKeys, "MEMORY_ARCHIVE_DB_URL"].flatMap(key => ["-e", key]), image], environment);
  await ownedCommand(instance.app, ["container", "start", instance.app], "Owned synthetic application startup");
  await waitForApplication(instance);
  check((await ownedCommand(instance.app, ["container", "exec", instance.app, "id", "-u"], "Nonroot runtime check")).output === "10001",
    "The application must run as the reviewed nonroot UID.");
  return instance;
}

const headers = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "reception-smoke.invalid", "X-Forwarded-Port": "443",
  Authorization: "Basic " + Buffer.from(operator + ":" + operatorPassword).toString("base64"), "X-Api-Contract": "1" };
async function request(instance, path, { cookie, discard = false, metrics, ...options } = {}) {
  const started = performance.now(); instance.active++; instance.peak = Math.max(instance.peak, instance.active);
  try {
    const response = await fetch(instance.base + path, { ...options, redirect: "manual", headers: { ...headers,
      ...(cookie ? { Cookie: cookie } : {}), ...options.headers }, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)]) });
    check(/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "") && response.headers.get("cache-control") === "no-store",
      "A synthetic API response changed its JSON/no-store boundary.");
    const bytes = Buffer.from(await response.arrayBuffer());
    check(bytes.length <= 16384, "A text fixture response exceeded its bounded JSON envelope.");
    let body;
    if (!discard) { try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new RollbackFailure("A synthetic response was not valid JSON."); } }
    return { status: response.status, headers: response.headers, body };
  } catch (failure) {
    if (failure instanceof RollbackFailure) throw failure;
    throw new RollbackFailure("A bounded local HTTP request failed; inspect diagnostics privately.");
  } finally {
    instance.active--; metrics?.push(performance.now() - started);
  }
}
async function guest(instance) {
  const response = await request(instance, "/api/session");
  check(response.status === 200 && response.body.authenticated === false, "Independent synthetic guest sessions must remain unauthenticated.");
  const value = response.headers.getSetCookie().find(value => value.startsWith("MEMORY_ARCHIVE_SESSION="));
  check(value && /;\s*Secure(?:;|$)/i.test(value) && /;\s*HttpOnly(?:;|$)/i.test(value) && /;\s*SameSite=Lax(?:;|$)/i.test(value),
    "The synthetic staging session must retain its cookie protections.");
  const cookie = value.split(";", 1)[0];
  check(!instance.sessions.has(cookie), "Independent logical guests cannot reuse a session cookie.");
  instance.sessions.add(cookie);
  const privateResponse = await request(instance, "/api/memories", { cookie });
  check(privateResponse.status === 401 && privateResponse.body.error?.code === "AUTH_REQUIRED", "A synthetic guest session acquired private couple access.");
  return cookie;
}
function verifyReceipt(receipt) {
  check(uuid.test(receipt?.contributionId) && receipt.eventKey === "kevin-mel-wedding" && !Number.isNaN(Date.parse(receipt.createdAt))
    && receipt.completion === "COMPLETE" && receipt.memories?.length === 1 && uuid.test(receipt.memories[0].memoryId)
    && receipt.memories[0].memoryType === "TEXT" && receipt.memories[0].clientItemId === null && receipt.memories[0].uploadState === null
    && receipt.memories[0].reviewStatus === "PENDING" && receipt.memories[0].visibility === "COUPLE_ONLY",
  "A committed text receipt changed its exact private identity or completion shape.");
  return receipt;
}
async function submit(instance, item, { payload = item.payload, expected, discard = false, metrics, extraHeaders = {} } = {}) {
  const response = await request(instance, "/api/contributions", { method: "POST", cookie: item.cookie, discard, metrics,
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": item.key, ...extraHeaders }, body: JSON.stringify(payload) });
  check(response.status === expected, "A submission did not return its expected create/replay/conflict/rate status.");
  instance.createCalls++;
  if (response.status !== 429) {
    instance.peerAdmissions++; instance.keyCalls.set(item.key, (instance.keyCalls.get(item.key) || 0) + 1);
  }
  return response;
}
async function readReceipt(instance, item, metrics) {
  const response = await request(instance, "/api/contributions/" + item.receipt.contributionId + "/receipt", {
    cookie: item.cookie, metrics, headers: { "Idempotency-Key": item.key } });
  check(response.status === 200, "A committed receipt could not be reconciled through its separate admission scope.");
  same(response.body, item.receipt, "A reconciled receipt changed the original durable identity.");
  instance.receiptCalls++; instance.receiptKeyCalls.set(item.key, (instance.receiptKeyCalls.get(item.key) || 0) + 1);
}
function item(cookie, index) {
  return { cookie, key: randomUUID(), payload: { guestName: index % 2 ? " " : " Synthetic Reception Guest " + index + " ",
    message: " Synthetic reception note " + index + ". " } };
}
async function wave(instance, count, concurrency, offset) {
  const guests = await receptionPool(Array.from({ length: count }, (_, index) => index + offset), concurrency,
    async index => item(await guest(instance), index));
  const measurements = [], started = performance.now(); instance.peak = 0;
  const records = await receptionPool(guests, concurrency, async current => {
    // Discard the committed application result before recovery. This represents
    // a synthetic lost-response state, not a measured browser/network drop.
    await submit(instance, current, { expected: 201, discard: true, metrics: measurements });
    current.receipt = verifyReceipt((await submit(instance, current, { expected: 200, metrics: measurements })).body);
    await readReceipt(instance, current, measurements);
    const conflict = await submit(instance, current, { payload: { ...current.payload, message: "Changed synthetic reception note." }, expected: 409, metrics: measurements });
    check(conflict.body.error?.code === "IDEMPOTENCY_CONFLICT", "A changed same-key note escaped the idempotency boundary.");
    return current;
  });
  check(instance.peak === concurrency && instance.active === 0, "The intended HTTP concurrency was not exercised or drained.");
  instance.records.push(...records);
  console.log("Reception wave: " + JSON.stringify({ logicalGuests: count, concurrency, peakHttpRequests: instance.peak,
    created: count, recoveredReplays: count, receipts: count, expectedConflicts: count, unexpectedErrors: 0,
    elapsedMs: Number((performance.now() - started).toFixed(1)), ...receptionTimings(measurements) }));
  await verifyRows(instance);
}
async function verifyRows(instance) {
  const rows = JSON.parse(await sql(instance, "SELECT COALESCE(json_agg(json_build_object('key',c.idempotency_key,'contributionId',c.id,'guestName',c.guest_name,"
    + "'fingerprint',c.request_fingerprint,'memoryId',m.id,'message',m.text_content,'type',m.memory_type,'review',m.review_status,'visibility',m.visibility,'revision',m.revision)"
    + " ORDER BY c.id),'[]'::json)::text FROM contribution c LEFT JOIN memory m ON m.contribution_id=c.id;"));
  check(rows.length === instance.records.length && new Set(rows.map(row => row.key)).size === rows.length
    && new Set(rows.map(row => row.contributionId)).size === rows.length && new Set(rows.map(row => row.memoryId)).size === rows.length,
  "The durable fixture has missing, duplicate or unexpected contribution/item identities.");
  const expected = new Map(instance.records.map(current => [current.key, current]));
  for (const row of rows) {
    const current = expected.get(row.key);
    check(current && row.contributionId === current.receipt.contributionId && row.memoryId === current.receipt.memories[0].memoryId
      && row.guestName === (current.payload.guestName.trim() || null) && row.message === current.payload.message.trim()
      && /^[0-9a-f]{64}$/.test(row.fingerprint) && row.type === "TEXT" && row.review === "PENDING" && row.visibility === "COUPLE_ONLY" && row.revision === 1,
    "A durable row disagrees with its exact recovered receipt, normalized text, fingerprint or privacy state.");
  }
  check(await sql(instance, "SELECT (SELECT count(*) FROM memory),(SELECT count(*) FROM media_asset),(SELECT count(*) FROM review_audit),(SELECT count(*) FROM upload_grant),(SELECT count(*) FROM deletion_ledger);")
    === instance.records.length + "|0|0|0|0", "The synthetic text waves created unexpected items, media, grants, review mutations or deletion plans.");
}
const digest = (operation, scope) => createHmac("sha256", throttleSecret).update("anonymous:v1:" + operation + ":" + scope).digest("hex");
async function verifyBuckets(instance, peerAttempts) {
  const rows = JSON.parse(await sql(instance, "SELECT COALESCE(json_agg(json_build_object('key',bucket_key,'attempts',attempts)),'[]'::json)::text FROM archive_anonymous_throttle;"));
  const expected = new Map([[digest("CREATE", "global"), instance.createCalls], [digest("RECEIPT", "global"), instance.receiptCalls]]);
  for (const [key, calls] of instance.keyCalls) expected.set(digest("CREATE", "key:" + key), calls);
  for (const [key, calls] of instance.receiptKeyCalls) expected.set(digest("RECEIPT", "key:" + key), calls);
  const unknown = [];
  for (const row of rows) {
    if (expected.has(row.key)) { check(row.attempts === expected.get(row.key), "A durable admission counter differs from the actual scoped requests."); expected.delete(row.key); }
    else unknown.push(row.attempts);
  }
  check(expected.size === 0, "An expected durable throttle scope was missing.");
  same(unknown.sort((left, right) => left - right), [peerAttempts, instance.receiptCalls].sort((left, right) => left - right),
    "Requests did not share exactly one durable CREATE peer scope and one separate receipt peer scope.");
}
function verify429(response) {
  const retry = response.headers.get("retry-after");
  check(response.body.error?.code === "RATE_LIMITED" && response.body.error?.message === "Please wait, then retry with the same note or photos."
    && /^[1-9][0-9]{0,2}$/.test(retry || "") && Number(retry) <= 900,
  "A scoped denied request did not preserve the safe error and bounded Retry-After contract.");
  return Number(retry);
}

const deliberateProbeFailure = "Deliberate healthy owned-fixture failure for cleanup verification.";
let failure, cleanupComplete = false, cleanupProbeTriggered = false;
try {
  const endpoint = (await docker(["context", "inspect", ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []), "--format", "{{.Endpoints.docker.Host}}"], "Local Docker endpoint check")).output;
  check(localDockerEndpoint(endpoint) && (!process.env.DOCKER_HOST || localDockerEndpoint(process.env.DOCKER_HOST)), "Reception smoke requires a local Docker endpoint.");
  const image = await immutableImage(options.image), postgres = await immutableImage(POSTGRES_17_IMAGE);
  check((await docker(["image", "inspect", "--format", "{{.Config.User}}", image], "Reviewed application user check")).output === "10001:10001",
    "The application image must declare the reviewed nonroot UID/GID.");
  const postgresEnvironment = JSON.parse((await docker(["image", "inspect", "--format", "{{json .Config.Env}}", postgres], "Existing PostgreSQL 17 check")).output);
  check(postgresEnvironment.includes("PG_MAJOR=17"), "The existing database image must declare PostgreSQL 17.");
  const inspector = prefix + "-inspect";
  await create(inspector, ["--network", "none", "--read-only", "--entrypoint", "sleep", image, "1"]);
  const jar = readJarTar((await ownedCommand(inspector, ["container", "cp", inspector + ":/app/app.jar", "-"], "Pinned application JAR copy", { bytes: true })).output);
  console.log("Reception artifact: image=" + image + " jar-sha256=" + sha256(jar) + " postgres=" + postgres);
  console.log("Reception scope: local text JSON, one 2GB/1CPU nonroot app per fixture, unchanged 15-minute CREATE limits 800 global/400 peer/12 retry-key; separate receipt scope.");
  networkAttempted = true;
  await docker(["network", "create", "--driver", "bridge", "--label", label, network], "Exclusive fixture network creation");
  const load = await fixture("load", image, postgres);
  if (options.probeFailureCleanup) {
    cleanupProbeTriggered = true;
    throw new RollbackFailure(deliberateProbeFailure);
  }
  await wave(load, 10, 10, 0);
  await wave(load, 20, 20, 10);
  await wave(load, 100, 20, 30);
  check(load.createCalls === 390 && load.records.length === 130, "The main guest waves changed their reviewed admission budget.");
  for (let index = 0; index < 10; index++) {
    const current = item(await guest(load), 130 + index);
    current.receipt = verifyReceipt((await submit(load, current, { expected: 201 })).body); load.records.push(current);
  }
  check(load.createCalls === 400, "The shared-peer proof must fill exactly its reviewed admitted capacity.");
  const denied = item(await guest(load), 140), deniedSpoofed = item(denied.cookie, 141);
  const peerRetryAfter = verify429(await submit(load, denied, { expected: 429 }));
  verify429(await submit(load, deniedSpoofed, { expected: 429, extraHeaders: { "X-Forwarded-For": "198.51.100.40",
    Forwarded: "for=198.51.100.40;proto=https;host=reception-smoke.invalid" } }));
  await readReceipt(load, load.records[0]);
  await verifyRows(load); await verifyBuckets(load, 400);
  console.log("Reception shared-peer proof: " + JSON.stringify({ admittedCreateCalls: 400, deniedFreshKeys: 2, retryAfterSeconds: peerRetryAfter,
    committedContributions: 140, committedItems: 140, duplicateIdentities: 0, forwardedSpoofDenied: true, separateReceiptRecovered: true }));
  await ownedCommand(load.app, ["container", "stop", "--time", "5", load.app], "Completed load fixture application stop");
  await ownedCommand(load.db, ["container", "stop", "--time", "5", load.db], "Completed load fixture database stop");

  // Fresh owned DB isolates the key-cap proof without resetting/aging any row.
  const key = await fixture("key", image, postgres), current = item(await guest(key), 0);
  current.receipt = verifyReceipt((await submit(key, current, { expected: 201 })).body); key.records.push(current);
  for (let index = 1; index < 12; index++) same((await submit(key, current, { expected: 200 })).body, current.receipt, "A bounded key replay changed its committed receipt.");
  const keyRetryAfter = verify429(await submit(key, current, { expected: 429 }));
  await ownedCommand(key.app, ["container", "restart", "--time", "5", key.app], "Owned application restart for durable key-cap proof");
  await waitForApplication(key);
  verify429(await submit(key, current, { expected: 429 }));
  const independent = item(await guest(key), 1);
  independent.receipt = verifyReceipt((await submit(key, independent, { expected: 201 })).body); key.records.push(independent);
  await readReceipt(key, current); await verifyRows(key); await verifyBuckets(key, 15);
  console.log("Reception retry-key proof: " + JSON.stringify({ admittedCallsForOriginalKey: 12, deniedSameKeyCalls: 2, retryAfterSeconds: keyRetryAfter,
    capSurvivedRestart: true, independentKeyAdmitted: true, separateReceiptRecovered: true, committedContributions: 2, committedItems: 2, duplicateIdentities: 0 }));
} catch (caught) {
  failure = caught instanceof RollbackFailure ? caught.message : "An unexpected local reception fixture check failed; inspect diagnostics privately.";
} finally {
  clearTimeout(deadline);
  try { cleanupComplete = await cleanupOwnedResources(); } catch { cleanupComplete = false; }
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
if (!cleanupComplete) {
  console.error("Reception smoke could not confirm cleanup. Inspect only this run's labelled resources privately: " + prefix); process.exitCode = 1;
} else if (timedOut) {
  console.error("Reception smoke exceeded its eight-minute deadline; all owned resources were removed."); process.exitCode = 1;
} else if (interrupted) {
  console.error("Reception smoke interrupted; all owned resources were removed."); process.exitCode = 130;
} else if (cleanupProbeTriggered && failure === deliberateProbeFailure) {
  console.log("Reception failure cleanup probe passed: the deliberate healthy-fixture failure reached finally; every exclusively owned container and network was removed and verified absent.");
} else if (failure) {
  console.error("Reception smoke failed: " + failure + " All owned resources were removed."); process.exitCode = 1;
} else {
  console.log("Reception smoke passed: 10/20 concurrent independent sessions, 100 logical guests at concurrency 20, exact private durable rows/receipts, discarded-response recovery/replay/conflict, unchanged shared-peer and persistent retry-key 429/Retry-After boundaries, receipt reconciliation and verified owned cleanup. Local one-process text JSON evidence; no media/R2, physical-device or hosted capacity claim.");
}
