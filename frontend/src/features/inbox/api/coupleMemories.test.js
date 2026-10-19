import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { createCoupleSubmissionApi } from "./coupleSubmissionApi.js";
import { createInboxController } from "./inboxController.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { createTextSubmission } from "../../contribution/api/textSubmission.js";
import { createPhotoBatchSubmission } from "../../media/api/photoBatchSubmission.js";
import { createAudioSubmission } from "../../audio/api/audioSubmission.js";
import { COUPLE_SESSION, IDS, MEDIA_DETAIL, MEMORY_DETAIL, TEXT_RECEIPT, UPLOAD_GRANT } from "../../../shared/api/v1/fixtures.js";

const copy = value => structuredClone(value);
const target = { title: "Private title", description: "Remembered context", memoryDate: "2024-06", datePrecision: "MONTH" };
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function entered(api) {
  const controller = createInboxController({ api });
  await controller.loadSession(); await controller.openMemory(IDS.text);
  return controller;
}
function fixture(overrides = {}) {
  let memory = copy(MEMORY_DETAIL);
  const api = { getSession: async () => copy(COUPLE_SESSION), listMemories: async () => ({ items: [memory], nextCursor: null }),
    getMemory: async () => copy(memory), updateMemoryMetadata: async (_id, metadata, options) => {
      memory = { ...memory, ...metadata, revision: options.revision + 1 }; return copy(memory);
    }, ...overrides };
  return { api, set memory(value) { memory = copy(value); }, get memory() { return copy(memory); } };
}

test("private adapter uses authenticated namespace, exact CSRF and original upload bodies", async () => {
  const calls = [];
  const receipt = { ...TEXT_RECEIPT, memories: TEXT_RECEIPT.memories.map(memory => ({ ...memory, reviewStatus: "KEEP" })) };
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(path.endsWith("upload-grants") ? UPLOAD_GRANT : receipt), { status: path.endsWith("upload-grants") ? 201 : 200, headers: { "Content-Type": "application/json" } });
  } }) });
  const privateApi = createCoupleSubmissionApi({ api, getSession: () => COUPLE_SESSION });
  await privateApi.createTextContribution({ guestName: "ignored guest", message: " note " }, { idempotencyKey: IDS.key });
  await privateApi.getReceipt(IDS.contribution, { idempotencyKey: IDS.key });
  await privateApi.authorizeUpload(IDS.contribution, IDS.photo, { idempotencyKey: IDS.key });
  await privateApi.finalizeUpload(IDS.contribution, IDS.photo, IDS.grant, { idempotencyKey: IDS.key });
  assert.ok(calls.every(call => call.path.startsWith("/api/memories/contributions")));
  assert.deepEqual(JSON.parse(calls[0].options.body), { guestName: null, message: "note" });
  for (const call of calls.filter(call => call.options.method !== "GET")) assert.equal(new Headers(call.options.headers).get("X-CSRF-Token"), COUPLE_SESSION.csrfToken);
  assert.equal(new Headers(calls[1].options.headers).get("Idempotency-Key"), IDS.key);
});

test("signed PUT permission expiry remains a retryable item and cannot clear authenticated drafts", async () => {
  const expired = new ApiError("expired", { status: 403, code: "UPLOAD_GRANT_EXPIRED" });
  let clears = 0;
  const file = new File(["exact bytes"], "original.png", { type: "image/png" });
  const api = createCoupleSubmissionApi({ api: { uploadMedia: async (_grant, original) => { assert.equal(original, file); throw expired; } },
    getSession: () => COUPLE_SESSION, onAccessFailure: () => clears++ });
  await assert.rejects(api.uploadMedia(UPLOAD_GRANT, file), { code: "UPLOAD_GRANT_EXPIRED" });
  assert.equal(clears, 0);
});

test("private photo retry renews a rejected signed grant and transfers the identical retained original", async () => {
  const api = createMockArchiveApi();
  const anonymous = await api.getSession();
  await api.login({ username: "fixture", password: "synthetic" }, { csrfToken: anonymous.csrfToken });
  const session = await api.getSession(), transfers = []; let clears = 0;
  const transfer = api.uploadMedia;
  api.uploadMedia = async (grant, original, options) => {
    transfers.push([grant.grantId, original]);
    if (transfers.length === 1) throw new ApiError("expired signed grant", { status: 403, code: "UPLOAD_GRANT_EXPIRED" });
    return transfer(grant, original, options);
  };
  const privateApi = createCoupleSubmissionApi({ api, getSession: () => session, onAccessFailure: () => clears++ });
  const file = new File(["original bytes"], "original.png", { type: "image/png" });
  const photo = { id: IDS.clientItem, file, caption: "original caption" };
  const batch = createPhotoBatchSubmission({ api: privateApi, randomUUID: () => IDS.key });
  await batch.submit({ guestName: null, photos: [photo] });
  const identities = copy(batch.receipt); assert.equal(batch.getSnapshot().pending, true); assert.equal(clears, 0);
  await batch.retry([photo.id]);
  assert.equal(batch.complete, true); assert.equal(clears, 0);
  assert.equal(batch.receipt.contributionId, identities.contributionId);
  assert.equal(batch.receipt.memories[0].memoryId, identities.memories[0].memoryId);
  assert.notEqual(transfers[0][0], transfers[1][0]); assert.equal(transfers[0][1], file); assert.equal(transfers[1][1], file);
  batch.dispose();
});

test("metadata PATCH enforces exact fields/revision/CSRF and rejects malformed successful details or ETags", async () => {
  let result = { ...copy(MEMORY_DETAIL), ...target, revision: 2 }, etag = '"2"';
  const calls = [];
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json", ...(etag === null ? {} : { ETag: etag }) } });
  } }) });
  const updated = await api.updateMemoryMetadata(IDS.text, target, { revision: 1, csrfToken: COUPLE_SESSION.csrfToken });
  assert.equal(updated.revision, 2); assert.deepEqual(JSON.parse(calls[0].options.body), target);
  assert.equal(calls[0].path, `/api/memories/${IDS.text}/metadata`);
  assert.equal(calls[0].options.headers.get("If-Match"), '"1"'); assert.equal(calls[0].options.headers.get("X-CSRF-Token"), COUPLE_SESSION.csrfToken);
  const valid = copy(result);
  for (const mutate of [value => { delete value.source; }, value => { delete value.title; }, value => { value.datePrecision = "DAY"; },
    value => { value.memoryDate = "2024-02-30"; value.datePrecision = "DAY"; }, value => { value.title = "\ud800"; },
    value => { value.description = "x".repeat(2001); }, value => { value.revision = 3; }, value => { value.memoryId = IDS.photo; }]) {
    result = copy(valid); mutate(result);
    await assert.rejects(api.updateMemoryMetadata(IDS.text, target, { revision: 1, csrfToken: COUPLE_SESSION.csrfToken }), { code: "CONTRACT_MISMATCH", unknownOutcome: true });
  }
  result = copy(valid);
  for (etag of [null, 'W/"2"', '"3"']) await assert.rejects(api.updateMemoryMetadata(IDS.text, target, { revision: 1, csrfToken: COUPLE_SESSION.csrfToken }), { code: "CONTRACT_MISMATCH", unknownOutcome: true });
});

test("shared coordinator fixture privately creates note/photo/audio, keeps originals and blocks guest capability access", async () => {
  // Synthetic adapter/coordinator fixture, not DOM, codecs, R2 or physical-browser acceptance.
  const api = createMockArchiveApi({ now: () => Date.parse("2026-11-01T00:00:00Z") });
  const originals = [], transfer = api.uploadMedia;
  api.uploadMedia = async (grant, file, options) => { originals.push(file); return transfer(grant, file, options); };
  const initial = await api.getSession(); await api.login({ username: "fixture", password: "synthetic" }, { csrfToken: initial.csrfToken });
  const controller = createInboxController({ api }); await controller.loadSession(); controller.beginCreation();
  const privateApi = controller.getCreationApi();
  api.setScenario("uncertainSubmission");
  const note = createTextSubmission({ api: privateApi, randomUUID: () => IDS.key });
  await assert.rejects(note.submit({ message: "Original private note" }), { unknownOutcome: true });
  const noteReceipt = await note.submit({ message: "Original private note" });
  assert.equal(noteReceipt.memories[0].reviewStatus, "KEEP");
  await assert.rejects(api.getReceipt(noteReceipt.contributionId, { idempotencyKey: IDS.key }), { status: 404 });
  api.setScenario("partialUpload");
  const photos = [1, 2].map(value => ({ id: `00000000-0000-4000-8000-00000000001${value}`, file: new File([String(value)], `original-${value}.png`, { type: "image/png" }), caption: "Original caption" }));
  const batch = createPhotoBatchSubmission({ api: privateApi, randomUUID: () => "00000000-0000-4000-8000-000000000020" });
  await batch.submit({ guestName: null, photos });
  const savedId = batch.receipt.memories[0].memoryId;
  assert.equal(batch.getSnapshot().savedCount, 1);
  await batch.retry([photos[1].id]);
  assert.equal(batch.receipt.memories[0].memoryId, savedId); assert.equal(batch.complete, true);
  api.setScenario("success");
  let generated = 30;
  const audio = createAudioSubmission({ api: privateApi, randomUUID: () => `00000000-0000-4000-8000-${String(generated++).padStart(12, "0")}` });
  const audioFile = new File(["synthetic audio bytes"], "original.webm", { type: "audio/webm" });
  await audio.submit({ file: audioFile, durationSeconds: 2, guestName: null, caption: "Original voice caption" });
  assert.deepEqual(originals, [photos[0].file, photos[1].file, photos[1].file, audioFile]);
  const originalPhoto = await api.getMemory(savedId);
  const session = await api.getSession();
  const editedPhoto = await api.updateMemoryMetadata(savedId, target, { revision: originalPhoto.revision, csrfToken: session.csrfToken });
  assert.deepEqual(editedPhoto.media, originalPhoto.media); assert.equal(editedPhoto.caption, "Original caption");
  const samePhoto = await api.updateMemoryMetadata(savedId, target, { revision: editedPhoto.revision, csrfToken: session.csrfToken });
  assert.deepEqual(samePhoto, editedPhoto);
  await assert.rejects(api.updateMemoryMetadata(savedId, target, { revision: originalPhoto.revision, csrfToken: session.csrfToken }), { status: 412, code: "METADATA_CONFLICT" });
  await controller.creationComplete(noteReceipt);
  assert.equal(controller.getSnapshot().detail.source, "COUPLE");
  await controller.saveMetadata(target);
  assert.equal(controller.getSnapshot().detail.textContent, "Original private note");
  assert.equal(controller.getSnapshot().detail.reviewStatus, "KEEP");
  await controller.loadInbox("KEEP"); assert.equal(controller.getSnapshot().items.length, 4);
  await controller.openMemory(noteReceipt.memories[0].memoryId);
  await controller.reviewMemory("DELETE"); await controller.reviewMemory("PENDING");
  assert.equal(controller.getSnapshot().detail.title, target.title);
  await controller.logout(); assert.equal(controller.getSnapshot().session, null); assert.equal(controller.getSnapshot().detail, null);
  note.dispose(); batch.dispose(); audio.dispose(); controller.dispose();
});

test("unknown metadata commit reconciles all four fields without attributing success or replacing newer review state", async () => {
  const f = fixture({ updateMemoryMetadata: async () => { f.memory = { ...f.memory, ...target, reviewStatus: "ARCHIVED", revision: 3 }; throw new ApiError("lost", { unknownOutcome: true }); } });
  const controller = await entered(f.api);
  await controller.saveMetadata(target); assert.equal(controller.getSnapshot().metadata.phase, "uncertain");
  await controller.reviewMemory("KEEP"); assert.equal(controller.getSnapshot().detail.reviewStatus, "PENDING");
  await controller.reloadMetadata();
  assert.equal(controller.getSnapshot().metadata.phase, "idle"); assert.equal(controller.getSnapshot().detail.reviewStatus, "ARCHIVED");
  assert.equal(controller.getSnapshot().detail.revision, 3); assert.match(controller.getSnapshot().notice, /does not identify who/);
  controller.dispose();
});

test("immutable media context ignores JSON object field order while rejecting changed original bytes", async () => {
  let changed = false;
  const f = fixture({ getPlayback: async () => { throw new ApiError("unavailable", { status: 503 }); },
    updateMemoryMetadata: async (_id, metadata, options) => {
      const result = { ...f.memory, ...metadata, revision: options.revision + 1 };
      result.media = Object.fromEntries(Object.entries(result.media).reverse());
      if (changed) result.media.checksumSha256 = "b".repeat(64);
      return result;
    } });
  f.memory = MEDIA_DETAIL;
  const controller = await entered(f.api);
  await controller.saveMetadata(target);
  assert.equal(controller.getSnapshot().metadata.phase, "idle"); assert.equal(controller.getSnapshot().detail.title, target.title);
  const original = copy(controller.getSnapshot().detail);
  changed = true; await controller.saveMetadata({ ...target, title: "Next title" });
  assert.equal(controller.getSnapshot().metadata.phase, "uncertain"); assert.deepEqual(controller.getSnapshot().detail, original);
  controller.dispose();
});

test("an older read cannot unlock an unknown metadata edit; only the exact frozen same edit can retry", async () => {
  const writes = []; let attempts = 0;
  const f = fixture({ updateMemoryMetadata: async (_id, metadata, options) => {
    writes.push([copy(metadata), options.revision]);
    if (++attempts === 1) throw new ApiError("lost", { unknownOutcome: true });
    f.memory = { ...f.memory, ...metadata, revision: 2 }; return f.memory;
  } });
  const controller = await entered(f.api);
  await controller.saveMetadata(target); await controller.reloadMetadata();
  assert.equal(controller.getSnapshot().metadata.canRetry, true);
  await controller.saveMetadata({ ...target, title: "replacement" }); assert.equal(writes.length, 1);
  await controller.retryMetadata(); assert.deepEqual(writes, [[target, 1], [target, 1]]);
  assert.equal(controller.getSnapshot().detail.title, target.title); controller.dispose();
});

test("conflicts reload newer metadata; CSRF refresh does not automatically resend; unavailable edits clear detail", async () => {
  let writes = 0;
  const f = fixture({ updateMemoryMetadata: async () => { writes++; throw new ApiError("stale", { status: 412, code: "METADATA_CONFLICT" }); } });
  const controller = await entered(f.api); await controller.saveMetadata(target);
  f.memory = { ...f.memory, title: "Other partner's title", revision: 2 };
  await controller.reloadMetadata(); assert.equal(controller.getSnapshot().detail.title, "Other partner's title"); assert.equal(writes, 1);
  f.api.updateMemoryMetadata = async () => { writes++; throw new ApiError("token", { status: 403, code: "CSRF_INVALID" }); };
  await controller.saveMetadata(target); assert.equal(controller.getSnapshot().metadata.phase, "csrf");
  await controller.reloadMetadata({ refreshSession: true }); assert.equal(writes, 2); assert.equal(controller.getSnapshot().metadata.phase, "idle");
  f.api.updateMemoryMetadata = async () => { throw new ApiError("gone", { status: 404 }); };
  await controller.saveMetadata(target); assert.equal(controller.getSnapshot().detail, null); controller.dispose();
});

test("hide aborts unknown edit, drops sensitive metadata draft and ignores a late result before fresh authenticated read", async () => {
  const pending = deferred(); let signal;
  const f = fixture({ updateMemoryMetadata: async (_id, _metadata, options) => { signal = options.signal; return pending.promise; } });
  const controller = await entered(f.api); const saving = controller.saveMetadata(target); await turn();
  controller.suspend(); assert.equal(signal.aborted, true); assert.equal(JSON.stringify(controller.getSnapshot()).includes(target.description), false);
  pending.resolve({ ...f.memory, ...target, revision: 2 }); await saving;
  assert.equal(controller.getSnapshot().detail, null);
  await controller.resume(); assert.equal(controller.getSnapshot().detail.title, null); assert.equal(controller.getSnapshot().metadata.phase, "idle");
  assert.match(controller.getSnapshot().notice, /hidden edit was cleared/); controller.dispose();
});

test("access failure clears creator/session and invalidates every retained private facade", async () => {
  const f = fixture({ createCoupleTextContribution: async () => { throw new ApiError("expired", { status: 401 }); } });
  const controller = await entered(f.api); controller.beginCreation(); const privateApi = controller.getCreationApi();
  await assert.rejects(privateApi.createTextContribution({ message: "sensitive" }, { idempotencyKey: IDS.key }), { status: 401 });
  assert.equal(controller.getSnapshot().phase, "login"); assert.equal(controller.getSnapshot().session, null);
  await assert.rejects(privateApi.createTextContribution({ message: "sensitive" }, { idempotencyKey: IDS.key }), { status: 401 }); controller.dispose();
});

test("disposing a note before transport or while transport ignores abort never sends a late write or exposes a late receipt", async () => {
  let calls = 0;
  const immediate = createTextSubmission({ api: { createTextContribution: async () => { calls++; return TEXT_RECEIPT; } }, randomUUID: () => IDS.key });
  const first = immediate.submit({ message: "sensitive" }); immediate.dispose();
  await assert.rejects(first, { code: "REQUEST_ABORTED" }); assert.equal(calls, 0);
  const pending = deferred(); let signal;
  const running = createTextSubmission({ api: { createTextContribution: async (_payload, options) => { signal = options.signal; return pending.promise; } }, randomUUID: () => IDS.key });
  const second = running.submit({ message: "sensitive" }); await turn(); running.dispose();
  await assert.rejects(second, { code: "REQUEST_ABORTED" }); assert.equal(signal.aborted, true);
  pending.resolve(TEXT_RECEIPT); await turn(); assert.equal(running.receipt, null); assert.equal(running.pending, false);
});

for (const phase of ["immediate success", "same-revision reconciliation"]) {
  test(`metadata rejects an unexpected audience change during ${phase} but accepts a newer reviewed state`, async () => {
    const original = { ...copy(MEMORY_DETAIL), reviewStatus: "KEEP" };
    let readMemory = original;
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
      let value, etag;
      if (options.method === "PATCH") {
        if (phase === "same-revision reconciliation") throw new TypeError("Synthetic lost response");
        value = { ...original, ...target, visibility: "PUBLIC", revision: 2 }; etag = '"2"';
      } else if (path === "/api/session") value = COUPLE_SESSION;
      else if (path.includes("/tags?")) value = { memoryId: IDS.text, items: [], nextCursor: null };
      else if (path.includes("?")) value = { items: [readMemory], nextCursor: null };
      else value = readMemory;
      return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", ...(etag ? { ETag: etag } : {}) } });
    } }) });
    const controller = await entered(api);
    try {
      await controller.saveMetadata(target);
      if (phase === "same-revision reconciliation") {
        readMemory = { ...original, visibility: "PUBLIC" };
        await controller.reloadMetadata();
      }
      assert.equal(controller.getSnapshot().metadata.phase, "uncertain");
      assert.equal(controller.getSnapshot().metadata.canRetry, false);
      assert.equal(controller.getSnapshot().detail.visibility, "COUPLE_ONLY");
      assert.equal(controller.getSnapshot().detail.revision, 1);
      readMemory = { ...original, ...target, visibility: "PUBLIC", revision: 3 };
      await controller.reloadMetadata();
      const state = controller.getSnapshot();
      assert.equal(state.metadata.phase, "idle"); assert.equal(state.detail.visibility, "PUBLIC");
      assert.equal(state.detail.revision, 3); assert.match(state.notice, /does not identify who/);
    } finally { controller.dispose(); }
  });
}
