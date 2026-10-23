import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoBatchSubmission } from "./photoBatchSubmission.js";
import { ApiError } from "../../../shared/api/apiClient.js";

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const unknown = () => new ApiError("Not confirmed", { code: "NETWORK_ERROR", unknownOutcome: true });
const invalid = () => new ApiError("Invalid photo", { code: "INVALID_MEDIA", status: 422 });
const photo = (value) => ({ id: id(value), file: new File([new Uint8Array([value, 2, 3])],
  `photo-${value}.png`, { type: "image/png" }), caption: ` caption ${value} ` });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(condition) {
  for (let index = 0; index < 100 && !condition(); index++) await Promise.resolve();
  assert.ok(condition(), "The expected asynchronous stage was reached.");
}

function fixture({ count = 3, hooks = {}, timers = {}, digest, now } = {}) {
  const raw = { guestName: " Guest ", photos: Array.from({ length: count }, (_, index) => photo(index + 1)) };
  const calls = [], hashes = new Map(), states = Array(count).fill("PENDING"), grants = new Map();
  let generated = 900, nextGrant = 500;
  function receipt() {
    const saved = states.filter((state) => state === "UPLOADED").length;
    return { contributionId: id(90), eventKey: "kevin-mel-wedding", createdAt: "2026-10-09T12:00:00Z",
      completion: saved === count ? "COMPLETE" : saved ? "PARTIAL" : "PENDING",
      memories: raw.photos.map((entry, index) => ({
        memoryId: id(100 + index), clientItemId: entry.id, memoryType: "PHOTO", reviewStatus: "PENDING",
        visibility: "COUPLE_ONLY", uploadState: states[index],
      })),
    };
  }
  const indexOfMemory = (memoryId) => Number(memoryId.slice(-12)) - 100;
  const api = {
    async createMediaContribution(...args) {
      calls.push({ op: "create", args });
      return hooks.create ? hooks.create(...args) : receipt();
    },
    async getReceipt(...args) {
      calls.push({ op: "receipt", args });
      return hooks.receipt ? hooks.receipt(...args) : receipt();
    },
    async authorizeUpload(...args) {
      calls.push({ op: "grant", args });
      if (hooks.grant) return hooks.grant(...args);
      const grant = { grantId: id(nextGrant++), method: "PUT", uploadUrl: "https://storage.example/upload",
        expiresAt: "2099-01-01T00:00:00Z", headers: { "Content-Type": "image/png" } };
      grants.set(grant.grantId, indexOfMemory(args[1]));
      return grant;
    },
    async uploadMedia(...args) {
      calls.push({ op: "upload", args });
      if (hooks.upload) return hooks.upload(...args);
      return { transferred: true };
    },
    ...(hooks.report ? { reportUploadFailure: (...args) => hooks.report(...args) } : {}),
    async finalizeUpload(...args) {
      calls.push({ op: "finalize", args });
      if (hooks.finalize) return hooks.finalize(...args);
      states[indexOfMemory(args[1])] = "UPLOADED";
      return receipt();
    },
  };
  const submission = createPhotoBatchSubmission({ api, ...timers, ...(now ? { now } : {}),
    randomUUID: () => id(generated++), digest: async (file) => {
      hashes.set(file, (hashes.get(file) ?? 0) + 1);
      return digest ? digest(file) : "1".repeat(64);
    },
  });
  return { raw, calls, hashes, states, grants, receipt, submission, indexOfMemory,
    get generated() { return generated - 900; } };
}

test("a failed direct PUT reports only its retained capability and never waits for telemetry or changes retry state", async () => {
  const reports = [];
  const f = fixture({ count: 1, hooks: {
    upload: async () => { throw new ApiError("private transport detail", { code: "UPLOAD_FAILED", unknownOutcome: true }); },
    report: (...args) => { reports.push(args); return new Promise(() => {}); },
  } });
  await f.submission.submit(f.raw);
  await Promise.resolve();
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], [id(90), id(100), id(500), { idempotencyKey: id(900) }]);
  assert.equal(f.submission.snapshot.items[0].error.code, "UPLOAD_FAILED");
  assert.equal(f.submission.pending, true);
  assert.equal(f.submission.snapshot.items[0].status, "failed");
  assert.equal(JSON.stringify(reports).includes("private"), false);
});

test("preflight expiry, finalization errors and disposal do not report a direct PUT failure", async () => {
  for (const code of ["UPLOAD_GRANT_EXPIRED", "CONTRACT_MISMATCH", "REQUEST_ABORTED"]) {
    const reports = [];
    const f = fixture({ count: 1, hooks: {
      upload: async () => { throw new ApiError("not a technical PUT response", { code, status: code === "UPLOAD_GRANT_EXPIRED" ? 410 : 0 }); },
      report: (...args) => reports.push(args),
    } });
    await f.submission.submit(f.raw); await Promise.resolve();
    assert.deepEqual(reports, []);
  }
  const reports = [];
  const f = fixture({ count: 1, hooks: {
    finalize: async () => { throw unknown(); }, report: (...args) => reports.push(args),
  } });
  await f.submission.submit(f.raw); await Promise.resolve(); assert.deepEqual(reports, []);
});

function manualTimers() {
  const pending = new Map(); let sequence = 0;
  return { pending,
    setTimeoutImpl(callback, milliseconds) { const key = ++sequence; pending.set(key, { callback, milliseconds }); return key; },
    clearTimeoutImpl(key) { pending.delete(key); },
    fire() {
      assert.equal(pending.size, 1);
      const [key, timer] = [...pending][0]; pending.delete(key); timer.callback(); return timer.milliseconds;
    },
  };
}

test("one frozen group keeps per-photo captions and original bytes; transfers and verification are sequential", async () => {
  const uploads = []; let active = 0, maximum = 0;
  const f = fixture({ hooks: { upload: async (grant, file) => {
    active++; maximum = Math.max(maximum, active); uploads.push(file);
    await Promise.resolve(); active--;
    assert.ok(Object.isFrozen(grant)); assert.ok(Object.isFrozen(grant.headers));
  } } });
  const stages = [];
  const result = await f.submission.submit(f.raw, (state) => stages.push(state));
  assert.equal(result.phase, "complete"); assert.equal(result.complete, true);
  assert.equal(result.savedCount, 3); assert.equal(result.canStartAnother, true);
  assert.deepEqual(uploads, f.raw.photos.map((entry) => entry.file)); assert.equal(maximum, 1);
  assert.deepEqual(f.calls.map((call) => call.op), ["create", "grant", "upload", "finalize", "grant", "upload", "finalize", "grant", "upload", "finalize"]);
  const payload = f.calls[0].args[0];
  assert.ok(Object.isFrozen(payload)); assert.ok(Object.isFrozen(payload.items)); assert.ok(payload.items.every(Object.isFrozen));
  assert.equal(payload.guestName, "Guest");
  assert.deepEqual(payload.items.map((item) => item.caption), ["caption 1", "caption 2", "caption 3"]);
  assert.deepEqual(payload.items.map((item) => item.clientItemId), f.raw.photos.map((item) => item.id));
  assert.equal(f.generated, 1); assert.deepEqual([...f.hashes.values()], [1, 1, 1]);
  assert.ok(stages.some((state) => state.items[0].status === "uploading"));
  const priorCalls = f.calls.length;
  await f.submission.submit(f.raw); await f.submission.retry(f.raw.photos.map((item) => item.id));
  assert.equal(f.calls.length, priorCalls);
  assert.equal(f.submission.startAnother().phase, "idle");
});

test("duplicate taps, including progress callback taps, share exactly one promise", async () => {
  const f = fixture(); let replay;
  const first = f.submission.submit(f.raw, () => { replay = f.submission.submit(f.raw); });
  assert.equal(f.submission.submit(f.raw), first);
  assert.equal(f.submission.retry([id(1)]), first);
  await first;
  assert.equal(replay, first); assert.equal(f.calls.filter((call) => call.op === "create").length, 1);
  assert.equal(f.calls.filter((call) => call.op === "upload").length, 3);
});

test("a final presentation callback may reset the batch without changing the completed promise's receipt", async () => {
  const f = fixture(); let reset = false;
  const result = await f.submission.submit(f.raw, (state) => {
    if (state.phase === "complete" && !reset) { reset = true; f.submission.startAnother(); }
  });
  assert.equal(result.phase, "complete"); assert.equal(result.savedCount, 3);
  assert.equal(result.receipt.contributionId, id(90)); assert.equal(f.submission.snapshot.phase, "idle");
});

test("a lost create response retains the same payload, key, selection IDs and checksums", async () => {
  let creates = 0;
  const f = fixture({ hooks: { create: () => { if (++creates === 1) throw unknown(); return f.receipt(); } } });
  await assert.rejects(f.submission.submit(f.raw), { unknownOutcome: true });
  assert.equal(f.submission.pending, true); assert.equal(f.submission.canStartAnother, false);
  assert.throws(() => f.submission.startAnother(), { code: "BATCH_UNCONFIRMED" });
  for (const changed of [
    { ...f.raw, guestName: "Other" },
    { ...f.raw, photos: [...f.raw.photos].reverse() },
    { ...f.raw, photos: f.raw.photos.map((entry, index) => index ? entry : { ...entry, caption: "changed" }) },
    { ...f.raw, photos: f.raw.photos.map((entry, index) => index ? entry : { ...entry, file: new File([entry.file], entry.file.name, { type: entry.file.type }) }) },
  ]) assert.throws(() => f.submission.submit(changed), { code: "DRAFT_CHANGED" });
  await f.submission.retry([id(1), id(2), id(3)]);
  const createCalls = f.calls.filter((call) => call.op === "create");
  assert.equal(createCalls[0].args[0], createCalls[1].args[0]);
  assert.equal(createCalls[0].args[1].idempotencyKey, createCalls[1].args[1].idempotencyKey);
  assert.deepEqual([...f.hashes.values()], [1, 1, 1]); assert.equal(f.generated, 1);
});

test("an unconfirmed PUT does not stop valid siblings; selected retry finalizes its retained grant first", async () => {
  const f = fixture({ hooks: { upload: (grant) => { if (f.grants.get(grant.grantId) === 1) throw unknown(); } } });
  const partial = await f.submission.submit(f.raw);
  assert.deepEqual(partial.items.map((item) => item.status), ["saved", "failed", "saved"]);
  assert.equal(partial.items[1].error.unknownOutcome, true); assert.equal(partial.canStartAnother, false);
  const before = f.calls.length;
  const complete = await f.submission.retry([id(2)]);
  assert.equal(complete.phase, "complete");
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "finalize"]);
  assert.equal(f.calls.filter((call) => call.op === "upload").length, 3);
  assert.deepEqual([...f.hashes.values()], [1, 1, 1]);
});

test("a lost finalization response is recovered from receipt without reuploading or re-finalizing saved siblings", async () => {
  const f = fixture({ count: 2, hooks: { finalize: (contributionId, memoryId) => {
    const index = f.indexOfMemory(memoryId); f.states[index] = "UPLOADED";
    if (index === 1) throw unknown();
    return f.receipt();
  } } });
  const partial = await f.submission.submit(f.raw);
  assert.equal(partial.phase, "partial"); assert.equal(partial.savedCount, 1);
  const before = f.calls.length;
  assert.equal((await f.submission.retry([id(2)])).phase, "complete");
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt"]);
});

for (const code of ["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"]) {
  test(`${code} on retained grant renews only that unsaved item, preserving the intent and original`, async () => {
    let uploads = 0, checks = 0;
    const f = fixture({ count: 1, hooks: {
      upload: () => { if (++uploads === 1) throw unknown(); },
      finalize: () => {
        if (++checks === 1) throw new ApiError("Renew", { code, status: code === "UPLOAD_INCOMPLETE" ? 409 : 410 });
        f.states[0] = "UPLOADED"; return f.receipt();
      },
    } });
    await f.submission.submit(f.raw);
    const before = f.calls.length;
    assert.equal((await f.submission.retry([id(1)])).complete, true);
    assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "finalize", "grant", "upload", "finalize"]);
    const puts = f.calls.filter((call) => call.op === "upload");
    assert.equal(puts[0].args[1], puts[1].args[1]); assert.notEqual(puts[0].args[0].grantId, puts[1].args[0].grantId);
    assert.equal(f.hashes.get(f.raw.photos[0].file), 1); assert.equal(f.generated, 1);
  });
}

test("known rejected photos permit explicit same-original retry and never discard saved siblings", async () => {
  let rejected = false;
  const f = fixture({ count: 2, hooks: { finalize: (contributionId, memoryId) => {
    const index = f.indexOfMemory(memoryId);
    if (!index && !rejected) { rejected = true; f.states[0] = "FAILED"; throw invalid(); }
    f.states[index] = "UPLOADED"; return f.receipt();
  } } });
  const result = await f.submission.submit(f.raw);
  assert.deepEqual(result.items.map((item) => item.status), ["rejected", "saved"]);
  assert.equal(result.items[0].knownRejected, true); assert.equal(result.items[0].retryEligible, true);
  assert.equal(result.canStartAnother, true); assert.equal(result.complete, false);
  const before = f.calls.length;
  const recovered = await f.submission.retry([id(1), id(2)]);
  assert.equal(recovered.phase, "complete");
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "grant", "upload", "finalize"]);
  assert.deepEqual([...f.hashes.values()], [1, 1]);
});

test("a FAILED receipt cannot resolve an unknown mutation without checking its retained grant", async () => {
  const f = fixture({ count: 2, hooks: { finalize: (contributionId, memoryId) => {
    const index = f.indexOfMemory(memoryId);
    if (!index) f.states[0] = "FAILED";
    throw unknown();
  } } });
  await f.submission.submit(f.raw);
  const retry = await f.submission.retry([id(2)]);
  assert.equal(retry.items[0].knownRejected, false); assert.equal(retry.items[1].knownRejected, false);
  assert.equal(retry.items[0].error.unknownOutcome, true);
  assert.equal(retry.canStartAnother, false);
  assert.throws(() => f.submission.startAnother(), { code: "BATCH_UNCONFIRMED" });
});

test("a stale FAILED receipt after timed-out retry cannot unlock replacement or discard the unconfirmed grant", async () => {
  const waiting = deferred(), timers = manualTimers(); let firstFinalizations = 0, secondFinalizations = 0;
  const f = fixture({ count: 2, timers, hooks: { finalize: (contributionId, memoryId) => {
    if (f.indexOfMemory(memoryId) === 0) {
      if (++firstFinalizations === 1) { f.states[0] = "FAILED"; throw invalid(); }
      if (firstFinalizations === 2) return waiting.promise;
      f.states[0] = "UPLOADED"; return f.receipt();
    }
    if (++secondFinalizations === 1) throw unknown();
    f.states[1] = "UPLOADED"; return f.receipt();
  } } });
  await f.submission.submit(f.raw);
  assert.equal(f.submission.snapshot.items[0].knownRejected, true);
  const retry = f.submission.retry([id(1)]);
  await until(() => firstFinalizations === 2);
  timers.fire(); await retry;
  assert.equal(f.submission.snapshot.items[0].error.unknownOutcome, true);
  const result = await f.submission.retry([id(2)]);
  assert.equal(result.items[1].status, "saved"); assert.equal(result.items[0].status, "failed");
  assert.equal(result.items[0].knownRejected, false); assert.equal(result.canStartAnother, false);
  assert.throws(() => f.submission.startAnother(), { code: "BATCH_UNCONFIRMED" });
  const before = f.calls.length;
  assert.equal((await f.submission.retry([id(1)])).complete, true);
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "finalize"]);
  waiting.resolve(f.receipt());
});

test("a deliberate new batch is allowed after every unfinished item is definitively rejected", async () => {
  const f = fixture({ count: 2, hooks: { finalize: (contributionId, memoryId) => {
    if (f.indexOfMemory(memoryId) === 0) { f.states[0] = "FAILED"; throw invalid(); }
    f.states[1] = "UPLOADED"; return f.receipt();
  } } });
  await f.submission.submit(f.raw);
  assert.equal(f.submission.canStartAnother, true);
  assert.equal(f.submission.startAnother().retained, false);
  assert.deepEqual(f.states, ["FAILED", "UPLOADED"]);
});

test("reordered receipts are matched by clientItemId, never by array position", async () => {
  const reversed = () => ({ ...f.receipt(), memories: f.receipt().memories.reverse() });
  const f = fixture({ hooks: { create: reversed, receipt: reversed,
    finalize: (contributionId, memoryId) => { f.states[f.indexOfMemory(memoryId)] = "UPLOADED"; return reversed(); },
  } });
  const result = await f.submission.submit(f.raw);
  assert.equal(result.complete, true);
  for (const call of f.calls.filter((call) => call.op === "upload")) {
    assert.equal(f.grants.get(call.args[0].grantId), f.raw.photos.findIndex((entry) => entry.file === call.args[1]));
  }
  assert.deepEqual(result.items.map((item) => item.memoryId), [id(100), id(101), id(102)]);
});

for (const kind of ["client item", "contribution", "memory", "saved regression", "creation timestamp"]) {
  test(`a mismatched ${kind} receipt preserves saved siblings and stops later mutations`, async () => {
    const f = fixture({ hooks: { finalize: (contributionId, memoryId) => {
      const index = f.indexOfMemory(memoryId);
      if (!index) { f.states[0] = "UPLOADED"; return f.receipt(); }
      const response = f.receipt();
      if (kind === "client item") response.memories[1].clientItemId = id(999);
      if (kind === "contribution") response.contributionId = id(999);
      if (kind === "memory") response.memories[1].memoryId = id(999);
      if (kind === "saved regression") { response.memories[0].uploadState = "PENDING"; response.completion = "PENDING"; }
      if (kind === "creation timestamp") response.createdAt = "2026-10-09T13:00:00Z";
      return response;
    } } });
    const result = await f.submission.submit(f.raw);
    assert.equal(result.complete, false); assert.equal(result.savedCount, 1);
    assert.equal(result.items[0].status, "saved"); assert.equal(result.items[2].status, "queued");
    assert.equal(result.error.code, "CONTRACT_MISMATCH"); assert.equal(result.error.unknownOutcome, true);
    assert.equal(f.calls.filter((call) => call.op === "upload").length, 2);
  });
}

test("an unexpected initial membership is rejected before any grant or transfer", async () => {
  const f = fixture({ hooks: { create: () => {
    const response = f.receipt(); response.memories[0].clientItemId = id(999); return response;
  } } });
  await assert.rejects(f.submission.submit(f.raw), { code: "CONTRACT_MISMATCH" });
  assert.deepEqual(f.calls.map((call) => call.op), ["create"]);
  assert.equal(f.submission.canStartAnother, false);
});

for (const uploadState of ["PENDING", "FAILED"]) {
  test(`a finalize receipt with target ${uploadState} keeps its outcome unknown and retains its grant`, async () => {
    const f = fixture({ count: 1, hooks: { finalize: () => { f.states[0] = uploadState; return f.receipt(); } } });
    const result = await f.submission.submit(f.raw);
    assert.equal(result.complete, false); assert.equal(result.savedCount, 0);
    assert.equal(result.items[0].error.code, "UPLOAD_INCOMPLETE");
    assert.equal(result.items[0].error.unknownOutcome, true); assert.equal(result.canStartAnother, false);
    const before = f.calls.length;
    const repeated = await f.submission.retry([id(1)]);
    assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "finalize"]);
    assert.equal(repeated.canStartAnother, false); assert.equal(repeated.items[0].knownRejected, false);
  });
}

test("429 pauses the whole batch, honors Retry-After and preserves its key without automatic retry", async () => {
  let currentTime = 1000, throttled = false;
  const f = fixture({ now: () => currentTime, hooks: { upload: () => {
    if (!throttled) { throttled = true; throw new ApiError("Wait", { code: "RATE_LIMITED", status: 429, retryAfterSeconds: 10 }); }
  } } });
  const result = await f.submission.submit(f.raw);
  assert.deepEqual(result.items.map((item) => item.status), ["failed", "queued", "queued"]);
  assert.equal(result.retryAfterSeconds, 10); assert.equal(result.error.code, "RATE_LIMITED");
  const before = f.calls.length;
  assert.throws(() => f.submission.retry([id(1), id(2), id(3)]), { status: 429, retryAfterSeconds: 10 });
  assert.equal(f.calls.length, before); currentTime += 10_000;
  assert.equal((await f.submission.retry([id(1), id(2), id(3)])).complete, true);
  assert.equal(f.calls.filter((call) => call.op === "create").length, 1);
});

test("a reconcile throttle prevents a known-rejected batch reset from bypassing Retry-After", async () => {
  let currentTime = 0;
  const f = fixture({ count: 1, now: () => currentTime, hooks: {
    finalize: () => { f.states[0] = "FAILED"; throw invalid(); },
    receipt: () => { throw new ApiError("Wait", { code: "RATE_LIMITED", status: 429, retryAfterSeconds: 10 }); },
  } });
  await f.submission.submit(f.raw); assert.equal(f.submission.canStartAnother, true);
  await assert.rejects(f.submission.retry([id(1)]), { status: 429 });
  assert.equal(f.submission.canStartAnother, false); assert.equal(f.submission.retryAfterSeconds, 10);
  assert.throws(() => f.submission.startAnother(), { code: "BATCH_UNCONFIRMED" });
  const before = f.calls.length;
  assert.throws(() => f.submission.submit(f.raw), { status: 429 }); assert.equal(f.calls.length, before);
  currentTime = 10_000;
  assert.equal(f.submission.canStartAnother, true); assert.equal(f.submission.startAnother().phase, "idle");
  assert.equal(f.submission.retryAfterSeconds, 0);
});

test("validation of the entire selection happens before IDs, checksums or requests", () => {
  const f = fixture();
  const malformed = [
    { ...f.raw, photos: [] }, { ...f.raw, photos: [...f.raw.photos, photo(4), photo(5), photo(6)] },
    { ...f.raw, photos: [{ ...photo(1), file: null }] },
    { ...f.raw, photos: [{ ...photo(1), file: new File([], "empty.png", { type: "image/png" }) }] },
    { ...f.raw, photos: [{ ...photo(1), file: new File(["x"], "phone.heic", { type: "image/heic" }) }] },
    { ...f.raw, photos: [{ ...photo(1), file: new File(["x"], "bad/path.png", { type: "image/png" }) }] },
    { ...f.raw, photos: [{ ...photo(1), caption: "x".repeat(501) }] },
    { ...f.raw, photos: [{ ...photo(1), id: "not-a-uuid" }] },
    { ...f.raw, photos: [photo(1), { ...photo(2), id: id(1).toUpperCase() }] },
    { ...f.raw, guestName: "x".repeat(101) },
  ];
  for (const raw of malformed) assert.throws(() => f.submission.submit(raw), { code: "VALIDATION_FAILED" });
  assert.equal(f.calls.length, 0); assert.equal(f.hashes.size, 0); assert.equal(f.generated, 0);
  assert.equal(f.submission.snapshot.retained, false);
});

test("selected retry excludes saved items and refuses foreign selection IDs before IO", async () => {
  const f = fixture({ count: 2, hooks: { upload: (grant) => { if (f.grants.get(grant.grantId) === 1) throw unknown(); } } });
  await f.submission.submit(f.raw); const before = f.calls.length;
  assert.throws(() => f.submission.retry([id(999)]), { code: "VALIDATION_FAILED" });
  await f.submission.retry([id(1)]); await f.submission.retry([]);
  assert.equal(f.calls.length, before);
});

test("snapshots are immutable, omit original bytes and grants, and do not change when later work completes", async () => {
  const f = fixture({ count: 1, hooks: { upload: () => { throw unknown(); } } });
  const partial = await f.submission.submit(f.raw);
  assert.ok(Object.isFrozen(partial)); assert.ok(Object.isFrozen(partial.items));
  assert.ok(Object.isFrozen(partial.items[0])); assert.ok(Object.isFrozen(partial.items[0].error));
  assert.throws(() => { partial.items[0].status = "saved"; }, TypeError);
  assert.ok(!JSON.stringify(partial).includes("storage.example")); assert.equal(partial.items[0].file, undefined);
  await f.submission.retry([id(1)]);
  assert.equal(partial.items[0].status, "failed"); assert.equal(f.submission.snapshot.items[0].status, "saved");
});

test("an API deadline aborts the request, ignores its late receipt and preserves the frozen intent for retry", async () => {
  const waiting = deferred(), timers = manualTimers(); let creates = 0;
  const f = fixture({ count: 1, timers, hooks: { create: () => ++creates === 1 ? waiting.promise : f.receipt() } });
  const first = f.submission.submit(f.raw);
  await until(() => f.calls.some((call) => call.op === "create"));
  assert.equal(timers.fire(), 30_000);
  await assert.rejects(first, { code: "REQUEST_TIMED_OUT", unknownOutcome: true });
  assert.equal(f.calls[0].args[1].signal.aborted, true); assert.equal(timers.pending.size, 0);
  f.states[0] = "UPLOADED"; waiting.resolve(f.receipt());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.submission.complete, false); assert.equal(f.submission.receipt, null);
  assert.equal((await f.submission.retry([id(1)])).complete, true);
  assert.equal(f.calls[0].args[0], f.calls[1].args[0]); assert.equal(f.hashes.get(f.raw.photos[0].file), 1);
});

test("a PUT deadline ignores late transfer completion and checks the retained grant on manual retry", async () => {
  const waiting = deferred(), timers = manualTimers(); let puts = 0;
  const f = fixture({ count: 1, timers, hooks: { upload: () => ++puts === 1 ? waiting.promise : undefined } });
  const first = f.submission.submit(f.raw);
  await until(() => f.calls.some((call) => call.op === "upload"));
  assert.equal(timers.fire(), 120_000);
  const result = await first;
  assert.equal(result.items[0].error.code, "REQUEST_TIMED_OUT"); assert.equal(result.items[0].error.unknownOutcome, true);
  assert.equal(f.calls.find((call) => call.op === "upload").args[2].signal.aborted, true);
  assert.equal(f.calls.filter((call) => call.op === "finalize").length, 0);
  waiting.resolve({ transferred: true }); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.submission.complete, false);
  const before = f.calls.length;
  assert.equal((await f.submission.retry([id(1)])).complete, true);
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt", "finalize"]);
  assert.equal(timers.pending.size, 0);
});

test("a finalize deadline never applies a late saved receipt before a deliberate receipt check", async () => {
  const waiting = deferred(), timers = manualTimers(); let checks = 0;
  const f = fixture({ count: 1, timers, hooks: { finalize: () => ++checks === 1 ? waiting.promise : f.receipt() } });
  const first = f.submission.submit(f.raw);
  await until(() => f.calls.some((call) => call.op === "finalize"));
  timers.fire(); const result = await first;
  assert.equal(result.complete, false); assert.equal(result.items[0].error.code, "REQUEST_TIMED_OUT");
  f.states[0] = "UPLOADED"; waiting.resolve(f.receipt()); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.submission.complete, false);
  const before = f.calls.length;
  assert.equal((await f.submission.retry([id(1)])).complete, true);
  assert.deepEqual(f.calls.slice(before).map((call) => call.op), ["receipt"]);
});

test("dispose aborts active requests, clears timers and suppresses every later progress callback", async () => {
  const waiting = deferred(), timers = manualTimers(), snapshots = [];
  const f = fixture({ count: 1, timers, hooks: { create: () => waiting.promise } });
  const first = f.submission.submit(f.raw, (value) => snapshots.push(value));
  await until(() => f.calls.some((call) => call.op === "create"));
  const before = snapshots.length;
  f.submission.dispose();
  await assert.rejects(first, { code: "REQUEST_ABORTED", unknownOutcome: true });
  assert.equal(f.calls[0].args[1].signal.aborted, true); assert.equal(timers.pending.size, 0);
  waiting.resolve(f.receipt()); await Promise.resolve(); await Promise.resolve();
  assert.equal(snapshots.length, before); assert.equal(f.submission.snapshot.totalCount, 0);
  assert.throws(() => f.submission.submit(f.raw), { code: "REQUEST_ABORTED" });
});

test("immediate disposal cancels before any queued digest or API operation can begin", async () => {
  const f = fixture(); const first = f.submission.submit(f.raw);
  f.submission.dispose(); await assert.rejects(first, { code: "REQUEST_ABORTED" });
  assert.equal(f.hashes.size, 0); assert.equal(f.calls.length, 0);
});

test("disposal from a receipt progress callback cannot silently resolve an unfinished batch or begin transfer", async () => {
  const f = fixture();
  const first = f.submission.submit(f.raw, (state) => {
    if (state.contributionId) f.submission.dispose();
  });
  await assert.rejects(first, { code: "REQUEST_ABORTED" });
  assert.deepEqual(f.calls.map((call) => call.op), ["create"]);
});

test("presentation callback failures cannot alter confirmed transfer outcomes", async () => {
  const f = fixture();
  assert.equal((await f.submission.submit(f.raw, () => { throw new Error("Presentation failed"); })).complete, true);
  assert.equal(f.calls.filter((call) => call.op === "upload").length, 3);
});

test("a known create validation rejection permits editing; uncertain create failures keep metadata locked", async () => {
  const f = fixture({ hooks: { create: () => { throw validationError(); } } });
  await assert.rejects(f.submission.submit(f.raw), { code: "VALIDATION_FAILED" });
  assert.equal(f.submission.snapshot.retained, false); assert.equal(f.submission.pending, false);
});

function validationError() { return new ApiError("Check captions", { code: "VALIDATION_FAILED", status: 400 }); }
