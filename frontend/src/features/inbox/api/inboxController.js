import { createArchiveApi } from "../../../shared/api/archiveApi.js";
import { ApiError } from "../../../shared/api/apiClient.js";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../../media/mediaConstraints.js";

const EMPTY_ITEMS = Object.freeze([]);
const idlePhoto = () => Object.freeze({ phase: "idle", url: null, error: null });
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

function photoMessage(failure) {
  if (failure?.code === "PHOTO_INTEGRITY") return "This photo did not match its saved original. It has not been displayed. Try loading it again.";
  if (failure?.code === "PHOTO_EXPIRED") return "The photo link expired. Try loading the original again.";
  if (failure?.code === "REQUEST_TIMED_OUT") return "The photo took too long to load. Try loading it again.";
  if (failure?.status === 429) return "Please wait before trying to load this photo again.";
  return "The original photo could not be loaded. The memory is still here. Try loading it again.";
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
    photo: idlePhoto(), logoutUnconfirmed: false });
  let generation = 0, operation = null, disposed = false, objectUrl = null;
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

  function start(patch) {
    if (disposed) return null;
    cancel();
    const current = { generation, controller: new AbortController() };
    operation = current;
    publish({ busy: true, error: null, photo: idlePhoto(), ...patch });
    return current;
  }

  function current(op) { return !disposed && op.generation === generation; }
  function assertCurrent(op) {
    if (!current(op)) throw interrupted();
    if (op.controller.signal.aborted) throw op.controller.signal.reason ?? interrupted();
  }

  async function bounded(op, task, duration = apiTimeoutMs) {
    assertCurrent(op);
    const signal = op.controller.signal;
    let timer, onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason ?? interrupted());
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeoutImpl(() => {
        const failure = new ApiError("The request took too long.", { code: "REQUEST_TIMED_OUT" });
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
    publish({ session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, photo: idlePhoto(), ...patch });
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
  }

  function cancelBody(response) {
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* Stream may already be closed. */ }
  }

  async function readPhoto(op, url, media, signal) {
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
        if (bytes > media.byteSize || bytes > MAX_PHOTO_BYTES) throw photoFailure("PHOTO_INTEGRITY");
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
    publish({ photo: Object.freeze({ phase: "loading", url: null, error: null }) });
    try {
      if (!media || !Number.isSafeInteger(media.byteSize) || media.byteSize < 1 || media.byteSize > MAX_PHOTO_BYTES
        || !ALLOWED_FILE_TYPES.has(media.detectedContentType) || !/^[0-9a-f]{64}$/.test(media.checksumSha256)) {
        throw photoFailure("PHOTO_INTEGRITY");
      }
      const grant = await bounded(op, signal => api.getPlayback(memory.memoryId, { signal }));
      let url;
      try { url = new URL(grant.url); } catch { throw photoFailure("PHOTO_INTEGRITY"); }
      if (url.protocol !== "https:" || url.username || url.password) throw photoFailure("PHOTO_INTEGRITY");
      if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now()) throw photoFailure("PHOTO_EXPIRED");
      const blob = await bounded(op, signal => readPhoto(op, url.href, media, signal), photoTimeoutMs);
      assertCurrent(op);
      const nextUrl = createObjectURL(blob);
      if (!current(op)) { revokeObjectURL(nextUrl); return; }
      objectUrl = nextUrl;
      publish({ photo: Object.freeze({ phase: "ready", url: nextUrl, error: null }) });
    } catch (failure) {
      if (!current(op)) return;
      if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure) }) });
    }
  }

  const controller = {
    getSnapshot: () => state,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A state listener is required.");
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadSession() {
      if (state.logoutUnconfirmed) return controller.logout();
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null });
      return run(op, async () => {
        const session = sessionCopy(await bounded(op, signal => api.getSession({ signal })));
        publish({ session, phase: session.authenticated ? "inbox" : "login" });
        if (session.authenticated) await page(op, "PENDING", null);
      }, failure => {
        if (!authFailure(failure)) clearPrivate({ phase: "unavailable", error: "The archive could not be reached. Try checking access again." });
      });
    },
    login(credentials) {
      const op = start({ phase: "login", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, logoutUnconfirmed: false });
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
      const op = start({ phase: "checking", session: null, items: EMPTY_ITEMS, nextCursor: null, detail: null, logoutUnconfirmed: false });
      return run(op, async () => {
        const fresh = await bounded(op, signal => api.getSession({ signal }));
        if (fresh.authenticated) await bounded(op, signal => api.logout({ csrfToken: fresh.csrfToken, signal }));
        clearPrivate({ phase: "login", error: null, logoutUnconfirmed: false });
      }, () => clearPrivate({ phase: "unavailable", logoutUnconfirmed: true,
        error: "Sign-out could not be confirmed. Private content is hidden here. Retry signing out before leaving a shared device." }));
    },
    loadInbox(reviewStatus = "PENDING", cursor = null) {
      if (!state.session?.authenticated || disposed) return Promise.resolve(state);
      const changed = reviewStatus !== state.reviewStatus;
      const op = start({ phase: "inbox", reviewStatus, detail: null,
        ...(changed ? { items: EMPTY_ITEMS, nextCursor: null } : {}) });
      return run(op, () => page(op, reviewStatus, cursor), failure => {
        if (!authFailure(failure)) publish({ error: "Your inbox could not be loaded. Try loading it again." });
      });
    },
    openMemory(id) {
      if (!state.session?.authenticated || disposed) return Promise.resolve(state);
      const op = start({ phase: "detail", detail: null });
      return run(op, async () => {
        const detail = frozenCopy(await bounded(op, signal => api.getMemory(id, { signal })));
        publish({ detail });
        if (detail.memoryType === "PHOTO") await photo(op, detail);
      }, failure => {
        if (!authFailure(failure)) publish({ error: failure?.status === 404
          ? "This memory is unavailable. Return to the inbox and load it again."
          : "This memory could not be loaded. Return to the inbox and try again." });
      });
    },
    backToInbox() {
      if (disposed || !state.session?.authenticated) return state;
      cancel();
      publish({ phase: "inbox", busy: false, error: null, detail: null, photo: idlePhoto() });
      return state;
    },
    retryPhoto() {
      if (state.phase !== "detail" || state.detail?.memoryType !== "PHOTO" || !state.session?.authenticated || disposed) return Promise.resolve(state);
      const detail = state.detail;
      const op = start({ phase: "detail", detail });
      return run(op, () => photo(op, detail), failure => {
        if (!authFailure(failure)) publish({ photo: Object.freeze({ phase: "error", url: null, error: photoMessage(failure) }) });
      });
    },
    dispose() {
      if (disposed) return;
      cancel();
      state = Object.freeze({ ...state, session: null, items: EMPTY_ITEMS, nextCursor: null,
        detail: null, photo: idlePhoto(), busy: false, error: null });
      disposed = true;
      listeners.clear();
    },
  };
  return Object.freeze(controller);
}
