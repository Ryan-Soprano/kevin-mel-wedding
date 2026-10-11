import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createApiClient, ApiError } from "../../../shared/api/apiClient.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { COUPLE_SESSION, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";
import { createInboxController } from "../../inbox/api/inboxController.js";
import { decodeExportStatus } from "./exportApi.js";
import { initialExport } from "./exportActions.js";
import { fetchExportPart, MAX_EXPORT_DOWNLOAD_BYTES } from "./exportDownload.js";

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
