import { ApiError, contractMismatch } from "./apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "../../features/media/mediaConstraints.js";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../features/audio/audioConstraints.js";
import { normalizeMemoryMetadata, metadataOf, sameMetadata } from "../../features/inbox/memoryMetadata.js";
import { MEMORY_VISIBILITIES } from "../../features/sharing/sharingApi.js";
import { compareInstants, instantKey } from "../../features/timeline/timelineFields.js";

export { MEMORY_VISIBILITIES };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = ["TEXT", "PHOTO", "AUDIO"];
export const STATES = ["PENDING", "KEEP", "ARCHIVED", "DELETE"];
const UPLOADS = ["PENDING", "UPLOADED", "FAILED"];
const isId = (value) => typeof value === "string" && UUID.test(value);
export const isTime = (value) => instantKey(value) !== null;
export const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function id(value) {
  if (!isId(value)) throw new TypeError("A valid UUID is required.");
  return value;
}

export function key(value) {
  if (typeof value !== "string" || !KEY.test(value)) throw new TypeError("Use a random UUID v4 as the idempotency key.");
  return value.toLowerCase();
}

export function csrf(value) {
  if (typeof value !== "string" || value.length < 16 || /[\r\n]/.test(value)) {
    throw new TypeError("Use the CSRF token returned by getSession().");
  }
  return { "X-CSRF-Token": value };
}

function storableText(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || (c >= 0xdc00 && c <= 0xdfff)) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

export function normalizeTextContribution({ guestName = null, message } = {}) {
  const errors = [];
  if (guestName !== null && (typeof guestName !== "string" || guestName.length > 100 || !storableText(guestName))) {
    errors.push({ field: "guestName", code: "SIZE", message: "Your name must be 100 characters or fewer." });
  }
  if (typeof message !== "string" || !message.trim() || message.length > 5000 || !storableText(message)) {
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
  if (guestName !== null && (typeof guestName !== "string" || guestName.length > 100 || !storableText(guestName))) {
    add("guestName", "Your name must be 100 characters or fewer.");
  }
  if (!["PHOTO", "AUDIO"].includes(memoryType) || !Array.isArray(items)
    || items.length < 1 || items.length > (memoryType === "PHOTO" ? MAX_PHOTOS : 1)) {
    add("items", "Supply one to five photos or one audio item.");
  }
  const seen = new Set();
  const normalized = Array.isArray(items) ? items.map((item, index) => {
    const field = "items[" + index + "]";
    const clientItemId = typeof item?.clientItemId === "string" ? item.clientItemId.toLowerCase() : item?.clientItemId;
    if (!isId(clientItemId) || seen.has(clientItemId)) add(field + ".clientItemId", "Each item needs a unique UUID.");
    seen.add(clientItemId);
    if (typeof item?.originalFilename !== "string" || !item.originalFilename.trim()
      || item.originalFilename.length > 255 || !storableText(item.originalFilename)
      || /[\\/]/.test(item.originalFilename)
      || [...item.originalFilename].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      add(field + ".originalFilename", "Use a filename, not a file path, of 1–255 characters.");
    }
    const photo = memoryType === "PHOTO";
    if (typeof item?.declaredContentType !== "string"
      || (photo ? !ALLOWED_FILE_TYPES.has(item.declaredContentType)
        : !AUDIO_CONTENT_TYPES.has(item.declaredContentType))) {
      add(field + ".declaredContentType", "This declared media format is unsupported.");
    }
    if (!positiveInteger(item?.byteSize) || item.byteSize > (photo ? MAX_PHOTO_BYTES : MAX_AUDIO_BYTES)) {
      add(field + ".byteSize", "This file exceeds the size limit.");
    }
    if (typeof item?.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.checksumSha256)) {
      add(field + ".checksumSha256", "Supply a lowercase SHA-256 checksum of the original file.");
    }
    const caption = item?.caption ?? null;
    if (caption !== null && (typeof caption !== "string" || caption.length > 500 || !storableText(caption))) {
      add(field + ".caption", "Captions must be 500 characters or fewer.");
    }
    if (!photo && (!Number.isFinite(item?.durationSeconds)
      || item.durationSeconds <= 0 || item.durationSeconds > MAX_AUDIO_SECONDS)) {
      add(field + ".durationSeconds", "Audio must be between zero and 120 seconds.");
    }
    return {
      clientItemId, originalFilename: item?.originalFilename,
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
  if (
    !isId(value?.contributionId) ||
    value.eventKey !== "kevin-mel-wedding" ||
    !isTime(value.createdAt) ||
    !["PENDING", "PARTIAL", "COMPLETE"].includes(value.completion) ||
    !Array.isArray(value.memories) ||
    value.memories.length < 1 ||
    value.memories.length > 5
  ) {
    throw contractMismatch();
  }
  const ids = new Set();
  const clientIds = new Set();
  for (const memory of value.memories) {
    if (
      !isId(memory?.memoryId) ||
      ids.has(memory.memoryId.toLowerCase()) ||
      !TYPES.includes(memory.memoryType) ||
      !STATES.includes(memory.reviewStatus) ||
      !MEMORY_VISIBILITIES.includes(memory.visibility) ||
      (memory.reviewStatus !== "KEEP" && memory.visibility !== "COUPLE_ONLY")
    ) {
      throw contractMismatch();
    }
    ids.add(memory.memoryId.toLowerCase());
    if (memory.memoryType === "TEXT") {
      if (memory.uploadState !== null || memory.clientItemId !== null) {
        throw contractMismatch();
      }
    } else {
      if (
        !isId(memory.clientItemId) ||
        clientIds.has(memory.clientItemId.toLowerCase()) ||
        !UPLOADS.includes(memory.uploadState)
      ) {
        throw contractMismatch();
      }
      clientIds.add(memory.clientItemId.toLowerCase());
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

export function decodeSession(value) {
  if (typeof value?.authenticated !== "boolean" || typeof value.csrfToken !== "string"
    || value.csrfToken.length < 16 || /[\r\n]/.test(value.csrfToken)
    || (value.authenticated
      ? typeof value.user?.displayName !== "string" || !Array.isArray(value.user.roles)
        || value.user.roles.length !== 1 || !["COUPLE", "OPERATOR"].includes(value.user.roles[0])
      : value.user !== null)
    || (value.passwordChangeRequired !== undefined && typeof value.passwordChangeRequired !== "boolean")
    || (value.passwordChangeRequired === true
      && (!value.authenticated || value.user.roles[0] !== "COUPLE"))) throw contractMismatch();
  // Older servers did not send this flag. An explicit pending response always
  // takes precedence over authenticated archive presentation.
  return { ...value, passwordChangeRequired: value.passwordChangeRequired ?? false };
}

export function decodeMemory(value) {
  let metadata;
  try { metadata = normalizeMemoryMetadata(metadataOf(value ?? {})); } catch { throw contractMismatch(); }
  if (!isId(value?.memoryId) || !isId(value.contributionId) || !TYPES.includes(value.memoryType)
    || !["GUEST", "COUPLE"].includes(value.source) || !sameMetadata(value, metadata)
    || (value.source === "COUPLE" && value.guestName !== null)
    || !STATES.includes(value.reviewStatus) || !MEMORY_VISIBILITIES.includes(value.visibility)
    || (value.reviewStatus !== "KEEP" && value.visibility !== "COUPLE_ONLY")
    || !positiveInteger(value.revision) || !isTime(value.createdAt) || !isTime(value.updatedAt)
    || compareInstants(value.updatedAt, value.createdAt) < 0
    || !(value.guestName === null || typeof value.guestName === "string")
    || !(value.textContent === null || typeof value.textContent === "string")
    || (value.memoryType === "TEXT"
      ? !value.textContent?.trim() || value.textContent.length > 5000 || value.media !== null || value.caption !== null
      : value.textContent !== null || !value.media)
    || !(value.caption === null || (typeof value.caption === "string" && value.caption.length <= 500))
    || (value.reviewStatus === "DELETE"
      ? !isTime(value.deleteAfter) || compareInstants(value.deleteAfter, value.updatedAt) < 0
      : value.deleteAfter !== null)) {
    throw contractMismatch();
  }
  if (value.media && (!positiveInteger(value.media.byteSize)
    || value.media.byteSize > (value.memoryType === "AUDIO" ? MAX_AUDIO_BYTES : MAX_PHOTO_BYTES)
    || typeof value.media.originalFilename !== "string" || !value.media.originalFilename.trim()
    || typeof value.media.detectedContentType !== "string"
    || !(value.memoryType === "AUDIO" ? AUDIO_CONTENT_TYPES : ALLOWED_FILE_TYPES).has(value.media.detectedContentType)
    || !/^[0-9a-f]{64}$/.test(value.media.checksumSha256)
    || value.media.uploadState !== "UPLOADED"
    || (value.memoryType === "AUDIO"
      ? !Number.isFinite(value.media.durationSeconds) || value.media.durationSeconds <= 0 || value.media.durationSeconds > MAX_AUDIO_SECONDS
      : value.media.durationSeconds !== null))) throw contractMismatch();
  return value;
}

export function decodeInbox(value, { limit = 100, reviewStatus } = {}) {
  if (
    !Array.isArray(value?.items) ||
    value.items.length > limit ||
    (value.totalCount !== undefined && (!Number.isSafeInteger(value.totalCount) || value.totalCount < value.items.length)) ||
    !(value.nextCursor === null || (
      typeof value.nextCursor === "string" &&
      value.nextCursor.length > 0 &&
      value.nextCursor.length <= 256
    ))
  ) {
    throw contractMismatch();
  }
  const ids = new Set();
  for (const item of value.items) {
    const memory = decodeMemory(item);
    const memoryId = memory.memoryId.toLowerCase();
    if (
      ids.has(memoryId) ||
      (reviewStatus !== undefined && memory.reviewStatus !== reviewStatus)
    ) {
      throw contractMismatch();
    }
    ids.add(memoryId);
  }
  return value;
}

export function decodeGrant(value) {
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
