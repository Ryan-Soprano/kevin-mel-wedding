import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { COUPLE_SESSION, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";
import { createInboxController } from "../../inbox/api/inboxController.js";
import { normalizeLibraryFilters, normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";
import { compareSaved } from "./libraryApi.js";

// Synthetic JSON adapter/controller fixtures. Browser layout, media transfer and
// provider acceptance are separate checks, not claims made by these tests.
const id = n => "55555555-5555-4555-8555-" + String(n).padStart(12, "0");
const TAG = { tagId: id(1), name: "Our <tag>", visibility: "COUPLE_ONLY", revision: id(2), memberCount: 0,
  createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", deletedAt: null };
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function response(value, status = 200, etag = value?.revision ?? value?.tag?.revision) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ETag: '"' + etag + '"' } });
}
async function signedMock(config = {}) {
  const api = createMockArchiveApi(config), session = await api.getSession();
  await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken }); return api;
}
const options = async (api, tag) => ({ revision: tag?.revision, csrfToken: (await api.getSession()).csrfToken });
const directTag = async (api, tagId = id(1), name = "Private tag") => api.createTag(tagId, name, await options(api));
async function entered(api, config = {}) { const c = createInboxController({ api, ...config }); await c.loadSession(); return c; }
async function notes(api, count = 25, text = "Synthetic searchable") {
  const memories = []; for (let n = 0; n < count; n++) {
    const receipt = await api.createCoupleTextContribution({ message: text + " " + n }, { idempotencyKey: id(n + 1000), ...(await options(api)) });
    memories.push(await api.getMemory(receipt.memories[0].memoryId));
  } return memories;
}
async function populated(api) {
  let tag = await directTag(api); const memories = await notes(api, 2);
  for (const memory of memories) tag = await api.attachTag(tag.tagId, memory.memoryId, await options(api, tag));
  return { tag, memories };
}

test("library search bounds raw UTF16 and storable text; tags trim required names and filters reject impossible scopes", () => {
  assert.equal(normalizeLibraryQuery("  %_\\'😀  "), "%_\\'😀"); assert.equal(normalizeLibraryQuery("  "), "");
  assert.equal(normalizeLibraryQuery("😀".repeat(100)).length, 200); assert.equal(normalizeTagName("  Wedding  "), "Wedding");
  for (const q of [null, 200, "x".repeat(201), " ".repeat(201), "a\0b", "\ud800", "\udc00"]) assert.throws(() => normalizeLibraryQuery(q), TypeError);
  for (const name of [null, " ", "x".repeat(201), "\ud800", "a\0b"]) assert.throws(() => normalizeTagName(name), e => e.code === "VALIDATION_FAILED");
  for (const filter of [{ memoryType: "toString" }, { reviewStatus: "DELETE" }, { tagId: [id(1)] }, { tagId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { fromYear: 0 }, { toYear: 10000 }, { fromYear: 2025, toYear: 2024 }, { fromYear: 1, datePrecision: "UNKNOWN" }]) assert.throws(() => normalizeLibraryFilters(filter), TypeError);
  assert.ok(compareSaved({ ...MEMORY_DETAIL, createdAt: "2026-01-01T00:00:00.001002Z" }, { ...MEMORY_DETAIL, createdAt: "2026-01-01T00:00:00.001001Z" }) < 0);
  assert.ok(compareSaved({ ...MEMORY_DETAIL, createdAt: "2026-01-01T00:00:00.000001Z" }, { ...MEMORY_DETAIL, createdAt: "2026-01-01T00:00:00Z" }) < 0);
});

test("real adapter keeps library/tag routes private, uses strong conditionals and bodyless legacy-memory links", async () => {
  const calls = [], legacy = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, request) => {
    calls.push({ path, request }); if (path.startsWith("/api/library/memories?")) return response({ items: [], nextCursor: null });
    if (path.includes("/tags?")) return response({ memoryId: legacy, items: [], nextCursor: null });
    if (path.startsWith("/api/tags?")) return response({ items: [], nextCursor: null });
    const body = request.body && JSON.parse(request.body); return response({ ...TAG, ...(body ?? {}), ...(request.method === "DELETE" && !path.includes("/members/") ? { name: null, deletedAt: TAG.updatedAt } : {}) }, request.headers.get("If-None-Match") ? 201 : 200);
  } }) });
  const config = { csrfToken: COUPLE_SESSION.csrfToken, revision: TAG.revision };
  await api.createTag(TAG.tagId, " Our <tag> ", config); await api.renameTag(TAG.tagId, "Renamed", config);
  await api.attachTag(TAG.tagId, legacy, config); await api.removeTag(TAG.tagId, legacy, config); await api.deleteTag(TAG.tagId, config);
  await api.listLibraryMemories({ q: "%_\\'", memoryType: "TEXT", reviewStatus: "KEEP", datePrecision: "YEAR", fromYear: 2024, toYear: 2025, tagId: TAG.tagId });
  await api.listMemoryTags(legacy); await api.listTags({ q: "literal_%" });
  assert.deepEqual(calls.slice(0, 5).map(c => c.request.method), ["PUT", "PATCH", "PUT", "DELETE", "DELETE"]);
  assert.deepEqual(JSON.parse(calls[0].request.body), { name: TAG.name }); assert.equal(calls[0].request.headers.get("If-None-Match"), "*");
  assert.equal(calls[1].request.headers.get("If-Match"), '"' + TAG.revision + '"'); assert.equal(calls[2].request.body, undefined); assert.equal(calls[3].request.body, undefined);
  const query = new URL(calls[5].path, "https://synthetic.test").searchParams; assert.equal(query.get("q"), "%_\\'"); assert.equal(query.get("tagId"), TAG.tagId); assert.equal(query.get("fromYear"), "2024");
  for (const { path, request } of calls) { assert.match(path, /^\/api\/(tags|library\/memories)/); assert.equal(request.cache, "no-store"); assert.equal(request.credentials, "same-origin"); if (request.method !== "GET") assert.equal(request.headers.get("X-CSRF-Token"), config.csrfToken); }
  assert.throws(() => api.listLibraryMemories({ limit: 51 }), TypeError); assert.throws(() => api.getTag(legacy), TypeError);
});

test("malformed tags, owner types, ETags, tombstones, duplicate rows and submillisecond order reject as contract errors", async () => {
  const whole = { ...MEMORY_DETAIL, memoryId: id(70), createdAt: "2026-01-01T00:00:00Z" }, fractional = { ...whole, memoryId: id(71), createdAt: "2026-01-01T00:00:00.000001Z" };
  const cases = [
    ["tag", { ...TAG, name: " " }], ["tag", { ...TAG, tagId: [TAG.tagId] }], ["tag", { ...TAG, revision: [TAG.revision] }], ["tag", TAG, "wrong"],
    ["tag", { ...TAG, name: null, deletedAt: "2026-10-10T12:00:00.000001Z" }],
    ["tags", { items: [null], nextCursor: null }], ["tags", { items: [TAG, TAG], nextCursor: null }],
    ["attached", { memoryId: 7, items: [], nextCursor: null }], ["attached", { memoryId: null, items: [], nextCursor: null }], ["attached", { memoryId: id(99), items: [], nextCursor: null }],
    ["library", { items: [whole, fractional], nextCursor: null }], ["library", { items: [whole, whole], nextCursor: null }], ["library", { items: [null], nextCursor: null }],
    ["members", { tag: { ...TAG, memberCount: 2 }, items: [{ memory: whole }, { memory: fractional }], nextCursor: null }], ["members", { tag: { ...TAG, memberCount: 1 }, items: [null], nextCursor: null }],
  ];
  for (const [kind, value, etag] of cases) {
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response(value, 200, etag) }) });
    await assert.rejects(() => kind === "tags" ? api.listTags() : kind === "attached" ? api.listMemoryTags(MEMORY_DETAIL.memoryId)
      : kind === "library" ? api.listLibraryMemories() : kind === "members" ? api.listTagMembers(TAG.tagId) : api.getTag(TAG.tagId), e => e.code === "CONTRACT_MISMATCH");
  }
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response({ items: [fractional, whole], nextCursor: null }) }) }); assert.equal((await api.listLibraryMemories()).items.length, 2);
});

test("literal library queries and all AND filters use metadata/original fields, not wildcard syntax", async () => {
  const api = await signedMock(), [original] = await notes(api, 1, "Literal %_\\' body");
  const fields = { title: "Needle title", description: "Needle description", memoryDate: "2024-03", datePrecision: "MONTH" };
  const memory = await api.updateMemoryMetadata(original.memoryId, fields, { ...(await options(api)), revision: original.revision });
  let tag = await directTag(api); tag = await api.attachTag(tag.tagId, memory.memoryId, await options(api, tag));
  for (const q of ["%_\\'", "NEEDLE TITLE", "needle description", "Literal"]) assert.equal((await api.listLibraryMemories({ q })).items.some(row => row.memoryId === memory.memoryId), true);
  assert.equal((await api.listLibraryMemories({ q: "%_different" })).items.length, 0);
  const filters = { q: "needle", memoryType: "TEXT", reviewStatus: "KEEP", datePrecision: "MONTH", fromYear: 2024, toYear: 2024, tagId: tag.tagId };
  assert.deepEqual((await api.listLibraryMemories(filters)).items.map(row => row.memoryId), [memory.memoryId]);
  for (const mismatch of [{ memoryType: "PHOTO" }, { reviewStatus: "ARCHIVED" }, { datePrecision: "DAY" }, { fromYear: 2025, toYear: 2025 }, { q: "no match" }]) assert.equal((await api.listLibraryMemories({ ...filters, ...mismatch })).items.length, 0);
  await api.deleteTag(tag.tagId, await options(api, tag)); await assert.rejects(() => api.listLibraryMemories(filters), e => e.status === 404);
});

test("bounded live library, catalogue, attached and member pages enforce context and anchor availability without retaining query text", async () => {
  const api = await signedMock(), memories = await notes(api), tags = []; let main = await directTag(api, id(500), "Synthetic searchable tag");
  for (const memory of memories) main = await api.attachTag(main.tagId, memory.memoryId, await options(api, main));
  for (let n = 0; n < 25; n++) { let tag = await directTag(api, id(600 + n), "Synthetic searchable tag"); tag = await api.attachTag(tag.tagId, memories[0].memoryId, await options(api, tag)); tags.push(tag); }
  const first = await api.listLibraryMemories({ q: "Synthetic searchable" }), second = await api.listLibraryMemories({ q: "Synthetic searchable", cursor: first.nextCursor });
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 5); assert.doesNotMatch(decodeURIComponent(first.nextCursor), /Synthetic|searchable/);
  await assert.rejects(() => api.listLibraryMemories({ cursor: first.nextCursor, q: "different" }), e => e.status === 400 && e.code === "INVALID_CURSOR");
  const catalog = await api.listTags({ q: "searchable" }); assert.equal(catalog.items.length, 20); assert.equal((await api.listTags({ q: "searchable", cursor: catalog.nextCursor })).items.length, 6);
  const attached = await api.listMemoryTags(memories[0].memoryId); assert.equal(attached.items.length, 20); assert.equal((await api.listMemoryTags(memories[0].memoryId, { cursor: attached.nextCursor })).items.length, 6);
  await assert.rejects(() => api.listMemoryTags(memories[1].memoryId, { cursor: attached.nextCursor }), e => e.status === 400);
  const members = await api.listTagMembers(main.tagId); assert.equal(members.items.length, 20); assert.equal((await api.listTagMembers(main.tagId, { cursor: members.nextCursor })).items.length, 5);
  const attachmentAnchor = attached.items.at(-1); await api.removeTag(attachmentAnchor.tagId, memories[0].memoryId, await options(api, attachmentAnchor));
  await assert.rejects(() => api.listMemoryTags(memories[0].memoryId, { cursor: attached.nextCursor }), e => e.status === 412 && e.code === "TAG_CONFLICT");
  const catalogueAnchor = await api.getTag(catalog.items.at(-1).tagId); await api.renameTag(catalogueAnchor.tagId, "No longer matches", await options(api, catalogueAnchor));
  await assert.rejects(() => api.listTags({ q: "searchable", cursor: catalog.nextCursor }), e => e.status === 412);
  const anchor = first.items.at(-1); await api.reviewMemory(anchor.memoryId, { reviewStatus: "DELETE", revision: anchor.revision }, await options(api));
  await assert.rejects(() => api.listLibraryMemories({ q: "Synthetic searchable", cursor: first.nextCursor }), e => e.status === 412 && e.code === "LIBRARY_CONFLICT");
  await assert.rejects(() => api.listTagMembers(main.tagId, { cursor: members.nextCursor }), e => e.status === 412);
});

test("duplicate-name shared tags and current no-op revisions preserve originals; memory DELETE detaches every module and Restore does not rejoin", async () => {
  const api = await signedMock(), { tag, memories } = await populated(api), original = memories[0]; let second = await directTag(api, id(3));
  second = await api.attachTag(second.tagId, original.memoryId, await options(api, second));
  assert.equal(second.name, tag.name); const noop = await api.attachTag(second.tagId, original.memoryId, await options(api, second)); assert.equal(noop.revision, second.revision);
  assert.deepEqual(await api.getMemory(original.memoryId), original);
  let album = await api.createAlbum(id(700), "Album", await options(api)); album = await api.addAlbumMember(album.albumId, original.memoryId, await options(api, album));
  let event = await api.createTimelineEvent(id(800), { title: "Milestone", description: null, eventDate: null, datePrecision: "UNKNOWN" }, await options(api)); event = await api.linkTimelineMemory(event.eventId, original.memoryId, await options(api, event));
  const controller = await entered(api); await controller.openMemory(original.memoryId); assert.equal(controller.getSnapshot().tags.items.length, 2);
  await controller.reviewMemory("DELETE"); assert.equal(controller.getSnapshot().detail.reviewStatus, "DELETE"); assert.deepEqual(controller.getSnapshot().tags.items, []); assert.equal(controller.getSnapshot().tags.memoryId, null);
  await assert.rejects(() => api.listMemoryTags(original.memoryId), e => e.status === 404); assert.equal((await api.getTag(tag.tagId)).memberCount, 1); assert.equal((await api.getTag(second.tagId)).memberCount, 0);
  assert.equal((await api.getAlbum(album.albumId)).memberCount, 0); assert.equal((await api.getTimelineEvent(event.eventId)).memberCount, 0);
  await controller.reviewMemory("PENDING"); assert.deepEqual(controller.getSnapshot().tags.items, []); assert.equal((await api.getTag(second.tagId)).memberCount, 0);
  assert.equal(controller.getSnapshot().detail.textContent, original.textContent); controller.dispose();
  const fresh = await api.getTag(tag.tagId), tombstone = await api.deleteTag(tag.tagId, await options(api, fresh)); assert.equal(tombstone.name, null); assert.equal(tombstone.memberCount, 0);
  assert.equal((await api.listTagMembers(tag.tagId)).items.length, 0); await assert.rejects(() => directTag(api, tag.tagId), e => e.status === 412);
});

test("Library detail/tag changes return to exact applied live page; stale anchor preserves filters and deliberate reset remounts draft", async () => {
  const api = await signedMock(); await notes(api); const tag = await directTag(api); const controller = await entered(api);
  await controller.loadLibrary({ q: "Synthetic searchable", memoryType: "TEXT" }); await controller.libraryPage(true);
  const before = controller.getSnapshot().library, memory = before.items[0]; await controller.openLibraryMemory(memory.memoryId);
  assert.equal(controller.getSnapshot().libraryReturn, true); await controller.chooseMemoryTag("Private"); await controller.changeMemoryTag(tag.tagId);
  assert.equal(controller.getSnapshot().phase, "detail"); assert.equal(controller.getSnapshot().libraryReturn, true); assert.equal(controller.getSnapshot().tags.items[0].tagId, tag.tagId);
  await controller.backToInbox(); assert.equal(controller.getSnapshot().phase, "library"); assert.deepEqual(controller.getSnapshot().library.filters, before.filters); assert.deepEqual(controller.getSnapshot().library.cursors, before.cursors);
  const anchorId = JSON.parse(decodeURIComponent(before.cursors.at(-1)))[1], anchor = await api.getMemory(anchorId);
  await controller.openLibraryMemory(memory.memoryId); await api.updateMemoryMetadata(anchorId, { title: null, description: null, memoryDate: "2024", datePrecision: "YEAR" }, { ...(await options(api)), revision: anchor.revision });
  // Change the saved anchor's review eligibility in the active filtered scope.
  const currentAnchor = await api.getMemory(anchorId); await api.reviewMemory(anchorId, { reviewStatus: "DELETE", revision: currentAnchor.revision }, await options(api));
  await controller.backToInbox(); assert.match(controller.getSnapshot().library.error, /same filters/); assert.deepEqual(controller.getSnapshot().library.filters, before.filters); assert.deepEqual(controller.getSnapshot().library.items, []);
  const resetVersion = controller.getSnapshot().library.formResetVersion; await controller.loadLibrary(normalizeLibraryFilters()); assert.equal(controller.getSnapshot().library.formResetVersion, resetVersion + 1);
  assert.deepEqual(controller.getSnapshot().library.cursors, [null]); assert.equal(controller.getSnapshot().library.filters.q, ""); controller.dispose();
});

test("tag chooser applies current draft filters and unavailable selected tag is retained until deliberate reset", async () => {
  const api = await signedMock(), tag = await directTag(api, id(1), "Sensitive filter tag"), controller = await entered(api);
  await controller.loadLibrary({ q: "saved applied" }); await controller.chooseLibraryTag({ q: "draft chosen", memoryType: "PHOTO" }, "Sensitive");
  assert.equal(controller.getSnapshot().library.filters.q, "saved applied"); await controller.selectLibraryTag(controller.getSnapshot().library.tagChoices[0]);
  assert.equal(controller.getSnapshot().library.filters.q, "draft chosen"); assert.equal(controller.getSnapshot().library.filters.memoryType, "PHOTO");
  await api.deleteTag(tag.tagId, await options(api, tag)); await controller.loadLibrary(); assert.match(controller.getSnapshot().library.error, /Clear the tag filter/);
  assert.equal(controller.getSnapshot().library.filters.tagId, tag.tagId); await controller.loadLibrary(normalizeLibraryFilters()); assert.equal(controller.getSnapshot().library.tagName, null); controller.dispose();
});

test("discarded committed tag create/rename/delete and memory attach/remove reconcile known identity without replay or duplicate", async () => {
  const api = await signedMock(); api.setScenario("uncertainSubmission"); const controller = await entered(api); await controller.loadTags(); await controller.beginTagCreation();
  await controller.createTag("Sensitive tag"); assert.equal(controller.getSnapshot().tags.mutation.phase, "uncertain"); await controller.reloadTagMutation(); const tag = controller.getSnapshot().tags.tag;
  assert.equal((await api.listTags()).items.length, 1); assert.equal(controller.getSnapshot().tags.mutation.phase, "idle");
  await controller.renameTag("Edited sensitive tag"); assert.equal(controller.getSnapshot().tags.mutation.phase, "uncertain"); await controller.reloadTagMutation(); assert.equal(controller.getSnapshot().tags.tag.name, "Edited sensitive tag");
  await controller.openMemory(MEMORY_DETAIL.memoryId); await controller.chooseMemoryTag(); await controller.changeMemoryTag(tag.tagId); assert.equal(controller.getSnapshot().tags.mutation.phase, "uncertain");
  await controller.reloadTagMutation(); assert.equal(controller.getSnapshot().phase, "detail"); assert.equal(controller.getSnapshot().tags.items.length, 1);
  await controller.changeMemoryTag(tag.tagId, true); assert.equal(controller.getSnapshot().tags.mutation.phase, "uncertain"); await controller.reloadTagMutation(); assert.equal(controller.getSnapshot().tags.items.length, 0);
  await controller.openTag(tag.tagId); await controller.deleteTag(); await controller.reloadTagMutation(); assert.equal(controller.getSnapshot().tags.tag.name, null); assert.equal(controller.getSnapshot().tags.tag.tagId, tag.tagId); controller.dispose();
});

test("unresolved tag write fences every private mutation/navigation; same-revision read allows only deliberate same-name retry", async () => {
  const api = await signedMock(); await directTag(api); let attempts = 0; const real = api.renameTag;
  api.renameTag = (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const controller = await entered(api); await controller.openTag(id(1)); await controller.renameTag("Sensitive unconfirmed"); const before = controller.getSnapshot();
  await controller.loadLibrary(); await controller.loadAlbums(); await controller.loadTimeline(); await controller.loadInbox(); await controller.openMemory(MEMORY_DETAIL.memoryId);
  await controller.loadTags(); await controller.beginTagCreation(); await controller.logout(); controller.beginCreation(); await controller.reviewMemory("DELETE"); await controller.saveMetadata({});
  assert.equal(controller.getSnapshot(), before); assert.equal(attempts, 1);
  controller.suspend(); assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Sensitive|Private tag/); await controller.resume();
  assert.equal(controller.getSnapshot().tags.mutation.canRetry, true); assert.equal(controller.getSnapshot().tags.mutation.needsName, true); assert.equal(attempts, 1);
  await controller.retryTagMutation("Wrong changed name"); assert.equal(attempts, 1); await controller.retryTagMutation("Sensitive unconfirmed"); assert.equal(attempts, 2); assert.equal(controller.getSnapshot().tags.tag.name, "Sensitive unconfirmed"); controller.dispose();
});

test("absent create read retries the exact retained UUID; hide during name preparation and failed preparation send nothing", async () => {
  const api = await signedMock(), real = api.createTag; let attempts = 0; const identities = [];
  api.createTag = (...args) => { identities.push(args[0]); attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const c = await entered(api); await c.loadTags(); await c.beginTagCreation(); await c.createTag("Secret new name"); c.suspend(); await c.resume(); await c.retryTagMutation("Secret new name");
  assert.equal(identities[0], identities[1]); assert.equal((await api.listTags()).items.length, 1); c.dispose();
  const pending = deferred(), hidden = await entered(api, { tagNameFingerprint: () => pending.promise }); await hidden.loadTags(); await hidden.beginTagCreation();
  const creating = hidden.createTag("Secret before digest"); await turn(); hidden.suspend(); pending.resolve("hash"); await creating; await hidden.resume(); assert.equal(attempts, 2); assert.equal(hidden.getSnapshot().tags.mutation.phase, "idle"); assert.doesNotMatch(JSON.stringify(hidden.getSnapshot()), /Secret before digest/); hidden.dispose();
  const failed = await entered(api, { tagNameFingerprint: async () => { throw new Error("synthetic"); } }); await failed.loadTags(); await failed.beginTagCreation(); await failed.createTag("Unsent");
  assert.equal(failed.getSnapshot().tags.mutation.phase, "idle"); assert.match(failed.getSnapshot().tags.error, /No change was sent/); assert.equal(attempts, 2); failed.dispose();
});

test("partner conflict clears populated old member cards before installing fresh token and failed refresh", async () => {
  const api = await signedMock(), { tag, memories } = await populated(api), c = await entered(api); await c.openTag(tag.tagId); assert.equal(c.getSnapshot().tags.members.length, 2);
  let newer = await api.removeTag(tag.tagId, memories[0].memoryId, await options(api, tag)); newer = await api.renameTag(tag.tagId, "Partner name", await options(api, newer));
  await c.renameTag("Stale draft"); assert.equal(c.getSnapshot().tags.mutation.phase, "conflict"); const real = api.listTagMembers; api.listTagMembers = async () => { throw new ApiError("synthetic", { status: 503 }); };
  await c.reloadTagMutation(); assert.equal(c.getSnapshot().tags.tag.revision, newer.revision); assert.equal(c.getSnapshot().tags.tag.name, "Partner name"); assert.equal(c.getSnapshot().tags.mutation.phase, "idle");
  assert.deepEqual(c.getSnapshot().tags.members, []); assert.deepEqual(c.getSnapshot().tags.items, []); assert.deepEqual(c.getSnapshot().tags.candidates, []); assert.equal(c.getSnapshot().tags.nextCursor, null);
  api.listTagMembers = real; await c.openTag(tag.tagId); assert.deepEqual(c.getSnapshot().tags.members.map(row => row.memory.memoryId), [memories[1].memoryId]); c.dispose();
});

test("acknowledged tag and memory attachment changes retain success/idle fence after failed or timed follow-up reads", async () => {
  for (const memoryContext of [false, true]) for (const timed of [false, true]) {
    const api = await signedMock(), { tag } = await populated(api), timers = new Map(); let next = 0;
    const c = await entered(api, { setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; }, clearTimeoutImpl(key) { timers.delete(key); } });
    if (memoryContext) { await c.openMemory(MEMORY_DETAIL.memoryId); await c.chooseMemoryTag(); assert.equal(c.getSnapshot().tags.items.length, 1); }
    else { await c.openTag(tag.tagId); assert.equal(c.getSnapshot().tags.members.length, 2); }
    const name = memoryContext ? "listMemoryTags" : "listTagMembers", real = api[name], pending = deferred(), reading = deferred();
    api[name] = () => { reading.resolve(); return timed ? pending.promise : Promise.reject(new ApiError("synthetic", { status: 503 })); };
    const saving = memoryContext ? c.changeMemoryTag(tag.tagId) : c.renameTag("Acknowledged name"); await reading.promise;
    if (timed) { assert.equal(timers.size, 1); [...timers.values()][0](); } await saving;
    assert.equal(c.getSnapshot().tags.mutation.phase, "idle"); assert.match(c.getSnapshot().tags.notice, /accepted|saved/); assert.match(c.getSnapshot().tags.error, /could not be loaded/);
    assert.deepEqual(c.getSnapshot().tags.items, []); assert.deepEqual(c.getSnapshot().tags.members, []); assert.deepEqual(c.getSnapshot().tags.candidates, []); assert.equal(c.getSnapshot().tags.nextCursor, null);
    api[name] = real; if (memoryContext) await c.loadMemoryTags(); else await c.openTag(tag.tagId);
    const latest = c.getSnapshot(); pending.resolve({ tag: TAG, memoryId: MEMORY_DETAIL.memoryId, items: [], nextCursor: null }); await turn(); assert.equal(c.getSnapshot(), latest); assert.equal(timers.size, 0); c.dispose();
  }
});

test("library hide/logout/access loss and ignored-abort results discard private query/filter/tag/page context", async () => {
  const api = await signedMock(); await notes(api); const tag = await directTag(api, id(1), "Sensitive chosen name"), c = await entered(api);
  await c.loadLibrary({ q: "Sensitive query", tagId: tag.tagId, fromYear: 2024 }); c.suspend(); assert.equal(c.getSnapshot().session, null); assert.deepEqual(c.getSnapshot().library.filters, normalizeLibraryFilters()); assert.doesNotMatch(JSON.stringify(c.getSnapshot()), /Sensitive|chosen/);
  await c.resume(); assert.equal(c.getSnapshot().phase, "library"); assert.equal(c.getSnapshot().library.filters.q, ""); assert.equal(c.getSnapshot().library.tagName, null);
  const pending = deferred(); api.listLibraryMemories = () => pending.promise; const loading = c.loadLibrary({ q: "Secret late query" }); await turn(); const logout = c.logout();
  pending.resolve({ items: [MEMORY_DETAIL], nextCursor: "secret-cursor" }); await loading; await logout; assert.equal(c.getSnapshot().phase, "login"); assert.doesNotMatch(JSON.stringify(c.getSnapshot()), /Secret|secret-cursor|Wishing/); c.dispose();
  const lostApi = await signedMock(), lost = await entered(lostApi); await lost.loadTags(); lostApi.setScenario("forbidden"); await lost.loadLibrary({ q: "Hidden query" }); assert.equal(lost.getSnapshot().phase, "unavailable"); assert.equal(lost.getSnapshot().library.filters.q, ""); lost.dispose();
});

test("private authoring fences Library/Tags and ordinary detail clears all prior feature return contexts", async () => {
  const api = await signedMock(), { tag, memories } = await populated(api), c = await entered(api); c.beginCreation(); const before = c.getSnapshot();
  await c.loadLibrary(); await c.loadTags(); await c.openTag(tag.tagId); await c.beginTagCreation(); await c.createTag("Blocked"); await c.chooseMemoryTag(); assert.equal(c.getSnapshot(), before);
  await c.loadInbox(); await c.openTag(tag.tagId); await c.openTagMemory(memories[0].memoryId); assert.equal(c.getSnapshot().tagReturnId, tag.tagId);
  await c.backToInbox(); assert.equal(c.getSnapshot().phase, "tags"); await c.loadLibrary(); await c.openLibraryMemory(memories[0].memoryId); assert.equal(c.getSnapshot().tagReturnId, null); assert.equal(c.getSnapshot().libraryReturn, true);
  await c.loadInbox(); await c.openMemory(memories[0].memoryId); assert.equal(c.getSnapshot().libraryReturn, false); assert.equal(c.getSnapshot().tagReturnId, null); assert.equal(c.getSnapshot().albumReturnId, null); assert.equal(c.getSnapshot().timelineReturnId, null);
  c.suspend(); await c.resume(); assert.equal(c.getSnapshot().phase, "inbox"); assert.equal(c.getSnapshot().library.items.length, 0); c.dispose();
});

test("memory-tag unknown outcome survives hide as opaque identity and reads before retry; CSRF refresh never replays", async () => {
  const api = await signedMock(), tag = await directTag(api), real = api.attachTag; let attempts = 0;
  api.attachTag = (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const c = await entered(api); await c.openMemory(MEMORY_DETAIL.memoryId); await c.chooseMemoryTag(); await c.changeMemoryTag(tag.tagId); c.suspend();
  assert.equal(c.getSnapshot().detail, null); assert.deepEqual(c.getSnapshot().tags.items, []); await c.resume(); assert.equal(c.getSnapshot().phase, "detail"); assert.equal(c.getSnapshot().tags.mutation.canRetry, true); assert.equal(attempts, 1);
  await c.retryTagMutation(); assert.equal(attempts, 2); assert.equal(c.getSnapshot().tags.items[0].tagId, tag.tagId);
  await c.openTag(tag.tagId); await api.login({ username: "synthetic", password: "synthetic" }, await options(api)); await c.renameTag("CSRF rejected name"); assert.equal(c.getSnapshot().tags.mutation.phase, "csrf");
  await c.reloadTagMutation({ refreshSession: true }); assert.equal(c.getSnapshot().tags.tag.name, tag.name); assert.equal(c.getSnapshot().tags.mutation.phase, "idle"); c.dispose();
});

test(
  "direct memory return restores the parent tag query while an explicit all-tags request clears it",
  async () => {
    const api = await signedMock();
    const parent = await directTag(api, id(1), "Parent archive label");
    const picker = await directTag(api, id(3), "Picker label");
    await api.attachTag(
      parent.tagId,
      MEMORY_DETAIL.memoryId,
      await options(api, parent),
    );
    const controller = await entered(api);
    try {
      await controller.loadTags("Parent archive");
      await controller.openTag(parent.tagId);
      await controller.openTagMemory(MEMORY_DETAIL.memoryId);
      await controller.chooseMemoryTag("Picker");
      assert.equal(controller.getSnapshot().tags.q, "Picker");

      await controller.changeMemoryTag(picker.tagId);
      await controller.backToInbox();
      const returned = controller.getSnapshot();
      assert.equal(returned.phase, "tags");
      assert.equal(returned.tags.tag.tagId, parent.tagId);
      assert.equal(returned.tags.q, "Parent archive");

      await controller.loadTags();
      assert.equal(controller.getSnapshot().tags.q, "Parent archive");
      assert.deepEqual(
        controller.getSnapshot().tags.items.map(tag => tag.tagId),
        [parent.tagId],
      );

      await controller.loadTags("");
      assert.equal(controller.getSnapshot().tags.q, "");
      assert.equal(controller.getSnapshot().tags.items.length, 2);

      await controller.loadTags("Parent archive");
      await controller.openTag(parent.tagId);
      await controller.openTagMemory(MEMORY_DETAIL.memoryId);
      await controller.chooseMemoryTag("Picker");
      controller.suspend();
      assert.equal(
        JSON.stringify(controller.getSnapshot()).includes("Parent archive"),
        false,
      );
      await controller.resume();
      await controller.backToInbox();
      assert.equal(controller.getSnapshot().tags.q, "");
    } finally {
      controller.dispose();
    }
  },
);

test(
  "mock tag changes clamp their own timestamps after clock rollback without backdating existing tags",
  async () => {
    let at = Date.parse("2026-10-19T16:00:00Z");
    const api = await signedMock({
      now: () => at,
    });
    const original = await directTag(api);

    at += 60_000;
    const later = await api.renameTag(
      original.tagId,
      "Later name",
      await options(api, original),
    );
    assert.ok(Date.parse(later.updatedAt) > Date.parse(original.createdAt));

    at -= 120_000;
    const renamed = await api.renameTag(
      original.tagId,
      "Renamed after clock rollback",
      await options(api, later),
    );
    assert.equal(renamed.createdAt, original.createdAt);
    assert.equal(renamed.updatedAt, later.updatedAt);
    assert.notEqual(renamed.revision, later.revision);

    const noop = await api.renameTag(
      original.tagId,
      renamed.name,
      await options(api, renamed),
    );
    assert.deepEqual(noop, renamed);

    const independent = await directTag(api, id(3), "Independent new tag");
    assert.equal(independent.createdAt, new Date(at).toISOString());

    const deleted = await api.deleteTag(
      original.tagId,
      await options(api, renamed),
    );
    assert.equal(deleted.updatedAt, later.updatedAt);
    assert.equal(deleted.deletedAt, later.updatedAt);
    assert.equal(deleted.name, null);
    assert.deepEqual(await api.getTag(original.tagId), deleted);
  },
);
