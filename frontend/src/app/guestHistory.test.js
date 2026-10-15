import test from "node:test";
import assert from "node:assert/strict";
import { attachGuestHistory } from "./guestHistory.js";
import { createGuestFlow, guestFlowReducer, hasUnfinishedWork } from "./guestFlow.js";

function fixture({ audioEnabled = true } = {}) {
  let flow = createGuestFlow({ audioEnabled }), recording, serial = 0, position = -1;
  const events = new EventTarget(), entries = [], writes = [], movements = [], navigations = [];
  function pop(state) {
    const event = new Event("popstate");
    Object.defineProperty(event, "state", { value: structuredClone(state) });
    events.dispatchEvent(event);
  }
  const history = {
    get state() { return structuredClone(entries[position]); },
    replaceState(state, title, ...url) {
      if (position < 0) position = 0;
      entries[position] = structuredClone(state); writes.push({ method: "replace", title, url });
    },
    pushState(state, title, ...url) {
      entries.splice(position + 1); entries.push(structuredClone(state)); position++;
      writes.push({ method: "push", title, url });
    },
    go(delta) {
      movements.push(delta);
      const next = position + delta;
      if (next < 0 || next >= entries.length || next === position) return;
      position = next; pop(entries[position]);
    },
  };
  function update(action) {
    flow = guestFlowReducer(flow, action);
    recording?.sync(flow.screen);
    return flow;
  }
  recording = attachGuestHistory({ getFlow: () => flow, navigate(screen) {
    navigations.push(screen); update({ type: "NAVIGATE", screen });
  }, eventTarget: events, historyImpl: history, randomId: () => "opaque-" + ++serial });
  return { recording, history, entries, writes, movements, navigations, pop, update, flow: () => flow };
}

test("Back and Forward revisit every guest screen without replacing mounted forms or their draft/completion state", () => {
  const f = fixture();
  try {
    f.update({ type: "CHOOSE" }); f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "FORM_STATE", kind: "note", state: { hasDraft: true } });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "photos" });
    f.update({ type: "FORM_STATE", kind: "photos", state: { hasDraft: true } });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "audio" });
    f.update({ type: "FORM_STATE", kind: "audio", state: { complete: true } });
    f.update({ type: "FINISHED", kind: "audio" });
    const forms = f.flow().forms, started = f.flow().started, entryCount = f.entries.length;
    assert.equal(f.flow().screen, "done"); assert.equal(hasUnfinishedWork(f.flow()), true);
    assert.deepEqual(started, ["note", "photos", "audio"]);
    for (const screen of ["audio", "choose", "photos", "choose", "note", "choose", "welcome"]) {
      f.history.go(-1); assert.equal(f.flow().screen, screen);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
    }
    for (const screen of ["choose", "note", "choose", "photos", "choose", "audio", "done"]) {
      f.history.go(1); assert.equal(f.flow().screen, screen);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
    }
    assert.equal(f.flow().forms.note.hasDraft, true); assert.equal(f.flow().forms.photos.hasDraft, true);
    assert.equal(f.flow().forms.audio.complete, false, "Done's deliberate reset is not undone by browser history");
    assert.equal(f.entries.length, entryCount, "pop navigation does not push replacement history entries");
  } finally { f.recording.dispose(); }
});

for (const kind of ["note", "photos", "audio"]) {
  test(`${kind} welcome entry preserves its draft through direct browser Back and Forward`, () => {
    const f = fixture();
    try {
      const welcomeEntry = f.history.state;
      f.update({ type: "SELECT", kind });
      f.update({ type: "FORM_STATE", kind, state: { hasDraft: true } });
      const forms = f.flow().forms, started = f.flow().started, entry = f.history.state;
      const writes = f.writes.length;
      assert.equal(f.entries.length, 2, "direct selection has no intermediate choices entry");
      f.history.go(-1);
      assert.equal(f.flow().screen, "welcome"); assert.deepEqual(f.history.state, welcomeEntry);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
      assert.equal(hasUnfinishedWork(f.flow()), true);
      f.history.go(1);
      assert.equal(f.flow().screen, kind); assert.deepEqual(f.history.state, entry);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
      assert.equal(f.flow().forms[kind].hasDraft, true);
      assert.deepEqual(started, [kind]); assert.equal(f.writes.length, writes);
      assert.deepEqual(f.navigations, ["welcome", kind]);
    } finally { f.recording.dispose(); }
  });

  test(`${kind} direct welcome entry bounces busy or pending browser navigation without a choices entry`, () => {
    for (const state of [{ busy: true }, { pending: true }]) {
      const f = fixture();
      try {
        f.update({ type: "SELECT", kind });
        f.update({ type: "FORM_STATE", kind, state: { ...state, hasDraft: true } });
        const before = f.flow(), entry = f.history.state, writes = f.writes.length;
        assert.equal(f.entries.length, 2);
        f.history.go(-1);
        assert.deepEqual(f.movements, [-1, 1]); assert.deepEqual(f.history.state, entry);
        assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []);
        assert.equal(f.writes.length, writes); assert.equal(hasUnfinishedWork(f.flow()), true);
        f.update({ type: "FORM_STATE", kind, state: { hasDraft: true } });
        f.history.go(-1); assert.equal(f.flow().screen, "welcome");
        f.history.go(1); assert.equal(f.flow().screen, kind);
        assert.equal(f.flow().forms[kind].hasDraft, true); assert.deepEqual(f.flow().started, [kind]);
        assert.equal(f.writes.length, writes);
      } finally { f.recording.dispose(); }
    }
  });

  test(`${kind} busy/pending work bounces browser navigation back to its owned entry`, () => {
    for (const state of [{ busy: true }, { pending: true }]) {
      const f = fixture();
      try {
        f.update({ type: "CHOOSE" }); f.update({ type: "SELECT", kind });
        f.update({ type: "FORM_STATE", kind, state: { ...state, hasDraft: true } });
        const before = f.flow(), entry = f.history.state, writes = f.writes.length;
        f.history.go(-1);
        assert.deepEqual(f.movements, [-1, 1]); assert.deepEqual(f.history.state, entry);
        assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.equal(f.writes.length, writes);
        f.update({ type: "FORM_STATE", kind, state: { hasDraft: true } });
        f.history.go(-1); assert.equal(f.flow().screen, "choose");
        f.history.go(1); assert.equal(f.flow().screen, kind); assert.equal(f.flow().forms[kind].hasDraft, true);
        assert.deepEqual(f.flow().started, [kind]);
      } finally { f.recording.dispose(); }
    }
  });
}

test("choosing a new branch after Back replaces the old Forward branch while keeping visited form owners", () => {
  const f = fixture();
  try {
    f.update({ type: "CHOOSE" }); f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "photos" });
    const oldForward = f.history.state;
    f.history.go(-1); assert.equal(f.flow().screen, "choose");
    f.update({ type: "SELECT", kind: "audio" });
    assert.equal(f.history.state.index, oldForward.index); assert.notEqual(f.history.state.key, oldForward.key);
    assert.ok(f.entries.every(entry => entry.key !== oldForward.key));
    const branch = f.flow(), branchNavigations = f.navigations.length;
    f.pop(oldForward);
    assert.equal(f.flow(), branch, "discarded Forward entries no longer belong to this navigation map");
    assert.equal(f.navigations.length, branchNavigations);
    const writes = f.writes.length, navigations = f.navigations.length;
    f.history.go(1);
    assert.equal(f.flow().screen, "audio"); assert.equal(f.navigations.length, navigations);
    f.update({ type: "FORM_STATE", kind: "audio", state: { hasDraft: true } });
    f.recording.sync("audio"); assert.equal(f.writes.length, writes, "draft reports do not add a screen entry");
    assert.deepEqual(f.flow().started, ["note", "photos", "audio"]);
  } finally { f.recording.dispose(); }
});

test("malformed owned indices cannot navigate or change a pending-work bounce offset", () => {
  const f = fixture();
  try {
    f.update({ type: "CHOOSE" }); const previous = f.history.state;
    f.update({ type: "SELECT", kind: "note" });
    for (const locked of [false, true]) {
      f.update({ type: "FORM_STATE", kind: "note", state: { pending: locked, hasDraft: true } });
      const before = f.flow();
      for (const index of [undefined, null, -1, previous.index + 1, String(previous.index), NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        f.pop({ ...previous, index });
        assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.deepEqual(f.movements, []);
      }
    }
  } finally { f.recording.dispose(); }
});

test("a current-entry pop never calls history.go(0) or navigates while a submission is locked", () => {
  const f = fixture();
  try {
    f.update({ type: "CHOOSE" }); f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "FORM_STATE", kind: "note", state: { pending: true } });
    const before = f.flow(); f.pop(f.history.state);
    assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.deepEqual(f.movements, []);
  } finally { f.recording.dispose(); }
});

test("history writes only opaque ownership keys and disposal ignores old or foreign navigation", () => {
  const f = fixture();
  f.update({ type: "CHOOSE" }); f.update({ type: "SELECT", kind: "note" });
  f.update({ type: "FORM_STATE", kind: "note", state: { hasDraft: true } });
  const entry = f.history.state, before = f.flow(), writes = f.writes.length;
  for (const value of [null, {}, { ...entry, owner: "foreign-owner" }, { ...entry, key: "unknown-key" }]) f.pop(value);
  assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []);
  for (const value of f.entries) assert.deepEqual(Object.keys(value), ["owner", "key", "index"]);
  assert.doesNotMatch(JSON.stringify(f.entries), /screen|forms|started|note|photos|audio|hasDraft|pending|csrf|message|file|receipt|retry/i);
  assert.deepEqual(f.writes.map(write => write.title), ["", "", ""]);
  assert.ok(f.writes.every(write => write.url.length === 0), "screen history does not change or embed data in the address");
  f.recording.dispose(); f.recording.dispose();
  f.recording.sync("photos"); f.pop(f.entries[0]); f.history.go(-1);
  assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.equal(f.writes.length, writes);
});
