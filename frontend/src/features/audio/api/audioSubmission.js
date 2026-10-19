import {
  createArchiveApi,
  decodeReceipt,
  normalizeMediaContribution,
} from "../../../shared/api/archiveApi.js";
import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import {
  AUDIO_CONTENT_TYPES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
} from "../audioConstraints.js";

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";
async function checksum(file) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** One retained original and immutable intent. Every recovery is a deliberate action. */
export function createAudioSubmission({
  api = createArchiveApi(),
  randomUUID = () => crypto.randomUUID(),
  digest = checksum,
  now = Date.now,
  apiTimeoutMs = 30_000,
  putTimeoutMs = 120_000,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  let file = null,
    input = null,
    draft = null,
    key = null,
    receipt = null,
    grant = null,
    inFlight = null;
  let failed = false,
    retryAt = 0,
    disposed = false;
  const cancellations = new Set();
  const complete = () => receipt?.completion === "COMPLETE";
  const wait = () => Math.max(0, Math.ceil((retryAt - now()) / 1000));
  const options = (signal) => ({ idempotencyKey: key, signal });
  const live = () => {
    if (disposed)
      throw new ApiError("Audio submission was cancelled.", {
        code: "REQUEST_ABORTED",
      });
  };

  function normalized(
    raw,
    clientItemId = PLACEHOLDER_ID,
    hash = "0".repeat(64),
  ) {
    if (
      !(raw?.file instanceof Blob) ||
      !AUDIO_CONTENT_TYPES.has(raw.file.type) ||
      !raw.file.size ||
      raw.file.size > MAX_AUDIO_BYTES ||
      !Number.isFinite(raw.durationSeconds) ||
      raw.durationSeconds <= 0 ||
      raw.durationSeconds > MAX_AUDIO_SECONDS
    ) {
      throw new ApiError(
        "Choose playable WebM, Ogg, or M4A audio up to two minutes and 25 MB.",
        { code: "VALIDATION_FAILED", status: 400 },
      );
    }
    return normalizeMediaContribution({
      guestName: raw.guestName,
      memoryType: "AUDIO",
      items: [
        {
          clientItemId,
          originalFilename: raw.file.name,
          declaredContentType: raw.file.type,
          byteSize: raw.file.size,
          checksumSha256: hash,
          caption: raw.caption,
          durationSeconds: raw.durationSeconds,
        },
      ],
    });
  }
  async function bounded(operation, timeoutMs, mutation = true) {
    live();
    const controller = new AbortController();
    let timer, cancel;
    const cancelled = new Promise((_, reject) => {
      cancel = () => {
        reject(
          new ApiError(
            "The audio request was cancelled. Its outcome may need checking.",
            {
              code: "REQUEST_ABORTED",
              unknownOutcome: mutation,
            },
          ),
        );
        controller.abort();
      };
      cancellations.add(cancel);
      timer = setTimeoutImpl(() => {
        reject(
          new ApiError(
            "Audio confirmation took too long. Keep this page open and retry this same clip.",
            {
              code: "REQUEST_TIMED_OUT",
              unknownOutcome: mutation,
            },
          ),
        );
        controller.abort();
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          live();
          return operation(controller.signal);
        }),
        cancelled,
      ]);
      live();
      return result;
    } finally {
      clearTimeoutImpl(timer);
      cancellations.delete(cancel);
    }
  }
  function accept(next, requireUploaded = false) {
    decodeReceipt(next);
    const member = next.memories[0];
    if (
      next.memories.length !== 1 ||
      member.memoryType !== "AUDIO" ||
      member.clientItemId !== draft.items[0].clientItemId ||
      (receipt &&
        (next.contributionId !== receipt.contributionId ||
          next.createdAt !== receipt.createdAt ||
          member.memoryId !== receipt.memories[0].memoryId ||
          (complete() && member.uploadState !== "UPLOADED")))
    )
      throw contractMismatch();
    if (requireUploaded && member.uploadState !== "UPLOADED")
      throw new ApiError(
        "This clip has not been confirmed. Retry to check it.",
        {
          code: "UPLOAD_INCOMPLETE",
          unknownOutcome: true,
        },
      );
    receipt = Object.freeze({
      ...next,
      memories: Object.freeze(
        next.memories.map((item) => Object.freeze({ ...item })),
      ),
    });
    if (complete()) {
      grant = null;
      failed = false;
    }
  }
  async function finalize(progress) {
    progress("Verifying the original audio…");
    accept(
      await bounded(
        (signal) =>
          api.finalizeUpload(
            receipt.contributionId,
            receipt.memories[0].memoryId,
            grant.grantId,
            options(signal),
          ),
        apiTimeoutMs,
      ),
      true,
    );
  }
  function progressCallback(callback) {
    return (message) => {
      if (!disposed) {
        try {
          callback(message);
        } catch {
          /* Preserve server outcomes. */
        }
      }
    };
  }
  const submission = {
    get retained() {
      return input !== null;
    },
    get pending() {
      return input !== null && !complete();
    },
    get complete() {
      return complete();
    },
    get failed() {
      return failed;
    },
    get receipt() {
      return receipt;
    },
    get retryAfterSeconds() {
      return wait();
    },
    submit(raw, onProgress = () => {}) {
      live();
      if (inFlight) return inFlight;
      if (wait())
        throw new ApiError("Please wait before retrying.", {
          code: "RATE_LIMITED",
          status: 429,
          retryAfterSeconds: wait(),
        });
      const validated = normalized(raw);
      if (
        input &&
        (raw.file !== file ||
          validated.guestName !== input.guestName ||
          validated.items[0].caption !== input.items[0].caption ||
          raw.durationSeconds !== input.items[0].durationSeconds)
      ) {
        throw new ApiError("Retry this original clip before changing it.", {
          code: "DRAFT_CHANGED",
          unknownOutcome: true,
        });
      }
      if (complete()) return Promise.resolve(receipt);
      if (!input) {
        file = raw.file;
        input = Object.freeze({
          ...validated,
          items: Object.freeze(validated.items.map(Object.freeze)),
        });
      }
      const progress = progressCallback(onProgress);
      inFlight = (async () => {
        failed = false;
        if (!draft) {
          progress("Preparing the original audio…");
          const hash = await bounded(() => digest(file), apiTimeoutMs, false);
          draft = normalized(raw, randomUUID(), hash);
          draft = Object.freeze({
            ...draft,
            items: Object.freeze(draft.items.map(Object.freeze)),
          });
          key = randomUUID();
        }
        progress("Checking this audio submission…");
        accept(
          receipt
            ? await bounded(
                (signal) =>
                  api.getReceipt(receipt.contributionId, options(signal)),
                apiTimeoutMs,
                false,
              )
            : await bounded(
                (signal) => api.createMediaContribution(draft, options(signal)),
                apiTimeoutMs,
              ),
        );
        if (complete()) return receipt;
        if (grant) {
          try {
            await finalize(progress);
            return receipt;
          } catch (error) {
            if (
              error.unknownOutcome ||
              !["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"].includes(
                error.code,
              )
            )
              throw error;
            grant = null;
          }
        }
        try {
          const next = await bounded(
            (signal) =>
              api.authorizeUpload(
                receipt.contributionId,
                receipt.memories[0].memoryId,
                options(signal),
              ),
            apiTimeoutMs,
          );
          const contentType = Object.entries(next?.headers ?? {}).find(
            ([name]) => name.toLowerCase() === "content-type",
          )?.[1];
          if (
            !next?.grantId ||
            !Number.isFinite(Date.parse(next.expiresAt)) ||
            contentType !== file.type
          )
            throw contractMismatch();
          grant = Object.freeze({
            ...next,
            headers: Object.freeze({ ...next.headers }),
          });
        } catch (error) {
          if (error.code !== "ALREADY_COMPLETE" || error.unknownOutcome)
            throw error;
          accept(
            await bounded(
              (signal) =>
                api.getReceipt(receipt.contributionId, options(signal)),
              apiTimeoutMs,
              false,
            ),
          );
          if (!complete()) throw contractMismatch();
          return receipt;
        }
        progress("Uploading the original audio…");
        await bounded(
          (signal) => api.uploadMedia(grant, file, { signal }),
          putTimeoutMs,
        );
        await finalize(progress);
        return receipt;
      })()
        .catch((error) => {
          if (
            [429, 503].includes(error.status) &&
            Number.isFinite(error.retryAfterSeconds) &&
            error.retryAfterSeconds >= 0
          ) {
            retryAt = now() + error.retryAfterSeconds * 1000;
          }
          if (
            error.code === "INVALID_MEDIA" &&
            error.status === 422 &&
            !error.unknownOutcome
          ) {
            failed = true;
            grant = null;
          }
          if (
            !draft ||
            (!receipt &&
              error.code === "VALIDATION_FAILED" &&
              !error.unknownOutcome)
          ) {
            file = null;
            input = null;
            draft = null;
            key = null;
          }
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    startAnother() {
      live();
      if (inFlight || wait() || (input && !complete() && !failed))
        throw new Error("Confirm this clip before starting another.");
      file = input = draft = key = receipt = grant = null;
      failed = false;
      retryAt = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      [...cancellations].forEach((cancel) => cancel());
      file = input = draft = key = receipt = grant = null;
    },
  };
  return Object.freeze(submission);
}
