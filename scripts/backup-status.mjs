import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This protocol reports an adapter's evidence. It does not capture a backup,
// authenticate its receipt, or establish that the home producer is installed.
export const BACKUP_STATUS_REF = "refs/heads/feature/backup-status";
export const BACKUP_STATUS_PATH = "ops/backup-status.json";
export const BACKUP_STATUS_MAX_BYTES = 16_384;
export const BACKUP_FAILURE_CATEGORIES = Object.freeze([
  "capture_failed", "encryption_failed", "verification_failed", "publication_failed",
  "media_copy_failed", "ledger_copy_failed", "expiry_failed", "storage_unavailable",
  "access_unavailable", "runtime_unavailable", "adapter_unavailable", "no_accepted_backup",
]);
const STATUS_KIND = "kevin-mel-backup-status";
const RECEIPT_KIND = "kevin-mel-backup-receipt";
const ORIGIN = "https://github.com/Ryan-Soprano/kevin-mel-wedding.git";
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class BackupStatusError extends Error {
  constructor(category = "invalid_status") {
    super("Backup status operation refused: " + category + ".");
    this.name = "BackupStatusError";
    this.category = category;
  }
}

function requireCondition(condition, category = "invalid_status") {
  if (!condition) throw new BackupStatusError(category);
}

function objectWithKeys(value, keys) {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireCondition(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value") && descriptors[key].enumerable));
}

function clockValue(now) {
  const value = now instanceof Date ? now.getTime() : now;
  requireCondition(Number.isSafeInteger(value) && value >= 0, "invalid_policy");
  return value;
}

function timestamp(value, now) {
  requireCondition(typeof value === "string" && ISO_UTC.test(value));
  const parsed = Date.parse(value);
  requireCondition(Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= now
    && new Date(parsed).toISOString() === value);
  return parsed;
}

function validateEvidence(value, kind, now) {
  objectWithKeys(value, ["schemaVersion", "kind", "state", "observedAt", "database", "media", "ledger", "expiry", "failure"]);
  requireCondition(value.schemaVersion === 1 && value.kind === kind
    && ["accepted", "unavailable"].includes(value.state));
  const observed = timestamp(value.observedAt, now);
  objectWithKeys(value.database, ["recoveryPointAt", "verifiedAt"]);
  objectWithKeys(value.media, ["verifiedAt"]);
  objectWithKeys(value.ledger, ["verifiedAt"]);
  objectWithKeys(value.expiry, ["checkedAt", "healthy"]);
  requireCondition(value.failure === null || BACKUP_FAILURE_CATEGORIES.includes(value.failure));
  if (value.state === "unavailable") {
    requireCondition(value.database.recoveryPointAt === null && value.database.verifiedAt === null
      && value.media.verifiedAt === null && value.ledger.verifiedAt === null
      && value.expiry.checkedAt === null && value.expiry.healthy === null
      && value.failure !== null);
  } else {
    const point = timestamp(value.database.recoveryPointAt, observed);
    const verified = timestamp(value.database.verifiedAt, observed);
    requireCondition(point <= verified && typeof value.expiry.healthy === "boolean");
    timestamp(value.media.verifiedAt, observed);
    timestamp(value.ledger.verifiedAt, observed);
    timestamp(value.expiry.checkedAt, observed);
  }
  return Object.freeze({
    schemaVersion: 1, kind, state: value.state, observedAt: value.observedAt,
    database: Object.freeze({ recoveryPointAt: value.database.recoveryPointAt, verifiedAt: value.database.verifiedAt }),
    media: Object.freeze({ verifiedAt: value.media.verifiedAt }),
    ledger: Object.freeze({ verifiedAt: value.ledger.verifiedAt }),
    expiry: Object.freeze({ checkedAt: value.expiry.checkedAt, healthy: value.expiry.healthy }),
    failure: value.failure,
  });
}

export function validateBackupStatus(value, { now = Date.now() } = {}) {
  return validateEvidence(value, STATUS_KIND, clockValue(now));
}

export function statusFromBackupReceipt(value, { now = Date.now() } = {}) {
  const receipt = validateEvidence(value, RECEIPT_KIND, clockValue(now));
  return validateBackupStatus({ ...receipt, kind: STATUS_KIND }, { now });
}

// JSON.parse alone accepts duplicate keys. Reject them before validating the
// exact content-free shape; diagnostics never include input values or paths.
function parseJson(text) {
  requireCondition(typeof text === "string" && Buffer.byteLength(text, "utf8") <= BACKUP_STATUS_MAX_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(text);
    const objects = [];
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
      if (match[0] === "{") objects.push(new Set());
      else if (match[0] === "[") objects.push(null);
      else if (match[0] === "}" || match[0] === "]") objects.pop();
      else if (/^\s*:/.test(text.slice(match.index + match[0].length))) {
        const key = JSON.parse(match[0]);
        const seen = objects.at(-1);
        requireCondition(seen instanceof Set && !seen.has(key));
        seen.add(key);
      }
    }
  } catch {
    throw new BackupStatusError();
  }
  return parsed;
}

export function parseBackupStatusJson(text, options) {
  return validateBackupStatus(parseJson(text), options);
}

export function parseBackupReceiptJson(text, options) {
  return statusFromBackupReceipt(parseJson(text), options);
}

export function evaluateBackupStatus(value, {
  now = Date.now(), databaseMaxAgeMs, mediaMaxAgeMs, ledgerMaxAgeMs, expiryMaxAgeMs,
} = {}) {
  const current = clockValue(now);
  for (const bound of [databaseMaxAgeMs, mediaMaxAgeMs, ledgerMaxAgeMs, expiryMaxAgeMs]) {
    requireCondition(Number.isSafeInteger(bound) && bound >= 1_000 && bound <= 30 * 86_400_000, "invalid_policy");
  }
  let status;
  try { status = validateBackupStatus(value, { now: current }); }
  catch { return Object.freeze({ healthy: false, category: "invalid_status", reasons: Object.freeze(["invalid_status"]), agesMs: null }); }
  if (status.state === "unavailable") {
    return Object.freeze({ healthy: false, category: "backup_unavailable", reasons: Object.freeze(["backup_unavailable"]), agesMs: null });
  }
  const agesMs = Object.freeze({
    database: current - Date.parse(status.database.recoveryPointAt),
    media: current - Date.parse(status.media.verifiedAt),
    ledger: current - Date.parse(status.ledger.verifiedAt),
    expiry: current - Date.parse(status.expiry.checkedAt),
  });
  const reasons = [];
  if (status.failure !== null) reasons.push("backup_failure");
  if (!status.expiry.healthy) reasons.push("expiry_unhealthy");
  for (const [area, limit] of [["database", databaseMaxAgeMs], ["media", mediaMaxAgeMs], ["ledger", ledgerMaxAgeMs], ["expiry", expiryMaxAgeMs]]) {
    if (agesMs[area] > limit) reasons.push("stale_" + area);
  }
  return Object.freeze({ healthy: reasons.length === 0, category: reasons[0] || "healthy", reasons: Object.freeze(reasons), agesMs });
}

function readReceipt(file, now) {
  let handle;
  try {
    const before = fs.lstatSync(file);
    requireCondition(before.isFile() && !before.isSymbolicLink() && before.size > 0
      && before.size <= BACKUP_STATUS_MAX_BYTES, "invalid_receipt");
    handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(handle);
    requireCondition(opened.isFile() && opened.size === before.size && opened.dev === before.dev
      && opened.ino === before.ino, "invalid_receipt");
    const bytes = Buffer.alloc(BACKUP_STATUS_MAX_BYTES + 1);
    const size = fs.readSync(handle, bytes, 0, bytes.length, 0);
    requireCondition(size === before.size && size <= BACKUP_STATUS_MAX_BYTES, "invalid_receipt");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    return parseBackupReceiptJson(text, { now });
  } catch { throw new BackupStatusError("invalid_receipt"); }
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

function gitCommand(repository, environment, args, input, allowed = [0]) {
  const hooks = path.join(path.dirname(environment.GIT_INDEX_FILE), "empty-hooks");
  const result = spawnSync("git", ["--no-pager", "-C", repository, "-c", "core.hooksPath=" + hooks,
    "-c", "http.sslVerify=true", "-c", "remote.origin.mirror=false", ...args], {
    env: environment, encoding: "utf8", input, maxBuffer: 65_536, timeout: 60_000, windowsHide: true,
  });
  requireCondition(!result.error && allowed.includes(result.status), "git_failed");
  return { code: result.status, output: result.stdout.trim() };
}

function privateDirectory(directory) {
  let actual;
  try {
    requireCondition(typeof directory === "string" && path.isAbsolute(directory), "private_directory_required");
    const original = fs.lstatSync(directory);
    requireCondition(original.isDirectory() && !original.isSymbolicLink(), "private_directory_required");
    actual = fs.realpathSync(directory);
    if (process.platform !== "win32") {
      const information = fs.statSync(actual);
      requireCondition(information.uid === process.getuid() && (information.mode & 0o077) === 0, "private_directory_required");
    } else {
      // No credentials are read. Reject inherited access for other principals;
      // SYSTEM and local Administrators retain their normal recovery access.
      const script = "$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:BACKUP_STATUS_PRIVATE_DIRECTORY;"
        + "$u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
        + "$owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;"
        + "if($owner -ne $u){exit 1};foreach($r in $a.Access){"
        + "if($r.AccessControlType -eq 'Allow'){"
        + "$sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;"
        + "if($sid -notin @($u,'S-1-5-18','S-1-5-32-544')){exit 1}}};exit 0";
      const aclEnvironment = { ...process.env, BACKUP_STATUS_PRIVATE_DIRECTORY: actual };
      // A parent PowerShell 7 module path cannot be loaded by Windows
      // PowerShell 5.1. Let that built-in shell discover its own modules.
      for (const key of Object.keys(aclEnvironment)) if (/^PSModulePath$/i.test(key)) delete aclEnvironment[key];
      const checked = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: aclEnvironment, encoding: "utf8",
        maxBuffer: 1_024, timeout: 10_000, windowsHide: true,
      });
      requireCondition(!checked.error && checked.status === 0, "private_directory_required");
    }
  } catch { throw new BackupStatusError("private_directory_required"); }
  return actual;
}

function ensureNoRegression(previous, next) {
  requireCondition(Date.parse(next.observedAt) >= Date.parse(previous.observedAt), "status_regression");
  if (previous.state !== "accepted") return;
  requireCondition(next.state === "accepted", "status_regression");
  for (const [oldTime, newTime] of [
    [previous.database.recoveryPointAt, next.database.recoveryPointAt],
    [previous.database.verifiedAt, next.database.verifiedAt],
    [previous.media.verifiedAt, next.media.verifiedAt],
    [previous.ledger.verifiedAt, next.ledger.verifiedAt],
    [previous.expiry.checkedAt, next.expiry.checkedAt],
  ]) requireCondition(Date.parse(newTime) >= Date.parse(oldTime), "status_regression");
}

export function publishBackupStatus(status, { repository, privateWorkDirectory, now = Date.now() } = {}) {
  const current = clockValue(now);
  const accepted = validateBackupStatus(status, { now: current });
  const parent = privateDirectory(privateWorkDirectory);
  const temporary = fs.mkdtempSync(path.join(parent, "backup-status-"), { encoding: "utf8" });
  fs.chmodSync(temporary, 0o700);
  const index = path.join(temporary, "index");
  fs.mkdirSync(path.join(temporary, "empty-hooks"), { mode: 0o700 });
  const environment = gitEnvironment(index);
  try {
    requireCondition(typeof repository === "string" && path.isAbsolute(repository), "repository_required");
    const command = (args, input, allowed) => gitCommand(repository, environment, args, input, allowed);
    requireCondition(command(["rev-parse", "--is-inside-work-tree"]).output === "true", "repository_required");
    for (const args of [["config", "--get-all", "remote.origin.url"], ["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
      requireCondition(command(args).output === ORIGIN, "origin_not_allowed");
    }
    const remote = command(["ls-remote", "--exit-code", "--refs", "origin", BACKUP_STATUS_REF], undefined, [0, 2]);
    let previousCommit;
    let previous;
    if (remote.code === 0) {
      const entries = remote.output.split("\n");
      const fields = entries[0]?.split(/\s+/);
      requireCondition(entries.length === 1 && fields.length === 2 && OBJECT_ID.test(fields[0])
        && fields[1] === BACKUP_STATUS_REF, "invalid_remote_status");
      previousCommit = fields[0];
      command(["fetch", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "origin", previousCommit]);
      const tree = command(["ls-tree", "-r", previousCommit]).output;
      const entry = tree.split(/\s+/);
      requireCondition(entry.length === 4 && entry[0] === "100644" && entry[1] === "blob"
        && OBJECT_ID.test(entry[2]) && entry[3] === BACKUP_STATUS_PATH, "invalid_remote_status");
      const bytes = command(["cat-file", "-s", entry[2]]).output;
      requireCondition(/^[1-9]\d{0,4}$/.test(bytes) && Number(bytes) <= BACKUP_STATUS_MAX_BYTES, "invalid_remote_status");
      previous = parseBackupStatusJson(command(["cat-file", "blob", entry[2]]).output, { now: current });
      ensureNoRegression(previous, accepted);
    } else requireCondition(remote.output === "", "invalid_remote_status");
    const serialized = JSON.stringify(accepted, null, 2) + "\n";
    if (previous && JSON.stringify(previous) === JSON.stringify(accepted)) return Object.freeze({ published: false });
    command(["read-tree", "--empty"]);
    const blob = command(["hash-object", "-w", "--stdin"], serialized).output;
    requireCondition(OBJECT_ID.test(blob), "git_failed");
    command(["update-index", "--add", "--cacheinfo", "100644," + blob + "," + BACKUP_STATUS_PATH]);
    const tree = command(["write-tree"]).output;
    requireCondition(OBJECT_ID.test(tree), "git_failed");
    const args = ["-c", "commit.gpgsign=false", "-c", "user.name=Backup status publisher",
      "-c", "user.email=backup-status@users.noreply.github.com", "commit-tree", tree];
    if (previousCommit) args.push("-p", previousCommit);
    const commit = command(args, "Update content-free backup status\n").output;
    requireCondition(OBJECT_ID.test(commit), "git_failed");
    // No force, local ref updates, checkout, reset, or application-index writes.
    // A concurrent publisher causes a normal non-fast-forward refusal.
    command(["push", "--porcelain", "--no-follow-tags", "origin", commit + ":" + BACKUP_STATUS_REF]);
    return Object.freeze({ published: true });
  } finally {
    requireCondition(path.dirname(temporary) === parent && path.basename(temporary).startsWith("backup-status-"), "cleanup_refused");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Validate an explicit adapter receipt: --validate-receipt <receipt.json>\n"
      + "Publish only its allowlisted content-free fields: --publish --receipt <receipt.json> --repository <absolute-checkout> --private-work-directory <existing-owner-only-directory>\n"
      + "Uses existing Git authentication and a private alternate index; never captures/encrypts backups or installs the home adapter.");
    return;
  }
  const now = Date.now();
  if (args.length === 2 && args[0] === "--validate-receipt") {
    readReceipt(args[1], now);
    console.log("Backup receipt shape valid; capture acceptance must be established by the home adapter.");
    return;
  }
  requireCondition(args.length === 7 && args[0] === "--publish" && args[1] === "--receipt"
    && args[3] === "--repository" && args[5] === "--private-work-directory", "invalid_arguments");
  const status = readReceipt(args[2], now);
  const result = publishBackupStatus(status, { repository: args[4], privateWorkDirectory: args[6], now });
  console.log(result.published ? "Content-free backup status published." : "Content-free backup status already current.");
}

if (process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof BackupStatusError ? error.message : "Backup status operation failed; inspect privately.");
    process.exitCode = 1;
  }
}
