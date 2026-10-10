import { createArchiveApi, normalizeTextContribution } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";

const REQUEST_TIMEOUT_MS = 30_000;

/** Own one logical message/key until its outcome is known; never retry automatically. */
export function createTextSubmission({ api = createArchiveApi(), randomUUID = () => crypto.randomUUID(), now = Date.now } = {}) {
  let draft = null;
  let idempotencyKey = null;
  let receipt = null;
  let inFlight = null;
  let retryAt = 0;
  let disposed = false, activeController = null;

  return {
    get pending() { return draft !== null && receipt === null; },
    get receipt() { return receipt; },
    get retryAfterSeconds() { return Math.max(0, Math.ceil((retryAt - now()) / 1000)); },
    submit(rawDraft) {
      if (disposed) throw new ApiError("This note draft was cleared.", { code: "REQUEST_ABORTED" });
      if (inFlight) return inFlight;
      if (retryAt > now()) {
        throw new ApiError("Please wait before retrying.", {
          code: "RATE_LIMITED", status: 429, retryAfterSeconds: Math.ceil((retryAt - now()) / 1000),
        });
      }
      const normalized = normalizeTextContribution(rawDraft);
      if (draft && (draft.guestName !== normalized.guestName || draft.message !== normalized.message)) {
        throw new ApiError("Retry your original message before starting another.", {
          code: "DRAFT_CHANGED", unknownOutcome: true,
        });
      }
      if (receipt) return Promise.resolve(receipt);
      if (!draft) {
        draft = Object.freeze(normalized);
        idempotencyKey = randomUUID();
      }
      const controller = new AbortController();
      activeController = controller;
      let timer;
      let onAbort;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(new ApiError("This note draft was cleared.", { code: "REQUEST_ABORTED", unknownOutcome: true }));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      // Bound the entire request, including a response body that never finishes.
      // Racing also ignores a late receipt from a transport that ignores abort.
      const request = Promise.resolve().then(() => {
        if (disposed || controller.signal.aborted) throw new ApiError("This note draft was cleared.", { code: "REQUEST_ABORTED", unknownOutcome: true });
        return api.createTextContribution(draft, { idempotencyKey, signal: controller.signal });
      });
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new ApiError("Could not confirm your note in time. Keep this page open and try again.", {
            code: "REQUEST_TIMEOUT", unknownOutcome: true,
          }));
          controller.abort();
        }, REQUEST_TIMEOUT_MS);
      });
      inFlight = Promise.race([request, deadline, cancelled])
        .then((saved) => {
          if (disposed) throw new ApiError("This note draft was cleared.", { code: "REQUEST_ABORTED", unknownOutcome: true });
          receipt = saved;
          return saved;
        }).catch((error) => {
          if (disposed) throw error;
          if (error instanceof ApiError && [429, 503].includes(error.status)
            && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds >= 0) {
            retryAt = now() + error.retryAfterSeconds * 1000;
          }
          // A v1 validation rejection is known not to have committed. Permit correction.
          if (error instanceof ApiError && error.code === "VALIDATION_FAILED" && !error.unknownOutcome) {
            draft = null;
            idempotencyKey = null;
          }
          throw error;
        }).finally(() => { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); activeController = null; inFlight = null; });
      return inFlight;
    },
    startAnother() {
      if (!receipt || inFlight) throw new Error("Confirm this message before starting another.");
      draft = null;
      idempotencyKey = null;
      receipt = null;
      retryAt = 0;
    },
    dispose() {
      disposed = true;
      activeController?.abort();
      draft = null; idempotencyKey = null; receipt = null; retryAt = 0;
    },
  };
}
