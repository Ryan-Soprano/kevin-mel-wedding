import { contractMismatch } from "./apiClient.js";
import { csrf, decodeInbox, decodeMemory, id, isTime, MEMORY_VISIBILITIES, positiveInteger, STATES } from "./archiveContracts.js";
import { normalizeMemoryMetadata, sameMetadata } from "../../features/inbox/memoryMetadata.js";

/** Couple inbox access, original playback and revision-checked memory changes. */
export function createMemoryApi({ client }) {
  const memoryRequest = (path, options, expectedId) => client.request(path, {
    ...options,
    decode(value) {
      const memory = decodeMemory(value);
      if (memory.memoryId !== expectedId) throw contractMismatch();
      return memory;
    },
  });
  return {
    listMemories({ reviewStatus = "PENDING", limit = 20, cursor, signal } = {}) {
      if (!STATES.includes(reviewStatus) || !positiveInteger(limit) || limit > 100
        || (cursor !== undefined && typeof cursor !== "string")) {
        throw new TypeError("Use a valid review state, a limit of 1–100, and an opaque cursor.");
      }
      const params = new URLSearchParams({ reviewStatus, limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      return client.request("/api/memories?" + params, { decode: decodeInbox, signal });
    },
    getMemory(memoryId, { signal } = {}) {
      return memoryRequest("/api/memories/" + id(memoryId), { signal }, memoryId);
    },
    updateMemoryMetadata(memoryId, metadata, { revision, csrfToken, signal } = {}) {
      if (!positiveInteger(revision)) throw new TypeError("Supply the latest memory revision.");
      const body = normalizeMemoryMetadata(metadata);
      return client.request("/api/memories/" + id(memoryId) + "/metadata", {
        method: "PATCH", body, headers: { ...csrf(csrfToken), "If-Match": '"' + revision + '"' }, signal,
        decode(value, response) {
          const memory = decodeMemory(value);
          if (memory.memoryId !== memoryId || !sameMetadata(memory, body) || ![revision, revision + 1].includes(memory.revision)
            || response.headers.get("ETag") !== '"' + memory.revision + '"') throw contractMismatch();
          return memory;
        },
      });
    },
    reviewMemory(memoryId, { reviewStatus, revision, visibility }, { csrfToken, signal } = {}) {
      if (!STATES.includes(reviewStatus) || !positiveInteger(revision)) {
        throw new TypeError("Supply a valid review state and the latest memory revision.");
      }
      if (visibility !== undefined && (!MEMORY_VISIBILITIES.includes(visibility)
        || (reviewStatus !== "KEEP" && visibility !== "COUPLE_ONLY"))) {
        throw new TypeError("Choose a supported memory audience.");
      }
      return client.request("/api/memories/" + id(memoryId) + "/review", {
        method: "PATCH", body: { reviewStatus, ...(visibility !== undefined ? { visibility } : {}) },
        headers: { ...csrf(csrfToken), "If-Match": '"' + revision + '"' },
        signal,
        decode(value, response) {
          const memory = decodeMemory(value);
          if (memory.memoryId !== memoryId || memory.reviewStatus !== reviewStatus
            || (visibility !== undefined && memory.visibility !== visibility)
            || ![revision, revision + 1].includes(memory.revision)
            || response.headers.get("ETag") !== '"' + memory.revision + '"') throw contractMismatch();
          return memory;
        },
      });
    },
    getPlayback(memoryId, { signal } = {}) {
      return client.request("/api/memories/" + id(memoryId) + "/playback", {
        signal,
        decode(value) {
          let url;
          try { url = new URL(value?.url); } catch { throw contractMismatch(); }
          if (url.protocol !== "https:" || url.username || url.password
            || !isTime(value.expiresAt)) throw contractMismatch();
          return value;
        },
      });
    },
  };
}
