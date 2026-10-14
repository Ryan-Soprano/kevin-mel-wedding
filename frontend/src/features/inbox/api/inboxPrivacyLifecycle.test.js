import test from "node:test";
import assert from "node:assert/strict";
import { attachInboxPrivacyLifecycle } from "./inboxPrivacyLifecycle.js";

function fixture() {
  const eventTarget = new EventTarget(), documentTarget = new EventTarget(), calls = [];
  const presentation = { username: "Kevin", password: "copied-password", page: 2, memoryId: "current-memory" };
  let dialog = false;
  documentTarget.visibilityState = "visible";
  const detach = attachInboxPrivacyLifecycle({ eventTarget, documentTarget,
    controller: { suspend: () => calls.push("suspend"), resume: () => calls.push("resume"), recheckSession: () => calls.push("check session") },
    isIntentionalDialog: () => dialog, onDialogEnd: () => { dialog = false; },
    onPause: () => calls.push("pause audio"),
    onHide: () => { calls.push("clear presentation"); for (const key of Object.keys(presentation)) presentation[key] = null; },
    flush: callback => { calls.push("flush start"); callback(); calls.push("flush end"); },
  });
  return { eventTarget, documentTarget, calls, presentation, detach, openDialog: () => { dialog = true; }, isDialogOpen: () => dialog };
}

for (const event of ["blur", "visibilitychange"]) {
  test(`${event} preserves login fields and the current view while switching away`, () => {
    const f = fixture(), before = { ...f.presentation };
    if (event === "visibilitychange") f.documentTarget.visibilityState = "hidden";
    (event === "visibilitychange" ? f.documentTarget : f.eventTarget).dispatchEvent(new Event(event));
    assert.deepEqual(f.calls, ["pause audio"]);
    assert.deepEqual(f.presentation, before, "copying a password or changing tabs does not reset the form or navigation");
    f.documentTarget.visibilityState = "visible";
    f.eventTarget.dispatchEvent(new Event("focus"));
    assert.deepEqual(f.calls, ["pause audio", "resume", "check session"]);
    assert.deepEqual(f.presentation, before);
    f.detach();
  });
}

test("pagehide clears private presentation synchronously; hidden return events cannot repopulate it", () => {
  const f = fixture();
  f.eventTarget.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(f.calls, ["flush start", "clear presentation", "suspend", "flush end"]);
  assert.ok(Object.values(f.presentation).every(value => value === null));
  f.documentTarget.visibilityState = "hidden";
  f.eventTarget.dispatchEvent(new Event("pageshow")); f.eventTarget.dispatchEvent(new Event("focus"));
  assert.equal(f.calls.length, 4);
  f.documentTarget.visibilityState = "visible";
  f.eventTarget.dispatchEvent(new Event("pageshow"));
  assert.deepEqual(f.calls.slice(4), ["resume", "check session"]);
  f.detach();
  const before = f.calls.length;
  for (const name of ["pagehide", "blur", "pageshow", "focus"]) f.eventTarget.dispatchEvent(new Event(name));
  f.documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.calls.length, before, "unmounted inbox owns no lifecycle listeners");
});

test("native chooser blur is scoped while pagehide still clears content", () => {
  const f = fixture(); f.openDialog();
  f.eventTarget.dispatchEvent(new Event("blur")); assert.deepEqual(f.calls, []);
  f.eventTarget.dispatchEvent(new Event("focus")); assert.equal(f.isDialogOpen(), false);
  f.eventTarget.dispatchEvent(new Event("blur")); assert.equal(f.calls.at(-1), "pause audio");
  f.openDialog(); f.eventTarget.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(f.calls.slice(-4), ["flush start", "clear presentation", "suspend", "flush end"]);
  f.detach();
});
