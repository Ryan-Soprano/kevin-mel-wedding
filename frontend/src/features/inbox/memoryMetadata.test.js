import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemoryMetadata, validMemoryDate } from "./memoryMetadata.js";

test("partial dates preserve their stated precision and validate Gregorian boundaries without adding a day", () => {
  for (const [value, precision] of [[null, "UNKNOWN"], ["0001", "YEAR"], ["9999-12", "MONTH"], ["2000-02-29", "DAY"], ["2024-02-29", "DAY"]]) {
    assert.equal(validMemoryDate(value, precision), true);
    const result = normalizeMemoryMetadata({ title: " Title ", description: " ", memoryDate: value, datePrecision: precision });
    assert.deepEqual(result, { title: "Title", description: null, memoryDate: value, datePrecision: precision });
  }
  for (const [value, precision] of [["0000", "YEAR"], ["2024-13", "MONTH"], ["1900-02-29", "DAY"], ["2024-04-31", "DAY"], ["2024-6", "MONTH"], ["2024", "DAY"], [null, "DAY"], ["2024", "UNKNOWN"], ["2024", "toString"]]) assert.equal(validMemoryDate(value, precision), false);
});

test("metadata validates raw limits, Unicode and exact fields before normalization or network", () => {
  const valid = { title: null, description: null, memoryDate: null, datePrecision: "UNKNOWN" };
  for (const extra of [{ title: " ".repeat(201) }, { description: "x".repeat(2001) }, { title: "\u0000" }, { description: "\ud800" }, { source: "COUPLE" }]) assert.throws(() => normalizeMemoryMetadata({ ...valid, ...extra }), { code: "VALIDATION_FAILED" });
  assert.throws(() => normalizeMemoryMetadata({ title: null, description: null, datePrecision: "UNKNOWN" }), { code: "VALIDATION_FAILED" });
  assert.equal(normalizeMemoryMetadata({ ...valid, title: "x".repeat(200), description: "x".repeat(2000) }).description.length, 2000);
});
