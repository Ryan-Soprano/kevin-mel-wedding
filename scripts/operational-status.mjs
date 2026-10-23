import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPERATIONAL_STATUS_REF = "refs/heads/feature/operational-status";
export const OPERATIONAL_STATUS_PATH = "ops/operational-status.json";
export const OPERATIONAL_STATUS_MAX_BYTES = 4096;
export const OPERATIONAL_CHECKS = Object.freeze(["application", "database", "guestSaves", "media", "capacity"]);
export const OPERATIONAL_FAILURES = Object.freeze(["collector_failed", "source_unavailable", "storage_unavailable",
  "observation_gap", "runtime_unavailable", "publication_failed"]);
const ORIGIN = "https://github.com/Ryan-Soprano/kevin-mel-wedding.git";
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class OperationalStatusError extends Error {
  constructor(category = "invalid_status") {
    super("Operational status operation refused: " + category + ".");
    this.name = "OperationalStatusError";
    this.category = category;
  }
}
export function requireOperational(condition, category = "invalid_status") {
  if (!condition) throw new OperationalStatusError(category);
}
export function exactOperationalKeys(value, keys) {
  requireOperational(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const entries = Object.getOwnPropertyDescriptors(value);
  requireOperational(Reflect.ownKeys(entries).length === keys.length && keys.every(key =>
    Object.hasOwn(entries, key) && Object.hasOwn(entries[key], "value") && entries[key].enumerable));
}
export function operationalClock(now) {
  const value = now instanceof Date ? now.getTime() : now;
  requireOperational(Number.isSafeInteger(value) && value >= 0, "invalid_policy");
  return value;
}
export function operationalTime(value, maximum) {
  requireOperational(typeof value === "string" && UTC.test(value));
  const parsed = Date.parse(value);
  requireOperational(Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    && new Date(parsed).toISOString() === value);
  return parsed;
}

// Duplicate and escaped-duplicate fields are refused before any shape is trusted.
export function parseOperationalJson(text, maximum = OPERATIONAL_STATUS_MAX_BYTES) {
  requireOperational(typeof text === "string" && Buffer.byteLength(text, "utf8") <= maximum);
  try {
    const parsed = JSON.parse(text);
    const objects = [];
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
      if (match[0] === "{") objects.push(new Set());
      else if (match[0] === "[") objects.push(null);
      else if (match[0] === "}" || match[0] === "]") objects.pop();
      else if (/^\s*:/.test(text.slice(match.index + match[0].length))) {
        const key = JSON.parse(match[0]);
        const seen = objects.at(-1);
        requireOperational(seen instanceof Set && !seen.has(key));
        seen.add(key);
      }
    }
    return parsed;
  } catch { throw new OperationalStatusError(); }
}

function validate(value, kind, now) {
  exactOperationalKeys(value, ["schemaVersion", "kind", "observedAt", ...OPERATIONAL_CHECKS, "failure"]);
  requireOperational(value.schemaVersion === 1 && value.kind === kind);
  const observed = operationalTime(value.observedAt, now);
  const checks = {};
  for (const name of OPERATIONAL_CHECKS) {
    exactOperationalKeys(value[name], ["checkedAt", "state"]);
    operationalTime(value[name].checkedAt, observed);
    requireOperational(["clear", "incident", "unconfirmed"].includes(value[name].state));
    checks[name] = Object.freeze({ checkedAt: value[name].checkedAt, state: value[name].state });
  }
  requireOperational(value.failure === null || OPERATIONAL_FAILURES.includes(value.failure));
  requireOperational(value.failure === null || OPERATIONAL_CHECKS.some(name => checks[name].state !== "clear"));
  return Object.freeze({ schemaVersion: 1, kind, observedAt: value.observedAt, ...checks, failure: value.failure });
}
export function validateOperationalStatus(value, { now = Date.now() } = {}) {
  return validate(value, "kevin-mel-operational-status", operationalClock(now));
}
export function statusFromOperationalReceipt(value, { now = Date.now() } = {}) {
  const receipt = validate(value, "kevin-mel-operational-receipt", operationalClock(now));
  return validateOperationalStatus({ ...receipt, kind: "kevin-mel-operational-status" }, { now });
}
export function parseOperationalStatusJson(text, options) {
  return validateOperationalStatus(parseOperationalJson(text), options);
}
export function parseOperationalReceiptJson(text, options) {
  return statusFromOperationalReceipt(parseOperationalJson(text), options);
}
export function evaluateOperationalStatus(value, { now = Date.now(), maxAgeMs = 300_000 } = {}) {
  const current = operationalClock(now);
  requireOperational(Number.isSafeInteger(maxAgeMs) && maxAgeMs >= 1000 && maxAgeMs <= 300_000, "invalid_policy");
  let status;
  try { status = validateOperationalStatus(value, { now: current }); } catch { /* unknown is never healthy */ }
  const result = {};
  for (const name of OPERATIONAL_CHECKS) {
    result[name] = !status || current - Date.parse(status.observedAt) > maxAgeMs
      || current - Date.parse(status[name].checkedAt) > maxAgeMs ? "unconfirmed" : status[name].state;
  }
  result.observation = !status || status.failure !== null || current - Date.parse(status.observedAt) > maxAgeMs
    ? "unconfirmed" : "clear";
  return Object.freeze(result);
}

export function readOperationalReceipt(file, now = Date.now()) {
  let handle;
  try {
    const before = fs.lstatSync(file);
    requireOperational(before.isFile() && !before.isSymbolicLink() && before.size > 0
      && before.size <= OPERATIONAL_STATUS_MAX_BYTES, "invalid_receipt");
    handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(handle);
    requireOperational(opened.isFile() && opened.size === before.size && opened.dev === before.dev
      && opened.ino === before.ino, "invalid_receipt");
    const bytes = Buffer.alloc(OPERATIONAL_STATUS_MAX_BYTES + 1);
    const size = fs.readSync(handle, bytes, 0, bytes.length, 0);
    requireOperational(size === before.size && size <= OPERATIONAL_STATUS_MAX_BYTES, "invalid_receipt");
    return parseOperationalReceiptJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)), { now });
  } catch { throw new OperationalStatusError("invalid_receipt"); }
  finally { if (handle !== undefined) fs.closeSync(handle); }
}

function gitEnvironment(indexFile) {
  const result = { ...process.env };
  for (const key of Object.keys(result)) {
    if (/^GIT_(?:DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|REPLACE_REF_BASE|CONFIG(?:_|$)|TRACE|AUTHOR_|COMMITTER_)/i.test(key)) delete result[key];
  }
  return { ...result, GIT_INDEX_FILE: indexFile, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never",
    GIT_NO_REPLACE_OBJECTS: "1", GIT_SSL_NO_VERIFY: "false" };
}
function privateDirectory(directory) {
  try {
    requireOperational(typeof directory === "string" && path.isAbsolute(directory));
    const original = fs.lstatSync(directory);
    requireOperational(original.isDirectory() && !original.isSymbolicLink());
    const actual = fs.realpathSync(directory);
    if (process.platform !== "win32") {
      const info = fs.statSync(actual);
      requireOperational(info.uid === process.getuid() && (info.mode & 0o077) === 0);
    } else {
      const script = "$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:OPERATIONAL_STATUS_PRIVATE_DIRECTORY;"
        + "$u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
        + "if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $u){exit 1};"
        + "foreach($r in $a.Access){if($r.AccessControlType -eq 'Allow'){"
        + "$sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;"
        + "if($sid -notin @($u,'S-1-5-18','S-1-5-32-544')){exit 1}}};exit 0";
      const environment = { ...process.env, OPERATIONAL_STATUS_PRIVATE_DIRECTORY: actual };
      for (const key of Object.keys(environment)) if (/^PSModulePath$/i.test(key)) delete environment[key];
      const checked = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: environment, encoding: "utf8", maxBuffer: 1024, timeout: 10_000, windowsHide: true,
      });
      requireOperational(!checked.error && checked.status === 0);
    }
    return actual;
  } catch { throw new OperationalStatusError("private_directory_required"); }
}
export function ensureOperationalStatusProgress(previous, next) {
  requireOperational(Date.parse(next.observedAt) >= Date.parse(previous.observedAt), "status_regression");
  if (next.observedAt === previous.observedAt) {
    requireOperational(JSON.stringify(next) === JSON.stringify(previous), "status_regression");
  }
  for (const name of OPERATIONAL_CHECKS) {
    requireOperational(Date.parse(next[name].checkedAt) >= Date.parse(previous[name].checkedAt), "status_regression");
    if (next[name].checkedAt === previous[name].checkedAt) {
      requireOperational(next[name].state === previous[name].state, "status_regression");
    }
  }
}

// spawnImpl is a local test seam; the CLI always uses the system Git implementation.
export function publishOperationalStatus(status, { repository, privateWorkDirectory, now = Date.now(), spawnImpl = spawnSync } = {}) {
  const accepted = validateOperationalStatus(status, { now: operationalClock(now) });
  const parent = privateDirectory(privateWorkDirectory);
  const temporary = fs.mkdtempSync(path.join(parent, "operational-status-"));
  fs.chmodSync(temporary, 0o700);
  const environment = gitEnvironment(path.join(temporary, "index"));
  const hooks = path.join(temporary, "empty-hooks");
  fs.mkdirSync(hooks, { mode: 0o700 });
  try {
    requireOperational(typeof repository === "string" && path.isAbsolute(repository), "repository_required");
    const command = (args, input, allowed = [0]) => {
      const result = spawnImpl("git", ["--no-pager", "-C", repository, "-c", "core.hooksPath=" + hooks,
        "-c", "http.sslVerify=true", "-c", "remote.origin.mirror=false", ...args], {
        env: environment, encoding: "utf8", input, maxBuffer: 65_536, timeout: 60_000, windowsHide: true,
      });
      requireOperational(!result.error && allowed.includes(result.status), "git_failed");
      return { code: result.status, output: result.stdout.trim() };
    };
    requireOperational(command(["rev-parse", "--is-inside-work-tree"]).output === "true", "repository_required");
    for (const args of [["config", "--get-all", "remote.origin.url"], ["remote", "get-url", "--all", "origin"],
      ["remote", "get-url", "--push", "--all", "origin"]]) {
      requireOperational(command(args).output === ORIGIN, "origin_not_allowed");
    }
    const remote = command(["ls-remote", "--exit-code", "--refs", "origin", OPERATIONAL_STATUS_REF], undefined, [0, 2]);
    let previousCommit;
    let previous;
    if (remote.code === 0) {
      const entries = remote.output.split("\n");
      const fields = entries[0]?.split(/\s+/);
      requireOperational(entries.length === 1 && fields.length === 2 && OBJECT_ID.test(fields[0])
        && fields[1] === OPERATIONAL_STATUS_REF, "invalid_remote_status");
      previousCommit = fields[0];
      command(["fetch", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "origin", previousCommit]);
      const entry = command(["ls-tree", "-r", previousCommit]).output.split(/\s+/);
      requireOperational(entry.length === 4 && entry[0] === "100644" && entry[1] === "blob"
        && OBJECT_ID.test(entry[2]) && entry[3] === OPERATIONAL_STATUS_PATH, "invalid_remote_status");
      const size = command(["cat-file", "-s", entry[2]]).output;
      requireOperational(/^[1-9]\d{0,3}$/.test(size) && Number(size) <= OPERATIONAL_STATUS_MAX_BYTES, "invalid_remote_status");
      previous = parseOperationalStatusJson(command(["cat-file", "blob", entry[2]]).output, { now });
      ensureOperationalStatusProgress(previous, accepted);
    } else requireOperational(remote.output === "", "invalid_remote_status");
    if (previous && JSON.stringify(previous) === JSON.stringify(accepted)) return Object.freeze({ published: false });
    command(["read-tree", "--empty"]);
    const blob = command(["hash-object", "-w", "--stdin"], JSON.stringify(accepted, null, 2) + "\n").output;
    requireOperational(OBJECT_ID.test(blob), "git_failed");
    command(["update-index", "--add", "--cacheinfo", "100644," + blob + "," + OPERATIONAL_STATUS_PATH]);
    const tree = command(["write-tree"]).output;
    requireOperational(OBJECT_ID.test(tree), "git_failed");
    const args = ["-c", "commit.gpgsign=false", "-c", "user.name=Operational status publisher",
      "-c", "user.email=operational-status@users.noreply.github.com", "commit-tree", tree];
    if (previousCommit) args.push("-p", previousCommit);
    const commit = command(args, "Update content-free operational status\n").output;
    requireOperational(OBJECT_ID.test(commit), "git_failed");
    command(["push", "--porcelain", "--no-follow-tags", "origin", commit + ":" + OPERATIONAL_STATUS_REF]);
    return Object.freeze({ published: true });
  } finally {
    requireOperational(path.dirname(temporary) === parent && path.basename(temporary).startsWith("operational-status-"), "cleanup_refused");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Validate: --validate-receipt <receipt.json>\nPublish allowlisted operational evidence: --publish --receipt <receipt.json> --repository <absolute-checkout> --private-work-directory <existing-private-directory>\nUses existing Git authentication; does not collect observations or modify backup status.");
    return;
  }
  if (args.length === 2 && args[0] === "--validate-receipt") {
    readOperationalReceipt(args[1]);
    console.log("Operational receipt shape valid; live observations require independent acceptance.");
    return;
  }
  requireOperational(args.length === 7 && args[0] === "--publish" && args[1] === "--receipt"
    && args[3] === "--repository" && args[5] === "--private-work-directory", "invalid_arguments");
  const result = publishOperationalStatus(readOperationalReceipt(args[2]), { repository: args[4], privateWorkDirectory: args[6] });
  console.log(result.published ? "Content-free operational status published." : "Content-free operational status already current.");
}
if (process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (failure) {
    console.error(failure instanceof OperationalStatusError ? failure.message : "Operational status operation failed; inspect privately.");
    process.exitCode = 1;
  }
}
