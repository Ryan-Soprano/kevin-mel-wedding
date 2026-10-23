import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OPERATIONAL_CHECKS, OPERATIONAL_STATUS_MAX_BYTES, OPERATIONAL_STATUS_PATH, OPERATIONAL_STATUS_REF,
  OperationalStatusError, ensureOperationalStatusProgress, evaluateOperationalStatus, exactOperationalKeys, operationalTime,
  parseOperationalJson, parseOperationalStatusJson, requireOperational, validateOperationalStatus,
} from "./operational-status.mjs";

export const OPERATIONAL_REPOSITORY = "Ryan-Soprano/kevin-mel-wedding";
export const OPERATIONAL_ISSUE = 116;
export const CANONICAL_HEALTH_URL = "https://kevinandmel.com/api/health";
export const WATCHED_CHECKS = Object.freeze([...OPERATIONAL_CHECKS, "observation", "canonical"]);
const OWNER = "Ryan-Soprano";
const API = "https://api.github.com";
const REMINDER_MS = 3_600_000;
const STATES = ["clear", "incident", "unconfirmed"];
const LABELS = Object.freeze({ application: "Application observation", database: "Database readiness",
  guestSaves: "Guest save condition", media: "Media/storage condition", capacity: "Capacity condition",
  observation: "Observation availability", canonical: "Canonical HTTPS liveness" });

export function readOperationalWatchdogConfiguration(env) {
  if (env.ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED !== "true"
    || env.ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED !== "true") return null;
  const synthetic = ["synthetic-failure", "synthetic-recovery"].includes(env.ARCHIVE_OPERATIONAL_WATCHDOG_MODE);
  if (!synthetic && (env.ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED !== "true"
    || env.ARCHIVE_OPERATIONAL_WATCHDOG_HOST_PROOF_CONFIRMED !== "true")) return null;
  requireOperational(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === OPERATIONAL_REPOSITORY, "configuration_error");
  requireOperational(typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.length > 0
    && env.GITHUB_TOKEN.length <= 4096 && !/[\r\n]/.test(env.GITHUB_TOKEN), "configuration_error");
  requireOperational(env.ARCHIVE_BACKUP_WATCHDOG_ISSUE === String(OPERATIONAL_ISSUE), "configuration_error");
  requireOperational(typeof env.GITHUB_RUN_ID === "string" && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID), "configuration_error");
  requireOperational(["live", "synthetic-failure", "synthetic-recovery"].includes(env.ARCHIVE_OPERATIONAL_WATCHDOG_MODE)
    && (!synthetic || env.GITHUB_EVENT_NAME === "workflow_dispatch"), "configuration_error");
  requireOperational([undefined, "", "false", "true"].includes(env.ARCHIVE_OPERATIONAL_WATCHDOG_CANONICAL_HTTPS_ENABLED), "configuration_error");
  return Object.freeze({ token: env.GITHUB_TOKEN, runId: env.GITHUB_RUN_ID, mode: env.ARCHIVE_OPERATIONAL_WATCHDOG_MODE,
    canonicalEnabled: env.ARCHIVE_OPERATIONAL_WATCHDOG_CANONICAL_HTTPS_ENABLED === "true" });
}

// Both request headers and complete body share one deadline. Redirects and raw
// provider error bodies are never accepted or included in diagnostics.
async function boundedJson(url, options, { fetchImpl, timeoutMs, maximum }) {
  const controller = new AbortController();
  let timer;
  let reader;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new OperationalStatusError("remote_unavailable")); }, timeoutMs);
  });
  const work = async () => {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: controller.signal });
    requireOperational(!controller.signal.aborted, "remote_unavailable");
    requireOperational(response.ok, "remote_unavailable");
    const length = response.headers?.get("content-length");
    if (length !== null && length !== undefined) {
      requireOperational(/^[0-9]+$/.test(length) && Number(length) <= maximum, "remote_unavailable");
    }
    reader = response.body?.getReader();
    requireOperational(reader, "remote_unavailable");
    let count = 0;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      requireOperational(count <= maximum && !controller.signal.aborted, "remote_unavailable");
      chunks.push(Buffer.from(value));
    }
    requireOperational(!controller.signal.aborted, "remote_unavailable");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { value: parseOperationalJson(decoded, maximum), response };
  };
  try { return await Promise.race([work(), expired]); }
  finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation itself can be an unresolved provider promise. Abort/cancel
    // without extending the already expired whole-request deadline.
    if (reader) void reader.cancel().catch(() => {});
  }
}

export function createOperationalApi(token, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  requireOperational(typeof fetchImpl === "function" && Number.isSafeInteger(timeoutMs)
    && timeoutMs > 0 && timeoutMs <= 30_000, "configuration_error");
  return async (suffix, { method = "GET", body } = {}) => {
    const root = `/repos/${OPERATIONAL_REPOSITORY}`;
    requireOperational(typeof suffix === "string" && (suffix === root || suffix.startsWith(root + "/"))
      && !/[\r\n#]/.test(suffix) && ["GET", "POST", "PATCH"].includes(method), "configuration_error");
    try {
      const result = await boundedJson(API + suffix, { method, headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { fetchImpl, timeoutMs, maximum: 512 * 1024 });
      return result.value;
    } catch { throw new OperationalStatusError("github_unavailable"); }
  };
}

export function decodeOperationalStatusFile(value, { now = Date.now() } = {}) {
  requireOperational(value?.type === "file" && value.path === OPERATIONAL_STATUS_PATH && value.encoding === "base64"
    && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= OPERATIONAL_STATUS_MAX_BYTES
    && typeof value.content === "string" && value.content.length <= OPERATIONAL_STATUS_MAX_BYTES * 2);
  const encoded = value.content.replace(/\n/g, "");
  requireOperational(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded));
  const bytes = Buffer.from(encoded, "base64");
  requireOperational(bytes.length === value.size && bytes.toString("base64") === encoded);
  return parseOperationalStatusJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { now });
}

export async function checkCanonicalHealth({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  requireOperational(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000, "configuration_error");
  try {
    const { value, response } = await boundedJson(CANONICAL_HEALTH_URL,
      { method: "GET", cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } },
      { fetchImpl, timeoutMs, maximum: 128 });
    exactOperationalKeys(value, ["status"]);
    requireOperational(response.status === 200 && value.status === "ok"
      && /^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""));
    return "clear";
  } catch { return "unconfirmed"; }
}

function prefix(mode) { return `<!-- kevin-mel-operational-watchdog-state:v1:${mode} -->\n`; }
export function encodeOperationalWatchdogState(state) {
  return prefix(state.mode) + "```json\n" + JSON.stringify(state) + "\n```";
}
export function decodeOperationalWatchdogState(body, mode, now) {
  requireOperational(typeof body === "string" && body.length <= 4096 && body.startsWith(prefix(mode)), "invalid_state");
  const text = body.slice(prefix(mode).length);
  requireOperational(text.startsWith("```json\n") && text.endsWith("\n```"), "invalid_state");
  try {
    const value = parseOperationalJson(text.slice(8, -4));
    exactOperationalKeys(value, ["schemaVersion", "kind", "mode", "checks", "lastStatus"]);
    exactOperationalKeys(value.checks, WATCHED_CHECKS);
    requireOperational(value.schemaVersion === 1 && value.kind === "kevin-mel-operational-watchdog-state" && value.mode === mode);
    if (value.lastStatus !== null) {
      requireOperational(mode === "live");
      validateOperationalStatus(value.lastStatus, { now });
    }
    for (const name of WATCHED_CHECKS) {
      const check = value.checks[name];
      exactOperationalKeys(check, ["state", "lastNotificationAt"]);
      requireOperational(STATES.includes(check.state) || (name === "canonical" && check.state === "disabled"));
      if (check.lastNotificationAt !== null) operationalTime(check.lastNotificationAt, now);
      requireOperational(!["incident", "unconfirmed"].includes(check.state) || check.lastNotificationAt !== null);
    }
    requireOperational(encodeOperationalWatchdogState(value) === body);
    return value;
  } catch { throw new OperationalStatusError("invalid_state"); }
}

export function planOperationalNotifications(previous, observations, now, mode) {
  requireOperational(["live", "synthetic"].includes(mode) && Number.isSafeInteger(now) && now >= 0, "invalid_state");
  exactOperationalKeys(observations, WATCHED_CHECKS);
  const checks = {};
  const notices = [];
  for (const name of WATCHED_CHECKS) {
    let current = observations[name];
    requireOperational(STATES.includes(current) || (name === "canonical" && current === "disabled"), "invalid_state");
    const old = previous?.checks[name];
    // Disabling a failed probe cannot manufacture recovery from its incident.
    if (current === "disabled" && old && ["incident", "unconfirmed"].includes(old.state)) current = "unconfirmed";
    const fault = ["incident", "unconfirmed"].includes(current);
    let outcome = null;
    if (fault && (!old || old.state !== current)) outcome = "incident";
    else if (fault && now - Date.parse(old.lastNotificationAt) >= REMINDER_MS) outcome = "reminder";
    else if (current === "clear" && old && ["incident", "unconfirmed"].includes(old.state)) outcome = "recovery";
    if (outcome) notices.push(Object.freeze({ check: name, state: current, outcome }));
    checks[name] = Object.freeze({ state: current, lastNotificationAt: outcome ? new Date(now).toISOString() : old?.lastNotificationAt ?? null });
  }
  const state = { schemaVersion: 1, kind: "kevin-mel-operational-watchdog-state", mode, checks, lastStatus: previous?.lastStatus ?? null };
  return Object.freeze({ state, notices: Object.freeze(notices), changed: !previous || JSON.stringify(previous) !== JSON.stringify(state) });
}

function notificationText(plan, config, now) {
  const label = config.mode === "live" ? "Operational watchdog" : "Synthetic operational-watchdog test";
  const lines = plan.notices.map(item => `- ${LABELS[item.check]}: \`${item.state}\` (${item.outcome}).`);
  return `@${OWNER} ${label}: operator attention/condition update.\n\n${lines.join("\n")}\n\nObserved: ${new Date(now).toISOString()}.\n\n`
    + `[Review this watchdog run](https://github.com/${OPERATIONAL_REPOSITORY}/actions/runs/${config.runId}). `
    + "No guest content or counts are included. Checks and notification delivery are best effort; a cleared condition does not confirm an individual guest save.";
}

export async function runOperationalWatchdog({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const config = readOperationalWatchdogConfiguration(env);
  if (!config) return Object.freeze({ outcome: "skipped", notifications: 0 });
  requireOperational(Number.isSafeInteger(now) && now >= 0, "configuration_error");
  const request = createOperationalApi(config.token, { fetchImpl });
  const root = `/repos/${OPERATIONAL_REPOSITORY}`;
  const repo = await request(root);
  requireOperational(repo?.private === true && repo.full_name === OPERATIONAL_REPOSITORY && repo.owner?.login === OWNER, "configuration_error");
  const issuePath = `${root}/issues/${OPERATIONAL_ISSUE}`;
  const issue = await request(issuePath);
  requireOperational(issue?.number === OPERATIONAL_ISSUE && issue.state === "open" && !issue.pull_request
    && issue.title === "Backup watchdog operations" && typeof issue.body === "string" && issue.body.length <= 16384
    && issue.body.includes("<!-- kevin-mel-backup-watchdog:allow -->"), "configuration_error");
  const mode = config.mode === "live" ? "live" : "synthetic";
  const comments = await request(`${issuePath}/comments?per_page=100`);
  requireOperational(Array.isArray(comments) && comments.length <= 100, "invalid_state");
  const stateComments = [];
  const family = comments.filter(comment => comment.user?.login === "github-actions[bot]" && comment.user.type === "Bot"
    && typeof comment.body === "string" && comment.body.toLowerCase().includes("kevin-mel-operational-watchdog-state"));
  for (const comment of family) {
    // A damaged/version-changed marker is evidence of existing state, not a
    // license to initialize a new clear history. Validate both known modes.
    const candidate = ["live", "synthetic"].find(value => comment.body.startsWith(prefix(value)));
    requireOperational(candidate !== undefined, "invalid_state");
    decodeOperationalWatchdogState(comment.body, candidate, now);
    if (candidate === mode) stateComments.push(comment);
  }
  requireOperational(stateComments.length <= 1 && stateComments.every(comment => Number.isSafeInteger(comment.id) && comment.id > 0)
    && (stateComments.length > 0 || comments.length < 100), "invalid_state");
  const previous = stateComments[0] ? decodeOperationalWatchdogState(stateComments[0].body, mode, now) : null;
  let observations;
  let status;
  if (mode === "synthetic") {
    observations = Object.fromEntries([...OPERATIONAL_CHECKS, "observation"].map(name =>
      [name, config.mode === "synthetic-failure" ? "incident" : "clear"]));
    observations.canonical = "disabled";
  } else {
    try {
      status = decodeOperationalStatusFile(await request(`${root}/contents/${OPERATIONAL_STATUS_PATH}?ref=${encodeURIComponent(OPERATIONAL_STATUS_REF)}`), { now });
      if (previous?.lastStatus) ensureOperationalStatusProgress(previous.lastStatus, status);
    } catch { status = undefined; /* Missing, inaccessible, regressed, malformed or future evidence is unknown. */ }
    observations = { ...evaluateOperationalStatus(status, { now }) };
    observations.canonical = config.canonicalEnabled ? await checkCanonicalHealth({ fetchImpl }) : "disabled";
  }
  const plan = planOperationalNotifications(previous, observations, now, mode);
  // Preserve the last valid source watermark across missing/bad observations.
  // Replaying an earlier clear status cannot clear a more recent incident.
  if (status) plan.state.lastStatus = status;
  const stateChanged = plan.changed || JSON.stringify(previous?.lastStatus ?? null) !== JSON.stringify(plan.state.lastStatus);
  const write = async (suffix, method, body, expectedId) => {
    const written = await request(suffix, { method, body: { body } });
    requireOperational(Number.isSafeInteger(written?.id) && written.id > 0
      && (expectedId === undefined || written.id === expectedId) && written.user?.login === "github-actions[bot]"
      && written.user.type === "Bot" && written.body === body && written.issue_url === API + issuePath, "github_unavailable");
  };
  // Notify first. Failure/uncertainty never records a delivered notification.
  if (plan.notices.length) await write(`${issuePath}/comments`, "POST", notificationText(plan, config, now));
  if (stateChanged) {
    const body = encodeOperationalWatchdogState(plan.state);
    if (stateComments[0]) await write(`${root}/issues/comments/${stateComments[0].id}`, "PATCH", body, stateComments[0].id);
    else await write(`${issuePath}/comments`, "POST", body);
  }
  return Object.freeze({ outcome: plan.notices.length ? "notified" : stateChanged ? (previous ? "updated" : "initialized") : "unchanged", notifications: plan.notices.length });
}

if (process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const result = await runOperationalWatchdog();
    console.log(`Operational watchdog: ${result.outcome}.`);
  } catch (failure) {
    const category = failure instanceof OperationalStatusError
      && ["configuration_error", "github_unavailable", "invalid_state"].includes(failure.category) ? failure.category : "watchdog_failed";
    console.error(`Operational watchdog: ${category}; inspect private operations evidence.`);
    process.exitCode = 1;
  }
}
