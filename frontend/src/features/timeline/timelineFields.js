import { ApiError } from "../../shared/api/apiClient.js";
import { normalizeMemoryMetadata, validMemoryDate } from "../inbox/memoryMetadata.js";

export const EVENT_FIELDS = Object.freeze(["title", "description", "eventDate", "datePrecision"]);
export const emptyEventFields = () => ({ title: "", description: null, eventDate: null, datePrecision: "UNKNOWN" });
export const eventFields = event => Object.fromEntries(EVENT_FIELDS.map(field => [field, event[field]]));
export function normalizeEventFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 4
    || EVENT_FIELDS.some(field => !Object.hasOwn(value, field))) {
    throw new ApiError("Supply the title, description, event date and precision together.", { status: 400, code: "VALIDATION_FAILED" });
  }
  const normalized = normalizeMemoryMetadata({ title: value.title, description: value.description,
    memoryDate: value.eventDate, datePrecision: value.datePrecision });
  if (normalized.title === null) throw new ApiError("Give this event a title of 1–200 characters.", { status: 400, code: "VALIDATION_FAILED" });
  return { title: normalized.title, description: normalized.description, eventDate: normalized.memoryDate, datePrecision: normalized.datePrecision };
}
export function normalizeTimelineFilters({ fromYear = null, toYear = null, datePrecision = "ALL" } = {}) {
  if (!["ALL", "UNKNOWN", "YEAR", "MONTH", "DAY"].includes(datePrecision)
    || [fromYear, toYear].some(year => year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
    || (fromYear !== null && toYear !== null && fromYear > toYear)
    || (datePrecision === "UNKNOWN" && (fromYear !== null || toYear !== null))) throw new TypeError("Choose valid inclusive years and date precision; unknown dates cannot have a year range.");
  return { fromYear, toYear, datePrecision };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function partialDateLabel(value, precision) {
  if (precision === "UNKNOWN") return "Date unknown";
  const [year, month, day] = value.split("-");
  if (precision === "YEAR") return `Sometime in ${year}`;
  if (precision === "MONTH") return `${MONTHS[Number(month) - 1]} ${year}`;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}
export function compareEvents(left, right) {
  const a = left.eventDate ?? "~", b = right.eventDate ?? "~";
  return compareCanonical(a, b) || compareInstants(left.createdAt, right.createdAt) || compareCanonical(left.eventId, right.eventId);
}
export const compareCanonical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export function instantKey(value) {
  if (typeof value !== "string") return null;
  const parts = value.match(/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?Z$/);
  if (!parts || !validMemoryDate(parts[1], "DAY") || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return null;
  return `${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}.${(parts[5] ?? "").padEnd(9, "0")}`;
}
export const compareInstants = (left, right) => compareCanonical(instantKey(left), instantKey(right));
