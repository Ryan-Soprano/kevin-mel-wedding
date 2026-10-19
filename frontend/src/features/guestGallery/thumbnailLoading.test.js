import test from "node:test";
import assert from "node:assert/strict";
import { observeMorePhotos } from "./thumbnailLoading.js";

test("approaching the footer loads a batch without repeatedly loading while it stays visible", () => {
  const target = {};
  let notify;
  let loads = 0;
  let disconnects = 0;
  const stop = observeMorePhotos(target, () => loads++, {
    IntersectionObserverImpl: class {
      constructor(callback) { notify = callback; }
      observe(element) { assert.equal(element, target); }
      disconnect() { disconnects++; }
    },
  });

  notify([{ target, isIntersecting: false }]);
  assert.equal(loads, 0);
  notify([{ target, isIntersecting: true }]);
  assert.equal(loads, 1);
  notify([{ target, isIntersecting: true }]);
  notify([{ target, isIntersecting: true }]);
  assert.equal(loads, 1, "a continuously visible footer cannot drain the gallery");

  notify([{ target, isIntersecting: false }]);
  notify([{ target, isIntersecting: true }]);
  assert.equal(loads, 2, "scrolling to the next footer loads another batch");

  stop();
  assert.equal(disconnects, 1);
  notify([{ target, isIntersecting: false }, { target, isIntersecting: true }]);
  assert.equal(loads, 2, "a queued observation cannot load photos after leaving the grid");
});

test("manual loading remains available without an observer or automatic loading callback", () => {
  let loads = 0;
  const stop = observeMorePhotos({}, () => loads++, { IntersectionObserverImpl: undefined });
  stop();
  assert.equal(loads, 0);
  const unexpectedObserver = class {
    constructor() { assert.fail("an incomplete subscription must not create an observer"); }
  };
  observeMorePhotos(null, () => loads++, { IntersectionObserverImpl: unexpectedObserver })();
  observeMorePhotos({}, undefined, { IntersectionObserverImpl: unexpectedObserver })();
  assert.equal(loads, 0);
});

test("a focused manual control pauses passive loading without resetting the approach subscription", () => {
  const target = {};
  let notify, focused = true, loads = 0, observations = 0, disconnects = 0;
  const stop = observeMorePhotos(target, () => loads++, {
    shouldLoad: () => !focused,
    IntersectionObserverImpl: class {
      constructor(callback) { notify = callback; }
      observe(element) { assert.equal(element, target); observations++; }
      disconnect() { disconnects++; }
    },
  });
  notify([{ target, isIntersecting: true }]);
  assert.equal(loads, 0, "passive loading cannot remove the focused manual control");
  focused = false;
  notify([{ target, isIntersecting: true }]);
  assert.equal(loads, 0, "a paused approach remains consumed while the footer stays visible");
  notify([{ target, isIntersecting: false }, { target, isIntersecting: true }]);
  assert.equal(loads, 1, "a later approach can load once focus has left the manual control");
  focused = true;
  notify([{ target, isIntersecting: false }, { target, isIntersecting: true }]);
  assert.equal(loads, 1);
  assert.equal(observations, 1, "changing focus does not create a new subscription");
  stop();
  focused = false;
  notify([{ target, isIntersecting: false }, { target, isIntersecting: true }]);
  assert.equal(loads, 1, "cleanup blocks late observations even after focus changes");
  assert.equal(disconnects, 1);
});
