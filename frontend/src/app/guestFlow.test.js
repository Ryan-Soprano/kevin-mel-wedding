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

  test(`${kind}: resolved success permits Done or another type without stale draft flags`, () => {
    const flow = report(select(createGuestFlow(), kind), kind, { complete: true, hasDraft: true });
    assert.equal(navigationLocked(flow), false);
    assert.equal(hasUnfinishedWork(flow), false);
    for (const [type, screen] of [["FINISHED", "done"], ["ANOTHER", "choose"]]) {
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
