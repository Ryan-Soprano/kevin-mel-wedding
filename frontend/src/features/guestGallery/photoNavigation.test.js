import test from "node:test";
import assert from "node:assert/strict";
import { decodeGalleryImage, initialPhotoNavigation, isActivePhotoRequest, photoNavigation } from "./photoNavigation.js";

const update = (state, action) => photoNavigation(state, { total: 3, ...action });
const loadedFirst = () => update(initialPhotoNavigation(), { type: "ready", key: 0 });

test("slow automatic image keeps the displayed photo and counter until ready without skipping", () => {
  let state = loadedFirst();
  state = update(state, { type: "move", direction: 1, automatic: true });
  const requested = state.pending.key;
  assert.equal(state.index, 0);
  assert.equal(state.key, 0);
  assert.equal(state.pending.index, 1);
  // Even if another timer tick arrives before React cleans up the interval.
  assert.equal(update(state, { type: "move", direction: 1, automatic: true }), state);
  state = update(state, { type: "ready", key: requested });
  assert.equal(state.index, 1);
  assert.equal(state.key, requested, "promote the staged image's existing DOM key");
  assert.equal(state.pending, null);
});

test("new manual navigation supersedes a load and ignores its late success or failure", () => {
  let state = update(loadedFirst(), { type: "move", direction: 1 });
  const obsolete = state.pending.key;
  state = update(state, { type: "move", direction: 1 });
  assert.equal(state.pending.index, 2);
  assert.equal(isActivePhotoRequest(state, obsolete), false, "a stale failure must not pause a newer request");
  assert.equal(isActivePhotoRequest(state, state.pending.key), true);
  assert.equal(isActivePhotoRequest(state, state.key), true);
  assert.equal(update(state, { type: "ready", key: obsolete }), state);
  assert.equal(update(state, { type: "failed", key: obsolete }), state);
  state = update(state, { type: "ready", key: state.pending.key });
  assert.equal(state.index, 2);
});

test("a current image that recovers clears its own error, while another requested image's error stays", () => {
  let state = update(loadedFirst(), { type: "failed", key: 0 });
  state = update(state, { type: "ready", key: 0 });
  assert.equal(state.ready, true);
  assert.equal(state.error, null);
  state = update(state, { type: "move", direction: 1 });
  state = update(state, { type: "failed", key: state.pending.key });
  const requestedError = state.error;
  state = update(state, { type: "ready", key: 0 });
  assert.equal(state.error, requestedError, "the old image loading again must not hide a failed next photo");
});

test("failed next image retains the last good image and can retry the exact requested photo", () => {
  let state = update(loadedFirst(), { type: "move", direction: 1, automatic: true });
  const failed = state.pending.key;
  state = update(state, { type: "failed", key: failed });
  assert.equal(state.index, 0);
  assert.equal(state.key, 0);
  assert.equal(state.ready, true);
  assert.equal(state.error.index, 1);
  assert.equal(update(state, { type: "move", direction: 1, automatic: true }), state);
  state = update(state, { type: "request", index: state.error.index });
  assert.notEqual(state.pending.key, failed);
  assert.equal(state.error, null);
  state = update(state, { type: "ready", key: state.pending.key });
  assert.equal(state.index, 1);
});

test("initial failure offers a new image request and never starts autoplay before readiness", () => {
  let state = initialPhotoNavigation();
  assert.equal(update(state, { type: "move", direction: 1, automatic: true }), state);
  state = update(state, { type: "failed", key: state.key });
  assert.equal(state.ready, false);
  state = update(state, { type: "request", index: state.error.index });
  assert.equal(state.pending.index, 0);
  assert.notEqual(state.pending.key, state.key);
  state = update(state, { type: "ready", key: state.pending.key });
  assert.equal(state.ready, true);
  assert.equal(state.error, null);
});

test("pausing cancels automatic loads without cancelling manual navigation", () => {
  let state = update(loadedFirst(), { type: "move", direction: 1, automatic: true });
  const cancelled = state.pending.key;
  state = update(state, { type: "cancelAutomatic" });
  assert.equal(state.pending, null);
  assert.equal(update(state, { type: "ready", key: cancelled }), state);
  state = update(state, { type: "move", direction: -1 });
  assert.equal(state.pending.index, 2);
  assert.equal(update(state, { type: "cancelAutomatic" }), state);
  state = update(state, { type: "cancel" });
  assert.equal(state.pending, null);
  assert.equal(state.index, 0);
});

test("image readiness waits for decode rather than only its network load", async () => {
  let finishDecode;
  const image = { complete: true, naturalWidth: 1120, decode: () => new Promise((resolve) => { finishDecode = resolve; }) };
  let ready = false;
  const loading = decodeGalleryImage(image).then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  finishDecode();
  await loading;
  assert.equal(ready, true);
});

test("broken or undecodable images fail readiness; older browsers can use a completed image", async () => {
  await assert.rejects(decodeGalleryImage({ complete: true, naturalWidth: 0 }));
  await assert.rejects(decodeGalleryImage({ complete: false, naturalWidth: 1120 }));
  await assert.rejects(decodeGalleryImage({ complete: true, naturalWidth: 1120, decode: async () => { throw new Error("Invalid image"); } }));
  await decodeGalleryImage({ complete: true, naturalWidth: 1120 });
});
