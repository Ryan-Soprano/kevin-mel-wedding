import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { createMockArchiveApi } from "../../../shared/api/mockArchiveApi.js";
import { ApiError, createApiClient } from "../../../shared/api/apiClient.js";
import { COUPLE_SESSION, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";
import { createInboxController } from "../../inbox/api/inboxController.js";
import { compareEvents, compareInstants, eventFields, normalizeEventFields, normalizeTimelineFilters, partialDateLabel } from "../timelineFields.js";

const id = n => "22222222-2222-4222-8222-" + String(n).padStart(12, "0");
const FIELDS = { title: "Our milestone", description: "Synthetic event", eventDate: "2024-03", datePrecision: "MONTH" };
const EVENT = { eventId: id(1), ...FIELDS, visibility: "COUPLE_ONLY", revision: id(2), memberCount: 0,
  createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", deletedAt: null };
const copy = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function response(value, status = 200, revision = value?.revision ?? value?.event?.revision) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ETag: '"' + revision + '"' } });
}
async function signedMock(config = {}) {
  const api = createMockArchiveApi(config), session = await api.getSession();
  await api.login({ username: "synthetic", password: "synthetic" }, { csrfToken: session.csrfToken }); return api;
}
const options = async (api, event) => ({ revision: event?.revision, csrfToken: (await api.getSession()).csrfToken });
const directCreate = async (api, eventId = id(1), fields = FIELDS) => api.createTimelineEvent(eventId, fields, await options(api));
async function entered(api, config = {}) { const controller = createInboxController({ api, ...config }); await controller.loadSession(); await controller.loadTimeline(); return controller; }
async function populated(api) {
  let event = await directCreate(api); const memories = [];
  for (let index = 0; index < 2; index++) {
    const receipt = await api.createCoupleTextContribution({ message: "Synthetic timeline member " + index }, { idempotencyKey: id(index + 100), ...(await options(api)) });
    memories.push(await api.getMemory(receipt.memories[0].memoryId));
    event = await api.linkTimelineMemory(event.eventId, memories.at(-1).memoryId, await options(api, event));
  } return { event, memories };
}
test("event fields require bounded storable title, exact four fields and valid partial Gregorian dates without invented precision", () => {
  assert.deepEqual(normalizeEventFields({ ...FIELDS, title: " Our milestone ", description: "  " }), { ...FIELDS, description: null });
  assert.equal(normalizeEventFields({ ...FIELDS, title: "😀".repeat(100) }).title.length, 200);
  for (const value of [{ ...FIELDS, title: " " }, { ...FIELDS, title: "x".repeat(201) }, { ...FIELDS, description: "x".repeat(2001) },
    { ...FIELDS, title: "\ud800" }, { ...FIELDS, description: "a\0b" }, { ...FIELDS, datePrecision: "DAY", eventDate: "1900-02-29" },
    { ...FIELDS, datePrecision: "YEAR", eventDate: "0000" }, { ...FIELDS, datePrecision: "UNKNOWN", eventDate: "2024" }, { ...FIELDS, extra: true }])
    assert.throws(() => normalizeEventFields(value), error => error.code === "VALIDATION_FAILED");
  assert.equal(normalizeEventFields({ ...FIELDS, datePrecision: "DAY", eventDate: "2000-02-29" }).eventDate, "2000-02-29");
  assert.equal(normalizeEventFields({ ...FIELDS, datePrecision: "YEAR", eventDate: "9999" }).eventDate, "9999");
  assert.equal(partialDateLabel("2024", "YEAR"), "Sometime in 2024"); assert.equal(partialDateLabel("2024-03", "MONTH"), "March 2024");
  assert.equal(partialDateLabel(null, "UNKNOWN"), "Date unknown");
  for (const filter of [{ fromYear: 0 }, { toYear: 10000 }, { fromYear: 2025, toYear: 2024 }, { datePrecision: "UNKNOWN", fromYear: 1 }, { datePrecision: "toString" }])
    assert.throws(() => normalizeTimelineFilters(filter), TypeError);
});
test("ordering compares whole-second and fractional instants exactly through nanoseconds and canonical IDs", () => {
  assert.ok(compareInstants("2026-01-01T00:00:00Z", "2026-01-01T00:00:00.001Z") < 0);
  assert.ok(compareInstants("2026-01-01T00:00:00.001001Z", "2026-01-01T00:00:00.001002Z") < 0);
  assert.equal(compareInstants("2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.100000000Z"), 0);
  const events = ["2024-03-01", null, "2024", "2024-03"].map((date, index) => ({ ...EVENT, eventId: id(index + 1), eventDate: date }));
  assert.deepEqual(events.sort(compareEvents).map(event => event.eventDate), ["2024", "2024-03", "2024-03-01", null]);
});
test("real adapter uses private exact-field and bodyless conditional routes, strong list ETag and legacy memory IDs", async () => {
  const calls = []; const api = createArchiveApi({ client: createApiClient({ fetchImpl: async (path, request) => {
    calls.push({ path, request }); const body = request.body && JSON.parse(request.body);
    if (path.startsWith("/api/timeline/events?")) return response({ revision: id(3), items: [EVENT], nextCursor: null });
    return response({ ...EVENT, ...(body ?? {}), ...(request.method === "DELETE" && !path.includes("/memories/")
      ? { title: null, description: null, eventDate: null, datePrecision: "UNKNOWN", deletedAt: EVENT.updatedAt } : {}) }, request.headers.get("If-None-Match") ? 201 : 200);
  } }) });
  const config = { csrfToken: COUPLE_SESSION.csrfToken, revision: EVENT.revision }, legacy = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";
  await api.createTimelineEvent(id(1), FIELDS, config); await api.updateTimelineEvent(id(1), FIELDS, config);
  await api.linkTimelineMemory(id(1), legacy, config); await api.unlinkTimelineMemory(id(1), legacy, config);
  await api.listTimelineEvents({ fromYear: 2024, toYear: 2024, datePrecision: "MONTH" }); await api.deleteTimelineEvent(id(1), config);
  assert.equal(calls[0].request.headers.get("If-None-Match"), "*"); assert.equal(calls[1].request.headers.get("If-Match"), '"' + id(2) + '"');
  assert.deepEqual(JSON.parse(calls[0].request.body), FIELDS); assert.equal(calls[2].request.body, undefined); assert.equal(calls[3].request.body, undefined);
  assert.match(calls[4].path, /fromYear=2024&toYear=2024/);
  for (const call of calls) { assert.match(call.path, /^\/api\/timeline\/events/); assert.equal(call.request.cache, "no-store"); assert.equal(call.request.credentials, "same-origin"); }
  assert.throws(() => api.listTimelineEvents({ limit: 51 }), TypeError); assert.throws(() => api.getTimelineEvent(legacy), TypeError);
});
test("malformed events/pages/ETags, impossible tombstones and stale member order are contract errors", async () => {
  const whole = { ...MEMORY_DETAIL, memoryId: id(50), createdAt: "2026-01-01T00:00:00Z" };
  const fractional = { ...MEMORY_DETAIL, memoryId: id(51), createdAt: "2026-01-01T00:00:00.000001Z" };
  const cases = [
    { type: "event", value: { ...EVENT, title: " " } }, { type: "event", value: { ...EVENT, eventDate: "2024-02-31", datePrecision: "DAY" } },
    { type: "event", value: { ...EVENT, eventId: [id(1)] } }, { type: "event", value: EVENT, etag: "wrong" },
    { type: "event", value: { ...EVENT, title: null, description: null, eventDate: null, datePrecision: "UNKNOWN", deletedAt: "2026-10-10T12:00:00.000001Z" } },
    { type: "list", value: { revision: id(3), items: [null], nextCursor: null } },
    { type: "list", value: { revision: id(3), items: [EVENT, EVENT], nextCursor: null } },
    { type: "list", value: { revision: id(3), items: [{ ...EVENT, eventDate: null, datePrecision: "UNKNOWN" }, EVENT], nextCursor: null } },
    { type: "members", value: { event: { ...EVENT, memberCount: 2 }, items: [{ memory: fractional }, { memory: whole }], nextCursor: null } },
    { type: "members", value: { event: { ...EVENT, memberCount: 1 }, items: [null], nextCursor: null } },
  ];
  for (const entry of cases) {
    const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response(entry.value, 200, entry.etag) }) });
    await assert.rejects(() => entry.type === "list" ? api.listTimelineEvents() : entry.type === "members" ? api.listTimelineMemories(id(1)) : api.getTimelineEvent(id(1)), error => error.code === "CONTRACT_MISMATCH");
  }
  const api = createArchiveApi({ client: createApiClient({ fetchImpl: async () => response({ event: { ...EVENT, memberCount: 2 }, items: [{ memory: whole }, { memory: fractional }], nextCursor: null }) }) });
  assert.equal((await api.listTimelineMemories(id(1))).items.length, 2);
});
test(
  "mock timeline action times stay nondecreasing across rollback, creation and deletion",
  async () => {
    let at = Date.parse("2026-10-19T16:00:00Z");
    const api = await signedMock({
      now: () => at,
    });
    const original = await directCreate(api);

    at += 60_000;
    const later = await api.updateTimelineEvent(
      original.eventId,
      {
        ...FIELDS,
        title: "Later edit",
      },
      await options(api, original),
    );
    assert.ok(compareInstants(later.updatedAt, original.createdAt) > 0);

    at -= 120_000;
    const edited = await api.updateTimelineEvent(
      original.eventId,
      {
        ...FIELDS,
        title: "Edit after clock rollback",
      },
      await options(api, later),
    );
    assert.equal(edited.createdAt, original.createdAt);
    assert.equal(edited.updatedAt, later.updatedAt);
    assert.notEqual(edited.revision, later.revision);

    const beforeNoop = await api.listTimelineEvents();
    const noop = await api.updateTimelineEvent(
      original.eventId,
      eventFields(edited),
      await options(api, edited),
    );
    assert.deepEqual(noop, edited);
    assert.equal((await api.listTimelineEvents()).revision, beforeNoop.revision);

    const created = await directCreate(api, id(3));
    assert.equal(created.createdAt, later.updatedAt);
    assert.equal(created.updatedAt, later.updatedAt);

    at = Date.parse("2026-10-19T16:02:00Z");
    const other = await api.updateTimelineEvent(
      created.eventId,
      {
        ...FIELDS,
        title: "Latest timeline action",
      },
      await options(api, created),
    );

    at = Date.parse("2026-10-19T15:59:00Z");
    const deleted = await api.deleteTimelineEvent(
      original.eventId,
      await options(api, edited),
    );
    assert.equal(deleted.createdAt, original.createdAt);
    assert.equal(deleted.updatedAt, other.updatedAt);
    assert.equal(deleted.deletedAt, other.updatedAt);
    assert.equal(deleted.title, null);
    assert.deepEqual(await api.getTimelineEvent(original.eventId), deleted);

    const beforeRepeatedDelete = await api.listTimelineEvents();
    const repeatedDelete = await api.deleteTimelineEvent(
      original.eventId,
      await options(api, deleted),
    );
    assert.deepEqual(repeatedDelete, deleted);
    assert.equal(
      (await api.listTimelineEvents()).revision,
      beforeRepeatedDelete.revision,
    );
  },
);

test("timeline pagination/filtering and shared links preserve originals; date/member edits invalidate exact cursor scope", async () => {
  const api = await signedMock(); const events = [];
  for (let index = 0; index < 25; index++) events.push(await directCreate(api, id(index + 1), { ...FIELDS, title: "Milestone " + index,
    eventDate: index === 24 ? null : String(2000 + index), datePrecision: index === 24 ? "UNKNOWN" : "YEAR" }));
  const first = await api.listTimelineEvents(), second = await api.listTimelineEvents({ cursor: first.nextCursor });
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 5); assert.equal(second.items.at(-1).datePrecision, "UNKNOWN");
  const range = await api.listTimelineEvents({ fromYear: 2005, toYear: 2006 }); assert.deepEqual(range.items.map(event => event.eventDate), ["2005", "2006"]);
  assert.equal((await api.listTimelineEvents({ datePrecision: "UNKNOWN" })).items.length, 1);
  await assert.rejects(
    api.listTimelineEvents({
      cursor: first.nextCursor,
      fromYear: 2000,
    }),
    {
      status: 400,
      code: "INVALID_CURSOR",
    },
  );
  const original = await api.getMemory(MEMORY_DETAIL.memoryId);
  let linked = await api.linkTimelineMemory(events[0].eventId, original.memoryId, await options(api, events[0]));
  const shared = await api.linkTimelineMemory(events[1].eventId, original.memoryId, await options(api, events[1]));
  const noop = await api.linkTimelineMemory(linked.eventId, original.memoryId, await options(api, linked)); assert.equal(noop.revision, linked.revision);
  await assert.rejects(() => api.listTimelineEvents({ cursor: first.nextCursor }), error => error.code === "TIMELINE_CONFLICT");
  await assert.rejects(
    api.listTimelineEvents({
      cursor: first.nextCursor,
      fromYear: 2000,
    }),
    {
      status: 400,
      code: "INVALID_CURSOR",
    },
  );
  linked = await api.updateTimelineEvent(linked.eventId, { ...eventFields(linked), eventDate: "0001", title: "Ancient milestone" }, await options(api, linked));
  assert.equal((await api.listTimelineEvents()).items[0].eventDate, "0001"); assert.deepEqual(await api.getMemory(original.memoryId), original);
  const tombstone = await api.deleteTimelineEvent(linked.eventId, await options(api, linked)); assert.equal(tombstone.title, null); assert.equal(tombstone.memberCount, 0);
  assert.equal((await api.listTimelineMemories(shared.eventId)).items[0].memory.memoryId, original.memoryId);
  assert.deepEqual(await api.getMemory(original.memoryId), original);
  await assert.rejects(() => directCreate(api, tombstone.eventId), error => error.status === 412);
});
test("paged completed picker/member links are stable; original DELETE detaches all events/albums and Restore does not rejoin", async () => {
  const api = await signedMock(); let event = await directCreate(api); const second = await directCreate(api, id(3));
  let album = await api.createAlbum(id(500), "Shared album", await options(api)); const receipts = [];
  for (let index = 0; index < 24; index++) {
    const receipt = await api.createCoupleTextContribution({ message: "Synthetic linked " + index }, { idempotencyKey: id(100 + index), ...(await options(api)) }); receipts.push(receipt);
    event = await api.linkTimelineMemory(event.eventId, receipt.memories[0].memoryId, await options(api, event));
  }
  const memoryId = receipts[0].memories[0].memoryId;
  await api.linkTimelineMemory(second.eventId, memoryId, await options(api, second)); album = await api.addAlbumMember(album.albumId, memoryId, await options(api, album));
  const first = await api.listTimelineMemories(event.eventId); assert.equal(first.items.length, 20); assert.equal((await api.listTimelineMemories(event.eventId, { cursor: first.nextCursor })).items.length, 4);
  const memory = await api.getMemory(memoryId); const deleted = await api.reviewMemory(memoryId, { reviewStatus: "DELETE", revision: memory.revision }, await options(api));
  await assert.rejects(() => api.listTimelineMemories(event.eventId, { cursor: first.nextCursor }), error => error.status === 412);
  assert.equal((await api.getTimelineEvent(event.eventId)).memberCount, 23); assert.equal((await api.getTimelineEvent(second.eventId)).memberCount, 0); assert.equal((await api.getAlbum(album.albumId)).memberCount, 0);
  await api.reviewMemory(memoryId, { reviewStatus: "PENDING", revision: deleted.revision }, await options(api)); assert.equal((await api.getTimelineEvent(second.eventId)).memberCount, 0);
  const controller = await entered(api); await controller.openTimelineEvent(event.eventId); await controller.showTimelineSelector("KEEP"); assert.equal(controller.getSnapshot().timeline.candidates.length, 20);
  await controller.timelinePage(true); assert.ok(controller.getSnapshot().timeline.candidates.length > 0); await controller.openTimelineEvent(event.eventId); await controller.timelinePage(true);
  await controller.openTimelineMemory(controller.getSnapshot().timeline.members[0].memory.memoryId); assert.equal(controller.getSnapshot().timelineReturnId, event.eventId);
  await controller.backToInbox(); assert.equal(controller.getSnapshot().phase, "timeline"); controller.dispose();
});
test("discarded committed create/edit/delete responses reconcile the known identity without duplicate creates or replay", async () => {
  const api = await signedMock(); api.setScenario("uncertainSubmission"); const controller = await entered(api);
  await controller.beginTimelineCreation(); await controller.createTimelineEvent(FIELDS);
  assert.equal(controller.getSnapshot().timeline.mutation.phase, "uncertain");
  await controller.reloadTimelineMutation(); const eventId = controller.getSnapshot().timeline.event.eventId;
  assert.equal((await api.listTimelineEvents()).items.length, 1); assert.equal(controller.getSnapshot().timeline.mutation.phase, "idle");
  await controller.updateTimelineEvent({ ...FIELDS, title: "Edited milestone" }); assert.equal(controller.getSnapshot().timeline.mutation.phase, "uncertain");
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.event.title, "Edited milestone");
  assert.match(controller.getSnapshot().timeline.notice, /does not identify who changed/);
  await controller.deleteTimelineEvent(); assert.equal(controller.getSnapshot().timeline.mutation.phase, "uncertain");
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.event.title, null);
  assert.equal(controller.getSnapshot().timeline.event.eventId, eventId); assert.equal((await api.listTimelineEvents()).items.length, 0); controller.dispose();
});
test("unresolved timeline write fences albums, review, metadata, creation, navigation and logout; same revision read never auto sends", async () => {
  const api = await signedMock(); await directCreate(api); let attempts = 0; const real = api.updateTimelineEvent;
  api.updateTimelineEvent = (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const controller = await entered(api); await controller.openTimelineEvent(id(1)); await controller.updateTimelineEvent({ ...FIELDS, title: "Uncertain edit" });
  const before = controller.getSnapshot();
  await controller.loadAlbums(); await controller.beginAlbumCreation(); await controller.loadInbox(); await controller.openMemory(MEMORY_DETAIL.memoryId);
  await controller.logout(); controller.beginCreation(); await controller.loadTimeline(); await controller.reviewMemory("DELETE"); await controller.saveMetadata({});
  assert.equal(controller.getSnapshot(), before); assert.equal(attempts, 1);
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.mutation.canRetry, true); assert.equal(attempts, 1);
  await controller.retryTimelineMutation(); assert.equal(attempts, 2); assert.equal(controller.getSnapshot().timeline.event.title, "Uncertain edit"); controller.dispose();
});
test("partner conflict preserves partner event and clears old member cards before failed current-page refresh", async () => {
  const api = await signedMock(); const { event, memories } = await populated(api); const controller = await entered(api); await controller.openTimelineEvent(event.eventId);
  assert.equal(controller.getSnapshot().timeline.members.length, 2);
  let newer = await api.unlinkTimelineMemory(event.eventId, memories[0].memoryId, await options(api, event));
  newer = await api.updateTimelineEvent(event.eventId, { ...FIELDS, title: "Partner milestone", eventDate: "2025", datePrecision: "YEAR" }, await options(api, newer));
  await controller.updateTimelineEvent({ ...FIELDS, title: "Stale old draft" }); assert.equal(controller.getSnapshot().timeline.mutation.phase, "conflict");
  const realMembers = api.listTimelineMemories; api.listTimelineMemories = async () => { throw new ApiError("synthetic", { status: 503 }); };
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.event.revision, newer.revision);
  assert.equal(controller.getSnapshot().timeline.event.title, "Partner milestone"); assert.equal(controller.getSnapshot().timeline.mutation.phase, "idle");
  assert.deepEqual(controller.getSnapshot().timeline.members, []); assert.deepEqual(controller.getSnapshot().timeline.candidates, []);
  assert.equal(controller.getSnapshot().timeline.nextCursor, null); assert.match(controller.getSnapshot().timeline.error, /could not be loaded/);
  api.listTimelineMemories = realMembers; await controller.openTimelineEvent(event.eventId); assert.equal(controller.getSnapshot().timeline.members[0].memory.memoryId, memories[1].memoryId); controller.dispose();
});
test("acknowledged edits remain accepted after plain or timed follow-up read failure, with no old cards or late overwrite", async () => {
  for (const timed of [false, true]) {
    const api = await signedMock(); const { event } = await populated(api); const timers = new Map(); let next = 0;
    const controller = await entered(api, { setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; }, clearTimeoutImpl(key) { timers.delete(key); } });
    await controller.openTimelineEvent(event.eventId); const pending = deferred(), reading = deferred(), realMembers = api.listTimelineMemories;
    api.listTimelineMemories = () => { reading.resolve(); return timed ? pending.promise : Promise.reject(new ApiError("synthetic", { status: 503 })); };
    const saving = controller.updateTimelineEvent({ ...FIELDS, title: "Accepted edit" }); await reading.promise;
    if (timed) { assert.equal(timers.size, 1); [...timers.values()][0](); } await saving;
    assert.equal(controller.getSnapshot().timeline.event.title, "Accepted edit"); assert.equal(controller.getSnapshot().timeline.mutation.phase, "idle");
    assert.deepEqual(controller.getSnapshot().timeline.members, []); assert.deepEqual(controller.getSnapshot().timeline.candidates, []);
    assert.match(controller.getSnapshot().timeline.notice, /accepted/); assert.match(controller.getSnapshot().timeline.error, /could not be loaded/);
    api.listTimelineMemories = realMembers; await controller.openTimelineEvent(event.eventId); pending.resolve({ event: { ...EVENT, title: "Late old event" }, items: [], nextCursor: null }); await turn();
    assert.equal(controller.getSnapshot().timeline.event.title, "Accepted edit"); assert.equal(timers.size, 0); controller.dispose();
  }
});
test("hide clears all private event/filter/draft contents; fresh read precedes exact four-field retry and forbids changed fields", async () => {
  const api = await signedMock(); await directCreate(api); let attempts = 0; const real = api.updateTimelineEvent;
  api.updateTimelineEvent = (...args) => { attempts++; if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const controller = await entered(api); await controller.loadTimeline({ fromYear: 2024, toYear: 2024 }); await controller.openTimelineEvent(id(1));
  const secret = { ...FIELDS, title: "Sensitive edit", description: "Sensitive description", eventDate: "2023", datePrecision: "YEAR" };
  await controller.updateTimelineEvent(secret); controller.suspend(); assert.equal(controller.getSnapshot().session, null);
  assert.deepEqual(controller.getSnapshot().timeline.filters, normalizeTimelineFilters()); assert.equal(controller.getSnapshot().timeline.event, null);
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Sensitive|Our milestone|2024-03/);
  await controller.resume(); assert.equal(controller.getSnapshot().timeline.mutation.needsFields, true); assert.equal(attempts, 1);
  await controller.retryTimelineMutation({ ...secret, description: "Changed" }); assert.equal(attempts, 1);
  await controller.retryTimelineMutation(secret); assert.equal(attempts, 2); assert.equal(controller.getSnapshot().timeline.event.title, secret.title); controller.dispose();
});
test("create absent read preserves the same opaque UUID; hide before hash or failed preparation sends nothing and releases fence", async () => {
  const api = await signedMock(); const real = api.createTimelineEvent; let attempts = 0, identities = [];
  api.createTimelineEvent = (...args) => { attempts++; identities.push(args[0]); if (attempts === 1) throw new ApiError("synthetic", { unknownOutcome: true }); return real(...args); };
  const controller = await entered(api); await controller.beginTimelineCreation(); await controller.createTimelineEvent(FIELDS); controller.suspend(); await controller.resume();
  assert.equal(controller.getSnapshot().timeline.mutation.canRetry, true); assert.equal(controller.getSnapshot().timeline.mutation.needsFields, true);
  await controller.retryTimelineMutation(FIELDS); assert.equal(identities[0], identities[1]); assert.equal((await api.listTimelineEvents()).items.length, 1); controller.dispose();
  const pending = deferred(); const hidden = await entered(api, { timelineFieldsFingerprint: () => pending.promise }); await hidden.beginTimelineCreation();
  const creating = hidden.createTimelineEvent({ ...FIELDS, title: "Secret before hash" }); await turn(); hidden.suspend(); pending.resolve("hash"); await creating; await hidden.resume();
  assert.equal(attempts, 2); assert.equal(hidden.getSnapshot().timeline.mutation.phase, "idle"); assert.doesNotMatch(JSON.stringify(hidden.getSnapshot()), /Secret before hash/); hidden.dispose();
  const failed = await entered(api, { timelineFieldsFingerprint: async () => { throw new Error("synthetic fingerprint failure"); } }); await failed.beginTimelineCreation(); await failed.createTimelineEvent(FIELDS);
  assert.equal(failed.getSnapshot().timeline.mutation.phase, "idle"); assert.match(failed.getSnapshot().timeline.error, /No change was sent/); assert.equal(attempts, 2); failed.dispose();
});
test("CSRF refresh reads current event without replay; access loss/logout/disposal and ignored-abort reads clear private timeline", async () => {
  const api = await signedMock(); await directCreate(api); const controller = await entered(api); await controller.openTimelineEvent(id(1));
  await api.login({ username: "synthetic", password: "synthetic" }, await options(api)); await controller.updateTimelineEvent({ ...FIELDS, title: "Unsent edit" });
  assert.equal(controller.getSnapshot().timeline.mutation.phase, "csrf"); await controller.reloadTimelineMutation({ refreshSession: true });
  assert.equal(controller.getSnapshot().timeline.event.title, FIELDS.title); assert.equal(controller.getSnapshot().timeline.mutation.phase, "idle");
  const pending = deferred(), real = api.listTimelineMemories; api.listTimelineMemories = () => pending.promise;
  const loading = controller.openTimelineEvent(id(1)); await turn(); const logout = controller.logout(); assert.equal(controller.getSnapshot().timeline.event, null);
  pending.resolve({ event: copy(EVENT), items: [], nextCursor: null }); await loading; await logout; assert.equal(controller.getSnapshot().phase, "login");
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /Our milestone/); controller.dispose(); api.listTimelineMemories = real;
  await api.login({ username: "synthetic", password: "synthetic" }, await options(api)); const lost = await entered(api); api.setScenario("forbidden"); await lost.openTimelineEvent(id(1));
  assert.equal(lost.getSnapshot().phase, "unavailable"); assert.equal(lost.getSnapshot().timeline.event, null); lost.dispose();
});
test("ordinary detail/inbox navigation drops old album and timeline return context before hide/resume", async () => {
  const api = await signedMock(); const { event, memories } = await populated(api); const album = await api.createAlbum(id(500), "Old album", await options(api));
  const controller = await entered(api); await controller.openAlbum(album.albumId); await controller.openAlbumMemory(MEMORY_DETAIL.memoryId);
  assert.equal(controller.getSnapshot().albumReturnId, album.albumId); await controller.loadTimeline(); assert.equal(controller.getSnapshot().albumReturnId, null);
  await controller.openTimelineEvent(event.eventId); await controller.openTimelineMemory(memories[0].memoryId); assert.equal(controller.getSnapshot().timelineReturnId, event.eventId);
  await controller.backToInbox(); assert.equal(controller.getSnapshot().phase, "timeline"); await controller.loadInbox(); await controller.openMemory(memories[0].memoryId);
  assert.equal(controller.getSnapshot().timelineReturnId, null); assert.equal(controller.getSnapshot().albumReturnId, null); controller.suspend(); await controller.resume();
  assert.equal(controller.getSnapshot().phase, "inbox"); assert.equal(controller.getSnapshot().timeline.event, null); controller.dispose();
});
test("timeline commands cannot bypass private authoring or an unresolved album write", async () => {
  const api = await signedMock(); await directCreate(api); const controller = await entered(api); controller.beginCreation(); const before = controller.getSnapshot();
  await controller.loadTimeline(); await controller.openTimelineEvent(id(1)); await controller.beginTimelineCreation(); await controller.createTimelineEvent(FIELDS); assert.equal(controller.getSnapshot(), before);
  await controller.loadInbox(); await controller.beginAlbumCreation(); await controller.createAlbum("Fence album");
  api.renameAlbum = async () => { throw new ApiError("synthetic", { unknownOutcome: true }); }; await controller.renameAlbum("Uncertain album"); const frozen = controller.getSnapshot();
  await controller.loadTimeline(); await controller.openTimelineEvent(id(1)); await controller.beginTimelineCreation(); assert.equal(controller.getSnapshot(), frozen); controller.dispose();
});
test("ignored-abort timed write cannot overwrite a newer reconciled event; hide drops a late committed create callback", async () => {
  const api = await signedMock(); const original = await directCreate(api); const timers = new Map(); let next = 0;
  const controller = await entered(api, { setTimeoutImpl(callback) { const key = ++next; timers.set(key, callback); return key; }, clearTimeoutImpl(key) { timers.delete(key); } });
  await controller.openTimelineEvent(original.eventId); const pending = deferred(), dispatched = deferred(), realEdit = api.updateTimelineEvent;
  api.updateTimelineEvent = () => { dispatched.resolve(); return pending.promise; };
  const saving = controller.updateTimelineEvent({ ...FIELDS, title: "Unconfirmed stale draft" }); await dispatched.promise;
  assert.equal(timers.size, 1); [...timers.values()][0](); await saving; assert.equal(controller.getSnapshot().timeline.mutation.phase, "uncertain");
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.mutation.canRetry, true);
  const newer = await realEdit(original.eventId, { ...FIELDS, title: "Partner newer milestone" }, await options(api, original));
  await controller.reloadTimelineMutation(); assert.equal(controller.getSnapshot().timeline.event.title, newer.title);
  pending.resolve({ ...newer, title: "Late stale response" }); await turn(); assert.equal(controller.getSnapshot().timeline.event.title, newer.title);
  assert.equal(controller.getSnapshot().timeline.mutation.phase, "idle"); assert.equal(timers.size, 0); controller.dispose();
  api.updateTimelineEvent = realEdit;
  const createPending = deferred(), createDispatched = deferred(), realCreate = api.createTimelineEvent; let sameId;
  api.createTimelineEvent = (...args) => { sameId = args[0]; createDispatched.resolve(); return createPending.promise.then(() => realCreate(...args.slice(0, 2), { ...args[2], signal: undefined })); };
  const hidden = await entered(api); await hidden.beginTimelineCreation(); const creating = hidden.createTimelineEvent({ ...FIELDS, title: "Hidden late milestone" });
  await createDispatched.promise; hidden.suspend(); await creating; assert.doesNotMatch(JSON.stringify(hidden.getSnapshot()), /Hidden late milestone/);
  createPending.resolve(); await turn(); await turn(); assert.equal(hidden.getSnapshot().timeline.event, null);
  // A fresh authenticated read can discover the committed original UUID, without re-sending.
  await hidden.resume(); assert.equal(hidden.getSnapshot().timeline.event.eventId, sameId); assert.equal(hidden.getSnapshot().timeline.mutation.phase, "idle"); hidden.dispose();
});
