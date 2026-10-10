import { ApiError } from "../../shared/api/apiClient.js";

export const METADATA_FIELDS = Object.freeze(["title", "description", "memoryDate", "datePrecision"]);
const PATTERNS = { YEAR: /^\d{4}$/, MONTH: /^\d{4}-\d{2}$/, DAY: /^\d{4}-\d{2}-\d{2}$/ };

function validText(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

export function validMemoryDate(value, precision) {
  if (precision === "UNKNOWN") return value === null;
  if (typeof value !== "string" || !Object.hasOwn(PATTERNS, precision) || !PATTERNS[precision].test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || (month !== undefined && (month < 1 || month > 12))) return false;
  if (day === undefined) return true;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function normalizeMemoryMetadata(value) {
  const errors = [];
  const add = (field, message) => errors.push({ field, code: "INVALID_METADATA", message });
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 4 || METADATA_FIELDS.some(field => !Object.hasOwn(value, field))) {
    add("metadata", "Supply the title, description, date and date precision together.");
  }
  for (const [field, limit] of [["title", 200], ["description", 2000]]) {
    if (value?.[field] !== null && (typeof value?.[field] !== "string"
      || value[field].length > limit || !validText(value[field]))) add(field, `${field === "title" ? "Title" : "Description"} must be ${limit.toLocaleString()} characters or fewer.`);
  }
  if (!validMemoryDate(value?.memoryDate, value?.datePrecision)) {
    add("memoryDate", "Use a valid year, month or day matching the selected precision, or leave the date unknown.");
  }
  if (errors.length) throw new ApiError(errors[0].message, { code: "VALIDATION_FAILED", status: 400, fieldErrors: errors });
  return { title: value.title?.trim() || null, description: value.description?.trim() || null,
    memoryDate: value.memoryDate, datePrecision: value.datePrecision };
}

export function metadataOf(memory) {
  return Object.fromEntries(METADATA_FIELDS.map(field => [field, memory[field]]));
}

export function sameMetadata(left, right) {
  return METADATA_FIELDS.every(field => left[field] === right[field]);
}
