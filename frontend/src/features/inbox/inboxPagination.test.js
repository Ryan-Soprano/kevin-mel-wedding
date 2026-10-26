import test from "node:test";
import assert from "node:assert/strict";
import { inboxPageNumbers, rememberInboxPages } from "./inboxPagination.js";

test("numbered inbox pages retain discovered forward cursors and remove changed or ended branches", () => {
  const known = [null, "page-two", "page-three", "page-four"];
  assert.equal(rememberInboxPages(known, [null], "page-two"), known);
  assert.equal(rememberInboxPages(known, [null, "page-two"]), known, "an attempted page retains the other direct destinations");
  assert.deepEqual(rememberInboxPages(known, [null, "page-two"], "new-three"), [null, "page-two", "new-three"]);
  assert.deepEqual(rememberInboxPages(known, [null, "page-two"], null), [null, "page-two"]);
  assert.deepEqual(rememberInboxPages(known, [null, "other-filter"], "other-next"), [null, "other-filter", "other-next"]);
  assert.deepEqual(rememberInboxPages([null], [null, "restored-two", "restored-three"], "restored-four"),
    [null, "restored-two", "restored-three", "restored-four"]);
});

test("page number windows retain direct first, current, adjacent and last destinations", () => {
  assert.deepEqual(inboxPageNumbers(1, 1), [1]);
  assert.deepEqual(inboxPageNumbers(3, 2), [1, 2, 3]);
  assert.deepEqual(inboxPageNumbers(30, 15), [1, "gap-13", 13, 14, 15, 16, 17, "gap-30", 30]);
  assert.deepEqual(inboxPageNumbers(30, 1), [1, 2, 3, "gap-30", 30]);
  assert.deepEqual(inboxPageNumbers(30, 30), [1, "gap-28", 28, 29, 30]);
});
