import { ApiError, contractMismatch } from "../../../shared/api/apiClient.js";
const EMPTY = Object.freeze([]);
const idle = () => Object.freeze({ phase: "idle", error: null, canRetry: false });
export const initialExport = () => Object.freeze({ job: null, parts: EMPTY, issues: EMPTY, partsNextCursor: null, issuesNextCursor: null,
  partCursors: Object.freeze([null]), issueCursors: Object.freeze([null]), mutation: idle(), error: null, notice: null, unavailable: false,
  download: Object.freeze({ phase: "idle", url: null, filename: null, receivedBytes: 0, totalBytes: 0 }), retryAfterSeconds: null });

/** One private session owner; only opaque job/attempt identities survive hide.
 * Progress reads are deliberate. Creating/preparing/cancelling never auto-retry. */
export function createExportActions({ api, getState, publish, start, bounded, run, assertCurrent, isCurrent, authFailure, freeze, canNavigate,
  createObjectURL, revokeObjectURL, randomId = () => crypto.randomUUID(), now = Date.now }) {
  let jobId = null, intent = null, inFlight = null, uncertain = false, hidden = false, objectUrl = null, retryAt = 0;
  const state = () => getState().export;
  const set = patch => publish({ export: freeze({ ...state(), ...patch }) });
  const mutation = (phase, error = null, canRetry = false) => Object.freeze({ phase, error, canRetry });
  const visible = () => !intent && canNavigate();
  const base = patch => ({ phase: "export", detail: null, items: EMPTY, nextCursor: null, notice: null, export: freeze({ ...state(), error: null, notice: null, download: initialExport().download, ...patch }) });
  function waitAllowed() {
    const seconds = Math.ceil((retryAt - now()) / 1000);
    if (seconds > 0) { set({ retryAfterSeconds: seconds, error: "Please wait " + seconds + " seconds before checking or trying again." }); return false; }
    set({ retryAfterSeconds: null }); return true;
  }
  function unavailable() { intent = null; uncertain = false; actions.revokeDownload(); set({ ...initialExport(), unavailable: true, error: "This export is unavailable, expired or was lost when the app restarted. Start a new export explicitly." }); }
  function retryHint(failure) { if (failure?.retryAfterSeconds !== null && failure?.retryAfterSeconds !== undefined) { retryAt = now() + failure.retryAfterSeconds * 1000; set({ retryAfterSeconds: failure.retryAfterSeconds }); } }
  function readFailure(failure) {
    if (authFailure(failure)) return;
    if ([404, 410].includes(failure?.status)) { unavailable(); return; }
    retryHint(failure);
    set({ error: "Export progress could not be checked. Try checking again; no new export was started." });
  }
  async function pages(op) {
    set({ parts: EMPTY, issues: EMPTY, partsNextCursor: null, issuesNextCursor: null, partCursors: [null], issueCursors: [null] });
    const job = state().job; if (!job?.capturedAt || ["FAILED", "STALE", "CANCELLED", "EXPIRED"].includes(job.state)) return;
    try {
      const parts = await bounded(op, signal => api.listExportParts(jobId, { signal })); assertCurrent(op);
      set({ parts: parts.items, partsNextCursor: parts.nextCursor });
      const issues = await bounded(op, signal => api.listExportIssues(jobId, { signal })); assertCurrent(op);
      set({ issues: issues.items, issuesNextCursor: issues.nextCursor });
    } catch (failure) { if (!isCurrent(op)) throw failure; readFailure(failure); }
  }
  async function accepted(op, job, notice) {
    assertCurrent(op); if (job.exportId !== jobId) throw contractMismatch();
    intent = null; uncertain = false;
    set({ job, mutation: idle(), parts: EMPTY, issues: EMPTY, partsNextCursor: null, issuesNextCursor: null, notice, error: null, unavailable: false });
    await pages(op);
  }
  function writeFailure(failure) {
    retryHint(failure);
    if (failure?.status === 403 && failure.code === "CSRF_INVALID") set({ mutation: mutation("csrf", "Refresh your session and check this export before choosing another action.") });
    else if (authFailure(failure)) { /* Host clears identity and private bytes. */ }
    else if (failure?.status === 412 || uncertain || failure?.unknownOutcome || !failure?.status || failure.status >= 500) {
      uncertain = true; set({ mutation: mutation("uncertain", "This export action is unconfirmed. Check the same job and attempt before retrying.") });
    } else if ([404, 410].includes(failure?.status)) unavailable();
    else {
      intent = null; uncertain = false;
      set({ mutation: idle(), error: failure?.code === "EXPORT_BUSY" ? "Another export part is being prepared or downloaded. Wait, then try again."
        : failure?.status === 429 ? "Please wait before trying this export action again." : "This export action was not accepted. Check current progress before trying again." });
    }
  }
  function remember(op, task, failure = writeFailure) {
    const completion = run(op, task, failure).finally(() => { if (inFlight === completion) inFlight = null; }); inFlight = completion; return completion;
  }
  function send() {
    const frozen = intent, csrfToken = getState().session.csrfToken, op = start(base({ mutation: mutation("saving") }));
    return remember(op, async () => {
      const job = await bounded(op, signal => frozen.kind === "CREATE" ? api.createExport(jobId, { csrfToken, signal })
        : frozen.kind === "CANCEL" ? api.cancelExport(jobId, { attemptId: frozen.attemptId, csrfToken, signal })
          : api.prepareExportPart(jobId, frozen.partNumber, { attemptId: frozen.attemptId, csrfToken, signal }), undefined, true);
      await accepted(op, job, frozen.kind === "CANCEL" ? "Export cancelled. Files already saved on your device remain there." : "Export action accepted. Check progress to see when the part is ready.");
    });
  }
  async function reconcile(op) {
    const frozen = intent;
    if (frozen?.kind !== "CREATE") {
      let attempt;
      try { attempt = await bounded(op, signal => api.getExportAttempt(jobId, frozen.attemptId, { signal })); }
      catch (failure) {
        if (failure?.status !== 404) throw failure;
        let job; try { job = await bounded(op, signal => api.getExport(jobId, { signal })); }
        catch (readError) { if ([404, 410].includes(readError?.status)) { unavailable(); return; } throw readError; }
        assertCurrent(op);
        if (["FAILED", "STALE", "CANCELLED", "EXPIRED"].includes(job.state)) { await accepted(op, job, "Current export state loaded. The earlier action will not be resent."); return; }
        set({ job, parts: EMPTY, issues: EMPTY, mutation: mutation("uncertain", "That attempt is not recorded yet. It may still arrive. Retry only this same attempt, or check again.", true) }); return;
      }
      if (attempt.kind !== frozen.kind || attempt.partNumber !== frozen.partNumber) throw contractMismatch();
      // Recorded RUNNING is an acknowledgement, not completion. Never resend it.
      intent = null; uncertain = false; set({ mutation: idle(), notice: attempt.state === "FAILED" ? "The recorded export attempt failed. Check current state before choosing another action." : "The export attempt is recorded. It will not be resent." });
    }
    let job;
    try { job = await bounded(op, signal => api.getExport(jobId, { signal })); }
    catch (failure) {
      if (failure?.status === 404 && frozen?.kind === "CREATE") { set({ mutation: mutation("uncertain", "The same export identity is not recorded yet. The earlier request may still arrive. Retry this identity or check again; do not create a replacement.", true) }); return; }
      if (!intent && isCurrent(op)) { readFailure(failure); return; } throw failure;
    }
    await accepted(op, job, "Current export loaded. Check its status before choosing another action.");
  }
  const actions = {
    locked: () => intent !== null,
    hasPending: () => hidden,
    revokeDownload() { if (objectUrl !== null) { const old = objectUrl; objectUrl = null; try { revokeObjectURL(old); } catch { /* Still clear state. */ } } },
    leave() { actions.revokeDownload(); return { export: initialExport() }; },
    clear() { actions.revokeDownload(); jobId = null; intent = null; inFlight = null; uncertain = false; hidden = false; retryAt = 0; },
    suspend() { hidden = Boolean(jobId && (getState().phase === "export" || intent)); actions.revokeDownload(); inFlight = null; if (intent) uncertain = true; return { export: freeze({ ...initialExport(), mutation: intent ? mutation("uncertain") : idle() }) }; },
    async resume(op) { publish({ phase: "export" }); try { if (intent) await reconcile(op); else if (jobId) await actions.read(op); }
      catch (failure) { if ([404, 410].includes(failure?.status)) readFailure(failure); else throw failure; } assertCurrent(op); hidden = false; },
    async read(op) { const job = await bounded(op, signal => api.getExport(jobId, { signal })); assertCurrent(op); set({ job, error: null, unavailable: false }); await pages(op); },
    loadExport() {
      if (!visible()) return Promise.resolve(getState()); const op = start(base({ ...initialExport() }));
      return run(op, async () => {
        if (jobId) { await actions.read(op); return; }
        let job; try { job = await bounded(op, signal => api.getCurrentExport({ signal })); }
        catch (failure) { if (failure?.status === 404) return; throw failure; }
        assertCurrent(op); jobId = job.exportId; await accepted(op, job, "Existing export loaded. Check its progress before choosing another action.");
      }, readFailure);
    },
    createExport() {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || !waitAllowed() || (state().job && !["FAILED", "STALE", "CANCELLED", "EXPIRED"].includes(state().job.state))) return Promise.resolve(getState());
      jobId = randomId(); intent = { kind: "CREATE", attemptId: null, partNumber: null }; uncertain = false; return send();
    },
    prepareExportPart(number) {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || !state().job || !["READY", "READY_WITH_WARNINGS"].includes(state().job.state) || !waitAllowed()) return Promise.resolve(getState());
      if (!Number.isSafeInteger(number) || number < 1 || number > state().job.indexPartNumber) throw new TypeError("Choose an existing export part.");
      intent = { kind: "PREPARE", attemptId: randomId(), partNumber: number }; uncertain = false; return send();
    },
    cancelExport() {
      if (inFlight) return inFlight;
      if (!visible() || getState().busy || !state().job || ["CANCELLED", "EXPIRED"].includes(state().job.state) || !waitAllowed()) return Promise.resolve(getState());
      intent = { kind: "CANCEL", attemptId: randomId(), partNumber: null }; uncertain = false; return send();
    },
    checkExport({ refreshSession = false } = {}) {
      if (inFlight) return inFlight;
      if (!canNavigate() || !getState().session?.authenticated || getState().busy || !jobId || !waitAllowed()) return Promise.resolve(getState());
      const op = start(base({ mutation: intent ? mutation("loading") : idle(), parts: EMPTY, issues: EMPTY }));
      return remember(op, async () => {
        if (refreshSession) { const session = await bounded(op, signal => api.getSession({ signal })); if (!session.authenticated) throw new ApiError("Sign in again.", { status: 401 }); publish({ session: freeze({ authenticated: session.authenticated, csrfToken: session.csrfToken, user: { displayName: session.user.displayName, roles: session.user.roles } }) }); }
        if (intent) await reconcile(op); else await actions.read(op);
      }, failure => { if (intent) { if (!authFailure(failure)) { retryHint(failure); set({ mutation: mutation("uncertain", "Current export could not be checked. Try checking again.") }); } } else readFailure(failure); });
    },
    retryExportAction() { if (inFlight) return inFlight; if (!canNavigate() || !intent || !state().mutation.canRetry || getState().busy || !getState().session?.authenticated || !waitAllowed()) return Promise.resolve(getState()); return send(); },
    exportPage(kind, next) {
      if (!visible() || getState().busy || !jobId || !waitAllowed()) return Promise.resolve(getState()); const issues = kind === "issues", cursors = issues ? state().issueCursors : state().partCursors;
      const nextCursor = issues ? state().issuesNextCursor : state().partsNextCursor, stack = next ? [...cursors, nextCursor] : cursors.slice(0, -1); if ((next && !nextCursor) || !stack.length) return Promise.resolve(getState());
      const op = start(base({}));
      return run(op, async () => { const result = await bounded(op, signal => issues ? api.listExportIssues(jobId, { cursor: stack.at(-1), signal }) : api.listExportParts(jobId, { cursor: stack.at(-1), signal })); assertCurrent(op);
        set(issues ? { issues: result.items, issuesNextCursor: result.nextCursor, issueCursors: stack } : { parts: result.items, partsNextCursor: result.nextCursor, partCursors: stack }); }, readFailure);
    },
    downloadExportPart() {
      if (!visible() || getState().busy || !state().job?.preparedPart || !waitAllowed()) return Promise.resolve(getState());
      const part = state().job.preparedPart, op = start(base({ download: { phase: "loading", url: null, filename: part.filename, receivedBytes: 0, totalBytes: part.byteSize } }));
      return run(op, async () => {
        const blob = await bounded(op, signal => api.downloadExportPart(jobId, part, { signal, onProgress(receivedBytes, totalBytes) { if (isCurrent(op) && !signal.aborted) set({ download: { phase: "loading", url: null, filename: part.filename, receivedBytes, totalBytes } }); } }), 120_000);
        assertCurrent(op); actions.revokeDownload(); const url = createObjectURL(blob); if (!isCurrent(op)) { revokeObjectURL(url); return; } objectUrl = url;
        set({ download: { phase: "ready", url, filename: part.filename, receivedBytes: part.byteSize, totalBytes: part.byteSize }, notice: "Part bytes verified. Use Save verified ZIP part to ask your browser to save it." });
      }, failure => { if (authFailure(failure)) return; retryHint(failure); set({ download: initialExport().download, error: failure?.code === "EXPORT_INTEGRITY" ? "This part failed its size or checksum check. No download link was created. Check current progress before trying again." : "This part could not be loaded. Check current progress; it may have expired or been replaced." }); });
    },
    downloadStarted() { if (state().download.phase === "ready") set({ notice: "Download started. Check your browser’s downloads to confirm the file was saved." }); },
  }; return actions;
}
