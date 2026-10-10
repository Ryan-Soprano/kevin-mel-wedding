import { contractMismatch } from "../../../shared/api/apiClient.js";
import { compareCanonical, compareEvents, compareInstants, eventFields, instantKey, normalizeEventFields, normalizeTimelineFilters } from "../timelineFields.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEMORY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === "string" && UUID.test(value);
const id = value => { if (!isUuid(value)) throw new TypeError("Use a canonical UUID v4."); return value; };
const memoryId = value => { if (typeof value !== "string" || !MEMORY_UUID.test(value)) throw new TypeError("Use a valid memory UUID."); return value; };
const time = value => instantKey(value) !== null;
const cursorValid = value => value === null || (typeof value === "string" && value.length > 0 && value.length <= 4096);
export function decodeTimelineEvent(value) {
  if (!isUuid(value?.eventId) || !isUuid(value.revision) || value.visibility !== "COUPLE_ONLY"
    || !Number.isSafeInteger(value.memberCount) || value.memberCount < 0 || !time(value.createdAt) || !time(value.updatedAt)
    || compareInstants(value.updatedAt, value.createdAt) < 0) throw contractMismatch();
  if (value.deletedAt !== null) {
    if (!time(value.deletedAt) || compareInstants(value.deletedAt, value.createdAt) < 0 || compareInstants(value.deletedAt, value.updatedAt) > 0
      || value.title !== null || value.description !== null || value.eventDate !== null || value.datePrecision !== "UNKNOWN" || value.memberCount !== 0) throw contractMismatch();
  } else {
    try { const normalized = normalizeEventFields(eventFields(value));
      if (Object.keys(normalized).some(field => normalized[field] !== value[field])) throw contractMismatch();
    } catch { throw contractMismatch(); }
  }
  return value;
}
/** Authenticated conditional writes; the transport never resends mutations. */
export function createTimelineApi({ client, decodeMemory, csrf }) {
  const params = ({ limit = 20, cursor } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && !cursorValid(cursor))) throw new TypeError("Use a limit of 1–50 and an opaque cursor.");
    const result = new URLSearchParams({ limit: String(limit) }); if (cursor) result.set("cursor", cursor); return result;
  };
  const request = (eventId, options, validate = () => true, suffix = "") => client.request("/api/timeline/events/" + id(eventId) + suffix, {
    ...options, decode(value, response) {
      const event = decodeTimelineEvent(value);
      if (event.eventId !== eventId || response.headers.get("ETag") !== '"' + event.revision + '"' || !validate(event)) throw contractMismatch();
      return event;
    },
  });
  const condition = ({ revision, csrfToken, signal } = {}) => ({ signal, headers: { ...csrf(csrfToken), "If-Match": '"' + id(revision) + '"' } });
  const matches = (event, body) => event.deletedAt === null && Object.keys(body).every(field => event[field] === body[field]);
  return {
    listTimelineEvents({ signal, limit = 20, cursor, ...filter } = {}) {
      const filters = normalizeTimelineFilters(filter), query = params({ limit, cursor });
      query.set("datePrecision", filters.datePrecision);
      for (const field of ["fromYear", "toYear"]) if (filters[field] !== null) query.set(field, String(filters[field]));
      return client.request("/api/timeline/events?" + query, { signal, decode(value, response) {
        if (!isUuid(value?.revision) || response.headers.get("ETag") !== '"' + value.revision + '"'
          || !Array.isArray(value.items) || value.items.length > limit || !cursorValid(value.nextCursor)
          || new Set(value.items.map(event => event?.eventId)).size !== value.items.length) throw contractMismatch();
        value.items.forEach((raw, index) => {
          const event = decodeTimelineEvent(raw), year = event.eventDate === null ? null : Number(event.eventDate.slice(0, 4));
          if (event.deletedAt !== null || (filters.datePrecision !== "ALL" && event.datePrecision !== filters.datePrecision)
            || (filters.fromYear !== null && (year === null || year < filters.fromYear))
            || (filters.toYear !== null && (year === null || year > filters.toYear))
            || (index && compareEvents(value.items[index - 1], event) > 0)) throw contractMismatch();
        }); return value;
      } });
    },
    getTimelineEvent(eventId, { signal } = {}) { return request(eventId, { signal }); },
    createTimelineEvent(eventId, fields, { csrfToken, signal } = {}) {
      const body = normalizeEventFields(fields);
      return request(eventId, { method: "PUT", body, statuses: [201], headers: { ...csrf(csrfToken), "If-None-Match": "*" }, signal },
        event => matches(event, body) && event.memberCount === 0);
    },
    updateTimelineEvent(eventId, fields, options) {
      const body = normalizeEventFields(fields);
      return request(eventId, { method: "PATCH", body, ...condition(options) }, event => matches(event, body));
    },
    deleteTimelineEvent(eventId, options) { return request(eventId, { method: "DELETE", ...condition(options) }, event => event.deletedAt !== null); },
    listTimelineMemories(eventId, { signal, ...page } = {}) {
      return client.request("/api/timeline/events/" + id(eventId) + "/memories?" + params(page), { signal, decode(value, response) {
        const event = decodeTimelineEvent(value?.event);
        if (event.eventId !== eventId || response.headers.get("ETag") !== '"' + event.revision + '"'
          || !Array.isArray(value.items) || value.items.length > (page.limit ?? 20) || value.items.length > event.memberCount
          || !cursorValid(value.nextCursor) || (event.deletedAt !== null && (value.items.length || value.nextCursor !== null))) throw contractMismatch();
        const seen = new Set(); let previous = null;
        for (const item of value.items) {
          const memory = decodeMemory(item?.memory);
          if (memory.reviewStatus === "DELETE" || seen.has(memory.memoryId.toLowerCase()) || (memory.memoryType !== "TEXT" && memory.media.uploadState !== "UPLOADED")
            || !time(memory.createdAt) || (previous && (compareInstants(previous.createdAt, memory.createdAt) || compareCanonical(previous.memoryId.toLowerCase(), memory.memoryId.toLowerCase())) > 0)) throw contractMismatch();
          seen.add(memory.memoryId.toLowerCase()); previous = memory;
        } return value;
      } });
    },
    linkTimelineMemory(eventId, value, options) { return request(eventId, { method: "PUT", ...condition(options) }, event => event.deletedAt === null, "/memories/" + memoryId(value)); },
    unlinkTimelineMemory(eventId, value, options) { return request(eventId, { method: "DELETE", ...condition(options) }, event => event.deletedAt === null, "/memories/" + memoryId(value)); },
  };
}
