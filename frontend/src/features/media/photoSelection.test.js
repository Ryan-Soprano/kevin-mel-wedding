import test from "node:test";
import assert from "node:assert/strict";
import { addPhotoSelection, removePhotoSelection } from "./photoSelection.js";
import { MAX_PHOTO_BYTES } from "./mediaConstraints.js";

const photo = (name = "original.png", type = "image/png", size = 3) =>
  new File([new Uint8Array(size)], name, { type });
const ids = () => {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
};

test("a rejected addition preserves original files, captions and IDs without allocating new IDs", () => {
  const original = photo();
  const current = [{ id: "retained", file: original, caption: "Keep this caption" }];
  let allocations = 0;
  assert.throws(() => addPhotoSelection(current, [photo(), photo("phone.heic", "image/heic")],
    () => { allocations++; return "new"; }), /No photos/);
  assert.throws(() => addPhotoSelection(current, [null],
    () => { allocations++; return "new"; }), /No photos/);
  assert.equal(allocations, 0);
  assert.equal(current.length, 1);
  assert.equal(current[0].file, original);
  assert.equal(current[0].caption, "Keep this caption");
});

test("five photos and exact byte limit are accepted; a sixth or one-byte overflow is rejected atomically", () => {
  const createId = ids();
  const current = addPhotoSelection([], [photo("boundary.png", "image/png", MAX_PHOTO_BYTES)], createId);
  const five = addPhotoSelection(current, [photo(), photo(), photo(), photo()], createId);
  assert.equal(five.length, 5);
  assert.throws(() => addPhotoSelection(five, [photo()], createId), /up to 5/);
  assert.throws(() => addPhotoSelection(current, [photo("too-big.png", "image/png", MAX_PHOTO_BYTES + 1)], createId), /No photos/);
  assert.throws(() => addPhotoSelection(current, [photo("empty.png", "image/png", 0)], createId), /non-empty/);
});

test("adding and selective removal retain surviving identity and original bytes, including duplicate filenames", () => {
  const createId = ids();
  const sameFile = photo();
  const initial = addPhotoSelection([], [sameFile, sameFile], createId);
  assert.notEqual(initial[0].id, initial[1].id);
  initial[1].caption = "Second selection";
  const added = addPhotoSelection(initial, [photo()], createId);
  const remaining = removePhotoSelection(added, new Set([initial[0].id]));
  assert.equal(remaining[0], initial[1]);
  assert.equal(remaining[0].file, sameFile);
  assert.equal(remaining[0].caption, "Second selection");
  assert.equal(remaining[1], added[2]);
  assert.equal(addPhotoSelection(remaining, [], createId), remaining);
});

test("a colliding generated ID cannot replace an existing selection", () => {
  const current = [{ id: "same", file: photo(), caption: "" }];
  assert.throws(() => addPhotoSelection(current, [photo()], () => "same"), /identify/);
  assert.equal(current.length, 1);
});
