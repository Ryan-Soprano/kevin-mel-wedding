import assert from "node:assert/strict";
import test from "node:test";
import { memoryTime } from "./memoryDisplay.js";

test("archive timestamps use Eastern time across UTC date and daylight-saving boundaries", () => {
  assert.equal(memoryTime("2026-10-25T02:30:00Z"), "Oct 24, 2026, 10:30 PM EDT");
  assert.equal(memoryTime("2026-11-01T05:30:00Z"), "Nov 1, 2026, 1:30 AM EDT");
  assert.equal(memoryTime("2026-11-01T06:30:00Z"), "Nov 1, 2026, 1:30 AM EST");
  assert.equal(memoryTime("2026-03-08T06:59:00Z"), "Mar 8, 2026, 1:59 AM EST");
  assert.equal(memoryTime("2026-03-08T07:00:00Z"), "Mar 8, 2026, 3:00 AM EDT");
});
