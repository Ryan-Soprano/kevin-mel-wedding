import { ApiError, parseRetryAfter } from "../../../shared/api/apiClient.js";

export const MAX_EXPORT_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const hashBytes = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const integrity = () => new ApiError("This export part did not match its verified bytes. It has not been offered for download.", { code: "EXPORT_INTEGRITY" });
function cancelBody(response) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* Already closed. */ } }

/** A bounded single part, never a whole archive. No storage URL or credentials
 * leave the same-origin application route. Only verified bytes become a Blob. */
export async function fetchExportPart(path, expected, { fetchImpl = globalThis.fetch, signal, onProgress = () => {}, digest = hashBytes } = {}) {
  if (!/^\/api\/exports\/[0-9a-f-]{36}\/parts\/\d+\/download\?generation=[0-9a-f-]{36}$/.test(path)
    || !Number.isSafeInteger(expected?.byteSize) || expected.byteSize < 1 || expected.byteSize > MAX_EXPORT_DOWNLOAD_BYTES
    || typeof expected.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(expected.sha256) || typeof expected.filename !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.zip$/.test(expected.filename)) throw new TypeError("Use a verified bounded export part.");
  const response = await fetchImpl(path, { method: "GET", headers: { Accept: "application/zip", "X-Api-Contract": "1" },
    credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
  if (signal?.aborted) { cancelBody(response); throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
  if (response.status !== 200) {
    let code = "EXPORT_DOWNLOAD_UNAVAILABLE";
    try { if (response.headers.get("Content-Type")?.includes("application/json")) { const body = await response.json(); if (typeof body?.error?.code === "string") code = body.error.code; } else cancelBody(response); } catch { cancelBody(response); }
    throw new ApiError("This export part could not be loaded. Check its current status before trying again.", { status: response.status, code, retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")) });
  }
  const size = response.headers.get("Content-Length"), mime = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mime !== "application/zip" || size !== String(expected.byteSize) || response.headers.get("X-Archive-SHA256") !== expected.sha256
    || response.headers.get("Content-Disposition") !== 'attachment; filename="' + expected.filename + '"' || !response.body?.getReader) { cancelBody(response); throw integrity(); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const stop = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Already closed. */ } };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      const next = await reader.read(); if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw integrity(); bytes += next.value.byteLength;
      if (bytes > expected.byteSize || bytes > MAX_EXPORT_DOWNLOAD_BYTES) throw integrity(); chunks.push(next.value);
      try { onProgress(bytes, expected.byteSize); } catch { /* Presentation cannot change integrity. */ }
    }
    if (bytes !== expected.byteSize) throw integrity();
    const blob = new Blob(chunks, { type: "application/zip" }), checksum = await digest(await blob.arrayBuffer());
    if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    if (checksum !== expected.sha256) throw integrity(); return blob;
  } catch (failure) { stop(); throw failure; }
  finally { signal?.removeEventListener("abort", stop); reader.releaseLock(); }
}
