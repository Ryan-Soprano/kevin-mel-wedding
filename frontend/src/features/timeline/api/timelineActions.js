import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
import { normalizeEventFields, normalizeTimelineFilters } from "../timelineFields.js";

const EMPTY = Object.freeze([]);
const idle = () => Object.freeze({ phase: "idle", error: null, canRetry: false, needsFields: false });
export const initialTimeline = () => Object.freeze({ view: "list", items: EMPTY, event: null, requestedId: null,
  members: EMPTY, candidates: EMPTY, revision: null, filters: Object.freeze(normalizeTimelineFilters()), selectorStatus: "KEEP",
  nextCursor: null, cursors: Object.freeze([null]), mutation: idle(), error: null, notice: null });
const fingerprint = async fields => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(fields))))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Shares the inbox session, generation, deadlines and unresolved-write fence. */
export function createTimelineActions({ api, getState, publish, start, bounded, run, assertCurrent, isCurrent,
  authFailure, freeze, canNavigate, openMemory, randomId = () => crypto.randomUUID(), fieldsFingerprint = fingerprint }) {
  let intent = null, inFlight = null, uncertain = false, returnEventId = null, hiddenEventId = null, hiddenTimeline = false;
  const state = () => getState().timeline;
  const set = patch => publish({ timeline: Object.freeze({ ...state(), ...patch }) });
  const mutation = (phase, error = null, canRetry = false) => Object.freeze({ phase, error, canRetry,
    needsFields: Boolean(intent && ["create", "edit"].includes(intent.kind) && intent.fields === null) });
  const visible = () => !intent && canNavigate();
  const base = patch => ({ phase: "timeline", detail: null, items: EMPTY, nextCursor: null, timelineReturnId: null, notice: null,
    timeline: Object.freeze({ ...state(), error: null, notice: null, ...patch }) });
  function readFailure(failure) {
    if (authFailure(failure)) return;
    set({ error: failure?.status === 412 ? "The timeline changed while you were browsing. Reload its first page."
      : failure?.status === 404 ? "This event is unavailable. Return to the timeline."
        : "Your timeline could not be loaded. Try again." });
  }
  async function members(op, eventId, cursor = null, cursors = [null], notice = null) {
    const result = await bounded(op, signal => api.listTimelineMemories(eventId, { ...(cursor ? { cursor } : {}), signal }));
    assertCurrent(op);
    set({ view: "detail", requestedId: eventId, event: freeze(result.event), members: freeze(result.items), candidates: EMPTY,
      nextCursor: result.nextCursor, cursors: freeze(cursors), notice, error: null });
  }
  async function accepted(op, event, notice) {
    assertCurrent(op); intent = null; uncertain = false; hiddenEventId = null; hiddenTimeline = false;
    // Never attach fresh conditional tokens to old member/picker cards.
    set({ view: "detail", requestedId: event.eventId, event: freeze(event), mutation: idle(), notice, items: EMPTY,
      members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze([null]), error: null });
    try { await members(op, event.eventId, null, [null], notice); }
    catch (failure) { if (!isCurrent(op)) throw failure; readFailure(failure); }
  }
  function writeFailure(failure) {
    if (intent && ["create", "edit"].includes(intent.kind) && intent.fieldsHash === null) {
      intent = null; set({ mutation: idle(), error: "The event fields could not be prepared. No change was sent. Try again." });
    } else if (failure?.status === 403 && failure.code === "CSRF_INVALID") {
      set({ mutation: mutation("csrf", "Refresh your session and the event before choosing this action again.") });
    } else if (authFailure(failure)) {
      // Host clears private state and opaque recovery identity on access loss.
    } else if ([412, 428].includes(failure?.status)) {
      set({ mutation: mutation("conflict", "This event changed or its revision could not be checked. Reload current state.") });
    } else if (uncertain || failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      uncertain = true;
      set({ mutation: mutation("uncertain", "We could not confirm this timeline change. Reload current state before doing anything else.") });
    } else {
      intent = null; set({ mutation: idle(), error: failure?.status === 404 ? "That event or memory is unavailable. Reload the event."
        : failure?.status === 429 ? "Please wait before trying again. This request was not accepted."
          : "This timeline change was not accepted. Check its fields and reload before trying again." });
    }
  }
  function remember(op, task, failure = writeFailure) {
    const completion = run(op, task, failure).finally(() => { if (inFlight === completion) inFlight = null; });
    inFlight = completion; return completion;
  }
  async function execute(op, frozen) {
    const options = { revision: frozen.revision, csrfToken: getState().session.csrfToken };
    const event = await bounded(op, signal => {
      options.signal = signal;
      if (frozen.kind === "create") return api.createTimelineEvent(frozen.eventId, frozen.fields, options);
      if (frozen.kind === "edit") return api.updateTimelineEvent(frozen.eventId, frozen.fields, options);
      if (frozen.kind === "delete") return api.deleteTimelineEvent(frozen.eventId, options);
      return frozen.kind === "link" ? api.linkTimelineMemory(frozen.eventId, frozen.memoryId, options)
        : api.unlinkTimelineMemory(frozen.eventId, frozen.memoryId, options);
    }, undefined, true);
    if (event.eventId !== frozen.eventId || (frozen.kind === "delete" && event.deletedAt === null)
      || (["create", "edit"].includes(frozen.kind) && (event.deletedAt !== null || Object.keys(frozen.fields).some(field => event[field] !== frozen.fields[field])))) throw contractMismatch();
    await accepted(op, event, frozen.kind === "delete" ? "Event deleted. Its memories and original files remain in your archive."
      : "Timeline change accepted. Event placement preserves every original memory.");
  }
  function send() {
    const frozen = intent, op = start(base({ mutation: mutation("saving") }));
    return remember(op, () => execute(op, frozen));
  }
  async function reconcile(op) {
    const frozen = intent; let event;
    try { event = await bounded(op, signal => api.getTimelineEvent(frozen.eventId, { signal })); }
    catch (failure) {
      if (failure?.status !== 404 || frozen.kind !== "create") throw failure;
      set({ view: "create", event: null, members: EMPTY, candidates: EMPTY, nextCursor: null,
        mutation: mutation("uncertain", "This event is absent from the current read. The earlier request may still finish. Retry only the same event fields and identity, or reload again.", true) }); return;
    }
    if (event.eventId !== frozen.eventId) throw contractMismatch();
    if (frozen.kind !== "create" && event.revision === frozen.revision && uncertain) {
      set({ view: "detail", requestedId: event.eventId, event: freeze(event), members: EMPTY, candidates: EMPTY, nextCursor: null,
        mutation: mutation("uncertain", "The current read shows the earlier revision. The first request may still finish. Retry only this same change, or reload again.", true) }); return;
    }
    await accepted(op, event, "Current event loaded. Review it before choosing another action; this does not identify who changed it.");
  }
  function act(kind, extra = {}) {
    if (inFlight) return inFlight;
    if (!visible() || getState().busy || !state().event || state().event.deletedAt !== null) return Promise.resolve(getState());
    intent = Object.freeze({ kind, eventId: state().event.eventId, revision: state().event.revision, ...extra }); uncertain = false; return send();
  }
  function save(kind, fields) {
    if (inFlight) return inFlight;
    if (!visible() || getState().busy || (kind === "create" ? state().view !== "create" : !state().event || state().event.deletedAt !== null)) return Promise.resolve(getState());
    const normalized = normalizeEventFields(fields);
    intent = Object.freeze({ kind, eventId: kind === "create" ? randomId() : state().event.eventId,
      revision: kind === "create" ? null : state().event.revision, fields: normalized, fieldsHash: null }); uncertain = false;
    const frozen = intent, op = start(base({ mutation: mutation("saving") }));
    return remember(op, async () => {
      const fieldsHash = await bounded(op, () => fieldsFingerprint(normalized)); assertCurrent(op);
      intent = Object.freeze({ ...frozen, fieldsHash }); await execute(op, intent);
    });
  }
  const actions = {
    locked: () => intent !== null,
    hasPending: () => intent !== null || hiddenEventId !== null || hiddenTimeline,
    clear() { intent = null; inFlight = null; uncertain = false; returnEventId = null; hiddenEventId = null; hiddenTimeline = false; },
    clearNavigation() { returnEventId = null; hiddenEventId = null; hiddenTimeline = false; return { timelineReturnId: null }; },
    memoryContext(eventId) { returnEventId = eventId; publish({ timelineReturnId: eventId }); },
    hasReturn: () => returnEventId !== null, returnId: () => returnEventId,
    returnToEvent() { return actions.openTimelineEvent(returnEventId); },
    suspend() {
      if (intent && ["create", "edit"].includes(intent.kind) && intent.fieldsHash === null) intent = null;
      hiddenTimeline = intent !== null || returnEventId !== null || getState().phase === "timeline" || hiddenTimeline;
      hiddenEventId = intent?.eventId ?? returnEventId ?? (getState().phase === "timeline" ? state().event?.eventId ?? state().requestedId : null) ?? hiddenEventId;
      if (intent) { uncertain = true; intent = Object.freeze({ ...intent, fields: null }); }
      inFlight = null;
      return { timeline: Object.freeze({ ...initialTimeline(), mutation: intent ? mutation("uncertain") : idle() }) };
    },
    async resume(op) {
      publish({ phase: "timeline" });
      if (intent) await reconcile(op);
      else if (hiddenEventId) { const target = hiddenEventId; await members(op, target); hiddenEventId = null; hiddenTimeline = false; }
      else { await actions.readList(op); hiddenTimeline = false; }
    },
    async readList(op, cursor = null, cursors = [null]) {
      const result = await bounded(op, signal => api.listTimelineEvents({ ...state().filters, ...(cursor ? { cursor } : {}), signal }));
      assertCurrent(op); set({ view: "list", items: freeze(result.items), revision: result.revision, event: null, members: EMPTY,
        candidates: EMPTY, nextCursor: result.nextCursor, cursors: freeze(cursors), error: null });
    },
    loadTimeline(filters = state().filters, cursor = null, cursors = [null]) {
      if (!visible()) return Promise.resolve(getState());
      const normalized = normalizeTimelineFilters(filters); returnEventId = null;
      const op = start(base({ view: "list", filters: freeze(normalized), items: EMPTY, event: null, members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze(cursors) }));
      return run(op, () => actions.readList(op, cursor, cursors), readFailure);
    },
    openTimelineEvent(eventId, cursor = null, cursors = [null]) {
      if (!visible() || !eventId) return Promise.resolve(getState()); returnEventId = null;
      const op = start(base({ view: "detail", requestedId: eventId, event: state().event?.eventId === eventId ? state().event : null,
        members: EMPTY, candidates: EMPTY, nextCursor: null, cursors: freeze(cursors) }));
      return run(op, () => members(op, eventId, cursor, cursors), readFailure);
    },
    beginTimelineCreation() { if (!visible()) return getState(); const op = start(base({ ...initialTimeline(), view: "create" })); return run(op, async () => {}, readFailure); },
    createTimelineEvent(fields) { return save("create", fields); }, updateTimelineEvent(fields) { return save("edit", fields); },
    deleteTimelineEvent() { return act("delete"); }, linkTimelineMemory(memoryId) { return act("link", { memoryId }); }, unlinkTimelineMemory(memoryId) { return act("unlink", { memoryId }); },
    reloadTimelineMutation({ refreshSession = false } = {}) {
      if (inFlight) return inFlight;
      if (!intent || getState().busy || !getState().session?.authenticated) return Promise.resolve(getState());
      const previous = state().mutation.phase, op = start(base({ mutation: mutation("loading") }));
      return remember(op, async () => {
        if (refreshSession) {
          const session = await bounded(op, signal => api.getSession({ signal }));
          if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 });
          publish({ session: freeze({ authenticated: session.authenticated, csrfToken: session.csrfToken, user: { displayName: session.user.displayName, roles: session.user.roles } }) });
        } await reconcile(op);
      }, failure => { if (!authFailure(failure)) set({ mutation: mutation(previous, "Current event could not be loaded. Try reloading again.") }); });
    },
    retryTimelineMutation(fields) {
      if (inFlight) return inFlight;
      if (!intent || getState().busy || !getState().session?.authenticated || !state().mutation.canRetry) return Promise.resolve(getState());
      if (!state().mutation.needsFields) return send();
      const normalized = normalizeEventFields(fields), frozen = intent, op = start(base({ mutation: mutation("loading") }));
      return remember(op, async () => {
        const hash = await bounded(op, () => fieldsFingerprint(normalized)); assertCurrent(op);
        if (hash !== frozen.fieldsHash) { set({ mutation: mutation("uncertain", "Re-enter all the same fields used for the unconfirmed change. Different fields will not be sent.", true) }); return; }
        intent = Object.freeze({ ...frozen, fields: normalized }); await execute(op, intent);
      });
    },
    showTimelineSelector(reviewStatus = "KEEP", cursor = null, cursors = [null]) {
      if (!visible() || !state().event || state().event.deletedAt !== null) return Promise.resolve(getState());
      const op = start(base({ view: "select", candidates: EMPTY, members: EMPTY, nextCursor: null, selectorStatus: reviewStatus, cursors: freeze(cursors) }));
      return run(op, async () => {
        const result = await bounded(op, signal => api.listMemories({ reviewStatus, limit: 20, ...(cursor ? { cursor } : {}), signal }));
        assertCurrent(op); set({ candidates: freeze(result.items), nextCursor: result.nextCursor, error: null });
      }, readFailure);
    },
    openTimelineMemory(memoryId) { if (!visible() || !state().event) return Promise.resolve(getState()); return openMemory(memoryId, { eventId: state().event.eventId }); },
    timelinePage(next) {
      if (!visible() || getState().busy || state().error) return Promise.resolve(getState());
      const cursors = next ? [...state().cursors, state().nextCursor] : state().cursors.slice(0, -1);
      if ((next && !state().nextCursor) || !cursors.length) return Promise.resolve(getState());
      if (state().view === "list") return actions.loadTimeline(state().filters, cursors.at(-1), cursors);
      if (state().view === "select") return actions.showTimelineSelector(state().selectorStatus, cursors.at(-1), cursors);
      return actions.openTimelineEvent(state().event.eventId, cursors.at(-1), cursors);
    },
  }; return actions;
}
