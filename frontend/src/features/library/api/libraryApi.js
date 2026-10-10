import { contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeLibraryFilters, normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";
import { compareCanonical, compareInstants, instantKey } from "../../timeline/timelineFields.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEMORY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = value => typeof value === "string" && UUID.test(value);
const id = value => { if (!isId(value)) throw new TypeError("Use a canonical UUID v4."); return value; };
const memoryId = value => { if (typeof value !== "string" || !MEMORY_UUID.test(value)) throw new TypeError("Use a valid memory UUID."); return value; };
const cursorValid = value => value === null || (typeof value === "string" && value.length > 0 && value.length <= 4096);
export const compareSaved = (left, right, field = "memoryId") => compareInstants(right.createdAt, left.createdAt) || compareCanonical(right[field].toLowerCase(), left[field].toLowerCase());
export function decodeTag(value) {
  let name; try { name = value?.deletedAt === null ? normalizeTagName(value.name) : null; } catch { throw contractMismatch(); }
  if (!isId(value?.tagId) || !isId(value.revision) || value.visibility !== "COUPLE_ONLY" || value.name !== name
    || !Number.isSafeInteger(value.memberCount) || value.memberCount < 0 || !instantKey(value.createdAt) || !instantKey(value.updatedAt)
    || compareInstants(value.updatedAt, value.createdAt) < 0 || (value.deletedAt !== null && (!instantKey(value.deletedAt)
      || compareInstants(value.deletedAt, value.createdAt) < 0 || compareInstants(value.deletedAt, value.updatedAt) > 0 || value.memberCount !== 0))) throw contractMismatch();
  return value;
}
export function createLibraryApi({ client, decodeMemory, csrf }) {
  const pageParams = ({ limit = 20, cursor } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && !cursorValid(cursor))) throw new TypeError("Use a limit of 1–50 and an opaque cursor.");
    const params = new URLSearchParams({ limit: String(limit) }); if (cursor) params.set("cursor", cursor); return params;
  };
  const conditional = ({ revision, csrfToken, signal } = {}) => ({ signal, headers: { ...csrf(csrfToken), "If-Match": '"' + id(revision) + '"' } });
  const tagRequest = (tagId, options, validate = () => true, suffix = "") => client.request("/api/tags/" + id(tagId) + suffix, { ...options, decode(value, response) {
    const tag = decodeTag(value); if (tag.tagId !== tagId || response.headers.get("ETag") !== '"' + tag.revision + '"' || !validate(tag)) throw contractMismatch(); return tag;
  } });
  function decodeTags(value, limit, owner = null) {
    if ((owner !== null && (typeof value?.memoryId !== "string" || value.memoryId.toLowerCase() !== owner.toLowerCase())) || !Array.isArray(value?.items) || value.items.length > limit || !cursorValid(value.nextCursor)) throw contractMismatch();
    const seen = new Set(); value.items.forEach((raw, index) => { const tag = decodeTag(raw);
      if (tag.deletedAt !== null || seen.has(tag.tagId) || (index && compareSaved(value.items[index - 1], tag, "tagId") > 0)) throw contractMismatch(); seen.add(tag.tagId); }); return value;
  }
  return {
    listLibraryMemories({ signal, limit = 20, cursor, ...filters } = {}) {
      const normalized = normalizeLibraryFilters(filters), params = pageParams({ limit, cursor });
      for (const [key, value] of Object.entries(normalized)) if (value !== null) params.set(key, String(value));
      return client.request("/api/library/memories?" + params, { signal, decode(value) {
        if (!Array.isArray(value?.items) || value.items.length > limit || !cursorValid(value.nextCursor)) throw contractMismatch();
        const seen = new Set(); value.items.forEach((raw, index) => {
          const memory = decodeMemory(raw), year = memory.memoryDate === null ? null : Number(memory.memoryDate.slice(0, 4));
          if (memory.reviewStatus === "DELETE" || seen.has(memory.memoryId.toLowerCase()) || !instantKey(memory.createdAt)
            || (memory.memoryType !== "TEXT" && memory.media.uploadState !== "UPLOADED")
            || (normalized.memoryType !== "ALL" && normalized.memoryType !== memory.memoryType)
            || (normalized.reviewStatus !== "ALL" && normalized.reviewStatus !== memory.reviewStatus)
            || (normalized.datePrecision !== "ALL" && normalized.datePrecision !== memory.datePrecision)
            || (normalized.fromYear !== null && (year === null || year < normalized.fromYear))
            || (normalized.toYear !== null && (year === null || year > normalized.toYear))
            || (index && compareSaved(value.items[index - 1], memory) > 0)) throw contractMismatch(); seen.add(memory.memoryId.toLowerCase());
        }); return value;
      } });
    },
    listTags({ q = "", signal, ...page } = {}) {
      const params = pageParams(page); params.set("q", normalizeLibraryQuery(q));
      return client.request("/api/tags?" + params, { signal, decode: value => decodeTags(value, page.limit ?? 20) });
    },
    getTag(tagId, { signal } = {}) { return tagRequest(tagId, { signal }); },
    createTag(tagId, name, { csrfToken, signal } = {}) {
      const body = { name: normalizeTagName(name) };
      return tagRequest(tagId, { method: "PUT", body, statuses: [201], headers: { ...csrf(csrfToken), "If-None-Match": "*" }, signal }, tag => tag.name === body.name && tag.deletedAt === null && tag.memberCount === 0);
    },
    renameTag(tagId, name, options) { const body = { name: normalizeTagName(name) }; return tagRequest(tagId, { method: "PATCH", body, ...conditional(options) }, tag => tag.name === body.name && tag.deletedAt === null); },
    deleteTag(tagId, options) { return tagRequest(tagId, { method: "DELETE", ...conditional(options) }, tag => tag.deletedAt !== null); },
    listTagMembers(tagId, { signal, ...page } = {}) {
      return client.request("/api/tags/" + id(tagId) + "/members?" + pageParams(page), { signal, decode(value, response) {
        const tag = decodeTag(value?.tag);
        if (tag.tagId !== tagId || response.headers.get("ETag") !== '"' + tag.revision + '"' || !Array.isArray(value.items)
          || value.items.length > (page.limit ?? 20) || value.items.length > tag.memberCount || !cursorValid(value.nextCursor)
          || (tag.deletedAt !== null && (value.items.length || value.nextCursor !== null))) throw contractMismatch();
        const seen = new Set(); value.items.forEach((item, index) => { const memory = decodeMemory(item?.memory);
          if (memory.reviewStatus === "DELETE" || seen.has(memory.memoryId.toLowerCase()) || !instantKey(memory.createdAt)
            || (memory.memoryType !== "TEXT" && memory.media.uploadState !== "UPLOADED")
            || (index && compareSaved(value.items[index - 1].memory, memory) > 0)) throw contractMismatch(); seen.add(memory.memoryId.toLowerCase()); }); return value;
      } });
    },
    listMemoryTags(value, { signal, ...page } = {}) { return client.request("/api/library/memories/" + memoryId(value) + "/tags?" + pageParams(page), { signal, decode: result => decodeTags(result, page.limit ?? 20, value) }); },
    attachTag(tagId, value, options) { return tagRequest(tagId, { method: "PUT", ...conditional(options) }, tag => tag.deletedAt === null, "/members/" + memoryId(value)); },
    removeTag(tagId, value, options) { return tagRequest(tagId, { method: "DELETE", ...conditional(options) }, tag => tag.deletedAt === null, "/members/" + memoryId(value)); },
  };
}
