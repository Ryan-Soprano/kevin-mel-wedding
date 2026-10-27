import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { EMPTY_ITEMS, idlePhoto, idleReview, idleMetadata, idleShareLink, idlePasswordChange, hasArchiveAccess, frozenCopy, sessionCopy } from "./inboxState.js";
import { passwordChangeValidation } from "../passwordChange.js";
import { createInboxMedia, photoMessage, sha256 } from "./inboxMedia.js";
import { createMemoryMutationActions } from "./memoryMutationActions.js";
import { createCoupleSubmissionApi } from "./coupleSubmissionApi.js";
import { createAlbumActions, initialAlbums } from "../../albums/api/albumActions.js";
import { createTimelineActions, initialTimeline } from "../../timeline/api/timelineActions.js";
import { createLibraryActions, initialLibrary } from "../../library/api/libraryActions.js";
import { createTagActions, initialTags } from "../../library/api/tagActions.js";
import { createExportActions, initialExport } from "../../export/api/exportActions.js";

const interrupted = () => new ApiError("The request was cancelled.", { code: "REQUEST_ABORTED" });
const LOGIN_RATE_LIMITED = "Too many sign-in attempts.";
const LOGIN_READY = "You can try signing in again.";
const PASSWORD_RATE_LIMITED = "Too many password-change attempts.";

const navigationIds = pages => [...new Set(pages.flatMap(page => page.items.map(item => item.memoryId)))];

function detailNavigation(pages, index, reviewStatus, previousPageCursors = EMPTY_ITEMS) {
  const ids = navigationIds(pages);
  const pageIndex = pages.findIndex(page => page.items.some(item => item.memoryId === ids[index]));
  const nextCursor = pages.at(-1).nextCursor;
  return Object.freeze({ ids: Object.freeze(ids), index, reviewStatus, nextCursor, pages: Object.freeze(pages),
    pageCursors: Object.freeze(pages.map(page => page.cursor)), pageIndex, currentPageCursor: pages[pageIndex].cursor,
    previousPageCursors: Object.freeze(previousPageCursors),
    inboxPages: Object.freeze([...previousPageCursors, ...pages.slice(0, pageIndex + 1).map(page => page.cursor)]),
    canPrevious: index > 0 || previousPageCursors.length > 0, canNext: index + 1 < ids.length || nextCursor !== null });
}

/**
 * A private, in-memory presentation controller. Latest intent owns every result;
 * deadlines include body reads and decoding, even when a transport ignores abort.
 */
export function createInboxController({
  api: suppliedApi = createArchiveApi(), fetchImpl = globalThis.fetch,
  createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url),
  now = Date.now, digest = sha256, apiTimeoutMs = 30_000, photoTimeoutMs = 60_000,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
  albumNameFingerprint, timelineFieldsFingerprint, tagNameFingerprint,
} = {}) {
  let state = Object.freeze({ phase: "checking", session: null, busy: false, error: null, loginRetryAfterSeconds: 0,
    reviewStatus: "PENDING", items: EMPTY_ITEMS, nextCursor: null, totalCount: null, detail: null, requestedMemoryId: null, detailNavigation: null,
    photo: idlePhoto(), review: idleReview(), shareLink: idleShareLink(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
    timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false,
    tags: initialTags(), tagReturnId: null, export: initialExport(), notice: null, pageResetVersion: 0, logoutUnconfirmed: false,
    passwordChange: idlePasswordChange() });
  // Retained feature facades cannot issue archive requests after a refresh
  // changes the account's required-password state.
  const api = new Proxy({}, { get(_target, name) {
    const method = suppliedApi[name];
    if (typeof method !== "function") return method;
    return (...args) => {
      if (!["getSession", "login", "logout", "changePassword"].includes(name) && !hasArchiveAccess(state.session)) {
        return Promise.reject(new ApiError("Archive access needs to be checked.", state.session?.authenticated
          ? { status: 403, code: "PASSWORD_CHANGE_REQUIRED" } : { status: 401, code: "AUTH_REQUIRED" }));
      }
      return method.apply(suppliedApi, args);
    };
  } });
  let generation = 0, operation = null, disposed = false, cancelling = false, inboxDirty = false;
  let inboxCursor = null;
  let cancellingLogout = false;
  let loginRetryAt = 0, loginRetryTimer = null;
  let suspended = false, resuming = null, rechecking = null;
  let passwordOutcomeUnknown = false;
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
    if (next.session?.passwordChangeRequired) {
      revokePhoto();
      Object.assign(next, { phase: "password-change", items: EMPTY_ITEMS, nextCursor: null, detail: null,
        photo: idlePhoto(), review: idleReview(), metadata: idleMetadata(), shareLink: idleShareLink(),
        albums: initialAlbums(), albumReturnId: null, timeline: initialTimeline(), timelineReturnId: null,
        library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, export: initialExport() });
    }
    next.requestedMemoryId = next.phase === "detail" && hasArchiveAccess(next.session)
      ? next.detail?.memoryId ?? next.requestedMemoryId : null;
    if (next.phase !== "detail" || !hasArchiveAccess(next.session)
      || next.albumReturnId || next.timelineReturnId || next.libraryReturn || next.tagReturnId) next.detailNavigation = null;
    if (!hasArchiveAccess(next.session) || !["inbox", "detail"].includes(next.phase)
      || (next.pageResetVersion !== state.pageResetVersion && patch.totalCount === undefined)) next.totalCount = null;
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

  function remainingLoginWait() { return Math.max(0, Math.ceil((loginRetryAt - now()) / 1000)); }

  function clearLoginWait() {
    if (loginRetryTimer !== null) clearTimeoutImpl(loginRetryTimer);
    loginRetryTimer = null;
    loginRetryAt = 0;
  }

  function updateLoginWait() {
    loginRetryTimer = null;
    if (disposed) return;
    const remaining = remainingLoginWait();
    publish({ loginRetryAfterSeconds: remaining,
      ...(remaining === 0 && [LOGIN_RATE_LIMITED, PASSWORD_RATE_LIMITED].includes(state.error)
        ? { error: state.error === PASSWORD_RATE_LIMITED ? "You can try changing your password again." : LOGIN_READY } : {}) });
    if (remaining > 0 && !disposed) {
      loginRetryTimer = setTimeoutImpl(updateLoginWait, Math.min(1000, Math.max(1, loginRetryAt - now())));
      loginRetryTimer?.unref?.();
    }
  }

  function waitAfterLoginFailure(seconds) {
    clearLoginWait();
    // The current login policy returns 900 seconds; retain that safe fallback
    // only when a throttled response has no usable Retry-After value.
    const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds : 900;
    loginRetryAt = now() + wait * 1000;
    updateLoginWait();
  }

  function cancel(purpose = null) {
    const owner = ++generation;
    if (cancelling) return owner;
    // Abort and resource cleanup can call back synchronously. Detach ownership
    // and block replacement intents until all of this cleanup has finished.
    const previousOperation = operation, previousCheck = rechecking;
    if (previousOperation?.purpose === "password-change" && !previousOperation.passwordConfirmed) passwordOutcomeUnknown = true;
    operation = null;
    rechecking = null;
    cancelling = true;
    // pagehide can interrupt sign-out before start() installs its operation.
    cancellingLogout = purpose === "logout" || previousOperation?.purpose === "logout";
    try {
      previousOperation?.controller.abort(interrupted());
      previousCheck?.op.controller.abort(interrupted());
      if (purpose !== "memory-page") revokePhoto();
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
    inboxCursor = null;
    albums.clear();
    timeline.clear();
    library.clear(); tags.clear(); exports.clear();
    publish({ session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, photo: idlePhoto(),
      review: idleReview(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
      timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, export: initialExport(), passwordChange: idlePasswordChange(), notice: null, ...patch });
  }

  function requirePassword(session, patch = {}) {
    clearPrivate({ phase: "password-change", session,
      passwordChange: Object.freeze({ phase: passwordOutcomeUnknown ? "uncertain" : "idle" }), ...patch });
  }

  function authFailure(failure) {
    if (failure?.code === "PASSWORD_CHANGE_REQUIRED" && state.session?.authenticated) {
      requirePassword(sessionCopy({ ...state.session, passwordChangeRequired: true }));
      return true;
    }
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
    inboxCursor = cursor;
    publish({ phase: "inbox", reviewStatus, items: frozenCopy(result.items), nextCursor: result.nextCursor, totalCount: result.totalCount ?? null, detail: null });
    inboxDirty = false;
  }

  function unavailableReview() { mutations.unavailableReview(); }

  function memoryNavigation(id, inboxCursors) {
    const previous = state.detailNavigation;
    const pages = state.phase === "inbox" ? [Object.freeze({ cursor: inboxCursor, items: state.items, nextCursor: state.nextCursor, totalCount: state.totalCount })] : previous?.pages;
    const ids = state.phase === "inbox" ? [...new Set(state.items.map(item => item.memoryId))] : previous?.ids;
    const index = ids?.indexOf(id) ?? -1;
    if (index < 0) return null;
    const preceding = state.phase === "inbox"
      ? (Array.isArray(inboxCursors) && inboxCursors.at(-1) === inboxCursor ? inboxCursors.slice(0, -1) : [])
      : previous.previousPageCursors;
    return detailNavigation(pages, index, previous?.reviewStatus ?? state.reviewStatus, preceding);
  }

  async function readAdjacentPage(op, navigation, direction) {
    const pages = [...navigation.pages], preceding = [...navigation.previousPageCursors], seen = new Set(pages.map(page => page.cursor));
    const currentId = navigation.ids[navigation.index];
    let index = navigation.index;
    while (direction === 1 ? pages.at(-1).nextCursor !== null : preceding.length > 0) {
      const cursor = direction === 1 ? pages.at(-1).nextCursor : preceding.pop();
      if (seen.has(cursor)) throw new ApiError("The page could not be confirmed.", { code: "CONTRACT_MISMATCH" });
      seen.add(cursor);
      const result = await bounded(op, signal => api.listMemories({ reviewStatus: navigation.reviewStatus,
        ...(cursor !== null ? { cursor } : {}), signal }));
      const page = frozenCopy({ cursor, items: result.items, nextCursor: result.nextCursor, totalCount: result.totalCount ?? null });
      if (direction === 1) pages.push(page);
      else pages.unshift(page);
      const ids = navigationIds(pages);
      index = ids.indexOf(currentId);
      const destination = index + direction;
      if (destination >= 0 && destination < ids.length) {
        const next = detailNavigation(pages, destination, navigation.reviewStatus, preceding);
        await readMemory(op, next.ids[destination], next);
        return;
      }
    }
    assertCurrent(op);
    publish({ detailNavigation: detailNavigation(pages, index, navigation.reviewStatus, preceding) });
  }

  async function readMemory(op, id, navigation) {
    const detail = frozenCopy(await bounded(op, signal => api.getMemory(id, { signal })));
    if (navigation) {
      if (detail.memoryId !== id) throw new ApiError("The contribution could not be confirmed.", { code: "CONTRACT_MISMATCH" });
      revokePhoto();
      assertCurrent(op);
      tags.clearMemoryPresentation();
      assertCurrent(op);
    }
    publish({ detail, ...(navigation ? { detailNavigation: navigation, requestedMemoryId: id, totalCount: navigation.pages[navigation.pageIndex].totalCount ?? null,
      photo: idlePhoto(), shareLink: idleShareLink(), notice: null } : {}) });
    assertCurrent(op);
    if (detail.reviewStatus !== "DELETE") await refreshMemoryTags(op, detail);
    if (!current(op) || op.controller.signal.aborted || !state.detail) return;
    if (["PHOTO", "AUDIO"].includes(detail.memoryType) && detail.reviewStatus !== "DELETE") await photo(op, detail);
  }

  function adjacentMemory(direction) {
    const navigation = state.detailNavigation;
    if (disposed || cancelling || suspended || state.busy || !hasArchiveAccess(state.session) || state.phase !== "detail"
      || !navigation || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
    const index = navigation.index + direction;
    const knownDestination = index >= 0 && index < navigation.ids.length;
    if (!knownDestination && !(direction === 1 ? navigation.canNext : navigation.canPrevious)) return Promise.resolve(state);

    // Discover the next cursor page without removing the currently open media.
    // Only a confirmed destination starts the usual detail/media replacement.
    const op = start({ phase: "detail", detail: state.detail, photo: state.photo, shareLink: state.shareLink }, "memory-page");
    return run(op, async () => {
      if (knownDestination) {
        await readMemory(op, navigation.ids[index], detailNavigation(navigation.pages, index, navigation.reviewStatus, navigation.previousPageCursors));
        return;
      }
      await readAdjacentPage(op, navigation, direction);
    }, failure => {
      if (!authFailure(failure)) publish({ error: "That contribution could not be loaded. Your current memory is still here; try again." });
    });
  }

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
        onSessionRefresh: (session, previous) => {
          if (!disposed && !cancelling && !suspended && generation === owner
            && state.phase === "create" && state.session === previous) {
            publish({ session: sessionCopy(session) });
          }
        },
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
      if (operation?.purpose === "password-change") passwordOutcomeUnknown = true;
      mutations.suspend();
      const logoutUnconfirmed = state.logoutUnconfirmed || operation?.purpose === "logout" || cancellingLogout;
      suspended = true;
      resuming = null;
      cancel();
      inboxDirty = true;
      inboxCursor = null;
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
          clearPrivate({ phase: "login", error: passwordOutcomeUnknown
            ? "Sign in with your new password if the change completed. If it was not accepted, use your temporary password."
            : "Sign in again to view the archive." });
          suspended = false;
          return;
        }
        if (session.passwordChangeRequired) {
          requirePassword(session);
          suspended = false;
          return;
        }
        passwordOutcomeUnknown = false;
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
          } else if (session.passwordChangeRequired) {
            const owner = cancel();
            if (disposed || generation !== owner) return state;
            requirePassword(session, { busy: false });
          } else if (state.phase === "password-change") {
            publish({ session });
            return controller.loadSession();
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
        if (session.passwordChangeRequired) { requirePassword(session); return; }
        if (session.authenticated) passwordOutcomeUnknown = false;
        publish({ session, phase: session.authenticated ? "inbox" : "login", reviewStatus: "PENDING",
          error: !session.authenticated && passwordOutcomeUnknown
            ? "Sign in with your new password if the change completed. If it was not accepted, use your temporary password." : null });
        if (session.authenticated) await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) clearPrivate({ phase: "unavailable", error: "The archive could not be reached. Try checking access again." });
      });
    },
    login(credentials) {
      if (disposed || cancelling || remainingLoginWait() > 0) return Promise.resolve(state);
      if (mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      clearLoginWait();
      const op = start({ phase: "login", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, notice: null, logoutUnconfirmed: false, loginRetryAfterSeconds: 0 });
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        const session = sessionCopy(await bounded(op, signal => api.login(
          { username: credentials.username, password: credentials.password }, { csrfToken: fresh.csrfToken, signal })));
        if (!session.authenticated) throw new ApiError("Sign-in was not confirmed.", { code: "CONTRACT_MISMATCH" });
        passwordOutcomeUnknown = false;
        if (session.passwordChangeRequired) { requirePassword(session); return; }
        publish({ session, phase: "inbox", reviewStatus: "PENDING" });
        await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) {
          if (state.session?.authenticated) publish({ phase: "inbox", error: "Your inbox could not be loaded. Try loading it again." });
          else if (failure?.status === 429) {
            waitAfterLoginFailure(failure.retryAfterSeconds);
            clearPrivate({ phase: "login", error: remainingLoginWait() > 0 ? LOGIN_RATE_LIMITED : LOGIN_READY });
          } else clearPrivate({ phase: "login", error: "Sign-in could not be confirmed. Try signing in again." });
        }
      });
    },
    changePassword(credentials) {
      if (disposed || cancelling || suspended || state.busy || passwordOutcomeUnknown || remainingLoginWait() > 0
        || !state.session?.authenticated || !state.session.passwordChangeRequired) return Promise.resolve(state);
      const validation = passwordChangeValidation({ ...credentials, repeatedPassword: credentials?.newPassword });
      if (validation) { publish({ error: validation }); return Promise.resolve(state); }
      const secret = { currentPassword: credentials.currentPassword, newPassword: credentials.newPassword };
      let passwordConfirmed = false;
      const previousToken = state.session.csrfToken;
      const op = start({ passwordChange: Object.freeze({ phase: "saving" }) }, "password-change");
      return run(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.changePassword(
          secret,
          { csrfToken: previousToken, signal }), apiTimeoutMs, true));
        if (!session.authenticated || session.passwordChangeRequired || session.csrfToken === previousToken) {
          throw new ApiError("Password change was not confirmed.", { code: "CONTRACT_MISMATCH", unknownOutcome: true });
        }
        passwordConfirmed = true;
        op.passwordConfirmed = true;
        passwordOutcomeUnknown = false;
        publish({ session, phase: "inbox", passwordChange: idlePasswordChange(), reviewStatus: "PENDING" });
        await page(op, "PENDING", null);
      }, failure => {
        if (passwordConfirmed) {
          if (!authFailure(failure)) publish({ phase: "inbox", error: "Your password was changed. Your inbox could not be loaded; try loading it again." });
        } else if (failure?.unknownOutcome || failure?.code === "PASSWORD_CHANGE_CONFLICT") {
          passwordOutcomeUnknown = true;
          publish({ passwordChange: Object.freeze({ phase: "uncertain" }), error: null });
        } else if (failure?.code === "INVALID_CREDENTIALS") {
          publish({ passwordChange: idlePasswordChange(), error: "Your temporary password was not accepted. Enter your passwords again." });
        } else if (failure?.code === "CSRF_INVALID") {
          publish({ passwordChange: Object.freeze({ phase: "uncertain" }), error: "Your session needs to be checked before trying again." });
          passwordOutcomeUnknown = true;
        } else if (failure?.status === 429) {
          waitAfterLoginFailure(failure.retryAfterSeconds);
          publish({ passwordChange: idlePasswordChange(), error: PASSWORD_RATE_LIMITED });
        } else if (failure?.code === "VALIDATION_FAILED") {
          publish({ passwordChange: idlePasswordChange(), error: "That password could not be accepted. Check the password requirements and enter your passwords again." });
        } else if (!authFailure(failure)) {
          publish({ passwordChange: idlePasswordChange(), error: "Your password could not be changed. Enter your passwords again when you are ready." });
        }
      }).finally(() => { secret.currentPassword = ""; secret.newPassword = ""; });
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
        passwordOutcomeUnknown = false;
        clearPrivate({ phase: "login", error: null, logoutUnconfirmed: false });
      }, () => clearPrivate({ phase: "unavailable", logoutUnconfirmed: true,
        error: "Sign-out could not be confirmed. Private content is hidden here. Retry signing out before leaving a shared device." }));
    },
    loadInbox(reviewStatus = "PENDING", cursor = null, { preservePageHistory = false } = {}) {
      if (!state.session?.authenticated || disposed || cancelling || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      const albumNavigation = albums.clearNavigation();
      const timelineNavigation = timeline.clearNavigation();
      const libraryNavigation = library.clearNavigation(), tagNavigation = tags.clearNavigation();
      const changed = reviewStatus !== state.reviewStatus;
      const op = start({ phase: "inbox", reviewStatus, detail: null, notice: null, albums: initialAlbums(), timeline: initialTimeline(), library: initialLibrary(), tags: initialTags(), ...albumNavigation, ...timelineNavigation, ...libraryNavigation, ...tagNavigation,
        ...(cursor === null && !preservePageHistory ? { pageResetVersion: state.pageResetVersion + 1 } : {}),
        ...(changed ? { items: EMPTY_ITEMS, nextCursor: null, totalCount: null } : {}) });
      return run(op, () => page(op, reviewStatus, cursor), failure => {
        if (!authFailure(failure)) publish({ error: "Your inbox could not be loaded. Try loading it again." });
      });
    },
    openMemory(id, { albumId = null, eventId = null, libraryReturn = false, tagId = null, inboxCursors } = {}) {
      if (!state.session?.authenticated || disposed || cancelling || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return Promise.resolve(state);
      const navigation = albumId || eventId || libraryReturn || tagId ? null : memoryNavigation(id, inboxCursors);
      // Publish the requested memory and its return context as one destination.
      const op = batchPublication(() => {
        albums.memoryContext(albumId);
        timeline.memoryContext(eventId);
        library.memoryContext(libraryReturn); tags.memoryContext(tagId); tags.clearMemoryPresentation();
        if (!albumId) publish({ albums: initialAlbums(), ...albums.clearNavigation() });
        if (!eventId) publish({ timeline: initialTimeline(), ...timeline.clearNavigation() });
        if (!libraryReturn) publish({ library: initialLibrary(), ...library.clearNavigation() });
        if (!tagId) publish(tags.clearNavigation());
        return start({ phase: "detail", detail: null, requestedMemoryId: id, detailNavigation: navigation, notice: null });
      });
      return run(op, () => readMemory(op, id), failure => {
        if (authFailure(failure)) return;
        if (failure?.status === 404) unavailableReview();
        else publish({ error: "This memory could not be loaded. Return to the inbox and try again." });
      });
    },
    previousMemory() { return adjacentMemory(-1); },
    nextMemory() { return adjacentMemory(1); },
    backToInbox() {
      if (disposed || cancelling || !state.session?.authenticated || mutations.locked() || albums.locked() || timeline.locked() || tags.locked() || exports.locked()) return state;
      if (albums.hasReturn()) return albums.returnToAlbum();
      if (timeline.hasReturn()) return timeline.returnToEvent();
      if (tags.hasReturn()) return tags.returnToTag();
      if (library.hasReturn()) return library.returnToLibrary();
      const sourcePage = state.detailNavigation?.pages[state.detailNavigation.pageIndex];
      if (inboxDirty) return controller.loadInbox(state.reviewStatus);
      const owner = cancel();
      if (disposed || generation !== owner) return state;
      if (sourcePage) inboxCursor = sourcePage.cursor;
      publish({ phase: "inbox", busy: false, error: null, detail: null, photo: idlePhoto(), notice: null,
        ...(sourcePage ? { items: sourcePage.items, nextCursor: sourcePage.nextCursor, totalCount: sourcePage.totalCount ?? null } : {}) });
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
      clearLoginWait();
      cancel();
      mutations.dispose();
      inboxDirty = false;
      inboxCursor = null;
      albums.clear();
      timeline.clear();
      library.clear(); tags.clear(); exports.clear();
      state = Object.freeze({ ...state, session: null, items: EMPTY_ITEMS, nextCursor: null, totalCount: null,
        detail: null, requestedMemoryId: null, detailNavigation: null, photo: idlePhoto(), review: idleReview(), shareLink: idleShareLink(), metadata: idleMetadata(), albums: initialAlbums(), albumReturnId: null,
        timeline: initialTimeline(), timelineReturnId: null, library: initialLibrary(), libraryReturn: false, tags: initialTags(), tagReturnId: null, export: initialExport(), notice: null, busy: false, error: null, loginRetryAfterSeconds: 0 });
      suspended = true;
      resuming = null;
      listeners.clear();
    },
  };
  return Object.freeze(controller);
}
