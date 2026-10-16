import assert from "node:assert/strict";
import test from "node:test";
import { createGuestFlow, guestFlowReducer, hasUnfinishedWork, navigationLocked } from "./guestFlow.js";

const kinds = ["note", "photos", "audio"];
const select = (flow, kind) => guestFlowReducer(flow, { type: "SELECT", kind });
const report = (flow, kind, state) => guestFlowReducer(flow, { type: "FORM_STATE", kind, state });

test("welcome choices open every enabled form directly without resetting form ownership", () => {
  for (const audioEnabled of [false, true]) {
    for (const kind of kinds) {
      const welcome = createGuestFlow({ audioEnabled });
      assert.equal(welcome.screen, "welcome");
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

test("Back from every form returns to welcome and preserves all started owners and editable drafts", () => {
  let flow = createGuestFlow({ audioEnabled: true });
  for (const kind of kinds) flow = report(select(flow, kind), kind, { hasDraft: true });
  const forms = flow.forms, started = flow.started;
  for (const kind of kinds) {
    const selected = select(flow, kind);
    flow = guestFlowReducer(selected, { type: "BACK" });
    assert.equal(flow.screen, "welcome");
    assert.equal(flow.forms, forms);
    assert.equal(flow.started, started);
    assert.deepEqual(started, kinds);
    for (const draft of kinds) assert.equal(flow.forms[draft].hasDraft, true);
    assert.equal(hasUnfinishedWork(flow), true);
  }
});

for (const kind of kinds) {
  test(`${kind}: busy and uncertain outcomes block back and cross-type navigation`, () => {
    for (const state of [{ busy: true }, { pending: true }, { busy: false, pending: true }]) {
      const flow = report(select(createGuestFlow({ audioEnabled: true }), kind), kind, state);
      assert.equal(navigationLocked(flow), true);
      for (const action of [
        { type: "BACK" },
        { type: "SELECT", kind: kind === "note" ? "photos" : "note" },
        ...["welcome", "done", ...kinds].map(screen => ({ type: "NAVIGATE", screen })),
      ]) assert.equal(guestFlowReducer(flow, action), flow);
      assert.equal(hasUnfinishedWork(flow), true);
    }
  });

  test(`${kind}: both confirmed success actions return home and reset only the active form`, () => {
    const otherKind = kind === "note" ? "photos" : "note";
    let flow = report(select(createGuestFlow({ audioEnabled: true }), otherKind), otherKind, { hasDraft: true });
    flow = report(select(flow, kind), kind, { complete: true, hasDraft: true });
    assert.equal(navigationLocked(flow), false);
    const started = flow.started, otherForm = flow.forms[otherKind];
    for (const type of ["FINISHED", "ANOTHER"]) {
      const next = guestFlowReducer(flow, { type, kind });
      assert.equal(next.screen, "welcome");
      assert.deepEqual(next.forms[kind], { busy: false, pending: false, hasDraft: false, complete: false });
      assert.equal(next.forms[otherKind], otherForm);
      assert.equal(next.forms[otherKind].hasDraft, true);
      assert.equal(next.started, started);
      assert.equal(select(next, kind).started, started);
      assert.equal(hasUnfinishedWork(next), true, "the other unsent draft retains its leave-page warning");
    }
    const savedOnly = report(select(createGuestFlow({ audioEnabled: true }), kind), kind, { complete: true, hasDraft: true });
    assert.equal(hasUnfinishedWork(savedOnly), false);
    assert.equal(hasUnfinishedWork(guestFlowReducer(savedOnly, { type: "FINISHED", kind })), false);
  });
}

test("same state reports are stable and inactive success callbacks cannot change the screen", () => {
  const flow = select(createGuestFlow(), "photos");
  assert.equal(report(flow, "photos", {}), flow);
  assert.equal(guestFlowReducer(flow, { type: "FINISHED", kind: "note" }), flow);
  assert.equal(guestFlowReducer(flow, { type: "ANOTHER", kind: "audio" }), flow);
});

test("history NAVIGATE preserves form ownership and flags while starting each newly visited form once", () => {
  let flow = report(select(createGuestFlow({ audioEnabled: true }), "note"), "note", { hasDraft: true });
  const forms = flow.forms, note = flow.forms.note;
  for (const screen of ["welcome", "photos", "welcome", "audio", "note", "done", "photos"]) {
    flow = guestFlowReducer(flow, { type: "NAVIGATE", screen });
    assert.equal(flow.screen, screen); assert.equal(flow.forms, forms); assert.equal(flow.forms.note, note);
    assert.equal(flow.forms.note.hasDraft, true); assert.equal(hasUnfinishedWork(flow), true);
  }
  assert.deepEqual(flow.started, kinds);
});

test("history NAVIGATE rejects the removed choices screen, unknown screens and disabled audio", () => {
  const flow = select(createGuestFlow(), "note");
  for (const screen of ["choose", "audio", "inbox", "review", "", null, undefined]) {
    assert.equal(guestFlowReducer(flow, { type: "NAVIGATE", screen }), flow);
  }
  assert.equal(guestFlowReducer(flow, { type: "CHOOSE" }), flow, "obsolete callbacks cannot reopen a second choices screen");
});

test("browser navigation back to a completed form does not reset its confirmation or owner", () => {
  for (const kind of kinds) {
    const saved = report(select(createGuestFlow({ audioEnabled: true }), kind), kind, { complete: true });
    const welcome = guestFlowReducer(saved, { type: "NAVIGATE", screen: "welcome" });
    const revisited = guestFlowReducer(welcome, { type: "NAVIGATE", screen: kind });
    assert.equal(revisited.forms, saved.forms); assert.equal(revisited.forms[kind].complete, true);
    assert.equal(hasUnfinishedWork(revisited), false); assert.deepEqual(revisited.started, [kind]);
  }
});
