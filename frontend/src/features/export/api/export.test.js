import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createApiClient, ApiError } from "../../../shared/api/apiClient.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import {
  COUPLE_SESSION,
  MEDIA_DETAIL,
  MEMORY_DETAIL,
} from "../../../shared/api/v1/fixtures.js";
import { createInboxController } from "../../inbox/api/inboxController.js";
import { decodeExportStatus } from "./exportApi.js";
import { initialExport } from "./exportActions.js";
import { fetchExportPart, MAX_EXPORT_DOWNLOAD_BYTES } from "./exportDownload.js";
import { createMockExportServer } from "./mockExportServer.js";

// Synthetic transport/controller fixtures. Actual production ZIP structure,
// original bytes and offline reader are verified by the packaged rehearsal.
const id = n => "88888888-8888-4888-8888-" + String(n).padStart(12, "0");
const excludedCounts = { deletedOrPurgingMemories: 0, unfinishedOrUnavailableMemories: 0, deletedAlbums: 0, deletedTimelineEvents: 0, deletedTags: 0 };
const JOB = { exportId: id(1), state: "READY", createdAt: "2026-10-10T12:00:00Z", capturedAt: "2026-10-10T12:00:01Z", expiresAt: "2026-10-10T12:30:00Z", hardExpiresAt: "2026-10-11T12:00:00Z",
  totalMemories: 2, totalOriginals: 1, totalOriginalBytes: 10, originalPartCount: 1, indexPartNumber: 2, processedOriginalParts: 0, availableOriginals: 0, unavailableOriginals: 0,
  complete: false, indexNeedsRefresh: false, preparedPart: null, lastAttempt: null, errorCode: null, excludedCounts, pollAfterSeconds: 2 };
const bytes = new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)]), sha256 = createHash("sha256").update(bytes).digest("hex");
const PART = { partNumber: 1, kind: "ORIGINALS", generation: id(3), attemptId: id(4), filename: "kevin-mel-archive-" + id(1) + "-part-1.zip", byteSize: bytes.length, sha256 };
const PATH = "/api/exports/" + id(1) + "/parts/1/download?generation=" + id(3);
const binary = (body = bytes, headers = {}, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/zip", "Content-Length": String(bytes.length), "Content-Disposition": 'attachment; filename="' + PART.filename + '"', "X-Archive-SHA256": sha256, ...headers } });
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function signedMock(config = {}) { const api = createMockArchiveApi(config), session = await api.getSession(); await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken }); return api; }
async function entered(api, extra = {}) {
  const created = [], revoked = [], controller = createInboxController({ api, createObjectURL(blob) { const url = "blob:export-" + (created.length + 1); created.push({ url, blob }); return url; }, revokeObjectURL: url => revoked.push(url), ...extra });
  await controller.loadSession(); await controller.loadExport(); return { c: controller, created, revoked };
}
async function ready(c) { await c.createExport(); await c.checkExport(); return c.getSnapshot().export.job; }
async function prepared(c, number = 1) { await c.prepareExportPart(number); await c.checkExport(); return c.getSnapshot().export.job.preparedPart; }

test("binary part transport uses only versioned same-origin route and verifies exact size, MIME, filename and SHA before Blob", async () => {
  const calls = [], progress = []; const blob = await fetchExportPart(PATH, PART, { fetchImpl: async (path, options) => { calls.push({ path, options }); return binary(); }, onProgress: (received, total) => progress.push([received, total]) });
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(bytes)); assert.equal(blob.type, "application/zip"); assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
  const { path, options } = calls[0]; assert.equal(path, PATH); assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error"); assert.equal(options.referrerPolicy, "no-referrer");
  assert.deepEqual(options.headers, { Accept: "application/zip", "X-Api-Contract": "1" });
  let reached = false; for (const value of [{ ...PART, byteSize: MAX_EXPORT_DOWNLOAD_BYTES + 1 }, { ...PART, filename: "../private.zip" }, { ...PART, sha256: "bad" }]) await assert.rejects(() => fetchExportPart(PATH, value, { fetchImpl: () => { reached = true; } }), TypeError);
  await assert.rejects(() => fetchExportPart("https://storage.example.test/private", PART), TypeError); assert.equal(reached, false);
});
test("binary malformed headers, short/long streams and actual checksum mismatch never return downloadable bytes", async () => {
  for (const [body, headers] of [[bytes, { "Content-Type": "text/html" }], [bytes, { "Content-Length": String(MAX_EXPORT_DOWNLOAD_BYTES + 1) }], [bytes, { "X-Archive-SHA256": "b".repeat(64) }],
    [bytes, { "Content-Disposition": 'attachment; filename="wrong.zip"' }], [bytes.slice(1), {}], [new Uint8Array([...bytes, 0]), {}], [new Uint8Array(bytes.length), {}]]) {
    await assert.rejects(() => fetchExportPart(PATH, PART, { fetchImpl: async () => binary(body, headers) }), e => e.code === "EXPORT_INTEGRITY");
  }
});
test("binary download retains its initial descriptor across a deferred fetch", async () => {
  const expected = { ...PART };
  const response = deferred();
  const dispatched = deferred();
  const progress = [];
  const downloading = fetchExportPart(PATH, expected, {
    fetchImpl() {
      dispatched.resolve();
      return response.promise;
    },
    onProgress(received, total) {
      progress.push([received, total]);
    },
  });
  await dispatched.promise;
  Object.assign(expected, {
    byteSize: PART.byteSize + 1,
    sha256: "f".repeat(64),
    filename: "replacement.zip",
  });
  response.resolve(binary());

  const blob = await downloading;
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(bytes));
  assert.deepEqual(progress.at(-1), [PART.byteSize, PART.byteSize]);
  assert.equal(expected.filename, "replacement.zip");
  assert.equal(Object.isFrozen(expected), false);
});

test("binary checksum target cannot be replaced while its digest is pending", async () => {
  const expected = { ...PART };
  const tampered = bytes.slice();
  tampered[0] ^= 0xff;
  const actualChecksum = createHash("sha256").update(tampered).digest("hex");
  const digest = deferred();
  const hashing = deferred();
  const downloading = fetchExportPart(PATH, expected, {
    fetchImpl: async () => binary(tampered),
    digest(retainedBytes) {
      assert.deepEqual(Buffer.from(retainedBytes), Buffer.from(tampered));
      hashing.resolve();
      return digest.promise;
    },
  });
  await hashing.promise;
  expected.sha256 = actualChecksum;
  digest.resolve(actualChecksum);

  await assert.rejects(downloading, failure => failure.code === "EXPORT_INTEGRITY");
  assert.equal(expected.sha256, actualChecksum);
});

test("binary expiry/busy/auth structured errors stay read failures and abort cancels an owned stream and late checksum", async () => {
  for (const [status, code] of [[401, "AUTH_REQUIRED"], [403, "ARCHIVE_UNAVAILABLE"], [409, "EXPORT_PART_UNAVAILABLE"], [410, "EXPORT_UNAVAILABLE"], [429, "RATE_LIMITED"]]) {
    await assert.rejects(() => fetchExportPart(PATH, PART, { fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: "Untrusted private diagnostic" } }), { status, headers: { "Content-Type": "application/json", "Retry-After": "2" } }) }), e => e.status === status && e.code === code && e.retryAfterSeconds === 2 && !e.message.includes("Untrusted"));
  }
  const abort = new AbortController(); let cancelled = 0;
  const reading = fetchExportPart(PATH, PART, { signal: abort.signal, fetchImpl: async () => binary(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 1)); }, cancel() { cancelled++; } })), onProgress() { abort.abort(new DOMException("Cancelled", "AbortError")); } });
  await assert.rejects(() => reading, e => e.name === "AbortError"); assert.equal(cancelled, 1);
  const digest = deferred(), started = deferred(), nextAbort = new AbortController();
  const hashing = fetchExportPart(PATH, PART, { signal: nextAbort.signal, fetchImpl: async () => binary(), digest: () => { started.resolve(); return digest.promise; } }); await started.promise; nextAbort.abort(new DOMException("Cancelled", "AbortError")); digest.resolve(sha256); await assert.rejects(() => hashing, e => e.name === "AbortError");
});
test("real JSON adapter uses known job/attempt identities, bodyless CSRF controls and bounded owner-checked pages", async () => {
  const calls = [], api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, request) => {
    calls.push({ path, request }); const payload = path.includes("/attempts/") ? { attemptId: id(5), kind: "PREPARE", partNumber: 1, state: "RUNNING" } : path.includes("?") ? { exportId: JOB.exportId, items: [], nextCursor: null } : JOB;
    return new Response(JSON.stringify(payload), { status: request.method === "PUT" || request.method === "POST" ? 202 : 200, headers: { "Content-Type": "application/json" } });
  } }) }); const options = { csrfToken: COUPLE_SESSION.csrfToken, attemptId: id(5) };
  await api.createExport(id(1), options); await api.prepareExportPart(id(1), 1, options); await api.cancelExport(id(1), options); await api.getExportAttempt(id(1), id(5)); await api.listExportParts(id(1)); await api.listExportIssues(id(1));
  assert.deepEqual(calls.slice(0, 3).map(c => c.request.method), ["PUT", "POST", "DELETE"]); assert.equal(calls[0].request.headers.get("If-None-Match"), "*"); assert.equal(calls[1].request.headers.get("Idempotency-Key"), id(5));
  for (const { path, request } of calls) { assert.match(path, /^\/api\/exports\//); assert.equal(request.body, undefined); assert.equal(request.credentials, "same-origin"); assert.equal(request.cache, "no-store"); if (request.method !== "GET") assert.equal(request.headers.get("X-CSRF-Token"), options.csrfToken); }
  assert.throws(() => api.listExportParts(id(1), { limit: 51 }), TypeError); assert.throws(() => api.prepareExportPart(id(1), 0, options), TypeError);
  for (const value of [{ ...JOB, exportId: [JOB.exportId] }, { ...JOB, processedOriginalParts: 2 }, { ...JOB, excludedCounts: { secret: 1 } }, { ...JOB, preparedPart: { ...PART, byteSize: MAX_EXPORT_DOWNLOAD_BYTES + 1 } },
    { ...JOB, preparedPart: { ...PART, filename: "../unsafe.zip" } }, { ...JOB, lastAttempt: { attemptId: id(5), kind: "CANCEL", partNumber: 1, state: "SUCCEEDED" } }, { ...JOB, complete: true }]) assert.throws(() => decodeExportStatus(value, JOB.exportId), e => e.code === "CONTRACT_MISMATCH");
  assert.equal(decodeExportStatus({ ...JOB, processedOriginalParts: 1, availableOriginals: 1, complete: true, preparedPart: null }, JOB.exportId).complete, true);
  const malformed = createArchiveApi({ client: createApiClient({ fetchImpl: async () => new Response(JSON.stringify({ exportId: id(2), items: [null], nextCursor: null }), { headers: { "Content-Type": "application/json" } }) }) }); await assert.rejects(() => malformed.listExportParts(id(1)), e => e.code === "CONTRACT_MISMATCH");
});
test("acknowledged job supports explicit part/index preparation, verified Blob save and navigation/logout without a permanent fence", async () => {
  const api = await signedMock(), f = await entered(api), job = await ready(f.c); assert.equal(job.state, "READY"); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle");
  await prepared(f.c); await f.c.downloadExportPart(); assert.equal(f.c.getSnapshot().export.download.phase, "ready"); assert.deepEqual(Buffer.from(await f.created[0].blob.arrayBuffer()), Buffer.from(bytes));
  f.c.exportDownloadStarted(); assert.match(f.c.getSnapshot().export.notice, /Download started/); assert.doesNotMatch(f.c.getSnapshot().export.notice, /saved successfully/);
  await prepared(f.c, job.indexPartNumber); assert.equal(f.c.getSnapshot().export.job.complete, true); await f.c.loadLibrary(); assert.equal(f.c.getSnapshot().phase, "library"); assert.equal(f.c.getSnapshot().export.job, null);
  await f.c.loadExport(); assert.equal(f.c.getSnapshot().export.job.exportId, job.exportId); await f.c.logout(); assert.equal(f.c.getSnapshot().phase, "login"); assert.equal(f.c.getSnapshot().export.job, null); f.c.dispose();
});
test("discarded committed create/prepare/cancel responses reconcile recorded identities without duplicate work", async () => {
  const api = await signedMock(); api.setScenario("uncertainSubmission"); const f = await entered(api); await f.c.createExport(); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain"); await f.c.checkExport(); const jobId = f.c.getSnapshot().export.job.exportId;
  await f.c.prepareExportPart(1); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain"); await f.c.checkExport(); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); assert.equal(f.c.getSnapshot().export.job.preparedPart.partNumber, 1);
  await f.c.cancelExport(); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain"); await f.c.checkExport(); assert.equal(f.c.getSnapshot().export.job.state, "CANCELLED"); assert.equal(f.c.getSnapshot().export.job.exportId, jobId); f.c.dispose();
});
test("unrecorded creation and preparation retry only the same retained UUID after a fresh read, never automatically", async () => {
  const api = await signedMock(), realCreate = api.createExport, realPrepare = api.prepareExportPart, creates = [], prepares = [];
  api.createExport = (...args) => { creates.push(args[0]); if (creates.length === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return realCreate(...args); };
  const f = await entered(api); await f.c.createExport(); await f.c.checkExport(); assert.equal(creates.length, 1); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); await f.c.retryExportAction(); await f.c.checkExport(); assert.equal(creates[0], creates[1]);
  api.prepareExportPart = (...args) => { prepares.push(args[2].attemptId); if (prepares.length === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return realPrepare(...args); };
  await f.c.prepareExportPart(1); await f.c.checkExport(); assert.equal(prepares.length, 1); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); await f.c.retryExportAction(); assert.equal(prepares[0], prepares[1]); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); f.c.dispose();
});
test("unresolved export fences all private actions and hide retains only opaque identity before fresh-session reconciliation", async () => {
  const api = await signedMock(), real = api.createExport; let attempts = 0; api.createExport = (...args) => { attempts++; if (attempts === 1) throw new ApiError("raw private diagnostic", { unknownOutcome: true }); return real(...args); };
  const f = await entered(api); await f.c.createExport(); const before = f.c.getSnapshot(); await f.c.loadLibrary(); await f.c.loadTags(); await f.c.loadAlbums(); await f.c.loadTimeline(); await f.c.loadInbox(); await f.c.openMemory(MEMORY_DETAIL.memoryId); await f.c.logout(); f.c.beginCreation(); await f.c.createExport(); assert.equal(f.c.getSnapshot(), before); assert.equal(attempts, 1);
  f.c.suspend(); assert.equal(f.c.getSnapshot().session, null); assert.equal(f.c.getSnapshot().export.job, null); assert.equal(f.c.getSnapshot().export.download.url, null); assert.doesNotMatch(JSON.stringify(f.c.getSnapshot()), /raw private|kevin-mel-archive-/);
  await f.c.resume(); assert.equal(attempts, 1); assert.equal(f.c.getSnapshot().phase, "export"); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); await f.c.retryExportAction(); assert.equal(attempts, 2); f.c.dispose();
});
test("acknowledged control stays idle with read error after failed/timed member pages and recorded-attempt status reads", async () => {
  for (const timed of [false, true]) {
    const api = await signedMock(), timers = new Map(); let next = 0; const f = await entered(api, { setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; }, clearTimeoutImpl(key) { timers.delete(key); } }); await ready(f.c);
    const pending = deferred(), reading = deferred(), real = api.listExportParts;
    api.listExportParts = () => { reading.resolve(); return timed ? pending.promise : Promise.reject(new ApiError("synthetic", { status: 503 })); };
    const preparing = f.c.prepareExportPart(1); await reading.promise; if (timed) [...timers.values()][0](); await preparing;
    assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); assert.equal(f.c.getSnapshot().export.job.state, "PREPARING"); assert.deepEqual(f.c.getSnapshot().export.parts, []); assert.match(f.c.getSnapshot().export.notice, /accepted/); assert.match(f.c.getSnapshot().export.error, /could not be checked/);
    api.listExportParts = real; await f.c.checkExport(); const latest = f.c.getSnapshot(); pending.resolve({ exportId: id(1), items: [], nextCursor: null }); await turn(); assert.equal(f.c.getSnapshot(), latest); assert.equal(timers.size, 0); f.c.dispose();
  }
  const api = await signedMock(), f = await entered(api); await ready(f.c); api.setScenario("uncertainSubmission"); await f.c.prepareExportPart(1); const realStatus = api.getExport; api.getExport = async () => { throw new ApiError("synthetic", { status: 503 }); }; await f.c.checkExport(); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); assert.match(f.c.getSnapshot().export.error, /could not be checked/); api.getExport = realStatus; f.c.dispose();
});
test("all owned Blob URLs revoke exactly once across progress, prepare, replacement, hide and disposal", async () => {
  const api = await signedMock(), f = await entered(api); await ready(f.c); await prepared(f.c); await f.c.downloadExportPart(); await f.c.checkExport(); assert.deepEqual(f.revoked, ["blob:export-1"]);
  await f.c.downloadExportPart(); await prepared(f.c, f.c.getSnapshot().export.job.indexPartNumber); assert.deepEqual(f.revoked, ["blob:export-1", "blob:export-2"]);
  await f.c.downloadExportPart(); f.c.suspend(); assert.deepEqual(f.revoked, ["blob:export-1", "blob:export-2", "blob:export-3"]); await f.c.resume(); assert.equal(f.c.getSnapshot().export.download.url, null); f.c.dispose(); assert.equal(f.revoked.length, 3);
});
test("hide and late download/checksum results cannot create URLs or resurrect a private export; auth loss clears session", async () => {
  const api = await signedMock(), f = await entered(api); await ready(f.c); await prepared(f.c); const pending = deferred(), dispatched = deferred(); api.downloadExportPart = () => { dispatched.resolve(); return pending.promise; };
  const loading = f.c.downloadExportPart(); await dispatched.promise; f.c.suspend(); await loading; pending.resolve(new Blob([bytes], { type: "application/zip" })); await turn(); assert.equal(f.created.length, 0); assert.equal(f.c.getSnapshot().export.job, null); await f.c.resume(); assert.equal(f.c.getSnapshot().phase, "export"); assert.equal(f.c.getSnapshot().export.download.url, null);
  api.setScenario("forbidden"); await f.c.checkExport(); assert.equal(f.c.getSnapshot().phase, "unavailable"); assert.equal(f.c.getSnapshot().export.job, null); assert.equal(f.c.getSnapshot().session, null); f.c.dispose();
});
test("known-job restart/expiry requires explicit fresh job, including resume; creation/other unresolved writes block export commands", async () => {
  const api = await signedMock(), f = await entered(api), previous = await ready(f.c), real = api.getExport; api.getExport = async () => { throw new ApiError("synthetic", { status: 404 }); };
  f.c.suspend(); await f.c.resume(); assert.equal(f.c.getSnapshot().phase, "export"); assert.equal(f.c.getSnapshot().export.unavailable, true); assert.equal(f.c.getSnapshot().export.job, null); api.getExport = real; await f.c.createExport(); assert.notEqual(f.c.getSnapshot().export.job.exportId, previous.exportId);
  await f.c.loadInbox(); f.c.beginCreation(); const creator = f.c.getSnapshot(); await f.c.loadExport(); await f.c.checkExport(); await f.c.createExport(); assert.equal(f.c.getSnapshot(), creator);
  await f.c.loadInbox(); await f.c.openMemory(MEMORY_DETAIL.memoryId); api.reviewMemory = async () => { throw new ApiError("synthetic", { unknownOutcome: true }); }; await f.c.reviewMemory("DELETE"); const review = f.c.getSnapshot(); await f.c.loadExport(); await f.c.checkExport(); await f.c.prepareExportPart(1); await f.c.cancelExport(); assert.equal(f.c.getSnapshot(), review); f.c.dispose();
});

test("timed-out export resume clears private progress and keeps only the identity for a fresh access check", async () => {
  for (const reconcileControl of [false, true]) {
    const api = await signedMock(), timers = new Map(); let next = 0;
    const f = await entered(api, { setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; }, clearTimeoutImpl(key) { timers.delete(key); } });
    const job = await ready(f.c), realParts = api.listExportParts, pending = deferred(), reading = deferred();
    if (reconcileControl) { api.setScenario("uncertainSubmission"); await f.c.prepareExportPart(1); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain"); }
    f.c.suspend();
    api.listExportParts = () => { reading.resolve(); return pending.promise; };
    const resuming = f.c.resume(); await reading.promise;
    assert.equal(f.c.getSnapshot().export.job.exportId, job.exportId);
    [...timers.values()][0](); await resuming;
    assert.equal(f.c.getSnapshot().phase, "unavailable");
    assert.equal(f.c.getSnapshot().session, null);
    assert.deepEqual(f.c.getSnapshot().export, initialExport());
    api.listExportParts = realParts;
    await f.c.resume();
    assert.equal(f.c.getSnapshot().phase, "export");
    assert.equal(f.c.getSnapshot().export.job.exportId, job.exportId);
    const latest = f.c.getSnapshot();
    pending.resolve({ exportId: job.exportId, items: [], nextCursor: null }); await turn();
    assert.equal(f.c.getSnapshot(), latest); assert.equal(timers.size, 0); f.c.dispose();
  }
});
test("safe Retry-After blocks premature requests and CSRF refresh reads current status without replaying", async () => {
  let clock = Date.now(); const api = await signedMock(), f = await entered(api, { now: () => clock }); await ready(f.c); let attempts = 0; const real = api.prepareExportPart;
  api.prepareExportPart = (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { status: 409, code: "EXPORT_BUSY", retryAfterSeconds: 2 }); return real(...args); };
  await f.c.prepareExportPart(1); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); await f.c.prepareExportPart(1); assert.equal(attempts, 1); clock += 2000; await f.c.prepareExportPart(1); assert.equal(attempts, 2); await f.c.checkExport();
  const session = await api.getSession(); await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken }); await f.c.cancelExport(); assert.equal(f.c.getSnapshot().export.mutation.phase, "csrf"); await f.c.checkExport({ refreshSession: true }); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain"); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); assert.notEqual(f.c.getSnapshot().export.job.state, "CANCELLED"); f.c.dispose();
});
test("fresh controller after logout/sign-in or refresh discovers the actor's existing job without another create", async () => {
  const api = await signedMock(), real = api.createExport; let creates = 0; api.createExport = (...args) => { creates++; return real(...args); };
  const f = await entered(api), job = await ready(f.c); await f.c.logout(); f.c.dispose();
  const session = await api.getSession(); await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken });
  const resumed = await entered(api); assert.equal(resumed.c.getSnapshot().export.job.exportId, job.exportId); assert.match(resumed.c.getSnapshot().export.notice, /Existing export loaded/); assert.equal(creates, 1); resumed.c.dispose();
  const refreshed = await entered(api); assert.equal(refreshed.c.getSnapshot().export.job.exportId, job.exportId); assert.equal(creates, 1); refreshed.c.dispose();
});
test("bounded part/issue pages replace rows, preserve separate cursors and accept valid part plans beyond 200", async () => {
  const large = { ...JOB, originalPartCount: 301, indexPartNumber: 302, totalOriginals: 301, processedOriginalParts: 301, unavailableOriginals: 25, state: "READY_WITH_WARNINGS" };
  assert.equal(decodeExportStatus(large, large.exportId).originalPartCount, 301);
  const partRows = Array.from({ length: 302 }, (_, n) => ({ partNumber: n + 1, kind: n === 301 ? "INDEX" : "ORIGINALS", state: n === 301 ? "UNPROCESSED" : "PROCESSED", availableOriginals: 0, unavailableOriginals: n < 25 ? 1 : 0 }));
  const issues = Array.from({ length: 25 }, (_, n) => ({ partNumber: n + 1, memoryId: id(n + 100), assetId: id(n + 200), code: "READ_FAILED" }));
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async path => {
    const url = new URL(path, "https://synthetic.test"), offset = Number(url.searchParams.get("cursor") ?? 0), size = Number(url.searchParams.get("limit") ?? 20); let value;
    if (path === "/api/session") value = COUPLE_SESSION;
    else if (path.startsWith("/api/memories?")) value = { items: [], nextCursor: null };
    else if (path.includes("/parts?") || path.includes("/issues?")) { const rows = path.includes("/parts?") ? partRows : issues; value = { exportId: JOB.exportId, items: rows.slice(offset, offset + size), nextCursor: offset + size < rows.length ? String(offset + size) : null }; }
    else value = large;
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  } }) });
  const f = await entered(api); assert.equal(f.c.getSnapshot().export.parts.length, 20); assert.equal(f.c.getSnapshot().export.issues.length, 20);
  await f.c.exportPage("parts", true); assert.equal(f.c.getSnapshot().export.parts[0].partNumber, 21); assert.deepEqual(f.c.getSnapshot().export.partCursors, [null, "20"]);
  await f.c.exportPage("issues", true); assert.equal(f.c.getSnapshot().export.issues.length, 5); assert.equal(f.c.getSnapshot().export.parts[0].partNumber, 21);
  await f.c.exportPage("parts", false); assert.equal(f.c.getSnapshot().export.parts[0].partNumber, 1); await f.c.checkExport(); assert.deepEqual(f.c.getSnapshot().export.issueCursors, [null]); assert.equal(f.c.getSnapshot().export.issues.length, 20); f.c.dispose();
});
for (const kind of ["parts", "issues"]) {
  for (const next of [true, false]) {
    test(`failed ${next ? "next" : "previous"} export ${kind} page preserves content and history until a successful retry`, async () => {
      const job = { ...JOB, originalPartCount: 45, indexPartNumber: 46, totalOriginals: 45,
        processedOriginalParts: 45, unavailableOriginals: 45, state: "READY_WITH_WARNINGS" };
      const rows = {
        parts: Array.from({ length: 46 }, (_, n) => ({ partNumber: n + 1, kind: n === 45 ? "INDEX" : "ORIGINALS",
          state: n === 45 ? "UNPROCESSED" : "PROCESSED", availableOriginals: 0, unavailableOriginals: n < 45 ? 1 : 0 })),
        issues: Array.from({ length: 45 }, (_, n) => ({ partNumber: n + 1, memoryId: id(n + 100), assetId: id(n + 200), code: "READ_FAILED" })),
      };
      const requests = [], failure = deferred(), dispatched = deferred();
      let failPage = false;
      const api = createArchiveApi({ client: createApiClient({ fetchImpl: async path => {
        const url = new URL(path, "https://synthetic.test");
        const pageKind = path.includes("/parts?") ? "parts" : path.includes("/issues?") ? "issues" : null;
        let value;
        if (pageKind) {
          const cursor = url.searchParams.get("cursor"), offset = Number(cursor ?? 0);
          requests.push({ kind: pageKind, cursor });
          if (failPage && pageKind === kind) {
            failPage = false;
            dispatched.resolve();
            await failure.promise;
            return new Response(JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "Synthetic page failure" } }),
              { status: 503, headers: { "Content-Type": "application/json" } });
          }
          value = { exportId: job.exportId, items: rows[pageKind].slice(offset, offset + 20), nextCursor: offset + 20 < rows[pageKind].length ? String(offset + 20) : null };
        } else if (path === "/api/session") value = COUPLE_SESSION;
        else if (path.startsWith("/api/memories?")) value = { items: [], nextCursor: null };
        else value = job;
        return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
      } }) });
      const f = await entered(api), otherKind = kind === "parts" ? "issues" : "parts";
      let paging;
      const pageState = state => ({
        parts: state.parts, issues: state.issues, partCursors: state.partCursors, issueCursors: state.issueCursors,
        partsNextCursor: state.partsNextCursor, issuesNextCursor: state.issuesNextCursor,
      });
      try {
        await f.c.exportPage(otherKind, true);
        if (!next) await f.c.exportPage(kind, true);
        const before = f.c.getSnapshot().export, expectedCursor = next ? "20" : null;
        failPage = true;
        paging = f.c.exportPage(kind, next);
        await dispatched.promise;
        const loading = f.c.getSnapshot();
        failure.resolve();
        await paging;
        const failed = f.c.getSnapshot();
        const retryStart = requests.length;
        await f.c.exportPage(kind, next);
        const retried = f.c.getSnapshot();

        assert.equal(loading.busy, true);
        assert.deepEqual(pageState(loading.export), pageState(before), "Loading keeps the visible pages and their navigation");
        assert.equal(failed.busy, false);
        assert.match(failed.export.error, /could not be checked/);
        assert.deepEqual(pageState(failed.export), pageState(before), "A failed read does not commit the requested page");
        assert.deepEqual(requests.slice(retryStart), [{ kind, cursor: expectedCursor }], "Retry requests the same target page");
        assert.equal(retried.export.error, null);
        assert.deepEqual(retried.export[kind], rows[kind].slice(next ? 20 : 0, next ? 40 : 20));
        const cursorKey = kind === "parts" ? "partCursors" : "issueCursors";
        assert.deepEqual(retried.export[cursorKey], next ? [null, "20"] : [null]);
        const otherCursorKey = kind === "parts" ? "issueCursors" : "partCursors";
        assert.deepEqual(retried.export[otherKind], before[otherKind]);
        assert.deepEqual(retried.export[otherCursorKey], before[otherCursorKey]);
        assert.equal(retried.export[otherKind + "NextCursor"], before[otherKind + "NextCursor"]);
      } finally {
        failure.resolve();
        await paging;
        f.c.dispose();
      }
    });
  }
}

test("late ignored-abort create after hide is reconciled through original job identity and never republished while hidden", async () => {
  const api = await signedMock(), original = api.createExport, pending = deferred(), dispatched = deferred(); let identity, creates = 0;
  api.createExport = (...args) => { creates++; identity = args[0]; dispatched.resolve(); return pending.promise.then(() => original(args[0], { ...args[1], signal: undefined })); };
  const f = await entered(api), creating = f.c.createExport(); await dispatched.promise; f.c.suspend(); await creating; assert.equal(f.c.getSnapshot().export.job, null);
  pending.resolve(); await turn(); await turn(); assert.equal(f.c.getSnapshot().export.job, null); await f.c.resume(); assert.equal(f.c.getSnapshot().export.job.exportId, identity); assert.equal(f.c.getSnapshot().export.mutation.phase, "idle"); assert.equal(creates, 1); f.c.dispose();
});
test("a throttled retry cannot erase an earlier unknown action and its Retry-After also pauses status checks", async () => {
  let clock = Date.now(); const api = await signedMock(), f = await entered(api, { now: () => clock }); await ready(f.c); let attempts = 0, checks = 0; const check = api.getExportAttempt;
  api.prepareExportPart = () => { attempts++; throw new ApiError("synthetic", attempts === 1 ? { unknownOutcome: true } : { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 3 }); };
  api.getExportAttempt = (...args) => { checks++; return check(...args); };
  await f.c.prepareExportPart(1); await f.c.checkExport(); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); await f.c.retryExportAction(); assert.equal(f.c.getSnapshot().export.mutation.phase, "uncertain");
  await f.c.checkExport(); assert.equal(checks, 1); assert.equal(attempts, 2); clock += 3000; await f.c.checkExport(); assert.equal(checks, 2); assert.equal(f.c.getSnapshot().export.mutation.canRetry, true); f.c.dispose();
});

function rawExportServer(now = () => Date.parse("2026-10-19T18:00:00Z")) {
  let sequence = 100;
  const reply = (value, status = 200, headers = {}) => new Response(
    JSON.stringify(value),
    { status, headers: { "Content-Type": "application/json", ...headers } },
  );
  const server = createMockExportServer({
    getSession: () => COUPLE_SESSION,
    getScenario: () => "success",
    getMemories: () => [MEMORY_DETAIL, MEDIA_DETAIL],
    nextId: () => id(sequence++),
    now,
    reply,
    failure: (code, message, status, headers = {}) => reply(
      { error: { code, message, fieldErrors: [] } },
      status,
      headers,
    ),
  });
  return (path, method = "GET", extraHeaders = {}) => server.handle(
    new URL(path, "https://synthetic.example.test"),
    method,
    new Headers({ "X-CSRF-Token": COUPLE_SESSION.csrfToken, ...extraHeaders }),
    null,
  );
}

async function rawReadyExport(request, exportId = id(1)) {
  const path = "/api/exports/" + exportId;
  const created = await request(path, "PUT", { "If-None-Match": "*" });
  assert.equal(created.status, 202);
  return (await request(path)).json();
}

test("mock export pages scope cursors to their job and route and validate limits before missing jobs", async () => {
  const request = rawExportServer();
  await rawReadyExport(request);
  const first = await (await request("/api/exports/" + id(1) + "/parts?limit=1")).json();
  assert.equal(first.items.length, 1);
  assert.equal(typeof first.nextCursor, "string");
  const wrongRoute = await request(
    "/api/exports/" + id(1) + "/issues?cursor=" + encodeURIComponent(first.nextCursor),
  );
  assert.equal(wrongRoute.status, 400);
  assert.equal((await wrongRoute.json()).error.code, "INVALID_CURSOR");

  await rawReadyExport(request, id(2));
  const wrongJob = await request(
    "/api/exports/" + id(2) + "/parts?cursor=" + encodeURIComponent(first.nextCursor),
  );
  assert.equal(wrongJob.status, 400);
  assert.equal((await wrongJob.json()).error.code, "INVALID_CURSOR");
  for (const kind of ["parts", "issues"]) {
    const badLimit = await request("/api/exports/" + id(99) + "/" + kind + "?limit=0");
    assert.equal(badLimit.status, 400);
    assert.equal((await badLimit.json()).error.code, "VALIDATION_FAILED");
    const malformed = await request("/api/exports/" + id(1) + "/" + kind + "?cursor=bad");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "INVALID_CURSOR");
  }
  const last = await (await request(
    "/api/exports/" + id(1) + "/parts?limit=1&cursor=" + encodeURIComponent(first.nextCursor),
  )).json();
  assert.equal(last.items[0].kind, "INDEX");
  assert.equal(last.nextCursor, null);
});

test("mock cancellation clears captured progress and pages and resolves every running attempt as failed", async () => {
  const request = rawExportServer();
  await rawReadyExport(request);
  await request("/api/exports/" + id(1) + "/parts/1/prepare", "POST", {
    "Idempotency-Key": id(10),
  });
  const cancelled = await (await request("/api/exports/" + id(1), "DELETE", {
    "Idempotency-Key": id(11),
  })).json();
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(cancelled.capturedAt, null);
  assert.equal(cancelled.indexPartNumber, null);
  assert.equal(cancelled.preparedPart, null);
  assert.equal(cancelled.complete, false);
  assert.equal(cancelled.indexNeedsRefresh, false);
  assert.deepEqual(cancelled.excludedCounts, {});
  for (const field of [
    "totalMemories", "totalOriginals", "totalOriginalBytes", "originalPartCount",
    "processedOriginalParts", "availableOriginals", "unavailableOriginals",
  ]) {
    assert.equal(cancelled[field], 0, field);
  }
  const attempt = await (await request(
    "/api/exports/" + id(1) + "/attempts/" + id(10),
  )).json();
  assert.equal(attempt.state, "FAILED");
  const parts = await (await request("/api/exports/" + id(1) + "/parts")).json();
  assert.deepEqual(parts.items, []);
  assert.equal(parts.nextCursor, null);
});

test("mock expiry stays content-free and a later cancellation does not replace its terminal reason", async () => {
  let at = Date.parse("2026-10-19T18:00:00Z");
  const request = rawExportServer(() => at);
  await rawReadyExport(request);
  at += 31 * 60_000;
  const expired = await (await request("/api/exports/" + id(1))).json();
  assert.equal(expired.state, "EXPIRED");
  const cancelled = await (await request("/api/exports/" + id(1), "DELETE", {
    "Idempotency-Key": id(12),
  })).json();
  assert.equal(cancelled.state, "EXPIRED");
  assert.equal(cancelled.capturedAt, null);
  assert.equal(cancelled.totalMemories, 0);
  assert.deepEqual(cancelled.excludedCounts, {});
});

test("mock read activity refreshes the idle deadline without extending the absolute lifetime", async () => {
  const started = Date.parse("2026-10-19T18:00:00Z");
  let at = started;
  const request = rawExportServer(() => at);
  const readyJob = await rawReadyExport(request);
  at += 20 * 60_000;
  const refreshed = await (await request("/api/exports/" + id(1))).json();
  assert.equal(refreshed.expiresAt, new Date(at + 30 * 60_000).toISOString());
  assert.equal(refreshed.hardExpiresAt, readyJob.hardExpiresAt);
  while (at + 29 * 60_000 < Date.parse(readyJob.hardExpiresAt)) {
    at += 29 * 60_000;
    const active = await (await request("/api/exports/" + id(1))).json();
    assert.equal(active.state, "READY");
    assert.equal(
      active.expiresAt,
      new Date(Math.min(at + 30 * 60_000, Date.parse(readyJob.hardExpiresAt))).toISOString(),
    );
  }
  at = Date.parse(readyJob.hardExpiresAt);
  assert.equal((await request("/api/exports/" + id(1))).status, 404);
});

test("mock preparation requires original results and preserves busy and recorded-attempt response semantics", async () => {
  const request = rawExportServer();
  const job = await rawReadyExport(request);
  const earlyIndex = await request(
    "/api/exports/" + id(1) + "/parts/" + job.indexPartNumber + "/prepare",
    "POST",
    { "Idempotency-Key": id(20) },
  );
  assert.equal(earlyIndex.status, 409);
  assert.equal((await earlyIndex.json()).error.code, "EXPORT_PARTS_PENDING");
  const path = "/api/exports/" + id(1) + "/parts/1/prepare";
  const first = await request(path, "POST", { "Idempotency-Key": id(21) });
  assert.equal(first.status, 202);
  assert.equal((await request(path, "POST", { "Idempotency-Key": id(21) })).status, 202);
  const busy = await request(path, "POST", { "Idempotency-Key": id(22) });
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, "EXPORT_BUSY");
  await request("/api/exports/" + id(1));
  assert.equal((await request(path, "POST", { "Idempotency-Key": id(21) })).status, 200);
});

test("a mock preparation finishing its asynchronous digest cannot resurrect a cancelled job or cache", async () => {
  const request = rawExportServer();
  await rawReadyExport(request);
  await request("/api/exports/" + id(1) + "/parts/1/prepare", "POST", {
    "Idempotency-Key": id(30),
  });
  const finishing = request("/api/exports/" + id(1));
  await request("/api/exports/" + id(1), "DELETE", { "Idempotency-Key": id(31) });
  const settled = await (await finishing).json();
  assert.equal(settled.state, "CANCELLED");
  assert.equal(settled.preparedPart, null);
  assert.equal(settled.lastAttempt.kind, "CANCEL");
  const latest = await (await request("/api/exports/" + id(1))).json();
  assert.equal(latest.state, "CANCELLED");
  assert.equal(latest.preparedPart, null);
  assert.equal(latest.totalMemories, 0);
});

test("an admitted mock progress read refreshes activity before its asynchronous digest settles", async () => {
  const started = Date.parse("2026-10-19T18:00:00Z");
  let at = started;
  const request = rawExportServer(() => at);
  await rawReadyExport(request);
  await request("/api/exports/" + id(1) + "/parts/1/prepare", "POST", {
    "Idempotency-Key": id(40),
  });
  at = started + 29 * 60_000;
  const finishing = request("/api/exports/" + id(1));
  at = started + 31 * 60_000;
  const completed = await (await finishing).json();
  assert.equal(completed.state, "READY");
  assert.equal(completed.preparedPart.partNumber, 1);
  assert.equal(completed.expiresAt, new Date(started + 59 * 60_000).toISOString());
});
