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
import { ANONYMOUS_SESSION, COUPLE_SESSION, IDS, MEDIA_DETAIL, MEMORY_DETAIL, TEXT_RECEIPT, UPLOAD_GRANT } from "../../../shared/api/v1/fixtures.js";

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
  let serverTime = Date.now();
  const api = createMockArchiveApi({ now: () => serverTime });
  const anonymous = await api.getSession();
  await api.login({ username: "fixture", password: "synthetic" }, { csrfToken: anonymous.csrfToken });
  const session = await api.getSession(), transfers = []; let clears = 0;
  const transfer = api.uploadMedia;
  api.uploadMedia = async (grant, original, options) => {
    transfers.push([grant.grantId, original]);
    if (transfers.length === 1) {
      // The server expires the permission before PUT while the client's local
      // clock still accepts it. Exercise the actual synthetic storage rejection.
      serverTime = Date.parse(grant.expiresAt);
    }
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

test("shared coordinator fixture privately creates note/photo/audio, keeps originals and blocks guest capability access", async (context) => {
  // Synthetic adapter/coordinator fixture, not DOM, codecs, R2 or physical-browser acceptance.
  const time = Date.parse("2026-11-01T00:00:00Z");
  context.mock.method(Date, "now", () => time);
  const api = createMockArchiveApi({ now: () => time });
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

for (const [type, rejectedStage] of [
  ["TEXT", "create"],
  ...["PHOTO", "AUDIO"].flatMap(type => ["create", "grant", "finalize"].map(stage => [type, stage])),
]) {
  test(`private ${type} ${rejectedStage} CSRF recovery retains the original intent and waits for explicit retry`, async () => {
    const refreshed = { ...copy(COUPLE_SESSION), csrfToken: "synthetic-refreshed-private-csrf-token" };
    const calls = { create: [], grant: [], finalize: [], transfers: [] };
    let sessionReads = 0, rejected = false, receipt = null;
    const rejectOnce = stage => {
      if (stage === rejectedStage && !rejected) {
        rejected = true;
        throw new ApiError("Synthetic stale token.", { status: 403, code: "CSRF_INVALID" });
      }
    };
    const create = async (payload, options) => {
      calls.create.push({ payload: copy(payload), key: options.idempotencyKey, csrf: options.csrfToken });
      rejectOnce("create");
      receipt ??= {
        ...copy(TEXT_RECEIPT),
        completion: type === "TEXT" ? "COMPLETE" : "PENDING",
        memories: [{ ...copy(TEXT_RECEIPT.memories[0]),
          clientItemId: type === "TEXT" ? null : payload.items[0].clientItemId,
          memoryType: type, reviewStatus: "KEEP", uploadState: type === "TEXT" ? null : "PENDING" }],
      };
      return copy(receipt);
    };
    const api = {
      getSession: async () => copy(++sessionReads === 1 ? COUPLE_SESSION : refreshed),
      listMemories: async () => ({ items: [], nextCursor: null }),
      createCoupleTextContribution: create,
      createCoupleMediaContribution: create,
      getCoupleReceipt: async () => copy(receipt),
      authorizeCoupleUpload: async (_contributionId, _memoryId, options) => {
        calls.grant.push({ key: options.idempotencyKey, csrf: options.csrfToken });
        rejectOnce("grant");
        return { ...copy(UPLOAD_GRANT), headers: { "Content-Type": type === "PHOTO" ? "image/png" : "audio/webm" } };
      },
      uploadMedia: async (_grant, original) => { calls.transfers.push(original); return { transferred: true }; },
      finalizeCoupleUpload: async (_contributionId, _memoryId, _grantId, options) => {
        calls.finalize.push({ key: options.idempotencyKey, csrf: options.csrfToken });
        rejectOnce("finalize");
        receipt = { ...receipt, completion: "COMPLETE",
          memories: receipt.memories.map(memory => ({ ...memory, uploadState: "UPLOADED" })) };
        return copy(receipt);
      },
    };
    const controller = createInboxController({ api });
    await controller.loadSession(); controller.beginCreation();
    const privateApi = controller.getCreationApi();
    const file = new File(["synthetic retained original"], type === "PHOTO" ? "original.png" : "original.webm", {
      type: type === "PHOTO" ? "image/png" : "audio/webm",
    });
    let nextId = 40;
    const sender = type === "TEXT" ? createTextSubmission({ api: privateApi })
      : type === "PHOTO" ? createPhotoBatchSubmission({ api: privateApi })
        : createAudioSubmission({ api: privateApi,
          randomUUID: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}` });
    const payload = type === "TEXT" ? { message: "Synthetic retained private note" }
      : type === "PHOTO" ? { photos: [{ id: IDS.clientItem, file, caption: "Original private caption" }] }
        : { file, durationSeconds: 2, caption: "Original private caption" };
    try {
      let firstFailure;
      const first = await sender.submit(payload).catch(error => { firstFailure = error; });
      firstFailure ??= first?.error;
      assert.equal(firstFailure?.code, "CSRF_INVALID");
      assert.equal(sender.pending, true);
      assert.equal(controller.getSnapshot().phase, "create");
      assert.equal(controller.getSnapshot().session.csrfToken, refreshed.csrfToken);
      assert.equal(sessionReads, 2);
      assert.equal(calls[rejectedStage].length, 1);
      await turn();
      assert.equal(calls[rejectedStage].length, 1, "refresh must not replay the rejected mutation");
      await sender.submit(payload);
      assert.equal(sender.receipt.completion, "COMPLETE");
      assert.equal(sender.pending, false);
      const allWrites = [...calls.create, ...calls.grant, ...calls.finalize];
      assert.ok(allWrites.every(call => call.key === calls.create[0].key));
      assert.equal(calls[rejectedStage][1].csrf, refreshed.csrfToken);
      assert.deepEqual(calls.create.at(-1).payload, calls.create[0].payload);
      assert.ok(calls.transfers.every(original => original === file));
      if (rejectedStage === "finalize") assert.equal(calls.transfers.length, 1, "retry must finalize the retained grant before reuploading");
    } finally { sender.dispose(); controller.dispose(); }
  });
}

for (const [name, refresh, expectedPhase] of [
  ["anonymous access", async () => copy(ANONYMOUS_SESSION), "login"],
  ["changed visible owner", async () => ({ ...copy(COUPLE_SESSION), user: { ...copy(COUPLE_SESSION.user), displayName: "Another synthetic owner" } }), "unavailable"],
  ["failed access check", async () => { throw new ApiError("Synthetic unavailable read.", { status: 503 }); }, "unavailable"],
]) {
  test(`private CSRF refresh clears the creator after ${name}`, async () => {
    let reads = 0, writes = 0;
    const api = {
      getSession: () => ++reads === 1 ? Promise.resolve(copy(COUPLE_SESSION)) : refresh(),
      listMemories: async () => ({ items: [], nextCursor: null }),
      createCoupleTextContribution: async () => { writes++; throw new ApiError("Synthetic stale token.", { status: 403, code: "CSRF_INVALID" }); },
    };
    const controller = createInboxController({ api });
    try {
      await controller.loadSession(); controller.beginCreation();
      await assert.rejects(controller.getCreationApi().createTextContribution({ message: "Synthetic draft" }, { idempotencyKey: IDS.key }));
      assert.equal(writes, 1);
      assert.equal(controller.getSnapshot().phase, expectedPhase);
      assert.equal(controller.getSnapshot().session, null);
    } finally { controller.dispose(); }
  });
}

for (const lateFailure of [false, true]) {
  test(`obsolete CSRF refresh ${lateFailure ? "failure" : "success"} cannot clear or replace a newer creator`, async () => {
    const pending = deferred(); let reads = 0, writes = 0;
    const api = {
      getSession: async () => ++reads === 2 ? pending.promise : copy(COUPLE_SESSION),
      listMemories: async () => ({ items: [], nextCursor: null }),
      createCoupleTextContribution: async () => { writes++; throw new ApiError("Synthetic stale token.", { status: 403, code: "CSRF_INVALID" }); },
    };
    const controller = createInboxController({ api });
    try {
      await controller.loadSession(); controller.beginCreation();
      const saving = controller.getCreationApi().createTextContribution({ message: "Synthetic old draft" }, { idempotencyKey: IDS.key });
      const rejected = assert.rejects(saving);
      await turn();
      await controller.backToInbox(); controller.beginCreation();
      const replacement = controller.getSnapshot();
      if (lateFailure) pending.resolve(Promise.reject(new ApiError("Synthetic late failure.", { status: 503 })));
      else pending.resolve({ ...copy(COUPLE_SESSION), csrfToken: "synthetic-obsolete-refreshed-token" });
      await rejected;
      assert.equal(controller.getSnapshot(), replacement);
      assert.equal(controller.getSnapshot().phase, "create");
      assert.equal(writes, 1);
    } finally { controller.dispose(); }
  });
}

test("a replacement session owns a creator while an older CSRF refresh is still pending", async () => {
  const pending = deferred();
  const replacement = { ...copy(COUPLE_SESSION), csrfToken: "synthetic-new-session-token" };
  let reads = 0;
  const api = {
    getSession: async () => ++reads === 2 ? pending.promise : copy(reads === 1 ? COUPLE_SESSION : replacement),
    listMemories: async () => ({ items: [], nextCursor: null }),
    createCoupleTextContribution: async () => { throw new ApiError("Synthetic stale token.", { status: 403, code: "CSRF_INVALID" }); },
  };
  const controller = createInboxController({ api });
  try {
    await controller.loadSession(); controller.beginCreation();
    const saving = controller.getCreationApi().createTextContribution({ message: "Synthetic old draft" }, { idempotencyKey: IDS.key });
    const rejected = assert.rejects(saving, { code: "REQUEST_ABORTED" });
    await turn(); await controller.recheckSession();
    const current = controller.getSnapshot();
    assert.equal(current.session.csrfToken, replacement.csrfToken);
    pending.resolve(copy(ANONYMOUS_SESSION));
    await rejected;
    assert.equal(controller.getSnapshot(), current);
  } finally { controller.dispose(); }
});

test("an aborted private request cannot install a late CSRF refresh or clear its current creator", async () => {
  const pending = deferred(), cancellation = new AbortController();
  let reads = 0, refreshSignal;
  const api = {
    getSession: async options => {
      if (++reads === 1) return copy(COUPLE_SESSION);
      refreshSignal = options.signal;
      return pending.promise;
    },
    listMemories: async () => ({ items: [], nextCursor: null }),
    createCoupleTextContribution: async () => { throw new ApiError("Synthetic stale token.", { status: 403, code: "CSRF_INVALID" }); },
  };
  const controller = createInboxController({ api });
  try {
    await controller.loadSession(); controller.beginCreation();
    const current = controller.getSnapshot();
    const saving = controller.getCreationApi().createTextContribution({ message: "Synthetic draft" }, {
      idempotencyKey: IDS.key, signal: cancellation.signal,
    });
    const rejected = assert.rejects(saving, { code: "REQUEST_ABORTED" });
    await turn(); cancellation.abort();
    assert.equal(refreshSignal, cancellation.signal);
    pending.resolve({ ...copy(COUPLE_SESSION), csrfToken: "synthetic-late-token" });
    await rejected;
    assert.equal(controller.getSnapshot(), current);
  } finally { controller.dispose(); }
});

test("private authoring still clears genuine application 403 access loss without a CSRF refresh", async () => {
  let reads = 0;
  const controller = createInboxController({ api: {
    getSession: async () => { reads++; return copy(COUPLE_SESSION); },
    listMemories: async () => ({ items: [], nextCursor: null }),
    createCoupleTextContribution: async () => { throw new ApiError("Synthetic unavailable archive.", { status: 403, code: "ARCHIVE_UNAVAILABLE" }); },
  } });
  try {
    await controller.loadSession(); controller.beginCreation();
    await assert.rejects(controller.getCreationApi().createTextContribution({ message: "Synthetic draft" }, { idempotencyKey: IDS.key }), { status: 403 });
    assert.equal(controller.getSnapshot().phase, "unavailable");
    assert.equal(controller.getSnapshot().session, null);
    assert.equal(reads, 1);
  } finally { controller.dispose(); }
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
      else if (path.includes("?")) {
        const reviewStatus = new URLSearchParams(path.split("?")[1]).get("reviewStatus");
        value = {
          items: readMemory.reviewStatus === reviewStatus ? [readMemory] : [],
          nextCursor: null,
        };
      } else value = readMemory;
      return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", ...(etag ? { ETag: etag } : {}) } });
    } }) });
    const controller = await entered(api);
    try {
      assert.equal(controller.getSnapshot().phase, "detail");
      assert.deepEqual(controller.getSnapshot().detail, original);
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
