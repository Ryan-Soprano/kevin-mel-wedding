import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";

const EMPTY = Object.freeze([]);
const idle = () => Object.freeze({ phase: "idle", error: null, canRetry: false, needsName: false });
export const initialTags = () => Object.freeze({ view: "list", items: EMPTY, tag: null, members: EMPTY,
  requestedId: null, memoryId: null, q: "", candidates: EMPTY, nextCursor: null, cursors: Object.freeze([null]), selectorStatus: "KEEP", mutation: idle(), error: null, notice: null });
const fingerprint = async name => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Tag work shares the host's session, cancellation generation and write fence. */
export function createTagActions({ api, getState, publish, start, bounded, run, assertCurrent,
  isCurrent, authFailure, freeze, canNavigate, openMemory, randomId = () => crypto.randomUUID(), nameFingerprint = fingerprint }) {
  let intent = null, inFlight = null, uncertain = false, returnTagId = null, hiddenTagId = null;
  let returnTagQuery = "";
  const state = () => getState().tags;
  const set = patch => publish({ tags: Object.freeze({ ...state(), ...patch }) });
  const mutation = (phase, error = null, canRetry = false) => Object.freeze({ phase, error, canRetry,
    needsName: Boolean(intent && ["create", "rename"].includes(intent.kind) && intent.name === null) });
  const visible = () => !intent && canNavigate();
  const base = patch => ({ ...(intent?.context === "memory" ? { phase: "detail" } : { phase: "tags", detail: null, items: EMPTY, nextCursor: null, tagReturnId: null }), notice: null,
    tags: Object.freeze({ ...state(), error: null, notice: null, ...patch }) });

  function readFailure(failure) {
    if (authFailure(failure)) return;
    set({ error: failure?.status === 412
      ? "This tag changed while you were browsing. Reload its first page."
      : failure?.status === 404 ? "This tag is unavailable. Return to your tags."
        : "Your tags could not be loaded. Try again." });
  }
  async function members(op, tagId, cursor = null, cursors = [null], notice = null) {
    const result = await bounded(op, signal => api.listTagMembers(tagId, { ...(cursor ? { cursor } : {}), signal }));
    assertCurrent(op);
    set({ view: "detail", requestedId: tagId, tag: freeze(result.tag), members: freeze(result.items), candidates: EMPTY,
      nextCursor: result.nextCursor, cursors: freeze(cursors), notice, error: null });
    assertCurrent(op);
  }
  async function accepted(op, tag, notice) {
    assertCurrent(op);
    const memoryId = intent?.context === "memory" ? intent.memoryId : null;
    intent = null; uncertain = false; hiddenTagId = null;
    // The new token must never authorize controls derived from an older order.
    // Install identity only until a fresh member page has actually been read.
    set({ view: memoryId ? "memory" : "detail", memoryId, requestedId: tag.tagId, tag: freeze(tag), mutation: idle(), notice, items: EMPTY,
      members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze([null]), error: null });
    try { if (memoryId) await actions.readMemoryTags(op, memoryId, null, [null], notice); else await members(op, tag.tagId, null, [null], notice); }
    catch (failure) {
      // A timed-out follow-up read does not undo an acknowledged write. An
      // obsolete generation must never republish content after hide/navigation.
      if (!isCurrent(op)) throw failure;
      readFailure(failure);
    }
  }
  function writeFailure(failure) {
    if (intent && ["create", "rename"].includes(intent.kind) && intent.nameHash === null) {
      intent = null;
      set({ mutation: idle(), error: "The tag name could not be prepared. No change was sent. Try again." });
    } else if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      set({ mutation: mutation("csrf", "Refresh your session and the tag before choosing this action again.") });
    } else if (authFailure(failure)) {
      // The host clears all tag intent and private state on access loss.
    } else if ([412, 428].includes(failure?.status)) {
      set({ mutation: mutation("conflict", "This tag changed or its revision could not be checked. Reload its current state.") });
    } else if (uncertain || failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      uncertain = true;
      set({ mutation: mutation("uncertain", "We could not confirm this tag change. Reload current state before doing anything else.") });
    } else {
      intent = null;
      set({ mutation: idle(), error: failure?.status === 404 ? "That tag or memory is unavailable. Reload the tag."
        : failure?.status === 429 ? "Please wait before trying again. This request was not accepted."
          : "This tag change was not accepted. Check the fields and reload before trying again." });
    }
  }
  function remember(op, task, onFailure = writeFailure) {
    const completion = run(op, task, onFailure).finally(() => { if (inFlight === completion) inFlight = null; });
    inFlight = completion;
    return completion;
  }
  function send() {
    const frozen = intent, token = getState().session?.csrfToken;
    const op = start(base({ mutation: mutation("saving") }));
    return remember(op, async () => {
      const options = { revision: frozen.revision, csrfToken: token };
      const tag = await bounded(op, signal => {
        options.signal = signal;
        if (frozen.kind === "create") return api.createTag(frozen.tagId, frozen.name, options);
        if (frozen.kind === "rename") return api.renameTag(frozen.tagId, frozen.name, options);
        if (frozen.kind === "delete") return api.deleteTag(frozen.tagId, options);
        if (frozen.kind === "add") return api.attachTag(frozen.tagId, frozen.memoryId, options);
        return api.removeTag(frozen.tagId, frozen.memoryId, options);
      }, undefined, true);
      if (tag.tagId !== frozen.tagId) throw contractMismatch();
      if (frozen.kind === "rename" && (tag.deletedAt !== null || tag.name !== frozen.name)) throw contractMismatch();
      if (frozen.kind === "delete" && tag.deletedAt === null) throw contractMismatch();
      await accepted(op, tag, frozen.kind === "delete"
        ? "Tag deleted. Its memories and original files remain in your archive."
        : "Tag change accepted. Current tag loaded; every memory stays private.");
    });
  }
  async function reconcile(op) {
    const frozen = intent;
    let tag;
    try { tag = await bounded(op, signal => api.getTag(frozen.tagId, { signal })); }
    catch (failure) {
      if (failure?.status !== 404 || frozen.kind !== "create") throw failure;
      // A read can precede a late create. Keep the same UUID until confirmed.
      set({ view: "create", tag: null, members: EMPTY, candidates: EMPTY,
        mutation: mutation("uncertain", "This tag is not present in the current read. The earlier request may still finish. Retry only this same tag name and identity, or reload again.", true) });
      return;
    }
    if (tag.tagId !== frozen.tagId) throw contractMismatch();
    if (frozen.kind !== "create" && tag.revision === frozen.revision && uncertain) {
      set({ view: frozen.context === "memory" ? "memory" : "detail", requestedId: tag.tagId, tag: freeze(tag), items: EMPTY, members: EMPTY, candidates: EMPTY, nextCursor: null,
        mutation: mutation("uncertain", "The current read still shows the earlier revision. The first request may still finish. Retry only this same change, or reload again.", true) });
      return;
    }
    await accepted(op, tag, "Current tag loaded. Review it before choosing another action; this does not identify who changed it.");
  }
  function act(kind, extra = {}) {
    if (inFlight) return inFlight;
    if (!visible() || getState().busy || !state().tag || state().tag.deletedAt !== null) return Promise.resolve(getState());
    intent = Object.freeze({ kind, tagId: state().tag.tagId, revision: state().tag.revision, ...extra });
    uncertain = false;
    return send();
  }
  const actions = {
    locked: () => intent !== null,
    hasPending: () => intent !== null || hiddenTagId !== null,
    clear() {
      intent = null;
      inFlight = null;
      uncertain = false;
      returnTagId = null;
      returnTagQuery = "";
      hiddenTagId = null;
    },
    clearNavigation() {
      returnTagId = null;
      returnTagQuery = "";
      hiddenTagId = null;
      return { tagReturnId: null };
    },
    memoryContext(tagId) {
      returnTagId = tagId;
      returnTagQuery = tagId && state().tag?.tagId === tagId ? state().q : "";
      publish({ tagReturnId: tagId });
    },
    hasReturn: () => returnTagId !== null,
    returnId: () => returnTagId,
    returnToTag() {
      return actions.openTag(returnTagId, null, [null], returnTagQuery);
    },
    suspend() {
      if (intent && ["create", "rename"].includes(intent.kind) && intent.nameHash === null) intent = null;
      hiddenTagId = intent?.tagId ?? returnTagId
        ?? (getState().phase === "tags" ? state().tag?.tagId ?? state().requestedId : null) ?? hiddenTagId;
      if (intent) {
        uncertain = true;
        // A hash permits deliberate same-name retry without retaining private text.
        intent = Object.freeze({ ...intent, name: null });
      }
      inFlight = null;
      returnTagQuery = "";
      return { tags: Object.freeze({ ...initialTags(), mutation: intent ? mutation("uncertain") : idle() }) };
    },
    async resume(op) {
      if (intent?.context === "memory") {
        const detail = await bounded(op, signal => api.getMemory(intent.memoryId, { signal })); assertCurrent(op);
        publish({ phase: "detail", detail: freeze(detail) }); await reconcile(op); return;
      }
      publish({ phase: "tags" });
      if (intent) await reconcile(op);
      else if (hiddenTagId) {
        const target = hiddenTagId;
        await members(op, target);
        hiddenTagId = null;
      } else await actions.readList(op);
    },
    async readList(op, cursor = null, cursors = [null]) {
      const result = await bounded(op, signal => api.listTags({ q: state().q, ...(cursor ? { cursor } : {}), signal }));
      assertCurrent(op);
      set({ view: "list", items: freeze(result.items), tag: null, members: EMPTY, candidates: EMPTY,
        nextCursor: result.nextCursor, cursors: freeze(cursors), error: null });
    },
    loadTags(q = state().q, cursor = null, cursors = [null]) {
      if (!visible()) return Promise.resolve(getState());
      returnTagId = null;
      returnTagQuery = "";
      const query = normalizeLibraryQuery(q);
      const op = start(base({ view: "list", q: query, items: EMPTY, tag: null, members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze(cursors) }));
      return run(op, () => actions.readList(op, cursor, cursors), readFailure);
    },
    openTag(tagId, cursor = null, cursors = [null], q = state().q) {
      if (!visible() || !tagId) return Promise.resolve(getState());
      returnTagId = null;
      returnTagQuery = "";
      const op = start(base({
        view: "detail",
        q,
        requestedId: tagId,
        tag: state().tag?.tagId === tagId ? state().tag : null,
        members: EMPTY,
        candidates: EMPTY,
        nextCursor: null,
        cursors: freeze(cursors),
      }));
      return run(op, () => members(op, tagId, cursor, cursors), readFailure);
    },
    beginTagCreation() {
      if (!visible()) return getState();
      const op = start(base({ ...initialTags(), view: "create" }));
      return run(op, async () => {}, readFailure);
    },
    createTag(name) {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || state().view !== "create") return Promise.resolve(getState());
      const normalized = normalizeTagName(name), tagId = randomId();
      intent = Object.freeze({ kind: "create", tagId, revision: null, name: normalized, nameHash: null });
      const op = start(base({ mutation: mutation("saving") }));
      return remember(op, async () => {
        const nameHash = await bounded(op, () => nameFingerprint(normalized));
        assertCurrent(op);
        intent = Object.freeze({ ...intent, nameHash });
        const tag = await bounded(op, signal => api.createTag(tagId, normalized, { csrfToken: getState().session.csrfToken, signal }), undefined, true);
        await accepted(op, tag, "Tag created privately. Add memories whenever you are ready.");
      });
    },
    renameTag(name) {
      if (inFlight || !visible() || getState().busy || !state().tag || state().tag.deletedAt !== null) return Promise.resolve(getState());
      const normalized = normalizeTagName(name);
      intent = Object.freeze({ kind: "rename", tagId: state().tag.tagId, revision: state().tag.revision,
        name: normalized, nameHash: null });
      uncertain = false;
      const op = start(base({ mutation: mutation("saving") }));
      return remember(op, async () => {
        const nameHash = await bounded(op, () => nameFingerprint(normalized)); assertCurrent(op);
        intent = Object.freeze({ ...intent, nameHash });
        const tag = await bounded(op, signal => api.renameTag(intent.tagId, normalized,
          { revision: intent.revision, csrfToken: getState().session.csrfToken, signal }), undefined, true);
        await accepted(op, tag, "Tag name saved privately.");
      });
    },
    deleteTag() { return act("delete"); },
    addTagMember(memoryId) { return act("add", { memoryId }); },
    removeTagMember(memoryId) { return act("remove", { memoryId }); },
    reloadTagMutation({ refreshSession = false } = {}) {
      if (inFlight) return inFlight;
      if (!intent || getState().busy || !getState().session?.authenticated) return Promise.resolve(getState());
      const previous = state().mutation.phase;
      const op = start(base({ mutation: mutation("loading") }));
      return remember(op, async () => {
        if (refreshSession) {
          const session = await bounded(op, signal => api.getSession({ signal }));
          if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
          publish({ session: freeze({ authenticated: session.authenticated, csrfToken: session.csrfToken,
            user: { displayName: session.user.displayName, roles: session.user.roles } }) });
        }
        await reconcile(op);
      }, failure => { if (!authFailure(failure)) set({ mutation: mutation(previous, "Current tag could not be loaded. Try reloading again.") }); });
    },
    retryTagMutation(name) {
      if (inFlight) return inFlight;
      if (!intent || getState().busy || !getState().session?.authenticated || !state().mutation.canRetry) return Promise.resolve(getState());
      if (!state().mutation.needsName) return send();
      const normalized = normalizeTagName(name), frozen = intent;
      const op = start(base({ mutation: mutation("loading") }));
      return remember(op, async () => {
        const hash = await bounded(op, () => nameFingerprint(normalized));
        assertCurrent(op);
        if (frozen.nameHash === null || hash !== frozen.nameHash) {
          set({ mutation: mutation("uncertain", "Re-enter the same name used for the unconfirmed change. A different name will not be sent.", true) });
          return;
        }
        intent = Object.freeze({ ...frozen, name: normalized });
        const options = { revision: frozen.revision, csrfToken: getState().session.csrfToken };
        const tag = await bounded(op, signal => frozen.kind === "create"
          ? api.createTag(frozen.tagId, normalized, { ...options, signal })
          : api.renameTag(frozen.tagId, normalized, { ...options, signal }), undefined, true);
        await accepted(op, tag, "Same tag change accepted. Current state loaded privately.");
      });
    },
    showTagSelector(reviewStatus = "KEEP", cursor = null, cursors = [null]) {
      if (!visible() || !state().tag || state().tag.deletedAt !== null) return Promise.resolve(getState());
      const op = start(base({ view: "select", candidates: EMPTY, nextCursor: null, selectorStatus: reviewStatus, cursors: freeze(cursors) }));
      return run(op, async () => {
        const result = await bounded(op, signal => api.listMemories({ reviewStatus, limit: 20, ...(cursor ? { cursor } : {}), signal }));
        assertCurrent(op);
        set({ candidates: freeze(result.items), nextCursor: result.nextCursor, cursors: freeze(cursors), error: null });
      }, readFailure);
    },
    openTagMemory(memoryId) {
      if (!visible() || !state().tag) return Promise.resolve(getState());
      return openMemory(memoryId, { tagId: state().tag.tagId });
    },
    tagPage(next) {
      if (!visible() || getState().busy || state().error) return Promise.resolve(getState());
      const cursors = next ? [...state().cursors, state().nextCursor] : state().cursors.slice(0, -1);
      if ((next && !state().nextCursor) || !cursors.length) return Promise.resolve(getState());
      if (state().view === "list") return actions.loadTags(state().q, cursors.at(-1), cursors);
      if (state().view === "select") return actions.showTagSelector(state().selectorStatus, cursors.at(-1), cursors);
      return actions.openTag(state().tag.tagId, cursors.at(-1), cursors);
    },
    readFailure,
    clearMemoryPresentation() { set({ view: "memory", memoryId: null, items: EMPTY, tag: null, members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze([null]), error: null, notice: null }); },
    async readMemoryTags(op, memoryId, cursor = null, cursors = [null], notice = null) {
      const result = await bounded(op, signal => api.listMemoryTags(memoryId, { ...(cursor ? { cursor } : {}), signal })); assertCurrent(op);
      set({ view: "memory", memoryId, items: freeze(result.items), tag: null, members: EMPTY, candidates: EMPTY, nextCursor: result.nextCursor, cursors: freeze(cursors), notice, error: null });
    },
    loadMemoryTags(cursor = null, cursors = [null]) {
      if (!visible() || getState().phase !== "detail" || !getState().detail || getState().detail.reviewStatus === "DELETE") return Promise.resolve(getState());
      const memoryId = getState().detail.memoryId, op = start({ phase: "detail", tags: freeze({ ...initialTags(), view: "memory", memoryId, items: EMPTY, cursors }) });
      return run(op, () => actions.readMemoryTags(op, memoryId, cursor, cursors), readFailure);
    },
    chooseMemoryTag(q = "", cursor = null, cursors = [null]) {
      if (!visible() || getState().phase !== "detail" || !getState().detail || getState().detail.reviewStatus === "DELETE") return Promise.resolve(getState());
      const memoryId = getState().detail.memoryId, query = normalizeLibraryQuery(q);
      const op = start({ phase: "detail", tags: freeze({ ...initialTags(), view: "attach", memoryId, q: query, cursors }) });
      return run(op, async () => { const page = await bounded(op, signal => api.listTags({ q: query, ...(cursor ? { cursor } : {}), signal })); assertCurrent(op);
        set({ items: freeze(page.items), nextCursor: page.nextCursor, error: null }); }, readFailure);
    },
    changeMemoryTag(tagId, remove = false) {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || getState().phase !== "detail" || getState().detail?.reviewStatus === "DELETE") return Promise.resolve(getState());
      const tag = state().items.find(item => item.tagId === tagId); if (!tag || tag.deletedAt !== null) return Promise.resolve(getState());
      intent = Object.freeze({ kind: remove ? "remove" : "add", context: "memory", tagId, revision: tag.revision, memoryId: getState().detail.memoryId }); uncertain = false; return send();
    },
    memoryTagPage(next) {
      if (!visible() || getState().busy || state().error) return Promise.resolve(getState());
      const cursors = next ? [...state().cursors, state().nextCursor] : state().cursors.slice(0, -1); if ((next && !state().nextCursor) || !cursors.length) return Promise.resolve(getState());
      return state().view === "attach" ? actions.chooseMemoryTag(state().q, cursors.at(-1), cursors) : actions.loadMemoryTags(cursors.at(-1), cursors);
    },
  };
  return actions;
}
