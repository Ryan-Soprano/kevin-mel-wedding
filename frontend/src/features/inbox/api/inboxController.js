import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../../media/mediaConstraints.js";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../audio/audioConstraints.js";
import { normalizeMemoryMetadata, metadataOf, sameMetadata } from "../memoryMetadata.js";
import { createCoupleSubmissionApi } from "./coupleSubmissionApi.js";
import { createAlbumActions, initialAlbums } from "../../albums/api/albumActions.js";

const EMPTY_ITEMS = Object.freeze([]);
const idlePhoto = () => Object.freeze({ phase: "idle", url: null, error: null });
const idleReview = () => Object.freeze({ phase: "idle", targetStatus: null, error: null, canRetry: false });
const idleMetadata = () => Object.freeze({ phase: "idle", error: null, canRetry: false });
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
  albumNameFingerprint,
} = {}) {
  let state = Object.freeze({ phase: "checking", session: null, busy: false, error: null,
    reviewStatus: "PENDING", items: EMPTY_ITEMS, nextCursor: null, detail: null,
    photo: idlePhoto(), review: idleReview(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null, notice: null, pageResetVersion: 0, logoutUnconfirmed: false });
  let generation = 0, operation = null, disposed = false, objectUrl = null;
  let reviewIntent = null, reviewInFlight = null, reviewUncertain = false, inboxDirty = false;
  let metadataIntent = null, metadataInFlight = null, metadataUncertain = false, metadataHiddenId = null;
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
    metadataIntent = null; metadataUncertain = false; metadataHiddenId = null;
    inboxDirty = false;
    albums.clear();
    publish({ session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, photo: idlePhoto(),
      review: idleReview(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null, notice: null, ...patch });
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
    metadataIntent = null; metadataUncertain = false; metadataHiddenId = null;
    inboxDirty = true;
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: state.pageResetVersion + 1,
      detail: null, review: idleReview(), metadata: idleMetadata(), error: "This memory is unavailable. Return to the inbox and reload it." });
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

  const metadataState = (phase, error = null, canRetry = false) => Object.freeze({ phase, error, canRetry });
  const originalContext = memory => JSON.stringify([memory.contributionId, memory.memoryType, memory.source,
    memory.guestName, memory.textContent, memory.caption, memory.createdAt, memory.media === null ? null
      : [memory.media.originalFilename, memory.media.detectedContentType, memory.media.byteSize,
        memory.media.checksumSha256, memory.media.durationSeconds, memory.media.uploadState]]);
  async function acceptMetadata(op, memory, notice) {
    assertCurrent(op);
    metadataIntent = null; metadataUncertain = false;
    inboxDirty = true;
    publish({ items: EMPTY_ITEMS, nextCursor: null, pageResetVersion: state.pageResetVersion + 1,
      detail: frozenCopy(memory), metadata: idleMetadata(), notice, error: null });
    assertCurrent(op);
    if (["PHOTO", "AUDIO"].includes(memory.memoryType) && memory.reviewStatus !== "DELETE") await photo(op, memory);
  }
  function metadataFailure(failure) {
    if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      publish({ metadata: metadataState("csrf", "Refresh your session and this memory before reconsidering the edit.") });
    } else if (authFailure(failure)) {
      // Access loss clears the editor, frozen draft and original previews.
    } else if ([412, 428].includes(failure?.status)) {
      publish({ metadata: metadataState("conflict", "This memory changed. Reload its current state before editing again. Your edit has not overwritten it.") });
    } else if (failure?.status === 404) unavailableReview();
    else if (metadataUncertain || failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      metadataUncertain = true;
      publish({ metadata: metadataState("uncertain", "We could not confirm this metadata edit. Reload the current state before choosing another action.") });
    } else {
      metadataIntent = null;
      publish({ metadata: idleMetadata(), error: failure?.status === 429
        ? "Please wait before saving metadata again. This request was not accepted."
        : "The metadata edit was not accepted. Check the fields and try again." });
    }
  }
  function metadataRun(op, task, onFailure = metadataFailure) {
    const completion = run(op, task, onFailure).finally(() => { if (metadataInFlight === completion) metadataInFlight = null; });
    metadataInFlight = completion;
    return completion;
  }
  function sendMetadata() {
    const intent = metadataIntent, token = state.session?.csrfToken;
    const op = start({ phase: "detail", metadata: metadataState("saving"), notice: null });
    return metadataRun(op, async () => {
      const memory = await bounded(op, signal => api.updateMemoryMetadata(intent.memoryId, intent.target, {
        revision: intent.expectedRevision, csrfToken: token, signal,
      }), apiTimeoutMs, true);
      if (memory.memoryId !== intent.memoryId || originalContext(memory) !== intent.original
        || memory.reviewStatus !== intent.fromStatus || memory.deleteAfter !== intent.deleteAfter
        || !sameMetadata(memory, intent.target)
        || memory.revision !== intent.expectedRevision + (sameMetadata(intent.before, intent.target) ? 0 : 1)) throw contractMismatch();
      await acceptMetadata(op, memory, "Memory details saved privately. Your original content is preserved.");
    });
  }
  async function reconcileMetadata(op, memory) {
    const intent = metadataIntent;
    if (memory.memoryId !== intent.memoryId || memory.revision < intent.expectedRevision
      || originalContext(memory) !== intent.original) throw contractMismatch();
    if (metadataUncertain && memory.revision === intent.expectedRevision) {
      if (!sameMetadata(memory, intent.before) || memory.reviewStatus !== intent.fromStatus
        || memory.deleteAfter !== intent.deleteAfter) throw contractMismatch();
      publish({ detail: frozenCopy(memory), metadata: metadataState("uncertain",
        "The current read still shows the earlier revision. The first request may still finish. Retry only this same edit, or reload again.", true) });
    } else await acceptMetadata(op, memory,
      "Current memory details loaded. Review them before editing again; this does not identify who changed them.");
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

  const albums = createAlbumActions({ api, getState: () => state, publish, start, bounded, run, assertCurrent, isCurrent: current,
    authFailure, freeze: frozenCopy,
    canNavigate: () => !disposed && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !reviewIntent && !metadataIntent,
    openMemory: (id, options) => controller.openMemory(id, options), nameFingerprint: albumNameFingerprint,
  });
  const controller = {
    loadAlbums: (...args) => albums.loadAlbums(...args),
    openAlbum: (...args) => albums.openAlbum(...args),
    beginAlbumCreation: () => albums.beginAlbumCreation(),
    createAlbum: name => albums.createAlbum(name),
    renameAlbum: name => albums.renameAlbum(name),
    deleteAlbum: () => albums.deleteAlbum(),
    addAlbumMember: id => albums.addAlbumMember(id),
    removeAlbumMember: id => albums.removeAlbumMember(id),
    moveAlbumMember: (id, direction) => albums.moveAlbumMember(id, direction),
    showAlbumSelector: (...args) => albums.showAlbumSelector(...args),
    openAlbumMemory: id => albums.openAlbumMemory(id),
    albumPage: next => albums.albumPage(next),
    reloadAlbumMutation: options => albums.reloadAlbumMutation(options),
    retryAlbumMutation: name => albums.retryAlbumMutation(name),
    getSnapshot: () => state,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A state listener is required.");
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginCreation() {
      if (disposed || suspended || state.busy || !state.session?.authenticated || reviewIntent || metadataIntent || albums.locked()) return state;
      cancel(); inboxDirty = true;
      publish({ phase: "create", detail: null, items: EMPTY_ITEMS, nextCursor: null, photo: idlePhoto(), notice: null, error: null });
      return state;
    },
    getCreationApi() {
      const owner = generation;
      return createCoupleSubmissionApi({ api, getSession: () => state.session,
        isCurrent: () => !disposed && !suspended && generation === owner && state.phase === "create",
        onAccessFailure: failure => { cancel(); authFailure(failure); },
      });
    },
    creationComplete(receipt) {
      if (state.phase !== "create" || !state.session?.authenticated || !receipt?.memories?.length) return Promise.resolve(state);
      inboxDirty = true;
      return controller.openMemory(receipt.memories[0].memoryId);
    },
    suspend() {
      if (disposed || (suspended && !resuming)) return state;
      // Preserve only the frozen action identity, never the displayed memory or token.
      if (reviewIntent && reviewInFlight) reviewUncertain = true;
      // Editable metadata is private content: hiding drops it entirely. Retain
      // only an ID so a fresh access check can read current state without retrying.
      if (metadataIntent) metadataHiddenId = metadataIntent.memoryId;
      metadataIntent = null; metadataUncertain = false; metadataInFlight = null;
      const logoutUnconfirmed = state.logoutUnconfirmed || operation?.purpose === "logout";
      suspended = true;
      resuming = null;
      reviewInFlight = null;
      cancel();
      inboxDirty = true;
      publish({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), notice: null, busy: false, error: null, logoutUnconfirmed,
        review: reviewIntent ? reviewState("uncertain") : idleReview(),
        metadata: idleMetadata(),
        ...albums.suspend(),
        albumReturnId: null,
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
          publish({ phase: "detail", albumReturnId: albums.returnId() });
          await reconcileReview(op, memory, "Current state reloaded after checking access. Review it before choosing another action; this does not identify who changed it.");
        } else if (metadataHiddenId) {
          const memory = await bounded(op, signal => api.getMemory(metadataHiddenId, { signal }));
          metadataHiddenId = null;
          publish({ phase: "detail", albumReturnId: albums.returnId() });
          await acceptMetadata(op, memory, "Current memory loaded after checking access. The hidden edit was cleared; inspect the saved details before making a new edit.");
        } else if (albums.hasPending()) await albums.resume(op);
        else await page(op, state.reviewStatus, null);
        assertCurrent(op);
        suspended = false;
      }, failure => {
        if (authFailure(failure)) { suspended = false; return; }
        if (failure?.status === 404 && (reviewIntent || metadataHiddenId)) {
          unavailableReview(); suspended = false; return;
        }
        // A failed recheck hides all content but keeps an uncertain action recoverable.
        revokePhoto();
        publish({ phase: "unavailable", session: null, items: EMPTY_ITEMS, nextCursor: null,
          detail: null, photo: idlePhoto(), albums: initialAlbums(), notice: null,
          error: "Archive access could not be checked. Private content is hidden. Try checking access again." });
      }).finally(() => { if (resuming === completion) resuming = null; });
      resuming = completion;
      return completion;
    },
    loadSession() {
      if (suspended) return controller.resume();
      if (reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
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
      if (reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
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
      if (reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
      albums.clear();
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, albums: initialAlbums(), albumReturnId: null, logoutUnconfirmed: false }, "logout");
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        if (fresh.authenticated) await bounded(op, signal => api.logout({ csrfToken: fresh.csrfToken, signal }));
        clearPrivate({ phase: "login", error: null, logoutUnconfirmed: false });
      }, () => clearPrivate({ phase: "unavailable", logoutUnconfirmed: true,
        error: "Sign-out could not be confirmed. Private content is hidden here. Retry signing out before leaving a shared device." }));
    },
    loadInbox(reviewStatus = "PENDING", cursor = null) {
      if (!state.session?.authenticated || disposed || reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
      const albumNavigation = albums.clearNavigation();
      const changed = reviewStatus !== state.reviewStatus;
      const op = start({ phase: "inbox", reviewStatus, detail: null, notice: null, albums: initialAlbums(), ...albumNavigation,
        ...(changed ? { items: EMPTY_ITEMS, nextCursor: null } : {}) });
      return run(op, () => page(op, reviewStatus, cursor), failure => {
        if (!authFailure(failure)) publish({ error: "Your inbox could not be loaded. Try loading it again." });
      });
    },
    openMemory(id, { albumId = null } = {}) {
      if (!state.session?.authenticated || disposed || reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
      albums.memoryContext(albumId);
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
      if (disposed || !state.session?.authenticated || reviewIntent || metadataIntent || albums.locked()) return state;
      if (albums.hasReturn()) return albums.returnToAlbum();
      if (inboxDirty) return controller.loadInbox(state.reviewStatus);
      cancel();
      publish({ phase: "inbox", busy: false, error: null, detail: null, photo: idlePhoto(), notice: null });
      return state;
    },
    retryPhoto() {
      if (state.phase !== "detail" || !["PHOTO", "AUDIO"].includes(state.detail?.memoryType) || state.detail.reviewStatus === "DELETE"
        || !state.session?.authenticated || disposed || reviewIntent || metadataIntent || albums.locked()) return Promise.resolve(state);
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
      if (disposed || reviewIntent || metadataIntent || albums.locked() || state.busy || state.phase !== "detail"
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
    saveMetadata(raw) {
      if (metadataInFlight) return metadataInFlight;
      if (disposed || suspended || reviewIntent || metadataIntent || albums.locked() || state.busy || state.phase !== "detail"
        || !state.detail || state.detail.reviewStatus === "DELETE" || !state.session?.authenticated) return Promise.resolve(state);
      const target = frozenCopy(normalizeMemoryMetadata(raw));
      metadataIntent = Object.freeze({ memoryId: state.detail.memoryId, target, before: frozenCopy(metadataOf(state.detail)),
        expectedRevision: state.detail.revision, fromStatus: state.detail.reviewStatus,
        deleteAfter: state.detail.deleteAfter, original: originalContext(state.detail) });
      metadataUncertain = false;
      return sendMetadata();
    },
    retryMetadata() {
      if (metadataInFlight) return metadataInFlight;
      if (disposed || suspended || !metadataIntent || state.busy || state.metadata.phase !== "uncertain"
        || !state.metadata.canRetry || !state.session?.authenticated) return Promise.resolve(state);
      return sendMetadata();
    },
    reloadMetadata({ refreshSession = false } = {}) {
      if (metadataInFlight) return metadataInFlight;
      if (disposed || suspended || !metadataIntent || state.busy
        || !["uncertain", "conflict", "csrf"].includes(state.metadata.phase)) return Promise.resolve(state);
      const intent = metadataIntent, previousPhase = state.metadata.phase;
      const op = start({ phase: "detail", metadata: metadataState(refreshSession ? "refreshing" : "loading"), notice: null });
      return metadataRun(op, async () => {
        if (refreshSession) {
          const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
          if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
          publish({ session });
        }
        await reconcileMetadata(op, await bounded(op, signal => api.getMemory(intent.memoryId, { signal })));
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) unavailableReview();
        else publish({ metadata: metadataState(previousPhase, "The current memory could not be loaded. Try again.") });
      });
    },
    dispose() {
      if (disposed) return;
      cancel();
      reviewIntent = null;
      reviewInFlight = null;
      reviewUncertain = false;
      metadataIntent = null; metadataInFlight = null; metadataUncertain = false; metadataHiddenId = null;
      inboxDirty = false;
      albums.clear();
      state = Object.freeze({ ...state, session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), review: idleReview(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null, notice: null, busy: false, error: null });
      suspended = true;
      resuming = null;
      disposed = true;
      listeners.clear();
    },
  };
  return Object.freeze(controller);
}
