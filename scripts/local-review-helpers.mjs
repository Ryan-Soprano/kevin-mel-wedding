import { check } from "./rollback-helpers.mjs";

export const LOCAL_REVIEW_LABEL = "com.memoryarchive.local-review";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const image = /^sha256:[0-9a-f]{64}$/;
const canonicalRun = value => typeof value === "string" && value.length === 36 && uuid.test(value);

export function parseLocalReviewArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args[0] === "--stop") {
    check(args.length === 2 && canonicalRun(args[1]), "Use --stop alone with this review session's exact UUID-v4 run ID.");
    return { stop: args[1] };
  }
  const result = { image: null, durationMinutes: 30, selfCheck: false, probeFailureCleanup: false, stop: null };
  let minutesSupplied = false;
  for (let index = 0; index < args.length;) {
    const flag = args[index++];
    if (flag === "--image") {
      check(!result.image && typeof args[index] === "string" && args[index].length === 71 && image.test(args[index]), "Supply --image once with an existing immutable local sha256 image ID; tags and registry references are refused.");
      result.image = args[index++];
    } else if (flag === "--minutes") {
      const value = args[index++];
      check(!minutesSupplied && typeof value === "string" && /^[1-9][0-9]{0,2}$/.test(value) && String(Number(value)) === value && Number(value) <= 120,
        "Supply --minutes once as an integer from 1 through 120.");
      minutesSupplied = true; result.durationMinutes = Number(value);
    } else if (flag === "--self-check" || flag === "--probe-failure-cleanup") {
      check(!result.selfCheck && !result.probeFailureCleanup, "Choose one check mode, without repeating it.");
      result[flag === "--self-check" ? "selfCheck" : "probeFailureCleanup"] = true;
    } else check(false, "Only --image, --minutes, --self-check, --probe-failure-cleanup, --stop and --help are supported.");
  }
  check(result.image, "An explicitly reviewed existing local --image is required; this utility never builds or pulls an image.");
  check(!minutesSupplied || !(result.selfCheck || result.probeFailureCleanup), "--minutes is only for an interactive review session.");
  return result;
}

export function localReviewNames(runId) {
  check(canonicalRun(runId), "A review session requires a canonical UUID-v4 run ID.");
  const prefix = "archive-local-review-" + runId + "-";
  return Object.freeze({ inspect: prefix + "inspect", network: prefix + "network", db: prefix + "db", app: prefix + "app" });
}

export function assertLocalReviewOwnership(name, runId, observedLabel) {
  check(observedLabel === runId && Object.values(localReviewNames(runId)).includes(name),
    "Resource operations require the exact generated review name and matching run ownership label.");
}

// Only operating-system and local Docker client settings survive. Application,
// cloud, database, Node and JVM configuration must be explicitly synthetic.
export function localReviewDockerEnvironment(source) {
  const result = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
    if (Object.hasOwn(source, key) && typeof source[key] === "string") result[key] = source[key];
  }
  return result;
}

// Published test-only fixture, already used by the disposable container/browser
// rehearsals. Never use this credential or low-cost hash for a real account.
export const SYNTHETIC_REVIEW_PASSWORD = "synthetic-auth-container-passphrase";
export const SYNTHETIC_REVIEW_PASSWORD_HASH = "{bcrypt}$2a$04$wzmk5ETbKnNeNERXKff2ZuhBkdnCKIlCI8Mml0tFgEkMdWcZgQ3g6";
export const SYNTHETIC_REVIEW_ACCOUNTS = Object.freeze([
  Object.freeze({ username: "synthetic-kevin", displayName: "Synthetic Kevin" }),
  Object.freeze({ username: "synthetic-mel", displayName: "Synthetic Melanie" }),
]);
