import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../../shared/api/apiClient.js";
import { createArchiveApi, decodeReceipt } from "../../shared/api/archiveApi.js";
import { COUPLE_SESSION, IDS, MEMORY_DETAIL, TEXT_RECEIPT } from "../../shared/api/v1/fixtures.js";
import { createInboxController } from "../inbox/api/inboxController.js";
import { createSharingApi, decodeSharedMemory } from "./sharingApi.js";

const shared = { memoryId: IDS.text, memoryType: "TEXT", textContent: "A lovely <memory>", caption: null,
  title: null, description: null, memoryDate: null, datePrecision: "UNKNOWN", createdAt: MEMORY_DETAIL.createdAt, media: null };
const token = "a".repeat(43);
const response = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ...headers } });

test("shared memory decoding accepts intended content and rejects private metadata and malformed media", () => {
  assert.equal(decodeSharedMemory(shared), shared);
  for (const extra of [{ guestName: "A private guest" }, { contributionId: IDS.contribution }, { reviewStatus: "KEEP" },
    { storageKey: "originals/secret" }, { source: "GUEST" }]) assert.throws(() => decodeSharedMemory({ ...shared, ...extra }), { code: "CONTRACT_MISMATCH" });
  const photo = { ...shared, memoryType: "PHOTO", textContent: null,
    media: { detectedContentType: "image/jpeg", byteSize: 100, durationSeconds: null } };
  assert.equal(decodeSharedMemory(photo), photo);
  for (const media of [{ originalFilename: "private.jpg" }, { checksumSha256: "secret" }, { byteSize: 10_000_001 }, { detectedContentType: "image/svg+xml" }])
    assert.throws(() => decodeSharedMemory({ ...photo, media: { ...photo.media, ...media } }), { code: "CONTRACT_MISMATCH" });
});

test("guest sharing APIs carry private capability only for the selected memory and do not attach mutation credentials", async () => {
  const calls = [];
  const api = createSharingApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options }); return response(shared);
  } }) });
  await api.getSharedMemory(IDS.text, { token });
  assert.equal(calls[0].path, `/api/shared-memories/${IDS.text}?token=${token}`);
  assert.equal(calls[0].options.headers.has("X-CSRF-Token"), false);
  assert.equal(calls[0].options.cache, "no-store");
  assert.throws(() => api.getSharedMemory(IDS.text, { token: "bad\nvalue" }), TypeError);
  const wrong = createSharingApi({ client: createApiClient({ fetchImpl: async () => response({ ...shared, memoryId: IDS.photo }) }) });
  await assert.rejects(wrong.getSharedMemory(IDS.text), { code: "CONTRACT_MISMATCH" });
});

test("sharing changes require exact audience confirmation and retain CSRF/revision checks", async () => {
  let observed;
  const memory = { ...MEMORY_DETAIL, reviewStatus: "KEEP", visibility: "PUBLIC", revision: 2 };
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    observed = { path, options }; return response(memory, { ETag: '"2"' });
  } }) });
  assert.deepEqual(await api.reviewMemory(IDS.text, { reviewStatus: "KEEP", visibility: "PUBLIC", revision: 1 }, { csrfToken: COUPLE_SESSION.csrfToken }), memory);
  assert.deepEqual(JSON.parse(observed.options.body), { reviewStatus: "KEEP", visibility: "PUBLIC" });
  assert.equal(observed.options.headers.get("If-Match"), '"1"');
  assert.equal(observed.options.headers.get("X-CSRF-Token"), COUPLE_SESSION.csrfToken);
  await assert.rejects(api.reviewMemory(IDS.text, { reviewStatus: "KEEP", visibility: "FRIENDS_FAMILY", revision: 1 }, { csrfToken: COUPLE_SESSION.csrfToken }), { code: "CONTRACT_MISMATCH", unknownOutcome: true });
  assert.throws(() => api.reviewMemory(IDS.text, { reviewStatus: "DELETE", visibility: "PUBLIC", revision: 1 }), TypeError);
});

test("durable receipts still confirm saved memories after the couple changes their audience", () => {
  for (const visibility of ["PUBLIC", "FRIENDS_FAMILY"]) {
    const receipt = structuredClone(TEXT_RECEIPT);
    Object.assign(receipt.memories[0], { reviewStatus: "KEEP", visibility });
    assert.deepEqual(decodeReceipt(receipt), receipt);
  }
});

test("private link issuance checks response ID, exact advanced revision, relative capability URL and ETag", async () => {
  let observed;
  const link = { memoryId: IDS.text, revision: 3, url: `/shared/${IDS.text}#token=${token}` };
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    observed = { path, options }; return response(link, { ETag: '"3"' });
  } }) });
  assert.deepEqual(await api.createShareLink(IDS.text, { revision: 2, csrfToken: COUPLE_SESSION.csrfToken }), link);
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.headers.get("If-Match"), '"2"');
  for (const changed of [{ revision: 2 }, { url: "https://example.com/secret" }, { memoryId: IDS.photo }]) {
    const bad = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response({ ...link, ...changed }, { ETag: '"3"' }) }) });
    await assert.rejects(bad.createShareLink(IDS.text, { revision: 2, csrfToken: COUPLE_SESSION.csrfToken }), { code: "CONTRACT_MISMATCH" });
  }
});

test("controller saves audience changes independently of review status, uses advanced link revision and removes revoked link", async () => {
  let memory = { ...MEMORY_DETAIL, reviewStatus: "KEEP" };
  const calls = [];
  const api = {
    getSession: async () => COUPLE_SESSION,
    listMemories: async () => ({ items: [memory], nextCursor: null }),
    getMemory: async () => memory,
    reviewMemory: async (id, change) => {
      calls.push(change);
      memory = { ...memory, reviewStatus: change.reviewStatus, visibility: change.visibility,
        revision: memory.revision + (memory.visibility === change.visibility ? 0 : 1) };
      return memory;
    },
    createShareLink: async (id, options) => {
      assert.equal(options.revision, memory.revision);
      memory = { ...memory, revision: memory.revision + 1 };
      return { memoryId: id, revision: memory.revision, url: `/shared/${id}#token=${token}` };
    },
  };
  const controller = createInboxController({ api });
  try {
    await controller.loadSession(); await controller.openMemory(IDS.text);
    await controller.reviewMemory("KEEP", "FRIENDS_FAMILY");
    assert.equal(controller.getSnapshot().detail.visibility, "FRIENDS_FAMILY");
    assert.equal(controller.getSnapshot().detail.revision, 2);
    await controller.createShareLink();
    assert.equal(controller.getSnapshot().detail.revision, 3);
    assert.match(controller.getSnapshot().shareLink.url, /#token=/);
    await controller.reviewMemory("KEEP", "COUPLE_ONLY");
    assert.equal(calls.at(-1).revision, 3);
    assert.equal(controller.getSnapshot().detail.visibility, "COUPLE_ONLY");
    assert.equal(controller.getSnapshot().shareLink.url, null);
    assert.equal(controller.getSnapshot().review.phase, "idle");
    await controller.reviewMemory("KEEP", "FRIENDS_FAMILY");
    await controller.createShareLink();
    assert.ok(controller.getSnapshot().shareLink.url);
  } finally { controller.dispose(); }
  assert.equal(controller.getSnapshot().shareLink.url, null);
});
