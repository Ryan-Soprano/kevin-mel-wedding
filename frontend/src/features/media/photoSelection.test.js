import test from "node:test";
import assert from "node:assert/strict";
import { addPhotoSelection, addPhotoSelectionWithFeedback, removePhotoSelection } from "./photoSelection.js";
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

test("mixed picker additions retain valid original files and report each skipped file", () => {
  const original = photo("already-selected.png");
  const current = [{ id: "retained", file: original, caption: "Keep this caption" }];
  const valid = photo("another.png");
  const empty = photo("empty.png", "image/png", 0);
  const oversized = photo("large.png", "image/png", MAX_PHOTO_BYTES + 1);
  let allocations = 0;
  const next = addPhotoSelectionWithFeedback(current, [photo("phone.heic", "image/heic"), valid, empty, oversized],
    () => `added-${++allocations}`);

  assert.equal(next.addedCount, 1);
  assert.equal(allocations, 1);
  assert.equal(next.photos.length, 2);
  assert.equal(next.photos[0], current[0]);
  assert.equal(next.photos[0].file, original);
  assert.equal(next.photos[0].caption, "Keep this caption");
  assert.equal(next.photos[1].file, valid);
  assert.equal(next.photos[1].id, "added-1");
  assert.deepEqual(next.rejections.map(rejection => rejection.fileName), ["phone.heic", "empty.png", "large.png"]);
  assert.match(next.rejections[0].reason, /copy to JPEG or PNG and keep your original/);
  assert.match(next.rejections[1].reason, /empty/);
  assert.match(next.rejections[2].reason, /larger than 10 MB/);
  assert.equal(current.length, 1);
});

test("picker additions fill remaining spaces in order without letting invalid files use a space", () => {
  const createId = ids();
  const current = addPhotoSelection([], [photo(), photo(), photo()], createId);
  const first = photo("first.png", "image/png", MAX_PHOTO_BYTES);
  const second = photo("second.png");
  const next = addPhotoSelectionWithFeedback(current,
    [first, photo("unsupported.heif", "image/heif"), second, photo("sixth.png")], createId);

  assert.equal(next.photos.length, 5);
  assert.equal(next.addedCount, 2);
  assert.equal(next.photos[3].file, first);
  assert.equal(next.photos[4].file, second);
  assert.deepEqual(next.photos.slice(0, 3), current);
  assert.deepEqual(next.rejections.map(rejection => rejection.fileName), ["unsupported.heif", "sixth.png"]);
  assert.match(next.rejections[1].reason, /up to 5 photos/);
});

test("invalid-only or full picker additions retain selection identity and allocate no IDs", () => {
  const createId = ids();
  const current = addPhotoSelection([], [photo(), photo(), photo(), photo(), photo()], createId);
  let allocations = 0;
  const nextId = () => { allocations++; return "unused"; };
  const invalid = addPhotoSelectionWithFeedback(current, [null, photo("empty.png", "image/png", 0)], nextId);
  const full = addPhotoSelectionWithFeedback(current, [photo("over-limit.png")], nextId);
  const canceled = addPhotoSelectionWithFeedback(current, [], nextId);

  for (const result of [invalid, full, canceled]) {
    assert.equal(result.photos, current);
    assert.equal(result.addedCount, 0);
  }
  assert.equal(invalid.rejections.length, 2);
  assert.equal(full.rejections.length, 1);
  assert.deepEqual(canceled.rejections, []);
  assert.equal(allocations, 0);
});

test("a picker identity failure cannot partially change retained originals", () => {
  const current = [{ id: "retained", file: photo(), caption: "Keep this caption" }];
  assert.throws(() => addPhotoSelectionWithFeedback(current, [photo(), photo()], () => "duplicate"), /identify/);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, "retained");
  assert.equal(current[0].caption, "Keep this caption");
});
