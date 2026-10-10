import test from "node:test";
import assert from "node:assert/strict";
import { attachInboxPrivacyLifecycle } from "./inboxPrivacyLifecycle.js";

test("intentional native-dialog blur is scoped; pagehide and hidden visibility always clear private content", () => {
  const eventTarget = new EventTarget(), documentTarget = new EventTarget(), calls = [];
  let dialog = true;
  documentTarget.visibilityState = "visible";
  const detach = attachInboxPrivacyLifecycle({ eventTarget, documentTarget,
    controller: { suspend: () => calls.push("hide"), resume: () => calls.push("check") },
    isIntentionalDialog: () => dialog, onDialogEnd: () => { dialog = false; },
  });
  eventTarget.dispatchEvent(new Event("blur")); assert.deepEqual(calls, []);
  eventTarget.dispatchEvent(new Event("pagehide")); assert.deepEqual(calls, ["hide"]);
  documentTarget.visibilityState = "hidden"; documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(calls, ["hide", "hide"]);
  documentTarget.visibilityState = "visible"; eventTarget.dispatchEvent(new Event("focus"));
  assert.equal(dialog, false); eventTarget.dispatchEvent(new Event("blur"));
  assert.deepEqual(calls, ["hide", "hide", "check", "hide"]); detach();
});

for (const event of ["pagehide", "blur", "visibilitychange"]) {
  test(`${event} synchronously clears presentation and credentials; return events only restore a visible page`, () => {
    const eventTarget = new EventTarget(), documentTarget = new EventTarget(), calls = [];
    documentTarget.visibilityState = "visible";
    const detach = attachInboxPrivacyLifecycle({ eventTarget, documentTarget,
      controller: { suspend: () => calls.push("hide"), resume: () => { calls.push("check session"); return Promise.resolve(); } },
      onHide: () => calls.push("clear credentials"), flush: callback => { calls.push("flush start"); callback(); calls.push("flush end"); },
    });
    if (event === "visibilitychange") documentTarget.visibilityState = "hidden";
    (event === "visibilitychange" ? documentTarget : eventTarget).dispatchEvent(new Event(event));
    assert.deepEqual(calls, ["flush start", "clear credentials", "hide", "flush end"]);
    documentTarget.visibilityState = "hidden";
    eventTarget.dispatchEvent(new Event("pageshow")); eventTarget.dispatchEvent(new Event("focus"));
    assert.equal(calls.length, 4, "a background page cannot recheck or repopulate content");
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    eventTarget.dispatchEvent(new Event("pageshow")); eventTarget.dispatchEvent(new Event("focus"));
    assert.deepEqual(calls.slice(4), ["check session", "check session", "check session"]);
    detach();
    const before = calls.length;
    for (const name of ["pagehide", "blur", "pageshow", "focus"]) eventTarget.dispatchEvent(new Event(name));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls.length, before, "unmounted inbox owns no lifecycle listeners");
  });
}
