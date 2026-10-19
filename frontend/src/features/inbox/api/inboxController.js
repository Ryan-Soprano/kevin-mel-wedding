import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { EMPTY_ITEMS, idlePhoto, idleReview, idleMetadata, idleShareLink, frozenCopy, sessionCopy } from "./inboxState.js";
import { createInboxMedia, photoMessage, sha256 } from "./inboxMedia.js";
import { createMemoryMutationActions } from "./memoryMutationActions.js";
import { createCoupleSubmissionApi } from "./coupleSubmissionApi.js";
import { createAlbumActions, initialAlbums } from "../../albums/api/albumActions.js";
import { createTimelineActions, initialTimeline } from "../../timeline/api/timelineActions.js";
import { createLibraryActions, initialLibrary } from "../../library/api/libraryActions.js";
import { createTagActions, initialTags } from "../../library/api/tagActions.js";
import { createExportActions, initialExport } from "../../export/api/exportActions.js";

const interrupted = () => new ApiError("The request was cancelled.", { code: "REQUEST_ABORTED" });

/**
 * A private, in-memory presentation controller. Latest intent owns every result;
 * deadlines include body reads and decoding, even when a transport ignores abort.
 */
export function createInboxController({
  api = createArchiveApi(), fetchImpl = globalThis.fetch,
  createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url),
  now = Date.now, digest = sha256, apiTimeoutMs = 30_000, photoTimeoutMs = 60_000,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
  albumNameFingerprint, timelineFieldsFingerprint, tagNameFingerprint,
} = {}) {
  let state = Object.freeze({ phase: "checking", session: null, busy: false, error: null,
    reviewStatus: "PENDING", items: EMPTY_ITEMS, nextCursor: null, detail: null, requestedMemoryId: null,
    photo: idlePhoto(), review: idleReview(), shareLink: idleShareLink(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
    timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false,
    tags: initialTags(), tagReturnId: null, export: initialExport(), notice: null, pageResetVersion: 0, logoutUnconfirmed: false });
  let generation = 0, operation = null, disposed = false, cancelling = false, inboxDirty = false;
  let cancellingLogout = false;
  let suspended = false, resuming = null, rechecking = null;
  let notifying = false, notifyAgain = false, batchDepth = 0;
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
    next.requestedMemoryId = next.phase === "detail" && next.session?.authenticated
      ? next.detail?.memoryId ?? next.requestedMemoryId : null;
    if (next.shareLink.url && (next.detail?.memoryId !== next.shareLink.memoryId
      || next.detail?.revision !== next.shareLink.revision || next.detail?.visibility !== "FRIENDS_FAMILY")) next.shareLink = idleShareLink();
    if (Object.keys(next).every(key => next[key] === state[key])) return;
    state = Object.freeze(next);
    if (batchDepth === 0) notify();
  }

  function batchPublication(task) {
    batchDepth++;
    try { return task(); }
    finally { if (--batchDepth === 0) notify(); }
  }

  function cancel(purpose = null) {
    const owner = ++generation;
    if (cancelling) return owner;
    // Abort and resource cleanup can call back synchronously. Detach ownership
    // and block replacement intents until all of this cleanup has finished.
    const previousOperation = operation, previousCheck = rechecking;
    operation = null;
    rechecking = null;
    cancelling = true;
    // pagehide can interrupt sign-out before start() installs its operation.
    cancellingLogout = purpose === "logout" || previousOperation?.purpose === "logout";
    try {
      previousOperation?.controller.abort(interrupted());
      previousCheck?.op.controller.abort(interrupted());
      revokePhoto();
      exports.revokeDownload();
    } finally { cancelling = false; cancellingLogout = false; }
    return owner;
  }

  function start(patch, purpose = null) {
    if (disposed || cancelling) return null;
    const owner = cancel(purpose);
    if (disposed || generation !== owner) return null;
    const current = { generation: owner, controller: new AbortController(), purpose };
    operation = current;
    publish({ busy: true, error: null, photo: idlePhoto(), shareLink: idleShareLink(), ...(patch.phase === "export" ? {} : exports.leave()), ...patch });
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
    mutations.clear();
    inboxDirty = false;
    albums.clear();
    timeline.clear();
    library.clear(); tags.clear(); exports.clear();
    publish({ session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, photo: idlePhoto(),
      review: idleReview(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
      timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, export: initialExport(), notice: null, ...patch });
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

  function unavailableReview() { mutations.unavailableReview(); }

  async function refreshMemoryTags(op, memory) {
    try { await tags.readMemoryTags(op, memory.memoryId); }
    catch (failure) {
      if (!current(op)) throw failure;
      if (!authFailure(failure)) tags.readFailure(failure);
    }
  }

  const { photo, revokePhoto } = createInboxMedia({ api, fetchImpl, createObjectURL, revokeObjectURL, now, digest, photoTimeoutMs,
    publish, bounded, assertCurrent, isCurrent: current, authFailure });
  const mutations = createMemoryMutationActions({ api, getState: () => state, publish, start, bounded, run, assertCurrent,
    isCurrent: current, authFailure, apiTimeoutMs, isDisposed: () => disposed || cancelling, isSuspended: () => suspended,
    otherLocked: () => albums.locked() || timeline.locked() || tags.locked() || exports.locked(),
    markInboxDirty: () => { inboxDirty = true; }, refreshMemoryTags, clearMemoryTags: () => tags.clearMemoryPresentation(), photo,
    detailContext: () => ({ phase: "detail", albumReturnId: albums.returnId(), timelineReturnId: timeline.returnId(), tagReturnId: tags.returnId() }),
  });

  const albums = createAlbumActions({ api, getState: () => state, publish,
    start: patch => start({ ...patch, timeline: initialTimeline(), ...timeline.clearNavigation(), library: initialLibrary(), ...library.clearNavigation(), tags: initialTags(), ...tags.clearNavigation() }), bounded, run, assertCurrent, isCurrent: current,
    authFailure, freeze: frozenCopy,
    canNavigate: () => !disposed && !cancelling && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !mutations.locked() && !timeline.locked() && !tags.locked() && !exports.locked(),
    openMemory: (id, options) => controller.openMemory(id, options), nameFingerprint: albumNameFingerprint,
  });
  const timeline = createTimelineActions({ api, getState: () => state, publish,
    start: patch => start({ ...patch, albums: initialAlbums(), ...albums.clearNavigation(), library: initialLibrary(), ...library.clearNavigation(), tags: initialTags(), ...tags.clearNavigation() }), bounded, run, assertCurrent, isCurrent: current,
    authFailure, freeze: frozenCopy,
    canNavigate: () => !disposed && !cancelling && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !mutations.locked() && !albums.locked() && !tags.locked() && !exports.locked(),
    openMemory: (id, options) => controller.openMemory(id, options), fieldsFingerprint: timelineFieldsFingerprint,
  });
  const library = createLibraryActions({ api, getState: () => state, publish,
    start: patch => start({ ...patch, albums: initialAlbums(), ...albums.clearNavigation(), timeline: initialTimeline(), ...timeline.clearNavigation(), tags: initialTags(), ...tags.clearNavigation() }),
    bounded, run, assertCurrent, authFailure, freeze: frozenCopy,
    canNavigate: () => !disposed && !cancelling && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !mutations.locked() && !albums.locked() && !timeline.locked() && !tags.locked() && !exports.locked(),
    openMemory: (id, options) => controller.openMemory(id, options),
  });
  const tags = createTagActions({ api, getState: () => state, publish,
    start: patch => start(patch.phase === "detail" ? patch : { ...patch, albums: initialAlbums(), ...albums.clearNavigation(), timeline: initialTimeline(), ...timeline.clearNavigation(), library: initialLibrary(), ...library.clearNavigation() }),
    bounded, run, assertCurrent, isCurrent: current, authFailure, freeze: frozenCopy,
    canNavigate: () => !disposed && !cancelling && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !mutations.locked() && !albums.locked() && !timeline.locked() && !exports.locked(),
    openMemory: (id, options) => controller.openMemory(id, options), nameFingerprint: tagNameFingerprint,
  });
  const exports = createExportActions({ api, getState: () => state, publish,
    start: patch => start({ ...patch, albums: initialAlbums(), ...albums.clearNavigation(), timeline: initialTimeline(), ...timeline.clearNavigation(), library: initialLibrary(), ...library.clearNavigation(), tags: initialTags(), ...tags.clearNavigation() }),
    bounded, run, assertCurrent, isCurrent: current, authFailure, freeze: frozenCopy, createObjectURL, revokeObjectURL, now,
    canNavigate: () => !disposed && !cancelling && !suspended && Boolean(state.session?.authenticated) && state.phase !== "create" && !mutations.locked() && !albums.locked() && !timeline.locked() && !tags.locked(),
  });
  const controller = {
    loadExport: () => exports.loadExport(), createExport: () => exports.createExport(), checkExport: options => exports.checkExport(options),
    prepareExportPart: number => exports.prepareExportPart(number), cancelExport: () => exports.cancelExport(), retryExportAction: () => exports.retryExportAction(),
    exportPage: (kind, next) => exports.exportPage(kind, next), downloadExportPart: () => exports.downloadExportPart(), exportDownloadStarted: () => exports.downloadStarted(),
    loadLibrary: (...args) => library.loadLibrary(...args), openLibraryMemory: id => library.openLibraryMemory(id), libraryPage: next => library.libraryPage(next),
    chooseLibraryTag: (...args) => library.chooseLibraryTag(...args), selectLibraryTag: tag => library.selectLibraryTag(tag),
    loadTags: (...args) => tags.loadTags(...args), openTag: (...args) => tags.openTag(...args), beginTagCreation: () => tags.beginTagCreation(),
    createTag: name => tags.createTag(name), renameTag: name => tags.renameTag(name), deleteTag: () => tags.deleteTag(),
    addTagMember: id => tags.addTagMember(id), removeTagMember: id => tags.removeTagMember(id), showTagSelector: (...args) => tags.showTagSelector(...args),
    openTagMemory: id => tags.openTagMemory(id), tagPage: next => tags.tagPage(next), reloadTagMutation: options => tags.reloadTagMutation(options), retryTagMutation: name => tags.retryTagMutation(name),
    loadMemoryTags: (...args) => tags.loadMemoryTags(...args), chooseMemoryTag: (...args) => tags.chooseMemoryTag(...args),
    changeMemoryTag: (...args) => tags.changeMemoryTag(...args), memoryTagPage: next => tags.memoryTagPage(next),
    loadTimeline: (...args) => timeline.loadTimeline(...args),
    openTimelineEvent: (...args) => timeline.openTimelineEvent(...args),
    beginTimelineCreation: () => timeline.beginTimelineCreation(),
    createTimelineEvent: fields => timeline.createTimelineEvent(fields),
    updateTimelineEvent: fields => timeline.updateTimelineEvent(fields),
    deleteTimelineEvent: () => timeline.deleteTimelineEvent(),
    linkTimelineMemory: id => timeline.linkTimelineMemory(id),
    unlinkTimelineMemory: id => timeline.unlinkTimelineMemory(id),
    showTimelineSelector: (...args) => timeline.showTimelineSelector(...args),
    openTimelineMemory: id => timeline.openTimelineMemory(id),
    timelinePage: next => timeline.timelinePage(next),
    reloadTimelineMutation: options => timeline.reloadTimelineMutation(options),
    retryTimelineMutation: fields => timeline.retryTimelineMutation(fields),
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
      if (disposed || cancelling || suspended || state.busy || !state.session?.authenticated || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return state;
      const owner = cancel();
      if (disposed || generation !== owner) return state;
      inboxDirty = true;
      publish({ phase: "create", detail: null, items: EMPTY_ITEMS, nextCursor: null, photo: idlePhoto(), notice: null, error: null });
      return state;
    },
    getCreationApi() {
      const owner = generation;
      return createCoupleSubmissionApi({ api, getSession: () => state.session,
        isCurrent: () => !disposed && !cancelling && !suspended && generation === owner && state.phase === "create",
        onAccessFailure: failure => {
          const owner = cancel();
          if (!disposed && generation === owner) authFailure(failure);
        },
      });
    },
    creationComplete(receipt) {
      if (disposed || cancelling || state.phase !== "create" || !state.session?.authenticated || !receipt?.memories?.length) return Promise.resolve(state);
      inboxDirty = true;
      return controller.openMemory(receipt.memories[0].memoryId);
    },
    suspend() {
      if (disposed || (suspended && !resuming)) return state;
      mutations.suspend();
      const logoutUnconfirmed = state.logoutUnconfirmed || operation?.purpose === "logout" || cancellingLogout;
      suspended = true;
      resuming = null;
      cancel();
      inboxDirty = true;
      publish({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), notice: null, busy: false, error: null, logoutUnconfirmed,
        // Build mutation state after synchronous abort callbacks have run.
        ...mutations.suspendedState(),
        ...albums.suspend(),
        ...timeline.suspend(),
        ...library.suspend(), ...tags.suspend(), ...exports.suspend(),
        albumReturnId: null,
        timelineReturnId: null,
        tagReturnId: null,
        pageResetVersion: state.pageResetVersion + 1 });
      return state;
    },
    resume() {
      if (disposed || cancelling || !suspended) return Promise.resolve(state);
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
        if (mutations.hasReview()) await mutations.resumeReview(op);
        else if (mutations.hasHiddenMetadata()) await mutations.resumeMetadata(op);
        else if (albums.hasPending()) await albums.resume(op);
        else if (timeline.hasPending()) await timeline.resume(op);
        else if (tags.hasPending()) await tags.resume(op);
        else if (library.hasPending()) await library.resume(op);
        else if (exports.hasPending()) await exports.resume(op);
        else await page(op, state.reviewStatus, null);
        assertCurrent(op);
        suspended = false;
      }, failure => {
        if (authFailure(failure)) { suspended = false; return; }
        if (failure?.status === 404 && (mutations.hasReview() || mutations.hasHiddenMetadata())) {
          unavailableReview(); suspended = false; return;
        }
        // A failed recheck hides all content but keeps an uncertain action recoverable.
        revokePhoto();
        publish({ phase: "unavailable", session: null, items: EMPTY_ITEMS, nextCursor: null,
          detail: null, photo: idlePhoto(), albums: initialAlbums(), timeline: initialTimeline(), library: initialLibrary(), tags: initialTags(), export: initialExport(), notice: null,
          error: "Archive access could not be checked. Private content is hidden. Try checking access again." });
      }).finally(() => { if (resuming === completion) resuming = null; });
      resuming = completion;
      return completion;
    },
    recheckSession() {
      // A foreground access check must not replace the view, revoke a loaded
      // photo, or interrupt a save. Saves already validate access on the server.
      if (disposed || cancelling || suspended || !state.session?.authenticated || state.busy
        || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) {
        return Promise.resolve(state);
      }
      if (rechecking) return rechecking.completion;
      const op = { generation, controller: new AbortController() };
      const completion = (async () => {
        try {
          const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
          if (!session.authenticated) {
            const owner = cancel();
            if (disposed || generation !== owner) return state;
            clearPrivate({ phase: "login", busy: false, error: "Your session has expired. Sign in again to view the archive." });
          } else publish({ session });
        } catch (failure) {
          if (!current(op)) return state;
          const owner = cancel();
          if (disposed || generation !== owner) return state;
          if (!authFailure(failure)) clearPrivate({ phase: "unavailable", busy: false,
            error: "Archive access could not be checked. Try checking access again." });
        } finally {
          if (rechecking?.op === op) rechecking = null;
        }
        return state;
      })();
      rechecking = { op, completion };
      return completion;
    },
    loadSession() {
      if (disposed || cancelling) return Promise.resolve(state);
      if (suspended) return controller.resume();
      if (mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      if (state.logoutUnconfirmed) return controller.logout();
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null });
      return run(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        publish({ session, phase: session.authenticated ? "inbox" : "login", reviewStatus: "PENDING" });
        if (session.authenticated) await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) clearPrivate({ phase: "unavailable", error: "The archive could not be reached. Try checking access again." });
      });
    },
    login(credentials) {
      if (disposed || cancelling) return Promise.resolve(state);
      if (mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      const op = start({ phase: "login", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null, logoutUnconfirmed: false });
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        const session = sessionCopy(await bounded(op, signal => api.login(
          { username: credentials.username, password: credentials.password }, { csrfToken: fresh.csrfToken, signal })));
        if (!session.authenticated) throw new ApiError("Sign-in was not confirmed.", { code: "CONTRACT_MISMATCH" });
        publish({ session, phase: "inbox", reviewStatus: "PENDING" });
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
      if (disposed || cancelling) return Promise.resolve(state);
      if (mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      albums.clear();
      timeline.clear();
      library.clear(); tags.clear(); exports.clear();
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, albums: initialAlbums(), albumReturnId: null,
        timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, logoutUnconfirmed: false }, "logout");
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        if (fresh.authenticated) await bounded(op, signal => api.logout({ csrfToken: fresh.csrfToken, signal }));
        clearPrivate({ phase: "login", error: null, logoutUnconfirmed: false });
      }, () => clearPrivate({ phase: "unavailable", logoutUnconfirmed: true,
        error: "Sign-out could not be confirmed. Private content is hidden here. Retry signing out before leaving a shared device." }));
    },
    loadInbox(reviewStatus = "PENDING", cursor = null) {
      if (!state.session?.authenticated || disposed || cancelling || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      const albumNavigation = albums.clearNavigation();
      const timelineNavigation = timeline.clearNavigation();
      const libraryNavigation = library.clearNavigation(), tagNavigation = tags.clearNavigation();
      const changed = reviewStatus !== state.reviewStatus;
      const op = start({ phase: "inbox", reviewStatus, detail: null, notice: null, albums: initialAlbums(), timeline: initialTimeline(), library: initialLibrary(), tags: initialTags(), ...albumNavigation, ...timelineNavigation, ...libraryNavigation, ...tagNavigation,
        ...(cursor === null ? { pageResetVersion: state.pageResetVersion + 1 } : {}),
        ...(changed ? { items: EMPTY_ITEMS, nextCursor: null } : {}) });
      return run(op, () => page(op, reviewStatus, cursor), failure => {
        if (!authFailure(failure)) publish({ error: "Your inbox could not be loaded. Try loading it again." });
      });
    },
    openMemory(id, { albumId = null, eventId = null, libraryReturn = false, tagId = null } = {}) {
      if (!state.session?.authenticated || disposed || cancelling || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      // Publish the requested memory and its return context as one destination.
      const op = batchPublication(() => {
        albums.memoryContext(albumId);
        timeline.memoryContext(eventId);
        library.memoryContext(libraryReturn); tags.memoryContext(tagId); tags.clearMemoryPresentation();
        if (!albumId) publish({ albums: initialAlbums(), ...albums.clearNavigation() });
        if (!eventId) publish({ timeline: initialTimeline(), ...timeline.clearNavigation() });
        if (!libraryReturn) publish({ library: initialLibrary(), ...library.clearNavigation() });
        if (!tagId) publish(tags.clearNavigation());
        return start({ phase: "detail", detail: null, requestedMemoryId: id, notice: null });
      });
      return run(op, async () => {
        const detail = frozenCopy(await bounded(op, signal => api.getMemory(id, { signal })));
        publish({ detail });
        assertCurrent(op);
        if (detail.reviewStatus !== "DELETE") await refreshMemoryTags(op, detail);
        if (!current(op) || op.controller.signal.aborted || !state.detail) return;
        if (["PHOTO", "AUDIO"].includes(detail.memoryType) && detail.reviewStatus !== "DELETE") await photo(op, detail);
      }, failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) unavailableReview();
        else publish({ error: "This memory could not be loaded. Return to the inbox and try again." });
      });
    },
    backToInbox() {
      if (disposed || cancelling || !state.session?.authenticated || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return state;
      if (albums.hasReturn()) return albums.returnToAlbum();
      if (timeline.hasReturn()) return timeline.returnToEvent();
      if (tags.hasReturn()) return tags.returnToTag();
      if (library.hasReturn()) return library.returnToLibrary();
      if (inboxDirty) return controller.loadInbox(state.reviewStatus);
      const owner = cancel();
      if (disposed || generation !== owner) return state;
      publish({ phase: "inbox", busy: false, error: null, detail: null, photo: idlePhoto(), notice: null });
      return state;
    },
    retryPhoto() {
      if (state.phase !== "detail" || !["PHOTO", "AUDIO"].includes(state.detail?.memoryType) || state.detail.reviewStatus === "DELETE"
        || !state.session?.authenticated || disposed || cancelling || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      const detail = state.detail;
      const op = start({ phase: "detail", detail });
      return run(op, () => photo(op, detail), failure => {
        if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure, detail.memoryType === "AUDIO") }) });
      });
    },
    retryMedia() { return controller.retryPhoto(); },
    createShareLink() { return mutations.createShareLink(); },
    reviewMemory(targetStatus, visibility) { return mutations.reviewMemory(targetStatus, visibility); },
    retryReview() { return mutations.retryReview(); },
    reloadReview() { return mutations.reloadReview(); },
    refreshReviewSession() { return mutations.refreshReviewSession(); },
    saveMetadata(raw) { return mutations.saveMetadata(raw); },
    retryMetadata() { return mutations.retryMetadata(); },
    reloadMetadata(...args) { return mutations.reloadMetadata(...args); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      mutations.dispose();
      inboxDirty = false;
      albums.clear();
      timeline.clear();
      library.clear(); tags.clear(); exports.clear();
      state = Object.freeze({ ...state, session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, requestedMemoryId: null, photo: idlePhoto(), review: idleReview(), shareLink: idleShareLink(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
        timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, export: initialExport(), notice: null, busy: false, error: null });
      suspended = true;
      resuming = null;
      listeners.clear();
    },
  };
  return Object.freeze(controller);
}
