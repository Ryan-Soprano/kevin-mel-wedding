import test from "node:test";
import assert from "node:assert/strict";
import { attachGuestHistory, restoreGuestHomeView } from "./guestHistory.js";
import { createGuestFlow, guestFlowReducer, hasUnfinishedWork } from "./guestFlow.js";

function homeRestorationFixture({
  kind = "photos", withGallery = true, withChoice = true, withHeading = true,
  bounds = { top: 200, bottom: 300 }, offsetTop = 640,
} = {}) {
  const calls = [];
  function element(name) {
    return {
      focus(options) { calls.push([name, "focus", options]); },
      scrollIntoView(options) { calls.push([name, "scrollIntoView", options]); },
      getBoundingClientRect() { return bounds; },
    };
  }
  const galleryHeading = element("gallery"), choice = element("choice"), heading = element("heading");
  return {
    calls,
    options: {
      choices: {
        offsetTop,
        querySelector(selector) {
          if (selector === `.memory-choice--${kind}`) return withChoice ? choice : null;
          return selector === "h2" && withHeading ? heading : null;
        },
      },
      gallery: {
        querySelector(selector) { return selector === "#couple-gallery" && withGallery ? galleryHeading : null; },
      },
      windowImpl: {
        innerHeight: 800,
        scrollTo(options) { calls.push(["window", "scrollTo", options]); },
      },
    },
  };
}

test("direct gallery return focuses and reveals the gallery before considering opening or choice metadata", () => {
  const f = homeRestorationFixture();
  assert.equal(restoreGuestHomeView({
    kind: "photos", scrollY: 0, showOpening: true, target: "gallery",
  }, f.options), true);
  assert.deepEqual(f.calls, [
    ["gallery", "focus", { preventScroll: true }],
    ["gallery", "scrollIntoView", { block: "start", behavior: "instant" }],
  ]);
});

test("restored gallery returns preserve zero and later viewports without replacing them with the gallery position", () => {
  for (const scrollY of [0, 2120]) {
    const f = homeRestorationFixture();
    assert.equal(restoreGuestHomeView({ target: "gallery", scrollY }, { ...f.options, restoredHome: true }), true);
    assert.deepEqual(f.calls, [
      ["gallery", "focus", { preventScroll: true }],
      ["window", "scrollTo", { top: scrollY, behavior: "instant" }],
    ]);
  }
});

test("restored gallery returns without a saved viewport reveal the gallery", () => {
  const f = homeRestorationFixture();
  assert.equal(restoreGuestHomeView({ target: "gallery", scrollY: null }, { ...f.options, restoredHome: true }), true);
  assert.deepEqual(f.calls, [
    ["gallery", "focus", { preventScroll: true }],
    ["gallery", "scrollIntoView", { block: "start", behavior: "instant" }],
  ]);
});

test("missing gallery falls back to the sharing choice and preserves a zero viewport", () => {
  const f = homeRestorationFixture({ withGallery: false });
  assert.equal(restoreGuestHomeView({
    kind: "photos", scrollY: 0, showOpening: false, target: "gallery",
  }, f.options), true);
  assert.deepEqual(f.calls, [
    ["choice", "focus", { preventScroll: true }],
    ["window", "scrollTo", { top: 0, behavior: "instant" }],
  ]);
});

test("missing sharing choice focuses its heading and uses the section position when no viewport was saved", () => {
  const f = homeRestorationFixture({ withChoice: false });
  assert.equal(restoreGuestHomeView({ kind: "photos", scrollY: null, showOpening: false }, f.options), true);
  assert.deepEqual(f.calls, [
    ["heading", "focus", { preventScroll: true }],
    ["window", "scrollTo", { top: 640, behavior: "instant" }],
  ]);
});

test("direct sharing returns reveal an offscreen choice while history restoration keeps its saved viewport", () => {
  for (const bounds of [{ top: -20, bottom: 80 }, { top: 750, bottom: 850 }]) {
    for (const restoredHome of [false, true]) {
      const f = homeRestorationFixture({ bounds });
      assert.equal(restoreGuestHomeView({ kind: "photos", scrollY: 1200, showOpening: false }, {
        ...f.options, restoredHome,
      }), true);
      assert.deepEqual(f.calls, [
        ["choice", "focus", { preventScroll: true }],
        ["window", "scrollTo", { top: 1200, behavior: "instant" }],
        ...(!restoredHome ? [["choice", "scrollIntoView", { block: "nearest", behavior: "instant" }]] : []),
      ]);
    }
  }
});

test("opening views leave App's heading fallback untouched unless a gallery destination is available", () => {
  for (const target of [undefined, "gallery"]) {
    const f = homeRestorationFixture({ withGallery: false });
    assert.equal(restoreGuestHomeView({ kind: "photos", scrollY: 1200, showOpening: true, target }, f.options), false);
    assert.deepEqual(f.calls, []);
  }
});

test("sharing restoration tolerates unavailable elements and keeps its original top-of-page fallback", () => {
  const f = homeRestorationFixture();
  assert.equal(restoreGuestHomeView({ showOpening: false, scrollY: null }, {
    windowImpl: f.options.windowImpl,
  }), true);
  assert.deepEqual(f.calls, [["window", "scrollTo", { top: 0, behavior: "instant" }]]);
});

function fixture({ audioEnabled = true, getHomeView, restoreHomeView, scrollRestoration = "auto" } = {}) {
  let flow = createGuestFlow({ audioEnabled }), recording, serial = 0, position = -1;
  const events = new EventTarget(), entries = [], writes = [], movements = [], navigations = [];
  function pop(state) {
    const event = new Event("popstate");
    Object.defineProperty(event, "state", { value: structuredClone(state) });
    events.dispatchEvent(event);
  }
  const history = {
    scrollRestoration,
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
  }, getHomeView, restoreHomeView, eventTarget: events, historyImpl: history, randomId: () => "opaque-" + ++serial });
  return { recording, history, entries, writes, movements, navigations, pop, update, flow: () => flow };
}

test("Back and Forward revisit every guest screen without replacing mounted forms or their draft/completion state", () => {
  const f = fixture();
  try {
    f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "FORM_STATE", kind: "note", state: { hasDraft: true } });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "photos" });
    f.update({ type: "FORM_STATE", kind: "photos", state: { hasDraft: true } });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "audio" });
    f.update({ type: "FORM_STATE", kind: "audio", state: { complete: true } });
    f.update({ type: "FINISHED", kind: "audio" });
    f.update({ type: "NAVIGATE", screen: "done" });
    const forms = f.flow().forms, started = f.flow().started, entryCount = f.entries.length;
    assert.equal(f.flow().screen, "done"); assert.equal(hasUnfinishedWork(f.flow()), true);
    assert.deepEqual(started, ["note", "photos", "audio"]);
    for (const screen of ["welcome", "audio", "welcome", "photos", "welcome", "note", "welcome"]) {
      f.history.go(-1); assert.equal(f.flow().screen, screen);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
    }
    for (const screen of ["note", "welcome", "photos", "welcome", "audio", "welcome", "done"]) {
      f.history.go(1); assert.equal(f.flow().screen, screen);
      assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
    }
    assert.equal(f.flow().forms.note.hasDraft, true); assert.equal(f.flow().forms.photos.hasDraft, true);
    assert.equal(f.flow().forms.audio.complete, false, "finishing a saved memory is not undone by browser history");
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

  test(`${kind} busy/pending work bounces a multiple-entry browser jump back to its owned form`, () => {
    for (const state of [{ busy: true }, { pending: true }]) {
      const f = fixture();
      try {
        const otherKind = kind === "note" ? "photos" : "note";
        f.update({ type: "SELECT", kind: otherKind });
        f.update({ type: "FORM_STATE", kind: otherKind, state: { hasDraft: true } });
        f.update({ type: "BACK" }); f.update({ type: "SELECT", kind });
        f.update({ type: "FORM_STATE", kind, state: { ...state, hasDraft: true } });
        const before = f.flow(), entry = f.history.state, writes = f.writes.length;
        f.history.go(-2);
        assert.deepEqual(f.movements, [-2, 2]); assert.deepEqual(f.history.state, entry);
        assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.equal(f.writes.length, writes);
        f.update({ type: "FORM_STATE", kind, state: { hasDraft: true } });
        f.history.go(-2); assert.equal(f.flow().screen, otherKind);
        f.history.go(2); assert.equal(f.flow().screen, kind); assert.equal(f.flow().forms[kind].hasDraft, true);
        assert.equal(f.flow().forms[otherKind].hasDraft, true);
        assert.deepEqual(f.flow().started, [otherKind, kind]);
      } finally { f.recording.dispose(); }
    }
  });
}

test("choosing a new branch after Back replaces the old Forward branch while keeping visited form owners", () => {
  const f = fixture();
  try {
    f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "BACK" }); f.update({ type: "SELECT", kind: "photos" });
    const oldForward = f.history.state;
    f.history.go(-1); assert.equal(f.flow().screen, "welcome");
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
    const previous = f.history.state;
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
    f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "FORM_STATE", kind: "note", state: { pending: true } });
    const before = f.flow(); f.pop(f.history.state);
    assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.deepEqual(f.movements, []);
  } finally { f.recording.dispose(); }
});

test("each welcome history entry restores its own copied choice and viewport before navigation", () => {
  let view = { kind: "photos", scrollY: 780, showOpening: false };
  const restored = [], navigationCounts = [];
  const f = fixture({
    getHomeView: () => view,
    restoreHomeView(next) {
      restored.push({ ...next });
      navigationCounts.push(f.navigations.length);
      view = next;
    },
  });
  try {
    f.update({ type: "SELECT", kind: "photos" });
    f.update({ type: "FORM_STATE", kind: "photos", state: { hasDraft: true } });
    f.update({ type: "BACK" });
    // Mutating the same App ref for another selection must not change the first entry.
    Object.assign(view, { kind: "note", scrollY: 1040 });
    f.update({ type: "SELECT", kind: "note" });
    f.update({ type: "FORM_STATE", kind: "note", state: { hasDraft: true } });
    f.update({ type: "BACK" });
    Object.assign(view, { kind: "audio", scrollY: 1320 });
    f.update({ type: "SELECT", kind: "audio" });
    const forms = f.flow().forms, started = f.flow().started, writes = f.writes.length;

    f.history.go(-3);
    assert.equal(f.flow().screen, "welcome");
    assert.deepEqual(view, { kind: "note", scrollY: 1040, showOpening: false });
    f.history.go(-2); // Welcome to an older welcome entry, without a screen change.
    assert.equal(f.flow().screen, "welcome");
    assert.deepEqual(view, { kind: "photos", scrollY: 780, showOpening: false });
    f.history.go(2);
    assert.deepEqual(view, { kind: "note", scrollY: 1040, showOpening: false });
    f.history.go(2);
    assert.deepEqual(view, { kind: "audio", scrollY: 1320, showOpening: false });
    assert.deepEqual(restored, [
      { kind: "note", scrollY: 1040, showOpening: false },
      { kind: "photos", scrollY: 780, showOpening: false },
      { kind: "note", scrollY: 1040, showOpening: false },
      { kind: "audio", scrollY: 1320, showOpening: false },
    ]);
    assert.deepEqual(navigationCounts, [0, 1, 2, 3], "view metadata is restored before dispatching each home navigation");
    assert.equal(f.flow().forms, forms); assert.equal(f.flow().started, started);
    assert.equal(f.flow().forms.photos.hasDraft, true); assert.equal(f.flow().forms.note.hasDraft, true);
    assert.equal(f.writes.length, writes);
  } finally { f.recording.dispose(); }
});

for (const kind of ["note", "photos", "audio"]) {
  test(`${kind} confirmed finish retains its gallery destination and live viewport across browser navigation`, () => {
    let view = { kind, scrollY: 780, showOpening: false };
    const f = fixture({ getHomeView: () => view, restoreHomeView(next) { view = next; } });
    try {
      const otherKind = kind === "note" ? "photos" : "note";
      f.update({ type: "FORM_STATE", kind: otherKind, state: { hasDraft: true } });
      const otherDraft = f.flow().forms[otherKind];
      f.update({ type: "SELECT", kind });
      f.update({ type: "FORM_STATE", kind, state: { complete: true } });
      view = { kind, scrollY: null, showOpening: false, target: "gallery" };
      f.update({ type: "FINISHED", kind });
      assert.equal(f.flow().screen, "welcome");
      assert.deepEqual(f.flow().forms[kind], {
        busy: false, capturing: false, pending: false, hasDraft: false, complete: false,
      });
      assert.equal(f.flow().forms[otherKind], otherDraft, "finishing preserves another form's draft");
      const forms = f.flow().forms, started = f.flow().started, writes = f.writes.length;

      // The direct return scrolls to the gallery; history captures that live viewport on departure.
      view.scrollY = 1400;
      f.history.go(-1);
      assert.equal(f.flow().screen, kind);
      Object.assign(view, { target: "unrecognized", scrollY: 25 });
      f.history.go(1);
      assert.deepEqual(view, { kind, scrollY: 1400, showOpening: false, target: "gallery" });

      // After scrolling farther on home, another traversal must restore the newer position.
      view.scrollY = 2120;
      f.history.go(-1);
      delete view.target;
      view.scrollY = 0;
      f.history.go(1);
      assert.deepEqual(view, { kind, scrollY: 2120, showOpening: false, target: "gallery" },
        "mutating a returned copy on the form cannot change its stored home entry");
      assert.equal(f.flow().forms, forms);
      assert.equal(f.flow().started, started);
      assert.equal(f.flow().forms[kind].complete, false, "history cannot resurrect the confirmed receipt");
      assert.equal(f.writes.length, writes, "traversal does not add replacement home entries");
      for (const entry of f.entries) assert.deepEqual(Object.keys(entry), ["owner", "key", "index"]);
      assert.doesNotMatch(JSON.stringify(f.entries), /gallery|target|homeView|scrollY/);
    } finally { f.recording.dispose(); }
  });
}

test("home metadata discards absent or unrecognized destinations while preserving its supported fields", () => {
  for (const target of [undefined, null, "Gallery", "sharing", "#couple-gallery", true, {}]) {
    let view = { kind: "photos", scrollY: 780, showOpening: false, target, receipt: "private" };
    const f = fixture({ getHomeView: () => view, restoreHomeView(next) { view = next; } });
    try {
      f.update({ type: "SELECT", kind: "photos" });
      f.history.go(-1);
      assert.deepEqual(view, { kind: "photos", scrollY: 780, showOpening: false });
      assert.equal(Object.hasOwn(view, "target"), false);
    } finally { f.recording.dispose(); }
  }
});

test("opening fallback survives browser Back and Forward and restored objects cannot mutate stored entries", () => {
  let view = { kind: "photos", scrollY: 780, showOpening: false };
  const f = fixture({ getHomeView: () => view, restoreHomeView(next) { view = next; } });
  try {
    f.update({ type: "SELECT", kind: "photos" });
    f.update({ type: "FORM_STATE", kind: "photos", state: { complete: true } });
    Object.assign(view, { scrollY: 0, showOpening: true });
    f.update({ type: "FINISHED", kind: "photos" });
    f.history.go(-1);
    assert.equal(f.flow().screen, "photos");
    Object.assign(view, { kind: "note", scrollY: 999, showOpening: false });
    f.history.go(1);
    assert.equal(f.flow().screen, "welcome");
    assert.deepEqual(view, { kind: "photos", scrollY: 0, showOpening: true });
    f.history.go(-1);
    // App can reuse and mutate the restored ref while another entry is active.
    Object.assign(view, { kind: "audio", scrollY: 1111, showOpening: false });
    f.history.go(1);
    assert.deepEqual(view, { kind: "photos", scrollY: 0, showOpening: true });
    assert.equal(f.flow().forms.photos.complete, false, "revisiting history cannot undo the confirmed reset");
  } finally { f.recording.dispose(); }
});

test("locked, malformed, current and foreign pops do not capture or restore home metadata", () => {
  const view = { kind: "photos", scrollY: 780, showOpening: false, target: "gallery" };
  let captures = 0, restores = 0;
  const f = fixture({
    getHomeView() { captures++; return view; },
    restoreHomeView() { restores++; },
  });
  try {
    const welcome = f.history.state;
    f.update({ type: "SELECT", kind: "photos" });
    f.update({ type: "FORM_STATE", kind: "photos", state: { pending: true } });
    const baseline = captures;
    f.pop(f.history.state);
    f.pop({ ...welcome, index: 999 });
    f.pop({ ...welcome, owner: "foreign-owner" });
    f.pop({ ...welcome, key: "unknown-key" });
    f.history.go(-1);
    assert.equal(f.flow().screen, "photos");
    assert.equal(captures, baseline); assert.equal(restores, 0);
    assert.deepEqual(f.movements, [-1, 1]);
    for (const entry of f.entries) assert.deepEqual(Object.keys(entry), ["owner", "key", "index"]);
    assert.doesNotMatch(JSON.stringify(f.entries), /homeView|kind|scrollY|showOpening|photos|target|gallery/);
  } finally { f.recording.dispose(); }
});

test("guest history owns manual viewport restoration while attached and restores the prior browser mode", () => {
  for (const previousMode of ["auto", "manual"]) {
    const f = fixture({ scrollRestoration: previousMode });
    try {
      assert.equal(f.history.scrollRestoration, "manual");
      f.update({ type: "SELECT", kind: "photos" });
      f.history.go(-1); f.history.go(1);
      assert.equal(f.history.scrollRestoration, "manual", "native scrolling cannot compete with guest view restoration");
    } finally { f.recording.dispose(); }
    assert.equal(f.history.scrollRestoration, previousMode);
  }
});

test("disposing guest history does not overwrite a newer owner's scroll restoration mode", () => {
  const f = fixture({ scrollRestoration: "manual" });
  f.history.scrollRestoration = "auto";
  f.recording.dispose();
  assert.equal(f.history.scrollRestoration, "auto", "a changed mode belongs to its newer owner");
});

test("repeated disposal cannot overwrite manual scrolling adopted by a later owner", () => {
  const f = fixture();
  f.recording.dispose();
  assert.equal(f.history.scrollRestoration, "auto");
  f.history.scrollRestoration = "manual";
  f.recording.dispose();
  assert.equal(f.history.scrollRestoration, "manual", "the first disposal relinquished ownership");
});

test("history writes only opaque ownership keys and disposal ignores old or foreign navigation", () => {
  const f = fixture();
  f.update({ type: "SELECT", kind: "note" });
  f.update({ type: "FORM_STATE", kind: "note", state: { hasDraft: true } });
  const entry = f.history.state, before = f.flow(), writes = f.writes.length;
  for (const value of [null, {}, { ...entry, owner: "foreign-owner" }, { ...entry, key: "unknown-key" }]) f.pop(value);
  assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []);
  for (const value of f.entries) assert.deepEqual(Object.keys(value), ["owner", "key", "index"]);
  assert.doesNotMatch(JSON.stringify(f.entries), /screen|forms|started|note|photos|audio|hasDraft|pending|csrf|message|file|receipt|retry|homeView|scrollY|showOpening/i);
  assert.deepEqual(f.writes.map(write => write.title), ["", ""]);
  assert.ok(f.writes.every(write => write.url.length === 0), "screen history does not change or embed data in the address");
  f.recording.dispose(); f.recording.dispose();
  f.recording.sync("photos"); f.pop(f.entries[0]); f.history.go(-1);
  assert.equal(f.flow(), before); assert.deepEqual(f.navigations, []); assert.equal(f.writes.length, writes);
});
