import { check } from "./rollback-helpers.mjs";

export const PINNED_IMAGE = "sha256:503bf93fa0f63d2a460d38cc2ac6894ba5fd4059e9755c2e049adaddb9401052";
export const POSTGRES_17_IMAGE = "sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseReceptionArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const result = { image: PINNED_IMAGE };
  let imageSupplied = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === "--image") {
      check(!imageSupplied && typeof args[index + 1] === "string" && /^sha256:[0-9a-f]{64}$/.test(args[index + 1]),
        "Use --image once with a complete existing immutable local image ID; tags and extra inputs are refused.");
      imageSupplied = true; result.image = args[index + 1]; index += 2;
    } else {
      check(args[index] === "--probe-failure-cleanup" && !result.probeFailureCleanup,
        "Only the immutable image and one explicit owned-failure cleanup probe are supported.");
      result.probeFailureCleanup = true; index++;
    }
  }
  return result;
}

export function assertReceptionOwnership(name, runId, observedOwner) {
  check(uuid.test(runId) && observedOwner === runId && typeof name === "string"
    && ["inspect", "network", "db-load", "app-load", "db-key", "app-key"].some(suffix => name === "archive-reception-" + runId + "-" + suffix),
  "A fixture operation requires an exact generated resource name and this run's ownership label.");
}

// A failed worker stops new work and drains already-started requests before the
// caller can clean up the fixture. This is deliberately bounded, never a flood.
export async function receptionPool(items, concurrency, operation) {
  check(Array.isArray(items) && items.length > 0 && items.length <= 100
    && Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 20 && typeof operation === "function",
  "Guest waves require 1-100 logical guests and 1-20 concurrent workers.");
  let next = 0, failure;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await operation(items[index], index); }
      catch (caught) { failure ??= caught; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export function receptionTimings(values) {
  check(Array.isArray(values) && values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0),
    "Request timing observations must be finite nonnegative measurements.");
  const sorted = [...values].sort((left, right) => left - right);
  const rank = fraction => Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(1));
  return { requests: sorted.length, p50Ms: rank(0.5), p95Ms: rank(0.95), maxMs: rank(1) };
}
