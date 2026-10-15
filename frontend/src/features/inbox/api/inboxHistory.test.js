import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { attachInboxHistory } from "./inboxHistory.js";
import { createInboxController } from "./inboxController.js";
import { COUPLE_SESSION, IDS, MEMORY_DETAIL } from "../../../shared/api/v1/fixtures.js";

const turn = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);

function fixture(api) {
  const source = createInboxController({ api: {} });
  const empty = clone(source.getSnapshot()); source.dispose();
  const actualController = api ? createInboxController({ api }) : null;
  let state = actualController?.getSnapshot() ?? { ...empty, phase: "inbox", session: clone(COUPLE_SESSION) }, recording, serial = 0;
  const events = new EventTarget(), entries = [], calls = [], movements = [];
  let position = -1, blocked = 0, pages = [null], creationBlocked = false, draft = false, discard = false;
  const emitPop = value => {
    const event = new Event("popstate"); Object.defineProperty(event, "state", { value: clone(value) }); events.dispatchEvent(event);
  };
  const history = {
    get state() { return clone(entries[position]); },
    replaceState(value) { if (position < 0) position = 0; entries[position] = clone(value); },
    pushState(value) { entries.splice(position + 1); entries.push(clone(value)); position++; },
    go(delta) { movements.push(delta); position += delta; assert.ok(position >= 0 && position < entries.length); emitPop(entries[position]); },
  };
  const set = patch => { state = { ...state, ...patch }; recording?.sync(state); return state; };
  const controller = actualController ?? {
    getSnapshot: () => state,
    loadInbox: async (status, cursor) => { calls.push(["inbox", status, cursor]); return set({ phase: "inbox", reviewStatus: status, detail: null }); },
    beginCreation: () => { calls.push(["create"]); return set({ phase: "create" }); },
    loadAlbums: async (cursor, stack) => { calls.push(["albums", cursor, stack]); return set({ phase: "albums", albums: { ...empty.albums, cursors: stack } }); },
    openAlbum: async (id, cursor, stack) => { calls.push(["album", id, cursor, stack]); return set({ phase: "albums", albums: { ...empty.albums, view: "detail", album: { albumId: id }, cursors: stack } }); },
    showAlbumSelector: async (status, cursor, stack) => { calls.push(["album-select", status, cursor, stack]); return set({ albums: { ...state.albums, view: "select", selectorStatus: status, cursors: stack } }); },
    beginAlbumCreation: async () => { calls.push(["album-create"]); return set({ phase: "albums", albums: { ...empty.albums, view: "create" } }); },
    loadTimeline: async (filters, cursor, stack) => { calls.push(["timeline", filters, cursor, stack]); return set({ phase: "timeline", timeline: { ...empty.timeline, filters, cursors: stack } }); },
    openTimelineEvent: async (id, cursor, stack) => { calls.push(["event", id, cursor, stack]); return set({ phase: "timeline", timeline: { ...empty.timeline, view: "detail", event: { eventId: id }, cursors: stack } }); },
    showTimelineSelector: async (status, cursor, stack) => { calls.push(["event-select", status, cursor, stack]); return set({ timeline: { ...state.timeline, view: "select", selectorStatus: status, cursors: stack } }); },
    beginTimelineCreation: async () => { calls.push(["event-create"]); return set({ phase: "timeline", timeline: { ...empty.timeline, view: "create" } }); },
    loadTags: async (q, cursor, stack) => { calls.push(["tags", q, cursor, stack]); return set({ phase: "tags", tags: { ...empty.tags, q, cursors: stack } }); },
    openTag: async (id, cursor, stack) => { calls.push(["tag", id, cursor, stack]); return set({ phase: "tags", tags: { ...empty.tags, view: "detail", tag: { tagId: id }, cursors: stack } }); },
    showTagSelector: async (status, cursor, stack) => { calls.push(["tag-select", status, cursor, stack]); return set({ tags: { ...state.tags, view: "select", selectorStatus: status, cursors: stack } }); },
    beginTagCreation: async () => { calls.push(["tag-create"]); return set({ phase: "tags", tags: { ...empty.tags, view: "create" } }); },
    loadLibrary: async (filters, cursor, stack) => { calls.push(["library", filters, cursor, stack]); return set({ phase: "library", library: { ...empty.library, filters, cursors: stack } }); },
    chooseLibraryTag: async (filters, q, cursor, stack) => { calls.push(["library-tags", filters, q, cursor, stack]); return set({ phase: "library", library: { ...empty.library, view: "chooseTag", draftFilters: filters, tagQuery: q, tagCursors: stack } }); },
    openMemory: async (id, context) => { calls.push(["memory", id, context]); return set({ phase: "detail", detail: { ...MEMORY_DETAIL, memoryId: id },
      albumReturnId: context.albumId, timelineReturnId: context.eventId, tagReturnId: context.tagId, libraryReturn: context.libraryReturn,
      tags: { ...empty.tags, view: "memory", memoryId: id } }); },
    loadMemoryTags: async (cursor, stack) => { calls.push(["memory-tags", cursor, stack]); return set({ tags: { ...state.tags, view: "memory", cursors: stack } }); },
    chooseMemoryTag: async (q, cursor, stack) => { calls.push(["memory-tag-select", q, cursor, stack]); return set({ tags: { ...state.tags, view: "attach", q, cursors: stack } }); },
    loadExport: async () => { calls.push(["export"]); return set({ phase: "export", export: { ...empty.export, partsNextCursor: "part-two", issuesNextCursor: "issue-two" } }); },
    exportPage: async (kind, next) => { calls.push(["export-page", kind, next]); const field = kind === "issues" ? "issueCursors" : "partCursors";
      return set({ export: { ...state.export, [field]: [...state.export[field], "next"] } }); },
  };
  recording = attachInboxHistory({ controller, eventTarget: events, historyImpl: history,
    getInboxPages: () => pages, setInboxPages: value => { pages = value; }, randomId: () => "opaque-" + ++serial,
    isCreationBlocked: () => creationBlocked, hasCreationDraft: () => draft, confirmDiscard: () => discard,
    onBlocked: () => { blocked++; } });
  const unsubscribe = actualController?.subscribe(next => { state = next; recording.sync(next); });
  recording.sync(state);
  return { controller, recording, history, events, entries, calls, movements, empty, set,
    setPages: value => { pages = value; }, getPages: () => pages, blocked: () => blocked,
    creation: (busy, hasDraft, confirm = false) => { creationBlocked = busy; draft = hasDraft; discard = confirm; },
    pop: emitPop,
    dispose() { unsubscribe?.(); recording.dispose(); actualController?.dispose(); },
  };
}

test("Back interrupts a held album read and Forward freshly reads its requested page", async () => {
  let release;
  const cursors = [], fresh = { albumId: IDS.contribution, name: "Fresh album" };
  const f = fixture({
    getSession: async () => clone(COUPLE_SESSION),
    listMemories: async () => ({ items: [], nextCursor: null }),
    listAlbums: ({ cursor }) => {
      cursors.push(cursor);
      return cursors.length === 1 ? new Promise(resolve => { release = resolve; })
        : Promise.resolve({ items: [fresh], nextCursor: null });
    },
  });
  try {
    await f.controller.loadSession(); const inbox = f.history.state;
    const reading = f.controller.loadAlbums("requested-page", [null, "requested-page"]);
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.entries.length, 2); await turn();
    f.history.go(-1); await turn();
    assert.deepEqual(f.history.state, inbox);
    assert.equal(f.controller.getSnapshot().phase, "inbox");
    f.history.go(1); await turn();
    assert.equal(f.controller.getSnapshot().phase, "albums");
    assert.deepEqual(cursors, ["requested-page", "requested-page"]);
    assert.deepEqual(f.controller.getSnapshot().albums.cursors, [null, "requested-page"]);
    release({ items: [{ albumId: IDS.key, name: "Obsolete response" }], nextCursor: null }); await reading; await turn();
    assert.deepEqual(f.controller.getSnapshot().albums.items, [fresh]);
    assert.equal(f.entries.length, 2);
    assert.doesNotMatch(JSON.stringify(f.entries), /requested-page|albumId|11111111/);
  } finally { release?.({ items: [], nextCursor: null }); f.dispose(); }
});

test("a held memory has a history entry before detail arrives and Forward rereads that identity", async () => {
  let release;
  const memories = [];
  const f = fixture({
    getSession: async () => clone(COUPLE_SESSION),
    listMemories: async () => ({ items: [], nextCursor: null }),
    getMemory: id => {
      memories.push(id);
      return memories.length === 1 ? new Promise(resolve => { release = resolve; })
        : Promise.resolve({ ...MEMORY_DETAIL, memoryId: id, textContent: "Fresh detail" });
    },
    listMemoryTags: async () => ({ items: [], nextCursor: null }),
    logout: async () => {},
  });
  try {
    await f.controller.loadSession(); const inbox = f.history.state;
    const reading = f.controller.openMemory(IDS.text);
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.controller.getSnapshot().detail, null);
    assert.equal(f.entries.length, 2); await turn();
    f.history.go(-1); await turn();
    assert.deepEqual(f.history.state, inbox);
    assert.equal(f.controller.getSnapshot().phase, "inbox");
    f.history.go(1); await turn();
    assert.deepEqual(memories, [IDS.text, IDS.text]);
    assert.equal(f.controller.getSnapshot().detail.textContent, "Fresh detail");
    release({ ...MEMORY_DETAIL, textContent: "Obsolete response" }); await reading; await turn();
    assert.equal(f.controller.getSnapshot().detail.textContent, "Fresh detail");
    assert.equal(f.entries.length, 2);
    assert.doesNotMatch(JSON.stringify(f.entries), /22222222|memoryId|Fresh detail/);
    const signingOut = f.controller.logout();
    assert.equal(f.controller.getSnapshot().requestedMemoryId, null);
    await signingOut;
    assert.equal(f.controller.getSnapshot().requestedMemoryId, null);
  } finally { release?.(clone(MEMORY_DETAIL)); f.dispose(); }
});

test("opening another memory records one coherent destination after clearing the old tag picker", async () => {
  const f = fixture({
    getSession: async () => clone(COUPLE_SESSION),
    listMemories: async () => ({ items: [], nextCursor: null }),
    getMemory: async id => ({ ...MEMORY_DETAIL, memoryId: id }),
    listMemoryTags: async () => ({ items: [], nextCursor: null }),
    listTags: async () => ({ items: [], nextCursor: null }),
  });
  try {
    await f.controller.loadSession(); await f.controller.openMemory(IDS.text);
    await f.controller.chooseMemoryTag("old-picker-query");
    const count = f.entries.length;
    const reading = f.controller.openMemory(IDS.photo);
    assert.equal(f.entries.length, count + 1);
    assert.equal(f.controller.getSnapshot().requestedMemoryId, IDS.photo);
    await reading;
    assert.equal(f.entries.length, count + 1);
    f.history.go(-1); await turn();
    assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.text);
    assert.equal(f.controller.getSnapshot().tags.view, "attach");
    assert.equal(f.controller.getSnapshot().tags.q, "old-picker-query");
    f.history.go(1); await turn();
    assert.equal(f.controller.getSnapshot().detail.memoryId, IDS.photo);
    assert.equal(f.controller.getSnapshot().tags.view, "memory");
  } finally { f.dispose(); }
});

for (const boundary of ["suspend", "dispose", 401, 403]) {
  test(`${boundary} clears a held memory identity and invalidates its history ownership`, async () => {
    let reject, reads = 0;
    const f = fixture({
      getSession: async () => clone(COUPLE_SESSION),
      listMemories: async () => ({ items: [], nextCursor: null }),
      getMemory: () => { reads++; return new Promise((_, rejectRead) => { reject = rejectRead; }); },
    });
    try {
      await f.controller.loadSession(); const reading = f.controller.openMemory(IDS.text); await turn();
      const old = f.history.state;
      assert.equal(f.controller.getSnapshot().requestedMemoryId, IDS.text);
      if (typeof boundary === "number") reject(Object.assign(new Error("Access lost"), { status: boundary }));
      else f.controller[boundary]();
      await reading;
      assert.equal(f.controller.getSnapshot().requestedMemoryId, null);
      f.pop(old); await turn();
      assert.equal(reads, 1);
      assert.equal(f.controller.getSnapshot().session, null);
    } finally { reject?.(new Error("Test ended")); f.dispose(); }
  });
}

for (const action of ["loadSession", "login"]) {
  test(`${action} records its initial Pending read without an old-filter history entry`, async () => {
    let release, reads = 0;
    const f = fixture({
      getSession: async () => clone(COUPLE_SESSION),
      login: async () => clone(COUPLE_SESSION),
      listMemories: () => ++reads === 3 ? new Promise(resolve => { release = resolve; })
        : Promise.resolve({ items: [], nextCursor: null }),
    });
    try {
      await f.controller.loadSession(); await f.controller.loadInbox("ARCHIVED");
      const count = f.entries.length;
      const reading = f.controller[action]({ username: "synthetic", password: "synthetic" }); await turn();
      assert.equal(f.controller.getSnapshot().busy, true);
      assert.equal(f.controller.getSnapshot().reviewStatus, "PENDING");
      assert.equal(f.entries.length, count);
      release({ items: [], nextCursor: null }); await reading;
      assert.equal(f.entries.length, count);
    } finally { release?.({ items: [], nextCursor: null }); f.dispose(); }
  });
}

test("history contains only opaque ownership while Back and Forward reread the original filter and page", async () => {
  const f = fixture();
  try {
    f.setPages([null, "private-cursor"]); f.set({ reviewStatus: "ARCHIVED" });
    f.set({ phase: "detail", detail: { ...MEMORY_DETAIL, textContent: "private-content-sentinel" },
      shareLink: { url: "private-token-sentinel" }, photo: { phase: "ready", url: "blob:private-original", error: null } });
    const detailEntry = f.history.state;
    f.history.go(-1); await turn();
    assert.deepEqual(f.calls, [["inbox", "ARCHIVED", "private-cursor"]]);
    assert.deepEqual(f.getPages(), [null, "private-cursor"]);
    f.history.go(1); await turn();
    assert.deepEqual(f.calls.slice(-2), [["inbox", "ARCHIVED", "private-cursor"], ["memory", IDS.text,
      { albumId: null, eventId: null, tagId: null, libraryReturn: false }]]);
    assert.deepEqual(f.history.state, detailEntry);
    for (const entry of f.entries) assert.deepEqual(Object.keys(entry), ["owner", "key", "index"]);
    assert.doesNotMatch(JSON.stringify(f.entries), /private-|blob:|22222222|csrf|memoryId|reviewStatus/);
  } finally { f.recording.dispose(); }
});

test("preview changes and fresh revisions update one destination instead of growing history", () => {
  const f = fixture();
  try {
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL) }); const count = f.entries.length;
    f.set({ photo: { phase: "ready", url: "blob:private", error: null } });
    f.setPages([null]); f.set({ detail: { ...MEMORY_DETAIL, revision: 2 }, pageResetVersion: 1 });
    f.set({ session: { ...COUPLE_SESSION, csrfToken: "fresh-token" } });
    assert.equal(f.entries.length, count);
  } finally { f.recording.dispose(); }
});

for (const domain of ["review", "metadata", "albums", "timeline", "tags", "export"]) {
  test(`Back cannot interrupt an unconfirmed ${domain} mutation`, async () => {
    const f = fixture();
    try {
      f.set({ phase: "detail", detail: clone(MEMORY_DETAIL) }); const entry = f.history.state;
      f.set({ [domain]: domain === "review" || domain === "metadata" ? { ...f.controller.getSnapshot()[domain], phase: "uncertain" }
        : { ...f.controller.getSnapshot()[domain], mutation: { phase: "uncertain" } } });
      const before = f.controller.getSnapshot(); f.history.go(-1); await turn();
      assert.equal(f.controller.getSnapshot(), before); assert.deepEqual(f.history.state, entry);
      assert.deepEqual(f.calls, []); assert.deepEqual(f.movements, [-1, 1]); assert.equal(f.blocked(), 1);
    } finally { f.recording.dispose(); }
  });
}

test("creator pending work blocks traversal and an ordinary draft requires deliberate discard", async () => {
  const f = fixture();
  try {
    f.set({ phase: "create" }); const entry = f.history.state;
    f.creation(true, true); f.history.go(-1); await turn();
    assert.deepEqual(f.history.state, entry); assert.deepEqual(f.calls, []);
    f.creation(false, true, false); f.history.go(-1); await turn();
    assert.deepEqual(f.history.state, entry); assert.deepEqual(f.calls, []);
    f.creation(false, true, true); f.history.go(-1); await turn();
    assert.deepEqual(f.calls, [["inbox", "PENDING", null]]);
  } finally { f.recording.dispose(); }
});

for (const boundary of ["login", "checking", "unavailable", "pagehide", "dispose"]) {
  test(`${boundary} invalidates prior private route ownership`, async () => {
    const f = fixture();
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL) }); const old = f.history.state;
    if (boundary === "pagehide") f.events.dispatchEvent(new Event("pagehide"));
    else if (boundary === "dispose") f.recording.dispose();
    else f.set({ phase: boundary, session: null, detail: null });
    f.pop(old); await turn(); assert.deepEqual(f.calls, []);
    f.recording.dispose();
  });
}

for (const [phase, idField, recordField, open, select] of [
  ["albums", "albumId", "album", "album", "album-select"],
  ["timeline", "eventId", "event", "event", "event-select"],
  ["tags", "tagId", "tag", "tag", "tag-select"],
]) {
  test(`${phase} selector restores only after fresh parent access with its page and review filter`, async () => {
    const f = fixture();
    try {
      f.set({ phase, [phase]: { ...f.empty[phase], view: "select", [recordField]: { [idField]: IDS.contribution },
        selectorStatus: "ARCHIVED", cursors: [null, "selector-page"] } });
      f.set({ phase: "inbox" }); f.history.go(-1); await turn();
      assert.deepEqual(f.calls, [[open, IDS.contribution, null, [null]], [select, "ARCHIVED", "selector-page", [null, "selector-page"]]]);
    } finally { f.recording.dispose(); }
  });
}

test("memory history rebuilds the private library origin and tag-picker page from metadata", async () => {
  const f = fixture();
  try {
    const filters = { ...f.empty.library.filters, q: "private-query" };
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL), libraryReturn: true,
      library: { ...f.empty.library, filters, cursors: [null, "library-page"] },
      tags: { ...f.empty.tags, view: "attach", q: "private-tag-query", cursors: [null, "tag-page"] } });
    f.set({ phase: "inbox" }); f.history.go(-1); await turn();
    assert.deepEqual(f.calls, [["library", filters, "library-page", [null, "library-page"]],
      ["memory", IDS.text, { albumId: null, eventId: null, tagId: null, libraryReturn: true }],
      ["memory-tag-select", "private-tag-query", "tag-page", [null, "tag-page"]]]);
    assert.doesNotMatch(JSON.stringify(f.entries), /private-query|private-tag-query|library-page/);
  } finally { f.recording.dispose(); }
});

test("export traversal reloads progress and pages without creating, preparing or downloading anything", async () => {
  const f = fixture();
  try {
    f.set({ phase: "export", export: { ...f.empty.export, partCursors: [null, "part-two"], issueCursors: [null, "issue-two", "issue-three"] } });
    f.set({ phase: "inbox" }); f.history.go(-1); await turn();
    assert.deepEqual(f.calls, [["export"], ["export-page", "parts", true], ["export-page", "issues", true], ["export-page", "issues", true]]);
  } finally { f.recording.dispose(); }
});

test("an invalid history key cannot supply private navigation or bypass a write fence", async () => {
  const f = fixture();
  try {
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL), review: { ...f.empty.review, phase: "uncertain" } });
    f.pop({ owner: f.history.state.owner, key: "unknown", index: 9999, memoryId: IDS.photo }); await turn();
    assert.deepEqual(f.calls, []); assert.equal(f.blocked(), 1);
    assert.deepEqual(Object.keys(f.history.state), ["owner", "key", "index"]);
  } finally { f.recording.dispose(); }
});

test("a newer browser traversal owns the view before a prior selector parent read completes", async () => {
  const f = fixture();
  let finish;
  try {
    f.set({ phase: "albums", albums: { ...f.empty.albums, view: "select", album: { albumId: IDS.contribution },
      cursors: [null], selectorStatus: "KEEP" } });
    f.set({ phase: "inbox", reviewStatus: "ARCHIVED" });
    f.controller.openAlbum = (...args) => { f.calls.push(["held-parent", ...args]); return new Promise(resolve => { finish = resolve; }); };
    f.history.go(-1); await turn();
    f.history.go(-1); await turn(); finish(); await turn();
    assert.deepEqual(f.calls, [["held-parent", IDS.contribution, null, [null]], ["inbox", "PENDING", null]]);
    assert.equal(f.controller.getSnapshot().phase, "inbox");
  } finally { finish?.(); f.recording.dispose(); }
});

test("a deliberate in-app action prevents a stale restoration from issuing its next read", async () => {
  const f = fixture();
  let finish;
  try {
    f.set({ phase: "albums", albums: { ...f.empty.albums, view: "select", album: { albumId: IDS.contribution },
      cursors: [null], selectorStatus: "KEEP" } });
    f.set({ phase: "inbox", reviewStatus: "ARCHIVED" });
    f.controller.openAlbum = (...args) => { f.calls.push(["held-parent", ...args]); return new Promise(resolve => { finish = resolve; }); };
    f.history.go(-1); await turn();
    f.recording.cancelRestore(); await f.controller.loadTags("fresh-query", null, [null]);
    finish(); await turn();
    assert.deepEqual(f.calls, [["held-parent", IDS.contribution, null, [null]], ["tags", "fresh-query", null, [null]]]);
    assert.equal(f.controller.getSnapshot().phase, "tags");
  } finally { finish?.(); f.recording.dispose(); }
});

test("expired access during a parent read cannot continue into a memory or selector", async () => {
  const f = fixture();
  try {
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL), albumReturnId: IDS.contribution,
      albums: { ...f.empty.albums, view: "detail", album: { albumId: IDS.contribution } } });
    f.set({ phase: "inbox" });
    f.controller.openAlbum = async () => { f.calls.push(["access-lost"]); f.set({ phase: "login", session: null, detail: null }); };
    f.history.go(-1); await turn();
    assert.deepEqual(f.calls, [["access-lost"]]);
    assert.equal(f.controller.getSnapshot().phase, "login");
  } finally { f.recording.dispose(); }
});

test("navigation after Back invalidates the discarded Forward branch", async () => {
  const f = fixture();
  try {
    f.set({ phase: "detail", detail: clone(MEMORY_DETAIL) });
    f.set({ phase: "albums", albums: { ...f.empty.albums } }); const oldForward = f.history.state;
    f.history.go(-1); await turn();
    await f.controller.loadTags("new-branch", null, [null]);
    const count = f.calls.length; f.pop(oldForward); await turn();
    assert.equal(f.calls.length, count);
    assert.equal(f.controller.getSnapshot().phase, "tags");
  } finally { f.recording.dispose(); }
});
