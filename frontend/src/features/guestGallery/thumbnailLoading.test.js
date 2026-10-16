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
