import { contractMismatch, createApiClient } from "../../shared/api/apiClient.js";

export const MEMORY_VISIBILITIES = ["COUPLE_ONLY", "FRIENDS_FAMILY", "PUBLIC"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = value => typeof value === "string" && UUID.test(value);
const isTime = value => typeof value === "string" && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const nullableText = value => value === null || typeof value === "string";
const PUBLIC_FIELDS = new Set(["memoryId", "memoryType", "textContent", "caption", "title", "description", "memoryDate", "datePrecision", "createdAt", "media"]);

export function decodeSharedMemory(value) {
  if (!value || Object.keys(value).some(key => !PUBLIC_FIELDS.has(key)) || !isId(value.memoryId)
    || !["TEXT", "PHOTO", "AUDIO"].includes(value.memoryType) || !isTime(value.createdAt)
    || !["caption", "title", "description", "memoryDate"].every(key => nullableText(value[key]))
    || !["UNKNOWN", "YEAR", "MONTH", "DAY"].includes(value.datePrecision)
    || (value.memoryType === "TEXT" ? typeof value.textContent !== "string" || !value.textContent.trim()
      || value.textContent.length > 5000 || value.media !== null : value.textContent !== null || !value.media)) throw contractMismatch();
  if (value.media) {
    const media = value.media;
    const photo = value.memoryType === "PHOTO";
    if (Object.keys(media).some(key => !["detectedContentType", "byteSize", "durationSeconds"].includes(key))
      || !Number.isSafeInteger(media.byteSize) || media.byteSize < 1 || media.byteSize > (photo ? 10_000_000 : 25_000_000)
      || !(photo ? ["image/jpeg", "image/png", "image/webp"] : ["audio/webm", "audio/ogg", "audio/mp4"]).includes(media.detectedContentType)
      || (photo ? media.durationSeconds !== null : !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0 || media.durationSeconds > 120)) throw contractMismatch();
  }
  return value;
}

function memoryId(id) {
  if (!isId(id)) throw new TypeError("Use a valid memory ID.");
  return id;
}

function tokenQuery(token) {
  if (token === undefined || token === null) return "";
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError("Use the token from the private sharing link.");
  return "?" + new URLSearchParams({ token });
}

export function createSharingApi({ client = createApiClient(), csrf } = {}) {
  return {
    listPublicMemories({ cursor, signal } = {}) {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      return client.request("/api/shared-memories?" + query, { signal, decode(value) {
        if (!Array.isArray(value?.items) || value.items.length > 20
          || !(value.nextCursor === null || typeof value.nextCursor === "string")) throw contractMismatch();
        value.items.forEach(decodeSharedMemory);
        return value;
      } });
    },
    getSharedMemory(id, { token, signal } = {}) {
      return client.request("/api/shared-memories/" + memoryId(id) + tokenQuery(token), { signal, decode(value) {
        const memory = decodeSharedMemory(value);
        if (memory.memoryId !== id) throw contractMismatch();
        return memory;
      } });
    },
    getSharedPlayback(id, { token, signal } = {}) {
      return client.request("/api/shared-memories/" + memoryId(id) + "/playback" + tokenQuery(token), { signal, decode(value) {
        let url;
        try { url = new URL(value?.url); } catch { throw contractMismatch(); }
        if (url.protocol !== "https:" || url.username || url.password || !isTime(value.expiresAt)) throw contractMismatch();
        return value;
      } });
    },
    createShareLink(id, { revision, csrfToken, signal } = {}) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("Supply the current memory revision.");
      return client.request("/api/memories/" + memoryId(id) + "/share-link", {
        method: "POST", headers: { ...csrf(csrfToken), "If-Match": `"${revision}"` }, signal,
        decode(value, response) {
          if (value?.memoryId !== id || value.revision !== revision + 1
            || typeof value.url !== "string" || !value.url.startsWith(`/shared/${id}#token=`)
            || !/^[A-Za-z0-9_-]{43}$/.test(value.url.split("#token=")[1])
            || response.headers.get("ETag") !== `"${value.revision}"`) throw contractMismatch();
          return value;
        },
      });
    },
  };
}
