import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { COUPLE_SESSION, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";
import { createInboxController } from "../../inbox/api/inboxController.js";
import { normalizeAlbumName } from "../albumName.js";

const id = number => "11111111-1111-4111-8111-" + String(number).padStart(12, "0");
const ALBUM = { albumId: id(1), name: "Wedding", visibility: "COUPLE_ONLY", revision: id(2), memberCount: 0,
  createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z", deletedAt: null };
const copy = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function response(value, status = 200, etag = value?.revision ?? value?.album?.revision) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ETag: '"' + etag + '"' } });
}
async function signedMock() {
  const api = createMockArchiveApi(); const session = await api.getSession();
  await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken });
  return api;
}
async function entered(api, options = {}) {
  const controller = createInboxController({ api, ...options }); await controller.loadSession();
  await controller.loadAlbums(); return controller;
}
async function directCreate(api, albumId = id(1), name = "Wedding") {
  return api.createAlbum(albumId, name, { csrfToken: (await api.getSession()).csrfToken });
}
const options = async (api, album) => ({ revision: album.revision, csrfToken: (await api.getSession()).csrfToken });
async function populatedAlbum(api) {
  let album = await directCreate(api); const memoryIds = [];
  for (let index = 0; index < 2; index++) {
    const receipt = await api.createCoupleTextContribution({ message: "Synthetic member " + index },
      { idempotencyKey: id(100 + index), csrfToken: (await api.getSession()).csrfToken });
    memoryIds.push(receipt.memories[0].memoryId);
    album = await api.addAlbumMember(album.albumId, memoryIds.at(-1), await options(api, album));
  }
  return { album, memoryIds };
}

test("album names bound raw UTF16, trim and reject blank, NUL and unpaired scalars", () => {
  assert.equal(normalizeAlbumName("  Wedding  "), "Wedding");
  assert.equal(normalizeAlbumName("😀".repeat(100)).length, 200);
  for (const value of [null, " ", "x".repeat(201), " ".repeat(201) + "x", "a\0b", "\ud800", "\udc00"])
    assert.throws(() => normalizeAlbumName(value), error => error.code === "VALIDATION_FAILED");
});

test("real adapter uses only private conditional routes and keeps member writes bodyless including legacy memory UUIDs", async () => {
  const calls = [];
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, request) => {
    calls.push({ path, request });
    const body = request.body && JSON.parse(request.body);
    return response({ ...ALBUM, ...(body?.name ? { name: body.name } : {}) }, request.headers.get("If-None-Match") ? 201 : 200);
  } }) });
  const token = COUPLE_SESSION.csrfToken;
  await api.createAlbum(id(1), " Wedding ", { csrfToken: token });
  await api.renameAlbum(id(1), "Trips", { csrfToken: token, revision: id(2) });
  const legacy = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";
  await api.addAlbumMember(id(1), legacy, { csrfToken: token, revision: id(2) });
  await api.removeAlbumMember(id(1), legacy, { csrfToken: token, revision: id(2) });
  await api.moveAlbumMember(id(1), legacy, "EARLIER", { csrfToken: token, revision: id(2) });
  assert.deepEqual(calls.map(call => call.request.method), ["PUT", "PATCH", "PUT", "DELETE", "POST"]);
  assert.equal(calls[0].request.headers.get("If-None-Match"), "*");
  assert.equal(calls[1].request.headers.get("If-Match"), '"' + id(2) + '"');
  assert.equal(calls[2].request.body, undefined); assert.equal(calls[3].request.body, undefined);
  assert.deepEqual(JSON.parse(calls[4].request.body), { direction: "EARLIER" });
  for (const call of calls) {
    assert.equal(call.request.headers.get("X-CSRF-Token"), token);
    assert.equal(call.request.credentials, "same-origin"); assert.equal(call.request.cache, "no-store");
    assert.match(call.path, /^\/api\/albums\//);
  }
  assert.throws(() => api.listAlbums({ limit: 51 }), TypeError);
  assert.throws(() => api.moveAlbumMember(id(1), legacy, "toString", { csrfToken: token, revision: id(2) }), TypeError);
});

test("malformed album rows, tombstone chronology, ETags, duplicate/deleted members never become success", async () => {
  const cases = [
    { path: "album", value: { ...ALBUM, deletedAt: "2026-10-10T12:00:00Z", name: null } },
    { path: "album", value: { ...ALBUM, revision: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" } },
    { path: "album", value: { ...ALBUM, revision: [id(2)] } },
    { path: "album", value: { ...ALBUM, albumId: [id(1)] } },
    { path: "album", value: ALBUM, etag: id(99) },
    { path: "list", value: { items: [null], nextCursor: null } },
    { path: "list", value: { items: [ALBUM, ALBUM], nextCursor: null } },
    { path: "members", value: { album: { ...ALBUM, memberCount: 2 }, items: [
      { memory: MEMORY_DETAIL, canMoveEarlier: false, canMoveLater: true },
      { memory: MEMORY_DETAIL, canMoveEarlier: true, canMoveLater: false }], nextCursor: null } },
    { path: "members", value: { album: { ...ALBUM, memberCount: 1 }, items: [{ memory: {
      ...MEMORY_DETAIL, reviewStatus: "DELETE", deleteAfter: "2027-11-09T15:00:00Z" }, canMoveEarlier: false, canMoveLater: false }], nextCursor: null } },
    { path: "members", value: { album: ALBUM, items: [null], nextCursor: null } },
  ];
  for (const entry of cases) {
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response(entry.value, 200, entry.etag) }) });
    await assert.rejects(() => entry.path === "list" ? api.listAlbums() : entry.path === "members" ? api.listAlbumMembers(id(1)) : api.getAlbum(id(1)),
      error => error.code === "CONTRACT_MISMATCH");
  }
});

test(
  "member pages accept a single uppercase legacy UUID but reject mixed-case duplicate identities",
  async () => {
    const legacy = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";
    const member = (memoryId) => ({
      memory: {
        ...MEMORY_DETAIL,
        memoryId,
      },
      canMoveEarlier: false,
      canMoveLater: false,
    });
    let items = [member(legacy.toUpperCase())];
    const api = createArchiveApi({
      client: createApiClient({
        fetchImpl: async () => {
          return response({
            album: {
              ...ALBUM,
              memberCount: items.length,
            },
            items,
            nextCursor: null,
          });
        },
      }),
    });

    const page = await api.listAlbumMembers(ALBUM.albumId);
    assert.equal(page.items[0].memory.memoryId, legacy.toUpperCase());

    items = [...items, member(legacy)];
    await assert.rejects(api.listAlbumMembers(ALBUM.albumId), {
      code: "CONTRACT_MISMATCH",
    });
  },
);

test(
  "mock album changes keep timestamps nondecreasing when the clock moves backward",
  async () => {
    let at = Date.parse("2026-10-19T16:00:00Z");
    const api = createMockArchiveApi({
      now: () => at,
    });
    const session = await api.getSession();
    await api.login(
      {
        username: "synthetic",
        password: "synthetic",
      },
      {
        csrfToken: session.csrfToken,
      },
    );
    const original = await directCreate(api);

    at += 60_000;
    const later = await api.renameAlbum(
      original.albumId,
      "Later name",
      await options(api, original),
    );
    assert.ok(Date.parse(later.updatedAt) > Date.parse(original.createdAt));

    at -= 120_000;
    const renamed = await api.renameAlbum(
      original.albumId,
      "Name after clock rollback",
      await options(api, later),
    );
    assert.equal(renamed.updatedAt, later.updatedAt);
    assert.equal(renamed.createdAt, original.createdAt);
    assert.notEqual(renamed.revision, later.revision);

    const noop = await api.renameAlbum(
      original.albumId,
      renamed.name,
      await options(api, renamed),
    );
    assert.deepEqual(noop, renamed);

    const deleted = await api.deleteAlbum(
      original.albumId,
      await options(api, renamed),
    );
    assert.equal(deleted.updatedAt, later.updatedAt);
    assert.equal(deleted.deletedAt, later.updatedAt);
    assert.equal(deleted.name, null);
    assert.deepEqual(await api.getAlbum(original.albumId), deleted);
  },
);

test("many-to-many membership, no-op tokens, cross-page moves, stale cursors and deletion preserve original memories", async () => {
  const api = await signedMock(); let album = await directCreate(api); const second = await directCreate(api, id(3), "Trips");
  const receipts = [];
  for (let index = 0; index < 24; index++) {
    receipts.push(await api.createCoupleTextContribution({ message: "Synthetic note " + index }, { idempotencyKey: id(index + 100), csrfToken: (await api.getSession()).csrfToken }));
    album = await api.addAlbumMember(album.albumId, receipts.at(-1).memories[0].memoryId, await options(api, album));
  }
  const firstMemory = await api.getMemory(receipts[0].memories[0].memoryId);
  const shared = await api.addAlbumMember(second.albumId, firstMemory.memoryId, await options(api, second));
  const noop = await api.addAlbumMember(album.albumId, firstMemory.memoryId, await options(api, album));
  assert.equal(noop.revision, album.revision); assert.equal(noop.memberCount, 24);
  const first = await api.listAlbumMembers(album.albumId); const later = await api.listAlbumMembers(album.albumId, { cursor: first.nextCursor });
  assert.equal(first.items.length, 20); assert.equal(later.items.length, 4);
  assert.equal(later.items[0].canMoveEarlier, true);
  album = await api.moveAlbumMember(album.albumId, later.items[0].memory.memoryId, "EARLIER", await options(api, album));
  await assert.rejects(() => api.listAlbumMembers(album.albumId, { cursor: first.nextCursor }), error => error.status === 412 && error.code === "ALBUM_CONFLICT");
  const reordered = await api.listAlbumMembers(album.albumId);
  assert.equal(reordered.items[19].memory.memoryId, later.items[0].memory.memoryId);
  const tombstone = await api.deleteAlbum(album.albumId, await options(api, album));
  assert.equal(tombstone.name, null); assert.equal(tombstone.memberCount, 0);
  assert.deepEqual(await api.getMemory(firstMemory.memoryId), firstMemory);
  assert.equal((await api.listAlbumMembers(shared.albumId)).items[0].memory.memoryId, firstMemory.memoryId);
  await assert.rejects(() => directCreate(api, album.albumId, "Resurrection"), error => error.status === 412);
  assert.deepEqual(await api.getAlbum(album.albumId), tombstone);
  assert.deepEqual((await api.listAlbumMembers(album.albumId)).items, []);
});

test("memory DELETE detaches every album, invalidates their revision and Restore does not rejoin", async () => {
  const api = await signedMock(); const receipt = await api.createCoupleTextContribution({ message: "Original synthetic note" }, { idempotencyKey: id(100), csrfToken: (await api.getSession()).csrfToken });
  let memory = await api.getMemory(receipt.memories[0].memoryId);
  const a = await directCreate(api), b = await directCreate(api, id(3), "Trips");
  const attached = await api.addAlbumMember(a.albumId, memory.memoryId, await options(api, a));
  await api.addAlbumMember(b.albumId, memory.memoryId, await options(api, b));
  memory = await api.reviewMemory(memory.memoryId, { reviewStatus: "DELETE", revision: memory.revision }, { csrfToken: (await api.getSession()).csrfToken });
  assert.equal((await api.getAlbum(a.albumId)).memberCount, 0); assert.notEqual((await api.getAlbum(a.albumId)).revision, attached.revision);
  assert.equal((await api.getAlbum(b.albumId)).memberCount, 0);
  await api.reviewMemory(memory.memoryId, { reviewStatus: "PENDING", revision: memory.revision }, { csrfToken: (await api.getSession()).csrfToken });
  assert.equal((await api.getAlbum(a.albumId)).memberCount, 0);
});

test("controller traverses paginated selector and member detail, returns to album without loading original preloads", async () => {
  const api = await signedMock(); await directCreate(api);
  for (let index = 0; index < 23; index++) await api.createCoupleTextContribution({ message: "Synthetic " + index }, { idempotencyKey: id(100 + index), csrfToken: (await api.getSession()).csrfToken });
  const controller = await entered(api);
  await controller.openAlbum(id(1)); await controller.showAlbumSelector("KEEP");
  assert.equal(controller.getSnapshot().albums.candidates.length, 20);
  await controller.albumPage(true); assert.equal(controller.getSnapshot().albums.candidates.length, 3);
  const memoryId = controller.getSnapshot().albums.candidates[0].memoryId;
  await controller.addAlbumMember(memoryId);
  assert.equal(controller.getSnapshot().albums.members.length, 1);
  await controller.openAlbumMemory(memoryId); assert.equal(controller.getSnapshot().phase, "detail");
  assert.equal(controller.getSnapshot().albumReturnId, id(1));
  await controller.backToInbox(); assert.equal(controller.getSnapshot().phase, "albums");
  assert.equal(controller.getSnapshot().albums.album.albumId, id(1));
  controller.dispose();
});

test("lost committed create and rename recover known identity without duplicate creation or actor attribution", async () => {
  const api = await signedMock(); api.setScenario("uncertainSubmission");
  const controller = await entered(api); await controller.beginAlbumCreation(); await controller.createAlbum("Wedding");
  assert.equal(controller.getSnapshot().albums.mutation.phase, "uncertain");
  await controller.reloadAlbumMutation();
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  assert.equal((await api.listAlbums()).items.length, 1);
  await controller.renameAlbum("Anniversary"); assert.equal(controller.getSnapshot().albums.mutation.phase, "uncertain");
  await controller.reloadAlbumMutation(); assert.equal(controller.getSnapshot().albums.album.name, "Anniversary");
  assert.match(controller.getSnapshot().albums.notice, /does not identify who changed/);
  controller.dispose();
});

test("an unresolved album mutation fences review, creation, navigation and logout; same-revision read only permits deliberate exact retry", async () => {
  const api = await signedMock(); await directCreate(api); const realRename = api.renameAlbum;
  let attempts = 0;
  api.renameAlbum = async (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return realRename(...args); };
  const controller = await entered(api); await controller.openAlbum(id(1)); await controller.renameAlbum("Trips");
  const before = controller.getSnapshot();
  await controller.loadInbox(); await controller.logout(); await controller.openMemory(MEMORY_DETAIL.memoryId); controller.beginCreation(); await controller.loadAlbums();
  assert.equal(controller.getSnapshot(), before); assert.equal(attempts, 1);
  await controller.reloadAlbumMutation(); assert.equal(controller.getSnapshot().albums.mutation.canRetry, true); assert.equal(attempts, 1);
  await controller.retryAlbumMutation(); assert.equal(attempts, 2); assert.equal(controller.getSnapshot().albums.album.name, "Trips");
  controller.dispose();
});

test("stale conflict loads the partner's current album and never silently reapplies the old name", async () => {
  const api = await signedMock(); const original = await directCreate(api); const controller = await entered(api); await controller.openAlbum(id(1));
  await api.renameAlbum(id(1), "Partner name", await options(api, original));
  await controller.renameAlbum("Old draft"); assert.equal(controller.getSnapshot().albums.mutation.phase, "conflict");
  await controller.reloadAlbumMutation(); assert.equal(controller.getSnapshot().albums.album.name, "Partner name");
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle"); controller.dispose();
});

test("a confirmed mutation stays confirmed when its following members read fails", async () => {
  const api = await signedMock(); await populatedAlbum(api); const controller = await entered(api); await controller.openAlbum(id(1));
  assert.equal(controller.getSnapshot().albums.members.length, 2);
  const realMembers = api.listAlbumMembers; let failed = false;
  api.listAlbumMembers = async (...args) => { if (!failed) { failed = true; throw new ApiError("synthetic read failure", { status: 503 }); } return realMembers(...args); };
  await controller.renameAlbum("Saved name");
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  assert.equal(controller.getSnapshot().albums.album.name, "Saved name"); assert.match(controller.getSnapshot().albums.error, /could not be loaded/);
  assert.deepEqual(controller.getSnapshot().albums.members, []); assert.deepEqual(controller.getSnapshot().albums.candidates, []);
  assert.equal(controller.getSnapshot().albums.nextCursor, null); assert.deepEqual(controller.getSnapshot().albums.cursors, [null]);
  await controller.openAlbum(id(1)); assert.equal(controller.getSnapshot().albums.album.name, "Saved name");
  controller.dispose();
});

test("hiding clears names/candidates/session while opaque pending identity permits same-name retry only after fresh read", async () => {
  const api = await signedMock(); await directCreate(api); const realRename = api.renameAlbum;
  let count = 0; api.renameAlbum = async (...args) => { count++; if (count === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return realRename(...args); };
  const controller = await entered(api); await controller.openAlbum(id(1)); await controller.renameAlbum("Sensitive name");
  controller.suspend(); assert.equal(controller.getSnapshot().session, null); assert.equal(controller.getSnapshot().albums.album, null);
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Sensitive name|Wedding/);
  await controller.resume(); assert.equal(controller.getSnapshot().albums.mutation.needsName, true);
  await controller.retryAlbumMutation("Different name"); assert.equal(count, 1);
  await controller.retryAlbumMutation("Sensitive name"); assert.equal(count, 2); assert.equal(controller.getSnapshot().albums.album.name, "Sensitive name");
  controller.dispose();
});

test("hide during name fingerprint preparation sends no write and releases fence; failed preparation also releases", async () => {
  const api = await signedMock(); const pending = deferred(); let creates = 0; const realCreate = api.createAlbum;
  api.createAlbum = (...args) => { creates++; return realCreate(...args); };
  const controller = await entered(api, { albumNameFingerprint: () => pending.promise });
  await controller.beginAlbumCreation(); const creation = controller.createAlbum("Secret draft"); await turn(); controller.suspend(); pending.resolve("hash");
  await creation; await controller.resume(); assert.equal(creates, 0); assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Secret draft/); controller.dispose();
  const failed = await entered(api, { albumNameFingerprint: async () => { throw new Error("synthetic hash failure"); } });
  await failed.beginAlbumCreation(); await failed.createAlbum("Retryable");
  assert.equal(failed.getSnapshot().albums.mutation.phase, "idle"); assert.match(failed.getSnapshot().albums.error, /No change was sent/); assert.equal(creates, 0); failed.dispose();
});

test("auth loss, immediate logout, disposal and ignored-abort late album reads cannot retain or resurrect private content", async () => {
  const api = await signedMock(); await directCreate(api, id(1), "Private wedding"); const controller = await entered(api); await controller.openAlbum(id(1));
  const pending = deferred(); const realMembers = api.listAlbumMembers;
  api.listAlbumMembers = () => pending.promise;
  const loading = controller.openAlbum(id(1)); await turn(); const logout = controller.logout();
  assert.equal(controller.getSnapshot().albums.album, null); assert.deepEqual(controller.getSnapshot().albums.members, []);
  pending.resolve({ album: copy(ALBUM), items: [], nextCursor: null }); await loading; await logout;
  assert.equal(controller.getSnapshot().phase, "login"); assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Private wedding/); controller.dispose();
  api.listAlbumMembers = realMembers;
  await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: (await api.getSession()).csrfToken });
  const second = await entered(api); api.setScenario("forbidden"); await second.openAlbum(id(1));
  assert.equal(second.getSnapshot().phase, "unavailable"); assert.equal(second.getSnapshot().albums.album, null); second.dispose();
});

test("CSRF rejection refreshes session and current album without automatically sending a write", async () => {
  const api = await signedMock(); await directCreate(api); const controller = await entered(api); await controller.openAlbum(id(1));
  await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: (await api.getSession()).csrfToken });
  await controller.renameAlbum("Unsent name"); assert.equal(controller.getSnapshot().albums.mutation.phase, "csrf");
  await controller.reloadAlbumMutation({ refreshSession: true });
  assert.equal(controller.getSnapshot().albums.album.name, "Wedding"); assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  controller.dispose();
});

test("deadline includes an ignored-abort album mutation and a late response cannot overwrite newer reconciled state", async () => {
  const api = await signedMock(); const original = await directCreate(api); const controller = await entered(api);
  await controller.openAlbum(id(1));
  const pending = deferred(), dispatched = deferred(), realRename = api.renameAlbum;
  api.renameAlbum = () => { dispatched.resolve(); return pending.promise; };
  // The existing host's deadline bounds both transport and decoder work.
  controller.dispose();
  const timers = new Map(); let next = 0;
  const boundedController = await entered(api, {
    setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; },
    clearTimeoutImpl(key) { timers.delete(key); },
  });
  await boundedController.openAlbum(id(1)); const saving = boundedController.renameAlbum("Unconfirmed draft");
  await dispatched.promise; assert.equal(timers.size, 1); [...timers.values()][0](); await saving;
  assert.equal(boundedController.getSnapshot().albums.mutation.phase, "uncertain");
  await boundedController.reloadAlbumMutation(); assert.equal(boundedController.getSnapshot().albums.mutation.canRetry, true);
  const newer = await realRename(id(1), "Partner newer name", await options(api, original));
  await boundedController.reloadAlbumMutation(); assert.equal(boundedController.getSnapshot().albums.album.name, "Partner newer name");
  pending.resolve({ ...newer, name: "Late stale draft" }); await turn();
  assert.equal(boundedController.getSnapshot().albums.album.name, "Partner newer name");
  assert.equal(boundedController.getSnapshot().albums.mutation.phase, "idle");
  assert.equal(timers.size, 0); boundedController.dispose();
});

test("album commands cannot cancel a private creator or its generation-bound submission", async () => {
  const api = await signedMock(); await directCreate(api); const controller = await entered(api);
  const pending = deferred(); const realCreate = api.createCoupleTextContribution;
  api.createCoupleTextContribution = (...args) => pending.promise.then(() => realCreate(...args));
  controller.beginCreation();
  const creation = controller.getCreationApi().createTextContribution({ message: "Synthetic pending creator" }, { idempotencyKey: id(100) });
  await turn(); const before = controller.getSnapshot();
  await controller.loadAlbums(); await controller.openAlbum(id(1)); await controller.beginAlbumCreation(); await controller.createAlbum("Bypass attempt");
  assert.equal(controller.getSnapshot(), before); assert.equal(before.phase, "create");
  pending.resolve(); const receipt = await creation;
  await controller.creationComplete(receipt); assert.equal(controller.getSnapshot().phase, "detail");
  assert.equal(controller.getSnapshot().detail.textContent, "Synthetic pending creator"); controller.dispose();
});

test("a timed-out follow-up read retains acknowledged album write and idle fence, and ignores late private rows", async () => {
  const api = await signedMock(); await populatedAlbum(api); const timers = new Map(); let next = 0;
  const controller = await entered(api, {
    setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; },
    clearTimeoutImpl(key) { timers.delete(key); },
  });
  await controller.openAlbum(id(1));
  assert.equal(controller.getSnapshot().albums.members.length, 2);
  const pending = deferred(), reading = deferred(), realMembers = api.listAlbumMembers;
  api.listAlbumMembers = () => { reading.resolve(); return pending.promise; };
  const saving = controller.renameAlbum("Acknowledged name"); await reading.promise;
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  assert.equal(timers.size, 1); [...timers.values()][0](); await saving;
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  assert.equal(controller.getSnapshot().albums.album.name, "Acknowledged name");
  assert.deepEqual(controller.getSnapshot().albums.members, []); assert.deepEqual(controller.getSnapshot().albums.candidates, []);
  assert.equal(controller.getSnapshot().albums.nextCursor, null); assert.deepEqual(controller.getSnapshot().albums.cursors, [null]);
  assert.match(controller.getSnapshot().albums.notice, /name saved/); assert.match(controller.getSnapshot().albums.error, /could not be loaded/);
  api.listAlbumMembers = realMembers; await controller.openAlbum(id(1));
  pending.resolve({ album: { ...ALBUM, name: "Late stale name" }, items: [], nextCursor: null }); await turn();
  assert.equal(controller.getSnapshot().albums.album.name, "Acknowledged name"); assert.equal(controller.getSnapshot().albums.error, null);
  assert.equal(timers.size, 0); controller.dispose();
});

test("ordinary inbox navigation drops prior album context before blur and fresh-session resume", async () => {
  const api = await signedMock(); await directCreate(api); const controller = await entered(api); await controller.openAlbum(id(1));
  await controller.loadInbox("PENDING"); assert.equal(controller.getSnapshot().albums.album, null);
  assert.equal(controller.getSnapshot().albumReturnId, null);
  controller.suspend(); await controller.resume(); assert.equal(controller.getSnapshot().phase, "inbox");
  assert.equal(controller.getSnapshot().albums.album, null);
  await controller.openAlbum(id(1)); await controller.openMemory(MEMORY_DETAIL.memoryId);
  assert.equal(controller.getSnapshot().albumReturnId, null);
  controller.suspend(); await controller.resume(); assert.equal(controller.getSnapshot().phase, "inbox");
  assert.equal(controller.getSnapshot().albums.album, null); controller.dispose();
});

test("partner's newer member order never keeps old cards enabled if reconciliation member refresh fails", async () => {
  const api = await signedMock(); const { album, memoryIds } = await populatedAlbum(api);
  const controller = await entered(api); await controller.openAlbum(album.albumId);
  assert.deepEqual(controller.getSnapshot().albums.members.map(item => item.memory.memoryId), memoryIds);
  const newer = await api.moveAlbumMember(album.albumId, memoryIds[1], "EARLIER", await options(api, album));
  await controller.renameAlbum("Stale name draft"); assert.equal(controller.getSnapshot().albums.mutation.phase, "conflict");
  const realMembers = api.listAlbumMembers;
  api.listAlbumMembers = async () => { throw new ApiError("synthetic refresh failure", { status: 503 }); };
  await controller.reloadAlbumMutation(); const snapshot = controller.getSnapshot();
  assert.equal(snapshot.albums.album.revision, newer.revision); assert.equal(snapshot.albums.mutation.phase, "idle");
  assert.equal(snapshot.albums.view, "detail"); assert.equal(snapshot.albums.requestedId, album.albumId);
  assert.deepEqual(snapshot.albums.members, []); assert.deepEqual(snapshot.albums.candidates, []);
  assert.equal(snapshot.albums.nextCursor, null); assert.deepEqual(snapshot.albums.cursors, [null]);
  assert.match(snapshot.albums.error, /could not be loaded/); assert.match(snapshot.albums.notice, /does not identify who changed/);
  api.listAlbumMembers = realMembers; await controller.openAlbum(album.albumId);
  assert.deepEqual(controller.getSnapshot().albums.members.map(item => item.memory.memoryId), [...memoryIds].reverse());
  await controller.showAlbumSelector("KEEP"); assert.equal(controller.getSnapshot().albums.candidates.length, 2);
  const newest = await api.moveAlbumMember(album.albumId, memoryIds[1], "LATER", await options(api, newer));
  await controller.addAlbumMember(memoryIds[0]); assert.equal(controller.getSnapshot().albums.mutation.phase, "conflict");
  api.listAlbumMembers = async () => { throw new ApiError("synthetic selector refresh failure", { status: 503 }); };
  await controller.reloadAlbumMutation();
  assert.equal(controller.getSnapshot().albums.album.revision, newest.revision);
  assert.equal(controller.getSnapshot().albums.view, "detail");
  assert.deepEqual(controller.getSnapshot().albums.candidates, []); assert.deepEqual(controller.getSnapshot().albums.members, []);
  assert.equal(controller.getSnapshot().albums.mutation.phase, "idle");
  controller.dispose();
});
