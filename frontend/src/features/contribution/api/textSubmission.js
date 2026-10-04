import { createArchiveApi, normalizeTextContribution } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";

/** Own one logical message/key until its outcome is known; never retry automatically. */
export function createTextSubmission({ api = createArchiveApi(), randomUUID = () => crypto.randomUUID(), now = Date.now } = {}) {
  let draft = null;
  let idempotencyKey = null;
  let receipt = null;
  let inFlight = null;
  let retryAt = 0;

  return {
    get pending() { return draft !== null && receipt === null; },
    get receipt() { return receipt; },
    get retryAfterSeconds() { return Math.max(0, Math.ceil((retryAt - now()) / 1000)); },
    submit(rawDraft) {
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
      inFlight = Promise.resolve().then(() => api.createTextContribution(draft, { idempotencyKey }))
        .then((saved) => {
          receipt = saved;
          return saved;
        }).catch((error) => {
          if (error instanceof ApiError && error.status === 429 && error.retryAfterSeconds !== null) {
            retryAt = now() + error.retryAfterSeconds * 1000;
          }
          // A v1 validation rejection is known not to have committed. Permit correction.
          if (error instanceof ApiError && error.code === "VALIDATION_FAILED" && !error.unknownOutcome) {
            draft = null;
            idempotencyKey = null;
          }
          throw error;
        }).finally(() => { inFlight = null; });
      return inFlight;
    },
    startAnother() {
      if (!receipt || inFlight) throw new Error("Confirm this message before starting another.");
      draft = null;
      idempotencyKey = null;
      receipt = null;
      retryAt = 0;
    },
  };
}
