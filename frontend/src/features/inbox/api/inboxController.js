import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../../media/mediaConstraints.js";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../audio/audioConstraints.js";

const EMPTY_ITEMS = Object.freeze([]);
const idlePhoto = () => Object.freeze({ phase: "idle", url: null, error: null });
const idleReview = () => Object.freeze({ phase: "idle", targetStatus: null, error: null, canRetry: false });
const REVIEW_STATES = new Set(["PENDING", "KEEP", "ARCHIVED", "DELETE"]);
const interrupted = () => new ApiError("The request was cancelled.", { code: "REQUEST_ABORTED" });

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)])));
  }
  return value;
}

function sessionCopy(value) {
  // Only session contract fields enter presentation state, never credential echoes.
  return frozenCopy({ authenticated: value.authenticated, csrfToken: value.csrfToken,
    user: value.user === null ? null : { displayName: value.user.displayName, roles: value.user.roles } });
}

async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function photoFailure(code = "PHOTO_UNAVAILABLE") {
  return new ApiError("The original photo is unavailable.", { code });
}

function photoMessage(failure, audio = false) {
  const kind = audio ? "audio" : "photo";
  if (failure?.code === "PHOTO_INTEGRITY") return `This ${kind} did not match its saved original. It has not been displayed. Try loading it again.`;
  if (failure?.code === "PHOTO_EXPIRED") return `The ${kind} link expired. Try loading the original again.`;
  if (failure?.code === "REQUEST_TIMED_OUT") return `The ${kind} took too long to load. Try loading it again.`;
  if (failure?.status === 429) return `Please wait before trying to load this ${kind} again.`;
  return `The original ${kind} could not be loaded. The memory is still here. Try loading it again.`;
}

/**
 * A private, in-memory presentation controller. Latest intent owns every result;
 * deadlines include body reads and decoding, even when a transport ignores abort.
 */
export function createInboxController({
  api = createArchiveApi(), fetchImpl = globalThis.fetch,
  createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url),
  now = Date.now, digest = sha256, apiTimeoutMs = 30_000, photoTimeoutMs = 60_000,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  let state = Object.freeze({ phase: "checking", session: null, busy: false, error: null,
    reviewStatus: "PENDING", items: EMPTY_ITEMS, nextCursor: null, detail: null,
    photo: idlePhoto(), review: idleReview(), notice: null, pageResetVersion: 0, logoutUnconfirmed: false });
  let generation = 0, operation = null, disposed = false, objectUrl = null;
  let reviewIntent = null, reviewInFlight = null, reviewUncertain = false, inboxDirty = false;
  let suspended = false, resuming = null;
  let notifying = false, notifyAgain = false;
  const listeners = new Set();

  function notify() {
    if (notifying) { notifyAgain = true; return; }
    notifying = true;
    try {
      do {
        notifyAgain = false;
        const current = state;
        for (const listener of [...listeners]) {
          if (disposed) break;
          if (!listeners.has(listener)) continue;
          try { listener(current); } catch { /* Presentation failures do not change server outcomes. */ }
          // A reentrant action must not deliver a superseded private snapshot.
          if (state !== current) { notifyAgain = true; break; }
        }
      } while (notifyAgain && !disposed);
    } finally { notifying = false; }
  }

  function publish(patch) {
    if (disposed) return;
    const next = { ...state, ...patch };
    if (Object.keys(next).every(key => next[key] === state[key])) return;
    state = Object.freeze(next);
    notify();
  }

  function revokePhoto() {
    const previous = objectUrl;
    objectUrl = null;
    if (previous !== null) {
      try { revokeObjectURL(previous); } catch { /* Cleanup must still clear presentation state. */ }
    }
  }

  function cancel() {
    generation++;
    operation?.controller.abort(interrupted());
    operation = null;
    revokePhoto();
  }

  function start(patch, purpose = null) {
    if (disposed) return null;
    cancel();
    const current = { generation, controller: new AbortController(), purpose };
    operation = current;
    publish({ busy: true, error: null, photo: idlePhoto(), ...patch });
    return current;
  }

  function current(op) { return !disposed && op.generation === generation; }
  function assertCurrent(op) {
    if (!current(op)) throw interrupted();
    if (op.controller.signal.aborted) throw op.controller.signal.reason ?? interrupted();
  }

  async function bounded(op, task, duration = apiTimeoutMs, mutation = false) {
    assertCurrent(op);
    const signal = op.controller.signal;
    let timer, onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason ?? interrupted());
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeoutImpl(() => {
        const failure = new ApiError("The request took too long.", { code: "REQUEST_TIMED_OUT", unknownOutcome: mutation });
        op.controller.abort(failure);
      }, duration);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        assertCurrent(op);
        return task(signal);
      }), cancelled]);
      assertCurrent(op);
      return result;
    } finally {
      clearTimeoutImpl(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  function clearPrivate(patch = {}) {
    revokePhoto();
    reviewIntent = null;
    reviewUncertain = false;
    inboxDirty = false;
    publish({ session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, photo: idlePhoto(),
      review: idleReview(), notice: null, ...patch });
  }

  function authFailure(failure) {
    if (failure?.status === 401) {
      clearPrivate({ phase: "login", error: failure.code === "INVALID_CREDENTIALS"
        ? "That username or password was not accepted."
        : "Your session has expired. Sign in again to view the archive." });
      return true;
    }
    if (failure?.status === 403) {
      clearPrivate({ phase: "unavailable", error: "Archive access is unavailable. Please check with Ryan." });
      return true;
    }
    return false;
  }

  async function run(op, task, failureHandler) {
    if (!op) return state;
    try { await task(op); }
    catch (failure) {
      if (current(op)) failureHandler(failure);
    } finally {
      if (current(op)) {
        operation = null;
        publish({ busy: false });
      }
    }
    return state;
  }

  async function page(op, reviewStatus, cursor) {
    const result = await bounded(op, signal => api.listMemories({ reviewStatus,
      ...(cursor !== null ? { cursor } : {}), signal }));
    assertCurrent(op);
    publish({ phase: "inbox", reviewStatus, items: frozenCopy(result.items), nextCursor: result.nextCursor, detail: null });
    inboxDirty = false;
  }

  function unavailableReview() {
    reviewIntent = null;
    reviewUncertain = false;
    inboxDirty = true;
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: state.pageResetVersion + 1,
      detail: null, review: idleReview(), error: "This memory is unavailable. Return to the inbox and reload it." });
  }

  function reviewState(phase, error = null, canRetry = false) {
    return Object.freeze({ phase, targetStatus: reviewIntent?.targetStatus ?? null, error, canRetry });
  }

  async function acceptCurrentReview(op, memory, notice) {
    assertCurrent(op);
    reviewIntent = null;
    reviewUncertain = false;
    inboxDirty = true;
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: state.pageResetVersion + 1,
      detail: frozenCopy(memory), review: idleReview(), notice, error: null });
    assertCurrent(op);
    if (["PHOTO", "AUDIO"].includes(memory.memoryType) && memory.reviewStatus !== "DELETE") await photo(op, memory);
  }

  function reviewFailure(failure) {
    if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      publish({ review: reviewState("csrf", "Refresh your session, then reconsider this change. No automatic retry will be made.") });
    } else if (authFailure(failure)) {
      // Authentication failures also clear the frozen review intent and owned previews.
    } else if ([412, 428].includes(failure?.status)) {
      publish({ review: reviewState("conflict", "This memory changed or its revision could not be checked. Reload its current state before choosing an action.") });
    } else if (failure?.status === 404) {
      unavailableReview();
    } else if (failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      reviewUncertain = true;
      publish({ review: reviewState("uncertain", "We could not confirm whether this change was saved. Reload the current state before doing anything else.") });
    } else if (reviewUncertain) {
      // A rejected retry cannot establish what happened to the first timed-out request.
      publish({ review: reviewState("uncertain", "This retry was not accepted, but the earlier request is still unconfirmed. Reload the current state before doing anything else.") });
    } else {
      reviewIntent = null;
      publish({ review: idleReview(), error: failure?.status === 429
        ? "Please wait before choosing this action again. The change was not accepted."
        : "The change was not accepted. Your memory is still here; reload it before trying again." });
    }
  }

  function rememberReviewRun(op, task, onFailure = reviewFailure) {
    const completion = run(op, task, onFailure).finally(() => {
      if (reviewInFlight === completion) reviewInFlight = null;
    });
    reviewInFlight = completion;
    return completion;
  }

  function sendReview() {
    const intent = reviewIntent;
    const token = state.session?.csrfToken;
    const op = start({ phase: "detail", review: reviewState("saving"), notice: null });
    return rememberReviewRun(op, async () => {
      const memory = await bounded(op, signal => api.reviewMemory(intent.memoryId, {
        reviewStatus: intent.targetStatus, revision: intent.expectedRevision,
      }, { csrfToken: token, signal }), apiTimeoutMs, true);
      if (memory.memoryId !== intent.memoryId || memory.reviewStatus !== intent.targetStatus
        || memory.revision !== intent.expectedRevision + (intent.fromStatus === intent.targetStatus ? 0 : 1)) throw contractMismatch();
      await acceptCurrentReview(op, memory, {
        PENDING: "Restored to your pending inbox. This memory stays private.",
        KEEP: "Kept privately. This memory has not been published.",
        ARCHIVED: "Archived privately. You can restore it to your inbox.",
        DELETE: "Moved to Recently deleted. You can restore it during its 30-day recovery window.",
      }[memory.reviewStatus]);
    });
  }

  async function reconcileReview(op, memory, notice) {
    const intent = reviewIntent;
    if (memory.memoryId !== intent.memoryId || memory.revision < intent.expectedRevision) throw contractMismatch();
    if (reviewUncertain && memory.revision === intent.expectedRevision) {
      // A read can precede a late commit, including after a known rejection of a retry.
      if (memory.reviewStatus !== intent.fromStatus) throw contractMismatch();
      publish({ detail: frozenCopy(memory), review: reviewState("uncertain",
        "The current read still shows the earlier revision. The first request may still finish. Retry only this same change, or reload again.", true) });
    } else await acceptCurrentReview(op, memory, notice);
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
      if (!current(op)) { revokeObjectURL(nextUrl); return; }
      objectUrl = nextUrl;
      publish({ photo: Object.freeze({ phase: "ready", url: nextUrl, error: null }) });
    } catch (failure) {
      if (!current(op)) return;
      if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure, audio) }) });
    }
  }

  const controller = {
    getSnapshot: () => state,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A state listener is required.");
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    suspend() {
      if (disposed || (suspended && !resuming)) return state;
      // Preserve only the frozen action identity, never the displayed memory or token.
      if (reviewIntent && reviewInFlight) reviewUncertain = true;
      const logoutUnconfirmed = state.logoutUnconfirmed || operation?.purpose === "logout";
      suspended = true;
      resuming = null;
      reviewInFlight = null;
      cancel();
      inboxDirty = true;
      publish({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), notice: null, busy: false, error: null, logoutUnconfirmed,
        review: reviewIntent ? reviewState("uncertain") : idleReview(),
        pageResetVersion: state.pageResetVersion + 1 });
      return state;
    },
    resume() {
      if (disposed || !suspended) return Promise.resolve(state);
      if (resuming) return resuming;
      if (state.logoutUnconfirmed) { suspended = false; return controller.logout(); }
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null });
      const completion = run(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        if (!session.authenticated) {
          clearPrivate({ phase: "login", error: "Sign in again to view the archive." });
          suspended = false;
          return;
        }
        publish({ session });
        if (reviewIntent) {
          const memory = await bounded(op, signal => api.getMemory(reviewIntent.memoryId, { signal }));
          publish({ phase: "detail" });
          await reconcileReview(op, memory, "Current state reloaded after checking access. Review it before choosing another action; this does not identify who changed it.");
        } else await page(op, state.reviewStatus, null);
        assertCurrent(op);
        suspended = false;
      }, failure => {
        if (authFailure(failure)) { suspended = false; return; }
        if (failure?.status === 404 && reviewIntent) {
          unavailableReview(); suspended = false; return;
        }
        // A failed recheck hides all content but keeps an uncertain action recoverable.
        revokePhoto();
        publish({ phase: "unavailable", session: null, items: EMPTY_ITEMS, nextCursor: null,
          detail: null, photo: idlePhoto(), notice: null,
          error: "Archive access could not be checked. Private content is hidden. Try checking access again." });
      }).finally(() => { if (resuming === completion) resuming = null; });
      resuming = completion;
      return completion;
    },
    loadSession() {
      if (suspended) return controller.resume();
      if (reviewIntent) return Promise.resolve(state);
      if (state.logoutUnconfirmed) return controller.logout();
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null });
      return run(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        publish({ session, phase: session.authenticated ? "inbox" : "login" });
        if (session.authenticated) await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) clearPrivate({ phase: "unavailable", error: "The archive could not be reached. Try checking access again." });
      });
    },
    login(credentials) {
      if (reviewIntent) return Promise.resolve(state);
      const op = start({ phase: "login", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null, logoutUnconfirmed: false });
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        const session = sessionCopy(await bounded(op, signal => api.login(
          { username: credentials.username, password: credentials.password }, { csrfToken: fresh.csrfToken, signal })));
        if (!session.authenticated) throw new ApiError("Sign-in was not confirmed.", { code: "CONTRACT_MISMATCH" });
        publish({ session, phase: "inbox" });
        await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) {
          if (state.session?.authenticated) publish({ phase: "inbox", error: "Your inbox could not be loaded. Try loading it again." });
          else clearPrivate({ phase: "login", error: failure?.status === 429
            ? "Too many sign-in attempts. Please wait before trying again."
            : "Sign-in could not be confirmed. Try signing in again." });
        }
      });
    },
    logout() {
      if (reviewIntent) return Promise.resolve(state);
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, logoutUnconfirmed: false }, "logout");
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        if (fresh.authenticated) await bounded(op, signal => api.logout({ csrfToken: fresh.csrfToken, signal }));
        clearPrivate({ phase: "login", error: null, logoutUnconfirmed: false });
      }, () => clearPrivate({ phase: "unavailable", logoutUnconfirmed: true,
        error: "Sign-out could not be confirmed. Private content is hidden here. Retry signing out before leaving a shared device." }));
    },
    loadInbox(reviewStatus = "PENDING", cursor = null) {
      if (!state.session?.authenticated || disposed || reviewIntent) return Promise.resolve(state);
      const changed = reviewStatus !== state.reviewStatus;
      const op = start({ phase: "inbox", reviewStatus, detail: null, notice: null,
        ...(changed ? { items: EMPTY_ITEMS, nextCursor: null } : {}) });
      return run(op, () => page(op, reviewStatus, cursor), failure => {
        if (!authFailure(failure)) publish({ error: "Your inbox could not be loaded. Try loading it again." });
      });
    },
    openMemory(id) {
      if (!state.session?.authenticated || disposed || reviewIntent) return Promise.resolve(state);
      const op = start({ phase: "detail", detail: null, notice: null });
      return run(op, async () => {
        const detail = frozenCopy(await bounded(op, signal => api.getMemory(id, { signal })));
        publish({ detail });
        assertCurrent(op);
        if (["PHOTO", "AUDIO"].includes(detail.memoryType) && detail.reviewStatus !== "DELETE") await photo(op, detail);
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) unavailableReview();
        else publish({ error: "This memory could not be loaded. Return to the inbox and try again." });
      });
    },
    backToInbox() {
      if (disposed || !state.session?.authenticated || reviewIntent) return state;
      if (inboxDirty) return controller.loadInbox(state.reviewStatus);
      cancel();
      publish({ phase: "inbox", busy: false, error: null, detail: null, photo: idlePhoto(), notice: null });
      return state;
    },
    retryPhoto() {
      if (state.phase !== "detail" || !["PHOTO", "AUDIO"].includes(state.detail?.memoryType) || state.detail.reviewStatus === "DELETE"
        || !state.session?.authenticated || disposed || reviewIntent) return Promise.resolve(state);
      const detail = state.detail;
      const op = start({ phase: "detail", detail });
      return run(op, () => photo(op, detail), failure => {
        if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure, detail.memoryType === "AUDIO") }) });
      });
    },
    retryMedia() { return controller.retryPhoto(); },
    reviewMemory(targetStatus) {
      if (!REVIEW_STATES.has(targetStatus)) throw new TypeError("Choose a supported private review state.");
      if (reviewInFlight) return reviewInFlight;
      if (disposed || reviewIntent || state.busy || state.phase !== "detail"
        || !state.detail || !state.session?.authenticated) return Promise.resolve(state);
      reviewIntent = Object.freeze({ memoryId: state.detail.memoryId, fromStatus: state.detail.reviewStatus,
        targetStatus, expectedRevision: state.detail.revision });
      reviewUncertain = false;
      return sendReview();
    },
    retryReview() {
      if (reviewInFlight) return reviewInFlight;
      if (disposed || !reviewIntent || state.busy || state.review.phase !== "uncertain"
        || !state.review.canRetry || !state.session?.authenticated) return Promise.resolve(state);
      return sendReview();
    },
    reloadReview() {
      if (reviewInFlight) return reviewInFlight;
      if (disposed || suspended || !reviewIntent || state.busy || !["uncertain", "conflict"].includes(state.review.phase)) return Promise.resolve(state);
      const intent = reviewIntent;
      const previousPhase = state.review.phase;
      const op = start({ phase: "detail", review: reviewState("loading"), notice: null });
      return rememberReviewRun(op, async () => {
        const memory = await bounded(op, signal => api.getMemory(intent.memoryId, { signal }));
        await reconcileReview(op, memory, "Current state reloaded. Review it before choosing another action; this does not identify who changed it.");
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) {
          unavailableReview();
        } else publish({ review: reviewState(previousPhase, "The current state could not be loaded. Please try reloading it again.") });
      });
    },
    refreshReviewSession() {
      if (reviewInFlight) return reviewInFlight;
      if (disposed || suspended || !reviewIntent || state.busy || state.review.phase !== "csrf") return Promise.resolve(state);
      const intent = reviewIntent;
      const op = start({ phase: "detail", review: reviewState("refreshing"), notice: null });
      return rememberReviewRun(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
        publish({ session });
        const memory = await bounded(op, signal => api.getMemory(intent.memoryId, { signal }));
        await reconcileReview(op, memory, "Session and memory refreshed. Choose the action again if you still want it.");
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) {
          unavailableReview();
        } else publish({ review: reviewState("csrf", "The session and current memory could not be refreshed. Try refreshing again.") });
      });
    },
    dispose() {
      if (disposed) return;
      cancel();
      reviewIntent = null;
      reviewInFlight = null;
      reviewUncertain = false;
      inboxDirty = false;
      state = Object.freeze({ ...state, session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), review: idleReview(), notice: null, busy: false, error: null });
      suspended = true;
      resuming = null;
      disposed = true;
      listeners.clear();
    },
  };
  return Object.freeze(controller);
}
