import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BACKUP_STATUS_PATH, BACKUP_STATUS_REF, evaluateBackupStatus, parseBackupStatusJson } from "./backup-status.mjs";

export const WATCHDOG_REPOSITORY = "Ryan-Soprano/kevin-mel-wedding";
export const WATCHDOG_ISSUE_TITLE = "Backup watchdog operations";
export const WATCHDOG_ISSUE_OPT_IN = "<!-- kevin-mel-backup-watchdog:allow -->";
const OWNER = "Ryan-Soprano";
const API = "https://api.github.com";
const STATUS_BYTES = 16 * 1024;
const RESPONSE_BYTES = 512 * 1024;
const REMINDER_MS = 60 * 60 * 1000;
const CATEGORIES = new Set(["healthy", "invalid_status", "backup_unavailable", "backup_failure", "expiry_unhealthy",
  "stale_database", "stale_media", "stale_ledger", "stale_expiry", "status_unavailable", "synthetic_failure"]);
const OUTCOMES = new Set(["initialized", "unchanged", "incident", "reminder", "recovery"]);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class BackupWatchdogError extends Error {
  constructor(category) { super(category); this.name = "BackupWatchdogError"; this.category = category; }
}
function requireValue(condition, category = "configuration_error") {
  if (!condition) throw new BackupWatchdogError(category);
}
function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validTime(value, now) {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value && Date.parse(value) <= now;
}
function positiveInteger(value, maximum) {
  return typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) <= maximum;
}

export function readWatchdogConfiguration(env) {
  // A manual isolated notification test proves recipient delivery before live
  // activation. It still requires budget approval and every repository/issue,
  // token, mode and threshold boundary below.
  if (env.ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED !== "true") return null;
  const synthetic = ["synthetic-failure", "synthetic-recovery"].includes(env.ARCHIVE_BACKUP_WATCHDOG_MODE);
  if (!synthetic && !["ARCHIVE_BACKUP_WATCHDOG_ENABLED", "ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED",
    "ARCHIVE_BACKUP_WATCHDOG_HOST_PROOF_CONFIRMED"].every(key => env[key] === "true")) return null;
  requireValue(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === WATCHDOG_REPOSITORY);
  requireValue(typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.length > 0
    && env.GITHUB_TOKEN.length <= 4096 && !/[\r\n]/.test(env.GITHUB_TOKEN));
  requireValue(positiveInteger(env.ARCHIVE_BACKUP_WATCHDOG_ISSUE, 999999));
  requireValue(typeof env.GITHUB_RUN_ID === "string" && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID));
  requireValue(["live", "synthetic-failure", "synthetic-recovery"].includes(env.ARCHIVE_BACKUP_WATCHDOG_MODE));
  requireValue(!synthetic || env.GITHUB_EVENT_NAME === "workflow_dispatch");
  const thresholds = {};
  for (const [name, target] of [["DATABASE", "databaseMaxAgeMs"], ["MEDIA", "mediaMaxAgeMs"],
    ["LEDGER", "ledgerMaxAgeMs"], ["EXPIRY", "expiryMaxAgeMs"]]) {
    const value = env[`ARCHIVE_BACKUP_WATCHDOG_${name}_MAX_AGE_SECONDS`];
    requireValue(positiveInteger(value, name === "EXPIRY" ? 86400 : 300));
    thresholds[target] = Number(value) * 1000;
  }
  return Object.freeze({ issue: Number(env.ARCHIVE_BACKUP_WATCHDOG_ISSUE), token: env.GITHUB_TOKEN,
    mode: env.ARCHIVE_BACKUP_WATCHDOG_MODE, runId: env.GITHUB_RUN_ID, thresholds: Object.freeze(thresholds) });
}

/** Fixed GitHub origin, no redirects, bounded body/deadline and no raw provider errors. */
export function createWatchdogApi(token, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  requireValue(typeof fetchImpl === "function" && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
  return async function request(path, { method = "GET", body } = {}) {
    requireValue(typeof path === "string" && (path === `/repos/${WATCHDOG_REPOSITORY}`
      || path.startsWith(`/repos/${WATCHDOG_REPOSITORY}/`))
      && !/[\r\n#]/.test(path) && ["GET", "POST", "PATCH"].includes(method));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(API + path, { method, redirect: "error", signal: controller.signal,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      requireValue(response.ok, "github_unavailable");
      const reader = response.body?.getReader();
      requireValue(reader, "github_unavailable");
      let length = 0;
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new BackupWatchdogError("github_unavailable");
        }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new BackupWatchdogError("github_unavailable");
    } finally { clearTimeout(timer); }
  };
}

export function decodeStatusFile(value, { now = Date.now() } = {}) {
  requireValue(value?.type === "file" && value.path === BACKUP_STATUS_PATH && value.encoding === "base64"
    && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= STATUS_BYTES
    && typeof value.content === "string" && value.content.length <= STATUS_BYTES * 2, "invalid_status");
  const encoded = value.content.replace(/\n/g, "");
  requireValue(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), "invalid_status");
  const bytes = Buffer.from(encoded, "base64");
  requireValue(bytes.length === value.size && bytes.toString("base64") === encoded, "invalid_status");
  try { return parseBackupStatusJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { now }); }
  catch { throw new BackupWatchdogError("invalid_status"); }
}

function statePrefix(mode) { return `<!-- kevin-mel-backup-watchdog-state:v1:${mode} -->\n`; }
export function encodeWatchdogState(state) {
  return statePrefix(state.mode) + "```json\n" + JSON.stringify(state) + "\n```";
}
export function decodeWatchdogState(body, mode, now) {
  requireValue(typeof body === "string" && body.length <= 2048 && body.startsWith(statePrefix(mode)), "invalid_state");
  const encoded = body.slice(statePrefix(mode).length);
  requireValue(encoded.startsWith("```json\n") && encoded.endsWith("\n```"), "invalid_state");
  let value;
  try { value = JSON.parse(encoded.slice(8, -4)); } catch { throw new BackupWatchdogError("invalid_state"); }
  requireValue(exactKeys(value, ["schemaVersion", "kind", "mode", "incident", "lastNotificationAt"])
    && value.schemaVersion === 1 && value.kind === "kevin-mel-backup-watchdog-state" && value.mode === mode
    && (value.incident === null || (CATEGORIES.has(value.incident) && value.incident !== "healthy"))
    && (value.lastNotificationAt === null || validTime(value.lastNotificationAt, now))
    && (value.incident === null || value.lastNotificationAt !== null)
    && encodeWatchdogState(value) === body, "invalid_state");
  return Object.freeze(value);
}

export function planWatchdogNotification(previous, category, now) {
  requireValue(CATEGORIES.has(category) && Number.isSafeInteger(now) && now >= 0, "invalid_state");
  const incident = category === "healthy" ? null : category;
  let outcome = "unchanged";
  if (!previous) outcome = incident ? "incident" : "initialized";
  else if (previous.incident !== incident) outcome = incident ? "incident" : "recovery";
  else if (incident && now - Date.parse(previous.lastNotificationAt) >= REMINDER_MS) outcome = "reminder";
  requireValue(OUTCOMES.has(outcome), "invalid_state");
  const notify = ["incident", "reminder", "recovery"].includes(outcome);
  return Object.freeze({ outcome, notify, incident,
    lastNotificationAt: notify ? new Date(now).toISOString() : previous?.lastNotificationAt ?? null });
}

function alertText(plan, category, mode, runId, now) {
  const label = mode === "synthetic" ? "Synthetic backup-watchdog test" : "Backup watchdog";
  const message = plan.outcome === "recovery" ? "the previously reported backup condition has cleared."
    : plan.outcome === "reminder" ? "the backup condition remains unresolved; operator attention is required."
      : "backup health could not be confirmed; operator attention is required.";
  return `@${OWNER} ${label}: ${message}\n\nCondition: \`${category}\`. Observed: ${new Date(now).toISOString()}.\n\n`
    + `[Review this watchdog run](https://github.com/${WATCHDOG_REPOSITORY}/actions/runs/${runId}). `
    + "A successful watchdog run proves this check completed; it does not establish complete backup coverage or a recovery guarantee.";
}

export async function runBackupWatchdog({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const config = readWatchdogConfiguration(env);
  if (!config) return Object.freeze({ category: "disabled", outcome: "skipped" });
  requireValue(Number.isSafeInteger(now) && now >= 0);
  const request = createWatchdogApi(config.token, { fetchImpl });
  const repoPath = `/repos/${WATCHDOG_REPOSITORY}`;
  const repo = await request(repoPath);
  requireValue(repo?.private === true && repo.full_name === WATCHDOG_REPOSITORY && repo.owner?.login === OWNER);
  const issuePath = `${repoPath}/issues/${config.issue}`;
  const issue = await request(issuePath);
  requireValue(issue?.number === config.issue && issue.state === "open" && !issue.pull_request
    && issue.title === WATCHDOG_ISSUE_TITLE && typeof issue.body === "string"
    && issue.body.length <= STATUS_BYTES && issue.body.includes(WATCHDOG_ISSUE_OPT_IN));
  const mode = config.mode === "live" ? "live" : "synthetic";
  // The state comment is created on the issue's first page and patched in place.
  // Refuse excess/ambiguous history rather than searching an unbounded issue.
  const comments = await request(`${issuePath}/comments?per_page=100`);
  requireValue(Array.isArray(comments) && comments.length <= 100, "invalid_state");
  const states = comments.filter(comment => comment.user?.login === "github-actions[bot]"
    && comment.user.type === "Bot" && typeof comment.body === "string" && comment.body.startsWith(statePrefix(mode)));
  requireValue(states.length <= 1 && states.every(comment => Number.isSafeInteger(comment.id) && comment.id > 0), "invalid_state");
  requireValue(states.length > 0 || comments.length < 100, "invalid_state");
  const previous = states[0] ? decodeWatchdogState(states[0].body, mode, now) : null;
  let category;
  if (config.mode !== "live") category = config.mode === "synthetic-failure" ? "synthetic_failure" : "healthy";
  else {
    try {
      const file = await request(`${repoPath}/contents/${BACKUP_STATUS_PATH}?ref=${encodeURIComponent(BACKUP_STATUS_REF)}`);
      const evaluation = evaluateBackupStatus(decodeStatusFile(file, { now }), { now, ...config.thresholds });
      requireValue(CATEGORIES.has(evaluation.category), "invalid_status");
      category = evaluation.category;
    } catch (failure) {
      category = failure instanceof BackupWatchdogError && failure.category === "github_unavailable"
        ? "status_unavailable" : "invalid_status";
    }
  }
  const plan = planWatchdogNotification(previous, category, now);
  async function writeComment(path, method, body, expectedId) {
    const written = await request(path, { method, body: { body } });
    requireValue(Number.isSafeInteger(written?.id) && written.id > 0
      && (expectedId === undefined || written.id === expectedId)
      && written.user?.login === "github-actions[bot]" && written.user.type === "Bot"
      && written.body === body && written.issue_url === `${API}${issuePath}`, "github_unavailable");
  }
  if (plan.notify) {
    // Notify first: an uncertain state write can cause a duplicate reminder,
    // while recording success first could silently lose the only alert.
    await writeComment(`${issuePath}/comments`, "POST", alertText(plan, category, mode, config.runId, now));
  }
  if (plan.outcome !== "unchanged") {
    const state = { schemaVersion: 1, kind: "kevin-mel-backup-watchdog-state", mode,
      incident: plan.incident, lastNotificationAt: plan.lastNotificationAt };
    const body = encodeWatchdogState(state);
    if (states[0]) await writeComment(`${repoPath}/issues/comments/${states[0].id}`, "PATCH", body, states[0].id);
    else await writeComment(`${issuePath}/comments`, "POST", body);
  }
  return Object.freeze({ category, outcome: plan.outcome });
}

function isMainModule() {
  try { return Boolean(process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href); }
  catch { return false; }
}

if (isMainModule()) {
  try {
    const result = await runBackupWatchdog();
    process.stdout.write(`Backup watchdog: ${result.category}; ${result.outcome}.\n`);
  } catch (failure) {
    const category = failure instanceof BackupWatchdogError && ["configuration_error", "github_unavailable", "invalid_state"].includes(failure.category)
      ? failure.category : "watchdog_failed";
    process.stderr.write(`Backup watchdog: ${category}. Check the private operations issue and approved configuration.\n`);
    process.exitCode = 1;
  }
}
