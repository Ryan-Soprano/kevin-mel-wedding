import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "./apiClient.js";
import { createArchiveApi, decodeReceipt, normalizeMediaContribution, normalizeTextContribution } from "./archiveApi.js";
import {
  ANONYMOUS_SESSION, AUDIO_REQUEST, IDS, MEDIA_DETAIL, MEMORY_DETAIL,
  PARTIAL_RECEIPT, PHOTO_RECEIPT, PHOTO_REQUEST, TEXT_RECEIPT, TEXT_REQUEST, UPLOAD_GRANT,
} from "./v1/fixtures.js";

const copy = (value) => structuredClone(value);
const returning = (value, status = 200) => createArchiveApi({
  client: createApiClient({ fetchImpl: async () => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  }) }),
});

test("upload failure reporting is same-origin, bounded, grant-only and best effort", async () => {
  const calls = [];
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options }); return new Response(null, { status: 204 });
  } }) });
  await api.reportUploadFailure(IDS.contribution, IDS.photo, UPLOAD_GRANT.grantId, { idempotencyKey: IDS.key });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/contributions/${IDS.contribution}/memories/${IDS.photo}/upload-failures`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { grantId: UPLOAD_GRANT.grantId });
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers.get("Idempotency-Key"), IDS.key);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  const failed = createArchiveApi({ client: { request: async () => { throw new Error("private details"); } } });
  await assert.doesNotReject(failed.reportUploadFailure(IDS.contribution, IDS.photo, UPLOAD_GRANT.grantId,
    { idempotencyKey: IDS.key }));
});

test("a stuck upload report has its own two-second abort deadline", async (context) => {
  let fire, observedSignal, cleared = false;
  context.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    assert.equal(milliseconds, 2000); fire = callback; return 123;
  });
  context.mock.method(globalThis, "clearTimeout", timer => { assert.equal(timer, 123); cleared = true; });
  const api = createArchiveApi({ client: { request: (path, { signal }) => {
    observedSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timed out")), { once: true }));
  } } });
  const report = api.reportUploadFailure(IDS.contribution, IDS.photo, UPLOAD_GRANT.grantId, { idempotencyKey: IDS.key });
  assert.equal(observedSignal.aborted, false); fire();
  await assert.doesNotReject(report);
  assert.equal(observedSignal.aborted, true); assert.equal(cleared, true);
});

test("text normalization preserves anonymity and validates before trimming", () => {
  assert.deepEqual(normalizeTextContribution({ guestName: "  ", message: " hi " }), {
    guestName: null, message: "hi",
  });
  assert.equal(normalizeTextContribution({ guestName: " Guest ", message: "x" }).guestName, "Guest");
  for (const payload of [{ message: " " }, { message: "x".repeat(5001) },
    { guestName: " ".repeat(101), message: "x" }, { guestName: 3, message: "x" }]) {
    assert.throws(() => normalizeTextContribution(payload), { code: "VALIDATION_FAILED" });
  }
  assert.equal(normalizeTextContribution({ message: "x".repeat(5000) }).message.length, 5000);
});

test("media normalization rejects controls, nonrepresentable strings and case-folded duplicate IDs", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const item = { clientItemId: id, originalFilename: "ok.png", declaredContentType: "image/png", byteSize: 1, checksumSha256: "0".repeat(64) };
  const payload = { memoryType: "PHOTO", items: [item] };
  for (const field of ["originalFilename", "caption"]) {
    for (const text of ["\u0000", "\ud800"]) assert.throws(() => normalizeMediaContribution({ ...payload, items: [{ ...item, [field]: text }] }));
  }
  assert.throws(() => normalizeMediaContribution({ ...payload, items: [{ ...item, originalFilename: "x\t.png" }] }));
  assert.throws(() => normalizeMediaContribution({ ...payload, guestName: "\ud800" }));
  assert.throws(() => normalizeMediaContribution({ ...payload, items: [item, { ...item, clientItemId: id.toUpperCase() }] }));
});

test("media metadata is normalized without treating client claims as verified bytes", () => {
  assert.equal(normalizeMediaContribution(PHOTO_REQUEST).items.length, 2);
  assert.equal(normalizeMediaContribution(AUDIO_REQUEST).items[0].durationSeconds, 12);
  const photo = copy(PHOTO_REQUEST);
  photo.items[0].caption = "  ";
  assert.equal(normalizeMediaContribution(photo).items[0].caption, null);
});

for (const [name, mutate] of [
  ["duplicate client item IDs", (p) => { p.items[1].clientItemId = p.items[0].clientItemId; }],
  ["too many photos", (p) => { p.items = Array(6).fill(p.items[0]); }],
  ["HEIC declaration", (p) => { p.items[0].declaredContentType = "image/heic"; }],
  ["oversized original", (p) => { p.items[0].byteSize = 10_000_001; }],
  ["zero-sized original", (p) => { p.items[0].byteSize = 0; }],
  ["invalid checksum", (p) => { p.items[0].checksumSha256 = "not-a-sha256"; }],
  ["filename path", (p) => { p.items[0].originalFilename = "../private.jpg"; }],
  ["oversized caption", (p) => { p.items[0].caption = "x".repeat(501); }],
]) {
  test("rejects " + name + " before transport", () => {
    const payload = copy(PHOTO_REQUEST);
    mutate(payload);
    assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
  });
}

test("audio duration and size limits are checked", () => {
  for (const duration of [0, 121, Infinity]) {
    const payload = copy(AUDIO_REQUEST);
    payload.items[0].durationSeconds = duration;
    assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
  }
  const payload = copy(AUDIO_REQUEST);
  payload.items[0].byteSize = 25_000_001;
  assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
});

test("audio metadata accepts only canonical production MIME types and one item", () => {
  for (const type of ["audio/webm", "audio/ogg", "audio/mp4"]) {
    const payload = copy(AUDIO_REQUEST); payload.items[0].declaredContentType = type;
    assert.equal(normalizeMediaContribution(payload).items[0].declaredContentType, type);
  }
  for (const type of ["video/webm", "video/mp4", "audio/wav", "audio/mpeg", "audio/webm;codecs=opus"]) {
    const payload = copy(AUDIO_REQUEST); payload.items[0].declaredContentType = type;
    assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
  }
  assert.throws(() => normalizeMediaContribution({ ...AUDIO_REQUEST, items: [AUDIO_REQUEST.items[0], AUDIO_REQUEST.items[0]] }), { code: "VALIDATION_FAILED" });
});

test("private audio details require verified canonical media, bounded size and actual duration", async () => {
  const audio = { ...MEDIA_DETAIL, memoryType: "AUDIO", media: { ...MEDIA_DETAIL.media,
    originalFilename: "message.webm", detectedContentType: "audio/webm", durationSeconds: 2.5 } };
  assert.deepEqual(await returning(audio).getMemory(IDS.photo), audio);
  assert.deepEqual(await returning({ items: [audio], nextCursor: null }).listMemories(), { items: [audio], nextCursor: null });
  for (const media of [{ durationSeconds: null }, { durationSeconds: 120.001 }, { detectedContentType: "video/webm" },
    { detectedContentType: "audio/wav" }, { byteSize: 25_000_001 }]) {
    await assert.rejects(returning({ ...audio, media: { ...audio.media, ...media } }).getMemory(IDS.photo), { code: "CONTRACT_MISMATCH" });
  }
});

test("receipts enforce item states, privacy, cardinality, and aggregate completion", () => {
  for (const fixture of [TEXT_RECEIPT, PHOTO_RECEIPT, PARTIAL_RECEIPT]) assert.deepEqual(decodeReceipt(fixture), fixture);
  for (const mutate of [
    (p) => { p.completion = "COMPLETE"; },
    (p) => { p.memories[0].visibility = "PUBLIC"; },
    (p) => { p.memories[1].memoryId = p.memories[0].memoryId; },
    (p) => { p.memories[1].clientItemId = p.memories[0].clientItemId; },
    (p) => { p.memories[0].uploadState = "UNKNOWN"; },
    (p) => { p.createdAt = "not a date"; },
  ]) {
    const receipt = copy(PHOTO_RECEIPT);
    mutate(receipt);
    assert.throws(() => decodeReceipt(receipt), { code: "CONTRACT_MISMATCH" });
  }
});

test("prototype echo and wrong-type receipts cannot claim a saved text memory", async () => {
  for (const fixture of [TEXT_REQUEST, PHOTO_RECEIPT]) {
    await assert.rejects(returning(fixture).createTextContribution(TEXT_REQUEST, { idempotencyKey: IDS.key }), {
      code: "CONTRACT_MISMATCH", status: 200, unknownOutcome: true,
    });
  }
});

test("media receipts must map exactly to the submitted client item IDs", async () => {
  const receipt = copy(PHOTO_RECEIPT);
  receipt.memories[0].clientItemId = IDS.key;
  await assert.rejects(returning(receipt, 201).createMediaContribution(PHOTO_REQUEST, { idempotencyKey: IDS.key }), {
    code: "CONTRACT_MISMATCH",
  });
});

test("submission keys must be UUID v4 and review inputs require a revision", () => {
  const api = returning(TEXT_RECEIPT);
  assert.throws(() => api.createTextContribution(TEXT_REQUEST, { idempotencyKey: "guessable" }), TypeError);
  assert.throws(() => api.reviewMemory(IDS.text, { reviewStatus: "KEEP" }, {}), TypeError);
  assert.throws(() => api.listMemories({ limit: 101 }), TypeError);
});

test("memory and session decoders reject missing concurrency/privacy fields", async () => {
  for (const fixture of [
    { ...MEMORY_DETAIL, revision: 0 }, { ...MEMORY_DETAIL, visibility: "PUBLIC" },
    { ...MEMORY_DETAIL, reviewStatus: "DELETE" }, { ...MEDIA_DETAIL, media: null },
  ]) {
    await assert.rejects(returning(fixture).getMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
  }
  await assert.rejects(returning({ ...ANONYMOUS_SESSION, csrfToken: "bad" }).getSession(), {
    code: "CONTRACT_MISMATCH",
  });
});

for (const uploadState of ["PENDING", "FAILED"]) {
  test("unfinished " + uploadState + " media cannot appear in archive details or inbox", async () => {
    const memory = copy(MEDIA_DETAIL);
    memory.media.uploadState = uploadState;
    await assert.rejects(returning(memory).getMemory(IDS.photo), {
      code: "CONTRACT_MISMATCH", unknownOutcome: false,
    });
    await assert.rejects(returning({ items: [memory], nextCursor: null }).listMemories(), {
      code: "CONTRACT_MISMATCH", unknownOutcome: false,
    });
  });
}

test("uploaded media is accepted in archive details and inbox", async () => {
  assert.deepEqual(await returning(MEDIA_DETAIL).getMemory(IDS.photo), MEDIA_DETAIL);
  const page = { items: [MEDIA_DETAIL], nextCursor: null };
  assert.deepEqual(await returning(page).listMemories(), page);
});

test("upload URLs must be HTTPS and cannot forward cookies or authorization headers", async () => {
  let observed;
  const api = createArchiveApi({ uploadFetch: async (_url, options) => {
    observed = options;
    return new Response(null, { status: 200 });
  } });
  assert.deepEqual(await api.uploadMedia(UPLOAD_GRANT, new Blob(["synthetic"])), { transferred: true });
  assert.equal(observed.credentials, "omit");
  assert.equal(observed.redirect, "error");
  assert.deepEqual(observed.headers, { "Content-Type": "image/jpeg" });
  for (const grant of [
    { ...UPLOAD_GRANT, uploadUrl: "http://uploads.example.test/file" },
    { ...UPLOAD_GRANT, headers: { Authorization: "secret" } },
    { ...UPLOAD_GRANT, uploadUrl: "https://user:secret@uploads.example.test/file" },
  ]) await assert.rejects(api.uploadMedia(grant, new Blob()), { code: "CONTRACT_MISMATCH" });
});

test("playback requires a valid HTTPS URL and expiry", async () => {
  await assert.rejects(returning({ url: "javascript:alert(1)", expiresAt: UPLOAD_GRANT.expiresAt }).getPlayback(IDS.photo), {
    code: "CONTRACT_MISMATCH",
  });
});

test("storage throttling preserves Retry-After for deliberate photo retry", async () => {
  const api = createArchiveApi({ uploadFetch: async () => new Response(null, {
    status: 429, headers: { "Retry-After": "11" },
  }) });
  const grant = { ...UPLOAD_GRANT, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await assert.rejects(api.uploadMedia(grant, new Blob(["synthetic"])), {
    code: "UPLOAD_FAILED", status: 429, retryAfterSeconds: 11, unknownOutcome: false,
  });
});

test("malformed storage retry guidance does not invent a cooldown", async () => {
  const api = createArchiveApi({ uploadFetch: async () => new Response(null, {
    status: 503, headers: { "Retry-After": "invalid" },
  }) });
  const grant = { ...UPLOAD_GRANT, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await assert.rejects(api.uploadMedia(grant, new Blob(["synthetic"])), {
    status: 503, retryAfterSeconds: null,
  });
});

test("resource responses must belong to the requested submission or memory", async () => {
  await assert.rejects(returning(TEXT_RECEIPT).getReceipt(IDS.key, { idempotencyKey: IDS.key }), {
    code: "CONTRACT_MISMATCH", unknownOutcome: false,
  });
  await assert.rejects(returning(MEMORY_DETAIL).getMemory(IDS.photo), { code: "CONTRACT_MISMATCH" });
  await assert.rejects(returning(TEXT_RECEIPT).finalizeUpload(IDS.key, IDS.photo, IDS.grant, { idempotencyKey: IDS.key }), {
    code: "CONTRACT_MISMATCH", unknownOutcome: true,
  });
});

test("photo boundary matches the existing picker and optional text trims Unicode whitespace", () => {
  const payload = structuredClone(PHOTO_REQUEST);
  payload.items[0].byteSize = 10_000_000;
  assert.equal(normalizeMediaContribution(payload).items[0].byteSize, 10_000_000);
  assert.deepEqual(normalizeTextContribution({ guestName: "\u00a0", message: "\u00a0hello\u00a0" }), {
    guestName: null, message: "hello",
  });
});

test("text rejects NUL and unpaired UTF-16 surrogates before transport", () => {
  for (const text of [String.fromCharCode(0), String.fromCharCode(0xd800), String.fromCharCode(0xdc00)]) {
    assert.throws(() => normalizeTextContribution({ message: text }), { code: "VALIDATION_FAILED" });
    assert.throws(() => normalizeTextContribution({ guestName: text, message: "ok" }), { code: "VALIDATION_FAILED" });
  }
});

test("review PATCH carries exact persisted revision, CSRF and target and accepts its matching ETag", async () => {
  let request;
  const memory = { ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: MEMORY_DETAIL.revision + 1 };
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    request = { path, options };
    return new Response(JSON.stringify(memory), { headers: { "Content-Type": "application/json", ETag: `"${memory.revision}"` } });
  } }) });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: MEMORY_DETAIL.revision }, {
    csrfToken: ANONYMOUS_SESSION.csrfToken, signal,
  }), memory);
  assert.equal(request.path, `/api/memories/${IDS.text}/review`);
  assert.equal(request.options.method, "PATCH");
  assert.equal(request.options.headers.get("If-Match"), `"${MEMORY_DETAIL.revision}"`);
  assert.equal(request.options.headers.get("X-CSRF-Token"), ANONYMOUS_SESSION.csrfToken);
  assert.equal(request.options.headers.get("X-Api-Contract"), "1");
  assert.deepEqual(JSON.parse(request.options.body), { reviewStatus: "KEEP" });
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.signal, signal);
});

test("review adapter accepts a current-revision same-state no-op without inventing a new revision", async () => {
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => new Response(JSON.stringify(MEMORY_DETAIL), {
    headers: { "Content-Type": "application/json", ETag: `"${MEMORY_DETAIL.revision}"` },
  }) }) });
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "PENDING", revision: MEMORY_DETAIL.revision }, {
    csrfToken: ANONYMOUS_SESSION.csrfToken,
  }), MEMORY_DETAIL);
});

for (const [name, modify, etag] of [
  ["wrong memory", memory => ({ ...memory, memoryId: IDS.photo }), "valid"],
  ["wrong target", memory => ({ ...memory, reviewStatus: "ARCHIVED" }), "valid"],
  ["unrelated revision", memory => ({ ...memory, revision: MEMORY_DETAIL.revision + 2 }), "valid"],
  ["missing ETag", memory => memory, null],
  ["wrong ETag", memory => memory, '"999"'],
  ["weak ETag", memory => memory, `W/"${MEMORY_DETAIL.revision + 1}"`],
]) {
  test(`review ${name} is an unknown result rather than confirmed success`, async () => {
    const memory = modify({ ...MEMORY_DETAIL, reviewStatus: "KEEP", revision: MEMORY_DETAIL.revision + 1 });
    let calls = 0;
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(memory), { headers: { "Content-Type": "application/json",
        ...(etag === null ? {} : { ETag: etag === "valid" ? `"${memory.revision}"` : etag }),
      } });
    } }) });
    await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: MEMORY_DETAIL.revision }, {
      csrfToken: ANONYMOUS_SESSION.csrfToken,
    }), { code: "CONTRACT_MISMATCH", unknownOutcome: true });
    assert.equal(calls, 1);
  });
}

test("review adapter preserves known stale-revision rejection even when target already matches", async () => {
  let calls = 0;
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "stale", requestId: IDS.request } }), {
      status: 412, headers: { "Content-Type": "application/json" },
    });
  } }) });
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "KEEP", revision: 1 }, {
    csrfToken: ANONYMOUS_SESSION.csrfToken,
  }), { status: 412, unknownOutcome: false });
  assert.equal(calls, 1);
});

test("deleted detail decodes its persisted recovery deadline and requires it to be consistent", async () => {
  const memory = { ...MEMORY_DETAIL, reviewStatus: "DELETE", deleteAfter: "2026-11-09T15:00:00Z" };
  assert.deepEqual(await returning(memory).getMemory(IDS.text), memory);
  assert.deepEqual(await returning({ items: [memory], nextCursor: null }).listMemories({ reviewStatus: "DELETE" }), {
    items: [memory], nextCursor: null,
  });
  await assert.rejects(returning({ ...memory, deleteAfter: "2020-01-01T00:00:00Z" }).getMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
});

test("malformed receipt members retain the contract error and uncertain mutation outcome", async () => {
  for (const member of [null, false, "not a memory", {}, []]) {
    const receipt = { ...TEXT_RECEIPT, memories: [member] };
    assert.throws(() => decodeReceipt(receipt), { code: "CONTRACT_MISMATCH" });
    await assert.rejects(returning(receipt, 201).createTextContribution(TEXT_REQUEST, {
      idempotencyKey: IDS.key,
    }), {
      code: "CONTRACT_MISMATCH",
      status: 201,
      unknownOutcome: true,
    });
  }
});

test("receipts reject UUID-equivalent duplicate memories and client items without changing valid output", () => {
  const legacyId = "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee";
  for (const field of ["memoryId", "clientItemId"]) {
    const receipt = copy(PHOTO_RECEIPT);
    receipt.memories[0][field] = legacyId;
    receipt.memories[1][field] = legacyId.toUpperCase();
    assert.throws(() => decodeReceipt(receipt), { code: "CONTRACT_MISMATCH" });
  }
  const valid = copy(PHOTO_RECEIPT);
  valid.memories[0].memoryId = legacyId.toUpperCase();
  valid.memories[0].clientItemId = legacyId.toUpperCase();
  assert.equal(decodeReceipt(valid), valid);
  assert.equal(valid.memories[0].memoryId, legacyId.toUpperCase());
  assert.equal(valid.memories[0].clientItemId, legacyId.toUpperCase());
});

test("receipt routes compare UUID identity independently of casing for guest and couple recovery", async () => {
  const legacyId = "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee";
  for (const [requestedId, returnedId] of [
    [legacyId.toUpperCase(), legacyId],
    [legacyId, legacyId.toUpperCase()],
  ]) {
    const receipt = { ...TEXT_RECEIPT, contributionId: returnedId };
    const api = returning(receipt);
    const options = { idempotencyKey: IDS.key, csrfToken: ANONYMOUS_SESSION.csrfToken };
    for (const read of [api.getReceipt, api.getCoupleReceipt]) {
      assert.deepEqual(await read(requestedId, options), receipt);
    }
    for (const finalize of [api.finalizeUpload, api.finalizeCoupleUpload]) {
      assert.deepEqual(await finalize(requestedId, IDS.photo, IDS.grant, options), receipt);
    }
  }
});

test("memory reads and conditional writes compare UUID identity independently of casing", async () => {
  const legacyId = "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee";
  const metadata = { title: "A title", description: null, memoryDate: null, datePrecision: "UNKNOWN" };
  for (const [requestedId, returnedId] of [
    [legacyId.toUpperCase(), legacyId],
    [legacyId, legacyId.toUpperCase()],
  ]) {
    const memory = { ...MEMORY_DETAIL, memoryId: returnedId };
    const reviewed = { ...memory, reviewStatus: "KEEP", revision: 2 };
    const edited = { ...memory, ...metadata, revision: 2 };
    const returningMemory = value => createArchiveApi({
      client: createApiClient({ fetchImpl: async () => new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", ETag: `"${value.revision}"` },
      }) }),
    });
    const options = { csrfToken: ANONYMOUS_SESSION.csrfToken };
    assert.deepEqual(await returningMemory(memory).getMemory(requestedId), memory);
    assert.deepEqual(await returningMemory(reviewed).reviewMemory(requestedId, {
      reviewStatus: "KEEP", revision: 1,
    }, options), reviewed);
    assert.deepEqual(await returningMemory(edited).updateMemoryMetadata(requestedId, metadata, {
      revision: 1, ...options,
    }), edited);
  }
});

test("inbox rejects response counts, filters, duplicate identities and unusable continuation cursors", async () => {
  const legacyId = "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee";
  const first = { ...MEMORY_DETAIL, memoryId: legacyId };
  for (const [page, options] of [
    [{ items: [MEMORY_DETAIL, first], nextCursor: null }, { limit: 1 }],
    [{ items: [{ ...MEMORY_DETAIL, reviewStatus: "ARCHIVED" }], nextCursor: null }, {}],
    [{ items: [first, { ...first, memoryId: legacyId.toUpperCase() }], nextCursor: null }, {}],
    [{ items: [MEMORY_DETAIL], nextCursor: "" }, {}],
    [{ items: [MEMORY_DETAIL], nextCursor: "x".repeat(257) }, {}],
  ]) {
    await assert.rejects(returning(page).listMemories(options), {
      code: "CONTRACT_MISMATCH",
      unknownOutcome: false,
    });
  }
  const boundary = { items: [MEMORY_DETAIL], nextCursor: "x".repeat(256) };
  assert.deepEqual(await returning(boundary).listMemories({ limit: 1 }), boundary);
});

test("shared receipt, memory and permission timestamps require real canonical UTC instants", async () => {
  for (const timestamp of [
    "2026-02-31T12:00:00Z",
    "2026-10-19T24:00:00Z",
    "2026-10-19T12:00Z",
    "2026-10-19T12:00:00.1234567890Z",
  ]) {
    assert.throws(() => decodeReceipt({ ...TEXT_RECEIPT, createdAt: timestamp }), {
      code: "CONTRACT_MISMATCH",
    });
    await assert.rejects(returning({
      ...MEMORY_DETAIL, createdAt: timestamp, updatedAt: timestamp,
    }).getMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
    await assert.rejects(returning({ ...UPLOAD_GRANT, expiresAt: timestamp }, 201).authorizeUpload(
      IDS.contribution, IDS.photo, { idempotencyKey: IDS.key },
    ), { code: "CONTRACT_MISMATCH" });
    await assert.rejects(returning({
      url: "https://playback.example.test/synthetic", expiresAt: timestamp,
    }).getPlayback(IDS.photo), { code: "CONTRACT_MISMATCH" });
  }
});

test("memory timestamp ordering retains submillisecond precision", async () => {
  const earlier = "2026-10-19T12:00:00.123001Z";
  const later = "2026-10-19T12:00:00.123999Z";
  await assert.rejects(returning({
    ...MEMORY_DETAIL, createdAt: later, updatedAt: earlier,
  }).getMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
  await assert.rejects(returning({
    ...MEMORY_DETAIL,
    reviewStatus: "DELETE",
    createdAt: earlier,
    updatedAt: later,
    deleteAfter: earlier,
  }).getMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
});

test("equal timestamps with different fractional padding preserve valid receipt and memory values", async () => {
  const receipt = { ...TEXT_RECEIPT, createdAt: "2026-10-19T12:00:00.1Z" };
  assert.equal(decodeReceipt(receipt), receipt);
  const memory = {
    ...MEMORY_DETAIL,
    reviewStatus: "DELETE",
    createdAt: receipt.createdAt,
    updatedAt: "2026-10-19T12:00:00.100000Z",
    deleteAfter: "2026-10-19T12:00:00.100000000Z",
  };
  assert.deepEqual(await returning(memory).getMemory(IDS.text), memory);
});
