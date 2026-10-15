import assert from "node:assert/strict";
import test from "node:test";
import { createGuestFlow, guestFlowReducer, hasUnfinishedWork, navigationLocked } from "./guestFlow.js";

const select = (flow, kind) => guestFlowReducer(flow, { type: "SELECT", kind });
const report = (flow, kind, state) => guestFlowReducer(flow, { type: "FORM_STATE", kind, state });

test("the invitation leads to an implemented memory type; unavailable choices cannot open", () => {
  const welcome = createGuestFlow();
  assert.equal(welcome.screen, "welcome");
  const choice = guestFlowReducer(welcome, { type: "CHOOSE" });
  assert.equal(choice.screen, "choose");
  assert.equal(select(choice, "audio"), choice);
  assert.equal(select(choice, "photos").screen, "photos");
});

test("welcome choices open every enabled form directly without resetting form ownership", () => {
  for (const audioEnabled of [false, true]) {
    for (const kind of ["note", "photos", "audio"]) {
      const welcome = createGuestFlow({ audioEnabled });
      const selected = select(welcome, kind);
      if (kind === "audio" && !audioEnabled) {
        assert.equal(selected, welcome);
        assert.deepEqual(selected.started, []);
        continue;
      }
      assert.equal(selected.screen, kind);
      assert.equal(selected.forms, welcome.forms);
      assert.deepEqual(selected.started, [kind]);
      assert.equal(select(selected, kind).started, selected.started);
      assert.equal(hasUnfinishedWork(selected), false);
    }
  }
});

test("back and switching types preserve every started form and editable draft", () => {
  let flow = select(createGuestFlow(), "note");
  flow = report(flow, "note", { hasDraft: true });
  flow = guestFlowReducer(flow, { type: "BACK" });
  assert.equal(flow.screen, "choose");
  flow = select(flow, "photos");
  flow = report(flow, "photos", { hasDraft: true });
  flow = select(flow, "note");
  assert.deepEqual(flow.started, ["note", "photos"]);
  assert.equal(flow.forms.note.hasDraft, true);
  assert.equal(flow.forms.photos.hasDraft, true);
  assert.equal(hasUnfinishedWork(flow), true);
});

for (const kind of ["note", "photos"]) {
  test(`${kind}: busy and uncertain outcomes block back and cross-type navigation`, () => {
    for (const state of [{ busy: true }, { pending: true }, { busy: false, pending: true }]) {
      const flow = report(select(createGuestFlow(), kind), kind, state);
      assert.equal(navigationLocked(flow), true);
      for (const action of [{ type: "BACK" }, { type: "CHOOSE" }, { type: "SELECT", kind: kind === "note" ? "photos" : "note" }]) {
        assert.equal(guestFlowReducer(flow, action), flow);
      }
      assert.equal(hasUnfinishedWork(flow), true);
    }
  });

  test(`${kind}: confirmed success returns to photos or another type without stale draft flags`, () => {
    const flow = report(select(createGuestFlow(), kind), kind, { complete: true, hasDraft: true });
    assert.equal(navigationLocked(flow), false);
    assert.equal(hasUnfinishedWork(flow), false);
    for (const [type, screen] of [["FINISHED", "welcome"], ["ANOTHER", "choose"]]) {
      const next = guestFlowReducer(flow, { type, kind });
      assert.equal(next.screen, screen);
      assert.equal(next.forms[kind].hasDraft, false);
      assert.deepEqual(next.started, [kind]);
      assert.equal(select(next, kind).started.length, 1);
    }
  });
}

test("same state reports are stable and inactive success callbacks cannot change the screen", () => {
  const flow = select(createGuestFlow(), "photos");
  assert.equal(report(flow, "photos", {}), flow);
  assert.equal(guestFlowReducer(flow, { type: "FINISHED", kind: "note" }), flow);
  assert.equal(guestFlowReducer(flow, { type: "ANOTHER", kind: "audio" }), flow);
});

test("finishing one type retains the other unsent draft and its leave-page warning", () => {
  let flow = report(select(createGuestFlow(), "note"), "note", { hasDraft: true });
  flow = report(select(flow, "photos"), "photos", { complete: true });
  flow = guestFlowReducer(flow, { type: "FINISHED", kind: "photos" });
  assert.equal(hasUnfinishedWork(flow), true);
  assert.equal(flow.forms.note.hasDraft, true);
});

test("enabled audio preserves its stopped draft and locks navigation during recording or uncertain confirmation", () => {
  let flow = select(createGuestFlow({ audioEnabled: true }), "audio");
  assert.equal(flow.screen, "audio");
  flow = report(flow, "audio", { hasDraft: true });
  const choices = guestFlowReducer(flow, { type: "BACK" });
  assert.equal(choices.forms.audio.hasDraft, true); assert.deepEqual(choices.started, ["audio"]);
  for (const state of [{ busy: true }, { pending: true }]) {
    const locked = report(flow, "audio", state);
    assert.equal(navigationLocked(locked), true);
    assert.equal(guestFlowReducer(locked, { type: "BACK" }), locked);
    assert.equal(select(locked, "note"), locked);
  }
  const saved = report(flow, "audio", { complete: true, hasDraft: true });
  assert.equal(hasUnfinishedWork(saved), false);
  assert.equal(guestFlowReducer(saved, { type: "FINISHED", kind: "audio" }).screen, "welcome");
});

test("history NAVIGATE preserves form ownership and flags while starting each newly visited form once", () => {
  let flow = report(select(createGuestFlow({ audioEnabled: true }), "note"), "note", { hasDraft: true });
  const forms = flow.forms, note = flow.forms.note;
  for (const screen of ["choose", "photos", "welcome", "audio", "note", "done", "photos"]) {
    flow = guestFlowReducer(flow, { type: "NAVIGATE", screen });
    assert.equal(flow.screen, screen); assert.equal(flow.forms, forms); assert.equal(flow.forms.note, note);
    assert.equal(flow.forms.note.hasDraft, true); assert.equal(hasUnfinishedWork(flow), true);
  }
  assert.deepEqual(flow.started, ["note", "photos", "audio"]);
});

test("history NAVIGATE rejects unknown screens and disabled audio without changing ownership", () => {
  const flow = select(createGuestFlow(), "note");
  for (const screen of ["audio", "inbox", "review", "", null, undefined]) {
    assert.equal(guestFlowReducer(flow, { type: "NAVIGATE", screen }), flow);
  }
});

test("history NAVIGATE cannot leave a busy or unconfirmed form or reset a completed form", () => {
  for (const kind of ["note", "photos", "audio"]) {
    for (const state of [{ busy: true }, { pending: true }]) {
      const flow = report(select(createGuestFlow({ audioEnabled: true }), kind), kind, state);
      for (const screen of ["welcome", "choose", "done", "note", "photos", "audio"]) {
        assert.equal(guestFlowReducer(flow, { type: "NAVIGATE", screen }), flow);
      }
    }
    const saved = report(select(createGuestFlow({ audioEnabled: true }), kind), kind, { complete: true });
    const choices = guestFlowReducer(saved, { type: "NAVIGATE", screen: "choose" });
    const revisited = guestFlowReducer(choices, { type: "NAVIGATE", screen: kind });
    assert.equal(revisited.forms, saved.forms); assert.equal(revisited.forms[kind].complete, true);
    assert.equal(hasUnfinishedWork(revisited), false); assert.deepEqual(revisited.started, [kind]);
  }
});
