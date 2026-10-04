import { ApiError, contractMismatch, createApiClient } from "./apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "../../features/media/mediaConstraints.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = ["TEXT", "PHOTO", "AUDIO"];
const STATES = ["PENDING", "KEEP", "ARCHIVED", "DELETE"];
const UPLOADS = ["PENDING", "UPLOADED", "FAILED"];
const isId = (value) => typeof value === "string" && UUID.test(value);
const isTime = (value) => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT/.test(value) && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function id(value) {
  if (!isId(value)) throw new TypeError("A valid UUID is required.");
  return value;
}

function key(value) {
  if (!KEY.test(value)) throw new TypeError("Use a random UUID v4 as the idempotency key.");
  return value;
}

function csrf(value) {
  if (typeof value !== "string" || value.length < 16 || /[\r\n]/.test(value)) {
    throw new TypeError("Use the CSRF token returned by getSession().");
  }
  return { "X-CSRF-Token": value };
}

export function normalizeTextContribution({ guestName = null, message } = {}) {
  const errors = [];
  if (guestName !== null && (typeof guestName !== "string" || guestName.length > 100)) {
    errors.push({ field: "guestName", code: "SIZE", message: "Your name must be 100 characters or fewer." });
  }
  if (typeof message !== "string" || !message.trim() || message.length > 5000) {
    errors.push({ field: "message", code: "INVALID_TEXT", message: "Write a message between 1 and 5,000 characters." });
  }
  if (errors.length) throw new ApiError(errors[0].message, {
    code: "VALIDATION_FAILED", status: 400, fieldErrors: errors,
  });
  return { guestName: guestName?.trim() || null, message: message.trim() };
}

/** Metadata is a claim; the server must verify the original bytes before finalizing. */
export function normalizeMediaContribution({ guestName = null, memoryType, items } = {}) {
  const errors = [];
  const add = (field, message) => errors.push({ field, code: "INVALID_MEDIA", message });
  if (guestName !== null && (typeof guestName !== "string" || guestName.length > 100)) {
    add("guestName", "Your name must be 100 characters or fewer.");
  }
  if (!["PHOTO", "AUDIO"].includes(memoryType) || !Array.isArray(items)
    || items.length < 1 || items.length > (memoryType === "PHOTO" ? MAX_PHOTOS : 1)) {
    add("items", "Supply one to five photos or one audio item.");
  }
  const seen = new Set();
  const normalized = Array.isArray(items) ? items.map((item, index) => {
    const field = "items[" + index + "]";
    if (!isId(item?.clientItemId) || seen.has(item.clientItemId)) add(field + ".clientItemId", "Each item needs a unique UUID.");
    seen.add(item?.clientItemId);
    if (typeof item?.originalFilename !== "string" || !item.originalFilename.trim()
      || item.originalFilename.length > 255 || /[\\/\r\n\0]/.test(item.originalFilename)) {
      add(field + ".originalFilename", "Use a filename, not a file path, of 1–255 characters.");
    }
    const photo = memoryType === "PHOTO";
    // Audio types are provisional until D-03 has real-device evidence.
    if (typeof item?.declaredContentType !== "string"
      || (photo ? !ALLOWED_FILE_TYPES.has(item.declaredContentType)
        : !/^(audio\/[a-z0-9.+-]+|video\/(webm|mp4))$/.test(item.declaredContentType))) {
      add(field + ".declaredContentType", "This declared media format is unsupported.");
    }
    if (!positiveInteger(item?.byteSize) || item.byteSize > (photo ? MAX_PHOTO_BYTES : 25_000_000)) {
      add(field + ".byteSize", "This file exceeds the provisional size limit.");
    }
    if (typeof item?.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.checksumSha256)) {
      add(field + ".checksumSha256", "Supply a lowercase SHA-256 checksum of the original file.");
    }
    const caption = item?.caption ?? null;
    if (caption !== null && (typeof caption !== "string" || caption.length > 500)) {
      add(field + ".caption", "Captions must be 500 characters or fewer.");
    }
    if (!photo && (!Number.isFinite(item?.durationSeconds)
      || item.durationSeconds <= 0 || item.durationSeconds > 120)) {
      add(field + ".durationSeconds", "Audio must be between zero and 120 seconds.");
    }
    return {
      clientItemId: item?.clientItemId, originalFilename: item?.originalFilename,
      declaredContentType: item?.declaredContentType, byteSize: item?.byteSize,
      checksumSha256: item?.checksumSha256,
      caption: typeof caption === "string" ? caption.trim() || null : null,
      ...(!photo ? { durationSeconds: item?.durationSeconds } : {}),
    };
  }) : [];
  if (errors.length) throw new ApiError(errors[0].message, {
    code: "VALIDATION_FAILED", status: 400, fieldErrors: errors,
  });
  return { guestName: guestName?.trim() || null, memoryType, items: normalized };
}

/** Reject an echo or an incomplete/malformed receipt before presenting a saved state. */
export function decodeReceipt(value) {
  if (!isId(value?.contributionId) || value.eventKey !== "kevin-mel-wedding"
    || !isTime(value.createdAt) || !["PENDING", "PARTIAL", "COMPLETE"].includes(value.completion)
    || !Array.isArray(value.memories) || value.memories.length < 1 || value.memories.length > 5) {
    throw contractMismatch();
  }
  const ids = new Set();
  const clientIds = new Set();
  for (const memory of value.memories) {
    if (!isId(memory.memoryId) || ids.has(memory.memoryId) || !TYPES.includes(memory.memoryType)
      || !STATES.includes(memory.reviewStatus) || memory.visibility !== "COUPLE_ONLY") {
      throw contractMismatch();
    }
    ids.add(memory.memoryId);
    if (memory.memoryType === "TEXT") {
      if (memory.uploadState !== null || memory.clientItemId !== null) throw contractMismatch();
    } else {
      if (!isId(memory.clientItemId) || clientIds.has(memory.clientItemId)
        || !UPLOADS.includes(memory.uploadState)) throw contractMismatch();
      clientIds.add(memory.clientItemId);
    }
  }
  const type = value.memories[0].memoryType;
  if (value.memories.some((memory) => memory.memoryType !== type)
    || (type !== "PHOTO" && value.memories.length !== 1)) throw contractMismatch();
  const complete = value.memories.filter((memory) =>
    memory.memoryType === "TEXT" || memory.uploadState === "UPLOADED").length;
  const expected = complete === value.memories.length ? "COMPLETE" : complete > 0 ? "PARTIAL" : "PENDING";
  if (value.completion !== expected) throw contractMismatch();
  return value;
}

function decodeSession(value) {
  if (typeof value?.authenticated !== "boolean" || typeof value.csrfToken !== "string"
    || value.csrfToken.length < 16 || /[\r\n]/.test(value.csrfToken)
    || (value.authenticated
      ? typeof value.user?.displayName !== "string" || !Array.isArray(value.user.roles)
        || value.user.roles.length !== 1 || value.user.roles[0] !== "COUPLE"
      : value.user !== null)) throw contractMismatch();
  return value;
}

function decodeMemory(value) {
  if (!isId(value?.memoryId) || !isId(value.contributionId) || !TYPES.includes(value.memoryType)
    || !STATES.includes(value.reviewStatus) || value.visibility !== "COUPLE_ONLY"
    || !positiveInteger(value.revision) || !isTime(value.createdAt) || !isTime(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || !(value.guestName === null || typeof value.guestName === "string")
    || !(value.textContent === null || typeof value.textContent === "string")
    || (value.memoryType === "TEXT"
      ? !value.textContent?.trim() || value.textContent.length > 5000 || value.media !== null || value.caption !== null
      : value.textContent !== null || !value.media)
    || !(value.caption === null || (typeof value.caption === "string" && value.caption.length <= 500))
    || (value.reviewStatus === "DELETE"
      ? !isTime(value.deleteAfter) || Date.parse(value.deleteAfter) < Date.parse(value.updatedAt)
      : value.deleteAfter !== null)) {
    throw contractMismatch();
  }
  if (value.media && (!positiveInteger(value.media.byteSize)
    || typeof value.media.originalFilename !== "string" || !value.media.originalFilename.trim()
    || typeof value.media.detectedContentType !== "string"
    || !/^[0-9a-f]{64}$/.test(value.media.checksumSha256)
    || value.media.uploadState !== "UPLOADED"
    || (value.memoryType === "AUDIO"
      ? !Number.isFinite(value.media.durationSeconds) || value.media.durationSeconds <= 0
      : value.media.durationSeconds !== null))) throw contractMismatch();
  return value;
}

function decodeInbox(value) {
  if (!Array.isArray(value?.items) || value.items.length > 100
    || !(value.nextCursor === null || typeof value.nextCursor === "string")) throw contractMismatch();
  value.items.forEach(decodeMemory);
  return value;
}

function decodeGrant(value) {
  let url;
  try { url = new URL(value?.uploadUrl); } catch { throw contractMismatch(); }
  if (!isId(value.grantId) || value.method !== "PUT" || url.protocol !== "https:"
    || url.username || url.password || !isTime(value.expiresAt)
    || !value.headers || typeof value.headers !== "object" || Array.isArray(value.headers)
    || Object.keys(value.headers).some((header) =>
      !/^(content-type|x-amz-checksum-sha256)$/i.test(header)
      || typeof value.headers[header] !== "string" || /[\r\n]/.test(value.headers[header]))) {
    throw contractMismatch();
  }
  return value;
}

/** Durable v1 adapter. The prototype form keeps its existing echo adapter until MSG-01. */
export function createArchiveApi({
  client = createApiClient(), uploadFetch = globalThis.fetch,
} = {}) {
  const receiptRequest = (path, options, expectedId) => client.request(path, {
    ...options,
    decode(value) {
      const receipt = decodeReceipt(value);
      if (receipt.contributionId !== expectedId) throw contractMismatch();
      return receipt;
    },
  });
  const memoryRequest = (path, options, expectedId) => client.request(path, {
    ...options,
    decode(value) {
      const memory = decodeMemory(value);
      if (memory.memoryId !== expectedId) throw contractMismatch();
      return memory;
    },
  });
  return {
    createTextContribution(payload, { idempotencyKey, signal } = {}) {
      return client.request("/api/contributions", {
        method: "POST", body: normalizeTextContribution(payload),
        headers: { "Idempotency-Key": key(idempotencyKey) }, statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories[0].memoryType !== "TEXT") throw contractMismatch();
          return receipt;
        },
      });
    },
    createMediaContribution(payload, { idempotencyKey, signal } = {}) {
      const body = normalizeMediaContribution(payload);
      return client.request("/api/contributions", {
        method: "POST", body, headers: { "Idempotency-Key": key(idempotencyKey) },
        statuses: [200, 201], signal,
        decode(value) {
          const receipt = decodeReceipt(value);
          if (receipt.memories.length !== body.items.length
            || receipt.memories.some((memory) => memory.memoryType !== body.memoryType
              || !body.items.some((item) => item.clientItemId === memory.clientItemId))) throw contractMismatch();
          return receipt;
        },
      });
    },
    getReceipt(contributionId, { idempotencyKey, signal } = {}) {
      return receiptRequest("/api/contributions/" + id(contributionId) + "/receipt", {
        headers: { "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
    authorizeUpload(contributionId, memoryId, { idempotencyKey, signal } = {}) {
      return client.request("/api/contributions/" + id(contributionId) + "/memories/"
        + id(memoryId) + "/upload-grants", {
        method: "POST", headers: { "Idempotency-Key": key(idempotencyKey) },
        statuses: [201], decode: decodeGrant, signal,
      });
    },
    async uploadMedia(grant, file, { signal } = {}) {
      decodeGrant(grant);
      if (Date.parse(grant.expiresAt) <= Date.now()) {
        throw new ApiError("The upload link expired. Request a new link for this item.", {
          code: "UPLOAD_GRANT_EXPIRED", status: 410,
        });
      }
      let response;
      try {
        response = await uploadFetch(grant.uploadUrl, {
          method: "PUT", headers: grant.headers, body: file,
          credentials: "omit", redirect: "error", signal,
        });
      } catch (cause) {
        throw new ApiError("The file transfer could not be confirmed. Retry this item.", {
          code: "UPLOAD_FAILED", unknownOutcome: true, cause,
        });
      }
      if (!response.ok) throw new ApiError("The file was not uploaded. Retry this item.", {
        code: [401, 403].includes(response.status) ? "UPLOAD_GRANT_EXPIRED" : "UPLOAD_FAILED",
        status: response.status,
      });
      return { transferred: true };
    },
    finalizeUpload(contributionId, memoryId, grantId, { idempotencyKey, signal } = {}) {
      return receiptRequest("/api/contributions/" + id(contributionId) + "/memories/"
        + id(memoryId) + "/finalize", {
        method: "POST", body: { grantId: id(grantId) },
        headers: { "Idempotency-Key": key(idempotencyKey) }, signal,
      }, contributionId);
    },
    getSession({ signal } = {}) {
      return client.request("/api/session", { decode: decodeSession, signal });
    },
    login(credentials, { csrfToken, signal } = {}) {
      return client.request("/api/session", {
        method: "POST", body: credentials, headers: csrf(csrfToken),
        decode: decodeSession, signal,
      });
    },
    logout({ csrfToken, signal } = {}) {
      return client.request("/api/session", {
        method: "DELETE", headers: csrf(csrfToken), statuses: [204], signal,
      });
    },
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
    reviewMemory(memoryId, { reviewStatus, revision }, { csrfToken, signal } = {}) {
      if (!STATES.includes(reviewStatus) || !positiveInteger(revision)) {
        throw new TypeError("Supply a valid review state and the latest memory revision.");
      }
      return memoryRequest("/api/memories/" + id(memoryId) + "/review", {
        method: "PATCH", body: { reviewStatus },
        headers: { ...csrf(csrfToken), "If-Match": '"' + revision + '"' },
        signal,
      }, memoryId);
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
