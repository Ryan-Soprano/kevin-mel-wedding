import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
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

test("sharing APIs canonicalize UUID case for reads, playback and link identity without accepting another memory", async () => {
  const id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const mixed = "AbCdEfAb-cDeF-4aBc-8dEf-AbCdEfAbCdEf";
  const calls = [];
  const memory = { ...shared, memoryId: id };
  const playback = { url: "https://media.example.test/synthetic-original", expiresAt: "2099-01-01T00:00:00Z" };
  const link = { memoryId: id, revision: 3, url: `/shared/${id}#token=${token}` };
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return path.includes("/share-link") ? response(link, { ETag: '"3"' })
      : response(path.includes("/playback") ? playback : memory);
  } }) });
  for (const supplied of [id.toUpperCase(), mixed]) {
    assert.deepEqual(await api.getSharedMemory(supplied, { token }), memory);
    assert.deepEqual(await api.getSharedPlayback(supplied, { token }), playback);
    assert.deepEqual(await api.createShareLink(supplied, { revision: 2, csrfToken: COUPLE_SESSION.csrfToken }), link);
  }
  assert.deepEqual(calls.map(call => call.path), Array.from({ length: 2 }, () => [
    `/api/shared-memories/${id}?token=${token}`, `/api/shared-memories/${id}/playback?token=${token}`, `/api/memories/${id}/share-link`,
  ]).flat());
  const mixedResponse = createArchiveApi({ client: createApiClient({ fetchImpl: async (path) => path.includes("/share-link")
    ? response({ ...link, memoryId: mixed, url: `/shared/${mixed}#token=${token}` }, { ETag: '"3"' })
    : response({ ...memory, memoryId: mixed }) }) });
  assert.equal((await mixedResponse.getSharedMemory(id.toUpperCase())).memoryId, mixed);
  assert.deepEqual(await mixedResponse.createShareLink(id.toUpperCase(), { revision: 2, csrfToken: COUPLE_SESSION.csrfToken }), link);
  const wrongMemory = createSharingApi({ client: createApiClient({ fetchImpl: async () => response(shared) }) });
  await assert.rejects(wrongMemory.getSharedMemory(mixed), { code: "CONTRACT_MISMATCH" });
  for (const changed of [{ memoryId: IDS.photo }, { url: `/shared/${IDS.photo}#token=${token}` },
    { url: `/shared/${id}#token=${token}&other=value` }, { url: `https://example.test/shared/${id}#token=${token}` }]) {
    const wrongLink = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response({ ...link, ...changed }, { ETag: '"3"' }) }) });
    await assert.rejects(wrongLink.createShareLink(mixed, { revision: 2, csrfToken: COUPLE_SESSION.csrfToken }), { code: "CONTRACT_MISMATCH" });
  }
});

test("inbox confirms canonical share links from mixed-case API responses without changing the capability", async () => {
  const id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const capability = "AbC_-09".repeat(6) + "A";
  for (const returnedId of [id.toUpperCase(), "AbCdEfAb-cDeF-4aBc-8dEf-AbCdEfAbCdEf"]) {
    const memory = { ...MEMORY_DETAIL, memoryId: id, reviewStatus: "KEEP", visibility: "FRIENDS_FAMILY", revision: 2 };
    const sharing = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, options) => {
      assert.equal(path, `/api/memories/${id}/share-link`);
      assert.equal(options.headers.get("If-Match"), '"2"');
      assert.equal(options.headers.get("X-CSRF-Token"), COUPLE_SESSION.csrfToken);
      return response({ memoryId: returnedId, revision: 3, url: `/shared/${returnedId}#token=${capability}` }, { ETag: '"3"' });
    } }) });
    const controller = createInboxController({ api: {
      getSession: async () => COUPLE_SESSION,
      listMemories: async () => ({ items: [memory], nextCursor: null }),
      getMemory: async () => memory,
      createShareLink: sharing.createShareLink,
    } });
    try {
      await controller.loadSession(); await controller.openMemory(id); await controller.createShareLink();
      const state = controller.getSnapshot();
      assert.deepEqual(state.shareLink, { memoryId: id, revision: 3, url: `/shared/${id}#token=${capability}` });
      assert.equal(state.detail.revision, 3);
      assert.equal(state.busy, false);
      assert.equal(state.error, null);
    } finally { controller.dispose(); }
  }
});

test("public memory pages retain content and usable recovery controls across loading, errors and empty results", async () => {
  // SSR covers the real view contract; the mounted browser check covers request
  // transitions, duplicate paging, focus and active/inactive settlement.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { PublicMemoriesView } = await server.ssrLoadModule("/src/features/sharing/SharedMemories.jsx");
    const state = { items: [shared], nextCursor: "next-page", pageCursor: null, loading: false, error: false, visible: true };
    const render = (changes = {}, props = {}) => renderToStaticMarkup(createElement(PublicMemoriesView, {
      state: { ...state, ...changes }, showNewest: true, ...props,
    }));
    assert.equal(render({ visible: false }), "", "initial loading and initially empty public feeds stay unobtrusive");
    const pending = render({ loading: true });
    assert.match(pending, /A lovely &lt;memory&gt;/);
    assert.match(pending, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(pending, /Loading shared memories…/);
    assert.match(pending, /class="shared-memory-list" aria-busy="true"/);
    assert.match(pending, /disabled="">Back to newest memories/);
    assert.match(pending, /disabled="">More shared memories/);
    assert.doesNotMatch(pending, /No more shared memories|couldn’t be loaded/);
    const failed = render({ error: true });
    assert.match(failed, /A lovely &lt;memory&gt;/);
    assert.match(failed, /Shared memories couldn’t be loaded\. Your current page is still here\./);
    assert.match(failed, /role="status"[^>]*tabindex="-1"/);
    assert.match(failed, /<button[^>]*>Try again<\/button>/);
    assert.match(failed, /<button[^>]*>Back to newest memories<\/button>/);
    assert.doesNotMatch(failed, /disabled=""|More shared memories|No more shared memories/);
    const retrying = render({ error: true, loading: true });
    assert.match(retrying, /A lovely &lt;memory&gt;/);
    assert.match(retrying, /Loading shared memories…/);
    assert.match(retrying, /disabled="">Try again/);
    assert.doesNotMatch(retrying, /couldn’t be loaded|current page is still here/);
    const empty = render({ items: [], nextCursor: null });
    assert.match(empty, /No more shared memories here\./);
    assert.match(empty, /Back to newest memories/);
    assert.match(empty, /<h2 tabindex="-1">Memories Kevin and Melanie have shared<\/h2>/);
  } finally { await server.close(); }
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
