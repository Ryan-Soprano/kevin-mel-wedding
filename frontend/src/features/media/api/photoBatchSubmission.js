import { createArchiveApi, decodeReceipt, normalizeMediaContribution } from "../../../shared/api/archiveApi.js";
import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "../mediaConstraints.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownInvalid = (error) => error.code === "INVALID_MEDIA" && error.status === 422 && !error.unknownOutcome;
const renewableGrant = (error) => !error.unknownOutcome
  && ["UPLOAD_INCOMPLETE", "UPLOAD_GRANT_EXPIRED"].includes(error.code);
const globalFailure = (error) => error.status === 429
  || ["CONTRACT_MISMATCH", "IDEMPOTENCY_CONFLICT", "NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
  || ([401, 403].includes(error.status) && error.code !== "UPLOAD_GRANT_EXPIRED");

async function checksum(file) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validation(message) {
  return new ApiError(message, { code: "VALIDATION_FAILED", status: 400 });
}

function errorDetails(error) {
  return Object.freeze({
    message: error.message, code: error.code ?? "UPLOAD_FAILED", status: error.status ?? 0,
    unknownOutcome: Boolean(error.unknownOutcome), requestId: error.requestId ?? null,
    retryAfterSeconds: error.retryAfterSeconds ?? null,
    fieldErrors: Object.freeze((error.fieldErrors ?? []).map((field) => Object.freeze({ ...field }))),
  });
}

/**
 * One immutable contribution, transferred one original at a time. A deliberate retry
 * reconciles the whole receipt, then an existing grant, before sending bytes again.
 * Files and grants remain only in memory; snapshots contain no signed upload URLs.
 */
export function createPhotoBatchSubmission({
  api = createArchiveApi(), randomUUID = () => crypto.randomUUID(), digest = checksum, now = Date.now,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
  apiTimeoutMs = 30_000, putTimeoutMs = 120_000,
} = {}) {
  let entries = [], input = null, draft = null, key = null, receipt = null, inFlight = null;
  let working = false, disposed = false, retryAt = 0, error = null;
  const cancellations = new Set();

  function assertLive() {
    if (disposed) throw new ApiError("The photo submission was cancelled.", { code: "REQUEST_ABORTED" });
  }

  function isComplete() { return receipt?.completion === "COMPLETE"; }
  function mayStartAnother() {
    return Boolean(input) && !working && !remainingWait() && (isComplete()
      || entries.every((entry) => entry.status === "saved" || entry.knownRejected));
  }
  function remainingWait() { return Math.max(0, Math.ceil((retryAt - now()) / 1000)); }

  function snapshot() {
    const savedCount = entries.filter((entry) => entry.status === "saved").length;
    const phase = working ? "working" : isComplete() ? "complete" : !input ? "idle"
      : entries.every((entry) => entry.status === "saved" || entry.knownRejected) ? "rejected" : "partial";
    return Object.freeze({
      phase, retained: input !== null, pending: input !== null && !isComplete(), complete: isComplete(),
      canStartAnother: mayStartAnother(), retryAt, retryAfterSeconds: remainingWait(),
      contributionId: receipt?.contributionId ?? null, receipt, error, savedCount, totalCount: entries.length,
      items: Object.freeze(entries.map((entry) => Object.freeze({
        id: entry.id, clientItemId: entry.clientItemId, fileName: entry.file.name,
        status: entry.status, memoryId: entry.memoryId, error: entry.error,
        knownRejected: entry.knownRejected, terminal: false,
        retryEligible: !working && !disposed && !remainingWait() && entry.status !== "saved",
        retryAt, retryAfterSeconds: remainingWait(),
      }))),
    });
  }

  function emit(onChange) {
    if (disposed) return;
    // A presentation callback cannot turn a confirmed upload into a failed mutation.
    try { onChange(snapshot()); } catch { /* State remains available through getSnapshot(). */ }
  }

  async function bounded(operation, timeoutMs, unknownOutcome = true) {
    assertLive();
    const controller = new AbortController();
    let timer, cancel;
    const interrupted = new Promise((_, reject) => {
      cancel = () => {
        reject(new ApiError("The photo submission was cancelled. Its outcome may need checking.", {
          code: "REQUEST_ABORTED", unknownOutcome,
        }));
        controller.abort();
      };
      cancellations.add(cancel);
      timer = setTimeoutImpl(() => {
        reject(new ApiError("The request took too long. Keep this page open and retry to check its outcome.", {
          code: "REQUEST_TIMED_OUT", unknownOutcome,
        }));
        controller.abort();
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        assertLive();
        return operation(controller.signal);
      }), interrupted]);
      assertLive();
      return result;
    } finally {
      clearTimeoutImpl(timer);
      cancellations.delete(cancel);
    }
  }

  function options(signal) { return { idempotencyKey: key, signal }; }

  function validate(raw) {
    if (!Array.isArray(raw?.photos) || raw.photos.length < 1 || raw.photos.length > MAX_PHOTOS) {
      throw validation("Choose between one and five photos.");
    }
    for (const photo of raw.photos) {
      if (!(photo?.file instanceof Blob) || !ALLOWED_FILE_TYPES.has(photo.file.type)
        || !photo.file.size || photo.file.size > MAX_PHOTO_BYTES) {
        throw validation("Each photo must be a non-empty JPEG, PNG, or WebP file up to 10 MB.");
      }
      if (photo.id !== undefined && (typeof photo.id !== "string" || !UUID.test(photo.id))) {
        throw validation("Each selected photo needs a unique selection ID.");
      }
    }
    // Distinct placeholders let all metadata be checked before allocating IDs or hashing.
    return normalizeMediaContribution({
      guestName: raw.guestName, memoryType: "PHOTO", items: raw.photos.map((photo, index) => ({
        clientItemId: photo.id ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        originalFilename: photo.file.name, declaredContentType: photo.file.type,
        byteSize: photo.file.size, checksumSha256: "0".repeat(64), caption: photo.caption,
      })),
    });
  }

  function lock(raw, validated) {
    if (input) {
      if (validated.guestName !== input.guestName || raw.photos.length !== entries.length
        || raw.photos.some((photo, index) => photo.file !== entries[index].file
          || validated.items[index].caption !== entries[index].caption
          || (photo.id !== undefined && photo.id !== entries[index].id))) {
        throw new ApiError("Retry these original photos before changing the selection or captions.", {
          code: "DRAFT_CHANGED", unknownOutcome: true,
        });
      }
      return;
    }
    input = Object.freeze({ guestName: validated.guestName });
    entries = raw.photos.map((photo, index) => {
      const id = photo.id ?? randomUUID();
      return { id, clientItemId: id.toLowerCase(), file: photo.file, caption: validated.items[index].caption,
        checksum: null, memoryId: null, grant: null, status: "queued", error: null, knownRejected: false };
    });
    key = randomUUID();
  }

  function acceptReceipt(value, expectedSavedItem = null) {
    decodeReceipt(value);
    if (value.memories.length !== entries.length
      || (receipt && (value.contributionId !== receipt.contributionId || value.createdAt !== receipt.createdAt))) {
      throw contractMismatch();
    }
    const members = new Map(value.memories.map((memory) => [memory.clientItemId, memory]));
    for (const entry of entries) {
      const member = members.get(entry.clientItemId);
      if (!member || member.memoryType !== "PHOTO"
        || (entry.memoryId && member.memoryId !== entry.memoryId)
        || (entry.status === "saved" && member.uploadState !== "UPLOADED")) throw contractMismatch();
    }
    if (expectedSavedItem && members.get(expectedSavedItem).uploadState !== "UPLOADED") {
      throw new ApiError("This photo has not been confirmed. Retry to check it.", {
        code: "UPLOAD_INCOMPLETE", unknownOutcome: true,
      });
    }
    // Validate the entire group before adopting any part of the new response.
    receipt = Object.freeze({ ...value,
      memories: Object.freeze(value.memories.map((memory) => Object.freeze({ ...memory }))),
    });
    for (const entry of entries) {
      const member = members.get(entry.clientItemId);
      entry.memoryId = member.memoryId;
      if (member.uploadState === "UPLOADED") {
        entry.status = "saved"; entry.error = null; entry.grant = null; entry.knownRejected = false;
      } else if (member.uploadState === "FAILED") {
        // A receipt read can still see a previous rejection while a newer finalize
        // transaction is in flight. Only a definitive retained-grant check can
        // resolve that unknown mutation; do not forget its grant or unlock replacement.
        if (entry.error?.unknownOutcome) continue;
        entry.status = "rejected"; entry.knownRejected = true; entry.grant = null;
        entry.error = errorDetails(new ApiError("The server rejected this photo. Retry its original bytes or start another batch.", {
          code: "INVALID_MEDIA", status: 422,
        }));
      }
    }
  }

  async function prepare(onChange) {
    if (draft) return;
    for (const entry of entries) {
      if (!entry.checksum) {
        entry.status = "preparing"; emit(onChange);
        entry.checksum = await bounded(() => digest(entry.file), apiTimeoutMs, false);
      }
      entry.status = "queued";
    }
    const prepared = normalizeMediaContribution({
      guestName: input.guestName, memoryType: "PHOTO", items: entries.map((entry) => ({
        clientItemId: entry.clientItemId, originalFilename: entry.file.name,
        declaredContentType: entry.file.type, byteSize: entry.file.size,
        checksumSha256: entry.checksum, caption: entry.caption,
      })),
    });
    draft = Object.freeze({ ...prepared, items: Object.freeze(prepared.items.map((item) => Object.freeze(item))) });
  }

  async function reconcile(onChange) {
    const next = receipt
      ? await bounded((signal) => api.getReceipt(receipt.contributionId, options(signal)), apiTimeoutMs, false)
      : await bounded((signal) => api.createMediaContribution(draft, options(signal)), apiTimeoutMs);
    acceptReceipt(next); emit(onChange);
  }

  async function finalize(entry, onChange) {
    entry.status = "finalizing"; emit(onChange);
    const next = await bounded((signal) => api.finalizeUpload(
      receipt.contributionId, entry.memoryId, entry.grant.grantId, options(signal)), apiTimeoutMs);
    acceptReceipt(next, entry.clientItemId); emit(onChange);
  }

  async function transfer(entry, onChange) {
    entry.error = null; entry.knownRejected = false;
    if (entry.grant) {
      try { await finalize(entry, onChange); return; }
      catch (failure) {
        if (!renewableGrant(failure)) throw failure;
        entry.grant = null;
      }
    }
    entry.status = "queued"; emit(onChange);
    let grant;
    try {
      grant = await bounded((signal) => api.authorizeUpload(
        receipt.contributionId, entry.memoryId, options(signal)), apiTimeoutMs);
    } catch (failure) {
      if (failure.code !== "ALREADY_COMPLETE" || failure.unknownOutcome) throw failure;
      await reconcile(onChange);
      if (entry.status !== "saved") throw contractMismatch();
      return;
    }
    if (!grant || !UUID.test(grant.grantId) || !Number.isFinite(Date.parse(grant.expiresAt))) throw contractMismatch();
    entry.grant = Object.freeze({ ...grant, headers: Object.freeze({ ...grant.headers }) });
    entry.status = "uploading"; emit(onChange);
    await bounded((signal) => api.uploadMedia(entry.grant, entry.file, { signal }), putTimeoutMs);
    await finalize(entry, onChange);
  }

  function rememberFailure(entry, failure) {
    if (failure.status === 429 && Number.isFinite(failure.retryAfterSeconds) && failure.retryAfterSeconds >= 0) {
      retryAt = now() + failure.retryAfterSeconds * 1000;
    }
    entry.error = errorDetails(failure);
    entry.knownRejected = knownInvalid(failure);
    entry.status = entry.knownRejected ? "rejected" : "failed";
    if (entry.knownRejected) entry.grant = null;
  }

  function run(selected, onChange) {
    let completedSnapshot;
    working = true; error = null;
    inFlight = Promise.resolve().then(async () => {
      assertLive();
      await prepare(onChange);
      await reconcile(onChange);
      assertLive();
      for (const entry of entries) {
        if (!selected.has(entry.id) || entry.status === "saved") continue;
        try { await transfer(entry, onChange); assertLive(); }
        catch (failure) {
          assertLive();
          rememberFailure(entry, failure); emit(onChange);
          if (globalFailure(failure)) { error = errorDetails(failure); break; }
        }
      }
      assertLive();
    }).catch((failure) => {
      if (!disposed) {
        error = errorDetails(failure);
        if (failure.status === 429 && Number.isFinite(failure.retryAfterSeconds) && failure.retryAfterSeconds >= 0) {
          retryAt = now() + failure.retryAfterSeconds * 1000;
        }
        // Preparation/known create validation has no accepted server intent to retain.
        if (!receipt && !failure.unknownOutcome && (!draft || failure.code === "VALIDATION_FAILED")) {
          entries = []; input = null; draft = null; key = null;
        }
        emit(onChange);
      }
      throw failure;
    }).finally(() => {
      working = false;
      completedSnapshot = snapshot();
      emit(onChange);
      inFlight = null;
    }).then(() => completedSnapshot);
    return inFlight;
  }

  function ready() {
    assertLive();
    if (remainingWait()) throw new ApiError("Please wait before retrying these photos.", {
      code: "RATE_LIMITED", status: 429, retryAfterSeconds: remainingWait(),
    });
  }

  return {
    getSnapshot: snapshot,
    get snapshot() { return snapshot(); },
    get pending() { return input !== null && !isComplete(); },
    get complete() { return isComplete(); },
    get canStartAnother() { return mayStartAnother(); },
    get retryAfterSeconds() { return remainingWait(); },
    get receipt() { return receipt; },
    submit(raw, onChange = () => {}) {
      if (inFlight) return inFlight;
      ready();
      const validated = validate(raw);
      lock(raw, validated);
      if (isComplete()) return Promise.resolve(snapshot());
      return run(new Set(entries.filter((entry) => entry.status !== "saved").map((entry) => entry.id)), onChange);
    },
    retry(selectedIds, onChange = () => {}) {
      if (inFlight) return inFlight;
      ready();
      if (!input) throw validation("Choose photos before retrying.");
      const ids = selectedIds ?? entries.filter((entry) => entry.status !== "saved").map((entry) => entry.id);
      if (!Array.isArray(ids) || ids.some((id) => !entries.some((entry) => entry.id === id || entry.clientItemId === id))) {
        throw validation("Choose retry items from this original photo batch.");
      }
      const selected = new Set(entries.filter((entry) => entry.status !== "saved"
        && ids.some((id) => id === entry.id || id === entry.clientItemId)).map((entry) => entry.id));
      if (!selected.size) return Promise.resolve(snapshot());
      return run(selected, onChange);
    },
    startAnother() {
      assertLive();
      if (!mayStartAnother()) throw new ApiError("Confirm the remaining photos before starting another batch.", {
        code: "BATCH_UNCONFIRMED", unknownOutcome: true,
      });
      entries = []; input = null; draft = null; key = null; receipt = null; error = null;
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of cancellations) cancel();
      cancellations.clear();
      // An unmounted coordinator cannot restart or retain file references unnecessarily.
      entries = []; input = null; draft = null; key = null; receipt = null;
    },
  };
}
