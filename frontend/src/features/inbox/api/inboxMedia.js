import { ApiError } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../../media/mediaConstraints.js";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../audio/audioConstraints.js";

export async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function photoFailure(code = "PHOTO_UNAVAILABLE") {
  return new ApiError("The original photo is unavailable.", { code });
}

export function photoMessage(failure, audio = false) {
  const kind = audio ? "audio" : "photo";
  if (failure?.code === "PHOTO_INTEGRITY") return `This ${kind} did not match its saved original. It has not been displayed. Try loading it again.`;
  if (failure?.code === "PHOTO_EXPIRED") return `The ${kind} link expired. Try loading the original again.`;
  if (failure?.code === "REQUEST_TIMED_OUT") return `The ${kind} took too long to load. Try loading it again.`;
  if (failure?.status === 429) return `Please wait before trying to load this ${kind} again.`;
  return `The original ${kind} could not be loaded. The memory is still here. Try loading it again.`;
}

/** Verified private originals share the host controller's request ownership. */
export function createInboxMedia({ api, fetchImpl, createObjectURL, revokeObjectURL, now, digest,
  photoTimeoutMs, publish, bounded, assertCurrent, isCurrent, authFailure }) {
  let objectUrl = null;

  function revokePhoto() {
    const previous = objectUrl;
    objectUrl = null;
    if (previous !== null) {
      try { revokeObjectURL(previous); } catch { /* Cleanup must still clear presentation state. */ }
    }
  }

  function cancelBody(response) {
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* Stream may already be closed. */ }
  }

  async function readPhoto(op, url, media, signal, maxBytes) {
    const response = await fetchImpl(url, { method: "GET", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", cache: "no-store", signal });
    try { assertCurrent(op); } catch (failure) { cancelBody(response); throw failure; }
    if (!response.ok) {
      cancelBody(response);
      throw photoFailure([401, 403, 410].includes(response.status) ? "PHOTO_EXPIRED" : "PHOTO_UNAVAILABLE");
    }
    const mime = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    const length = response.headers.get("Content-Length");
    if (mime !== media.detectedContentType || (length !== null
      && (!/^\d+$/.test(length) || Number(length) !== media.byteSize)) || !response.body?.getReader) {
      cancelBody(response);
      throw photoFailure("PHOTO_INTEGRITY");
    }
    const reader = response.body.getReader();
    const stopReading = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Already released. */ } };
    signal.addEventListener("abort", stopReading, { once: true });
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        assertCurrent(op);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > media.byteSize || bytes > maxBytes) throw photoFailure("PHOTO_INTEGRITY");
        chunks.push(next.value);
      }
      if (bytes !== media.byteSize) throw photoFailure("PHOTO_INTEGRITY");
      const blob = new Blob(chunks, { type: mime });
      const checksum = await digest(await blob.arrayBuffer());
      assertCurrent(op);
      if (checksum !== media.checksumSha256) throw photoFailure("PHOTO_INTEGRITY");
      return blob;
    } catch (failure) { stopReading(); throw failure; }
    finally {
      signal.removeEventListener("abort", stopReading);
      reader.releaseLock();
    }
  }

  async function photo(op, memory) {
    const media = memory.media;
    const audio = memory.memoryType === "AUDIO";
    const maxBytes = audio ? MAX_AUDIO_BYTES : MAX_PHOTO_BYTES;
    const types = audio ? AUDIO_CONTENT_TYPES : ALLOWED_FILE_TYPES;
    publish({ photo: Object.freeze({ phase: "loading", url: null, error: null }) });
    try {
      if (!media || !Number.isSafeInteger(media.byteSize) || media.byteSize < 1 || media.byteSize > maxBytes
        || !types.has(media.detectedContentType) || !/^[0-9a-f]{64}$/.test(media.checksumSha256)
        || (audio && (!Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0 || media.durationSeconds > MAX_AUDIO_SECONDS))) {
        throw photoFailure("PHOTO_INTEGRITY");
      }
      const grant = await bounded(op, signal => api.getPlayback(memory.memoryId, { signal }));
      let url;
      try { url = new URL(grant.url); } catch { throw photoFailure("PHOTO_INTEGRITY"); }
      if (url.protocol !== "https:" || url.username || url.password) throw photoFailure("PHOTO_INTEGRITY");
      if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now()) throw photoFailure("PHOTO_EXPIRED");
      const blob = await bounded(op, signal => readPhoto(op, url.href, media, signal, maxBytes), photoTimeoutMs);
      assertCurrent(op);
      const nextUrl = createObjectURL(blob);
      if (!isCurrent(op)) { revokeObjectURL(nextUrl); return; }
      objectUrl = nextUrl;
      publish({ photo: Object.freeze({ phase: "ready", url: nextUrl, error: null }) });
    } catch (failure) {
      if (!isCurrent(op)) return;
      if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure, audio) }) });
    }
  }

  return { photo, revokePhoto };
}
