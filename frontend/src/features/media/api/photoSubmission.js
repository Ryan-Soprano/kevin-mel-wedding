import { createArchiveApi, normalizeMediaContribution } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../mediaConstraints.js";

async function checksum(file) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

/** Retains the original bytes, metadata, IDs and key through each deliberate retry. */
export function createPhotoSubmission({
  api = createArchiveApi(), randomUUID = () => crypto.randomUUID(), digest = checksum, now = Date.now,
} = {}) {
  let file = null, draft = null, key = null, receipt = null, grant = null, inFlight = null;
  let failed = false, retryAt = 0;

  function normalized(raw, clientItemId = PLACEHOLDER_ID, hash = "0".repeat(64)) {
    if (!(raw.file instanceof Blob) || !ALLOWED_FILE_TYPES.has(raw.file.type)
      || !raw.file.size || raw.file.size > MAX_PHOTO_BYTES) {
      throw new ApiError("Choose a non-empty JPEG, PNG, or WebP photo up to 10 MB.", { code: "VALIDATION_FAILED" });
    }
    return normalizeMediaContribution({
      guestName: raw.guestName, memoryType: "PHOTO",
      items: [{
        clientItemId, originalFilename: raw.file.name, declaredContentType: raw.file.type,
        byteSize: raw.file.size, checksumSha256: hash, caption: raw.caption,
      }],
    });
  }
  const complete = () => receipt?.completion === "COMPLETE";
  const options = () => ({ idempotencyKey: key });
  const memoryId = () => receipt.memories[0].memoryId;

  return {
    get pending() { return draft !== null && !complete(); },
    get complete() { return complete(); },
    get failed() { return failed; },
    get receipt() { return receipt; },
    get retryAfterSeconds() { return Math.max(0, Math.ceil((retryAt - now()) / 1000)); },
    submit(raw, onProgress = () => {}) {
      if (inFlight) return inFlight;
      if (retryAt > now()) throw new ApiError("Please wait before retrying.", {
        code: "RATE_LIMITED", status: 429, retryAfterSeconds: Math.ceil((retryAt - now()) / 1000),
      });
      const validated = normalized(raw);
      if (draft && (raw.file !== file || validated.guestName !== draft.guestName
        || validated.items[0].caption !== draft.items[0].caption)) {
        throw new ApiError("Retry this original photo before choosing another.", { code: "DRAFT_CHANGED", unknownOutcome: true });
      }
      if (complete()) return Promise.resolve(receipt);
      inFlight = (async () => {
        if (!draft) {
          onProgress("Preparing photo…");
          const hash = await digest(raw.file);
          const prepared = normalized(raw, randomUUID(), hash);
          file = raw.file;
          draft = Object.freeze({ ...prepared, items: Object.freeze(prepared.items.map(Object.freeze)) });
          key = randomUUID();
        }
        failed = false;
        onProgress("Checking photo submission…");
        if (!receipt) receipt = await api.createMediaContribution(draft, options());
        else receipt = await api.getReceipt(receipt.contributionId, options());
        if (complete()) return receipt;
        // A lost PUT/finalize response may already have produced a verified object.
        if (grant) {
          try {
            onProgress("Checking uploaded photo…");
            receipt = await api.finalizeUpload(receipt.contributionId, memoryId(), grant.grantId, options());
            if (complete()) return receipt;
          } catch (error) {
            if (!["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"].includes(error.code)) throw error;
          }
          grant = null;
        }
        grant = await api.authorizeUpload(receipt.contributionId, memoryId(), options());
        onProgress("Uploading original photo…");
        await api.uploadMedia(grant, file);
        onProgress("Verifying original photo…");
        receipt = await api.finalizeUpload(receipt.contributionId, memoryId(), grant.grantId, options());
        if (!complete()) throw new ApiError("The photo is not yet confirmed. Keep this page open and retry.", {
          code: "UPLOAD_INCOMPLETE", unknownOutcome: true,
        });
        return receipt;
      })().catch((error) => {
        if (error instanceof ApiError && [429, 503].includes(error.status)
          && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds >= 0) {
          retryAt = now() + error.retryAfterSeconds * 1000;
        }
        if (error.code === "INVALID_MEDIA" && error.status === 422 && !error.unknownOutcome) {
          failed = true;
          grant = null;
        }
        // Creation validation is a known rejection; permit correction of unsent metadata.
        if (!receipt && error.code === "VALIDATION_FAILED" && !error.unknownOutcome) {
          draft = null; file = null; key = null;
        }
        throw error;
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
    startAnother() {
      if (inFlight || (!complete() && !failed)) throw new Error("Confirm this photo before starting another.");
      file = null; draft = null; key = null; receipt = null; grant = null; failed = false; retryAt = 0;
    },
  };
}
