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

test("audio duration and provisional size limits are checked", () => {
  for (const duration of [0, 121, Infinity]) {
    const payload = copy(AUDIO_REQUEST);
    payload.items[0].durationSeconds = duration;
    assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
  }
  const payload = copy(AUDIO_REQUEST);
  payload.items[0].byteSize = 25_000_001;
  assert.throws(() => normalizeMediaContribution(payload), { code: "VALIDATION_FAILED" });
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
