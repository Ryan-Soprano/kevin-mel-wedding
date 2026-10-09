import assert from "node:assert/strict";
import test from "node:test";
import { memoryTime } from "./memoryDisplay.js";

test("archive timestamps use the wedding timezone across UTC date and daylight-saving boundaries", () => {
  assert.equal(memoryTime("2026-10-25T02:30:00Z"), "Oct 24, 2026, 9:30 PM CDT");
  assert.equal(memoryTime("2026-11-01T06:30:00Z"), "Nov 1, 2026, 1:30 AM CDT");
  assert.equal(memoryTime("2026-11-01T07:30:00Z"), "Nov 1, 2026, 1:30 AM CST");
});
