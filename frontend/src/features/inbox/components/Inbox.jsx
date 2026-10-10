import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { attachInboxPrivacyLifecycle } from "../api/inboxPrivacyLifecycle.js";
import { createInboxController } from "../api/inboxController.js";
import { memoryTime } from "../memoryDisplay.js";
import { stopAudioPlayback } from "../audioPlayback.js";
import AddMemory from "./AddMemory.jsx";
import MemoryMetadataEditor from "./MemoryMetadataEditor.jsx";
import { audioCollectionEnabled } from "../../audio/audioConstraints.js";
import Albums from "../../albums/components/Albums.jsx";
import { initialAlbums } from "../../albums/api/albumActions.js";
import Timeline from "../../timeline/components/Timeline.jsx";
import { initialTimeline } from "../../timeline/api/timelineActions.js";
import "../inbox.css";

const INITIAL = {
  phase: "checking", session: null, busy: true, error: null,
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null,
  photo: { phase: "idle", url: null, error: null },
  review: { phase: "idle", targetStatus: null, error: null, canRetry: false },
  metadata: { phase: "idle", error: null, canRetry: false },
  notice: null, pageResetVersion: 0, logoutUnconfirmed: false,
  albums: initialAlbums(), albumReturnId: null,
  timeline: initialTimeline(), timelineReturnId: null,
};
const LABELS = { PENDING: "Pending", KEEP: "Kept", ARCHIVED: "Archived", DELETE: "Recently deleted" };
const REVIEW_LABELS = { PENDING: "Restore to inbox", KEEP: "Keep privately", ARCHIVED: "Archive", DELETE: "Delete" };
const MEMORY_LABELS = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
const MEMORY_SHORT_LABELS = { TEXT: "note", PHOTO: "photo", AUDIO: "voice memory" };

export default function Inbox({ createController = createInboxController, audioEnabled = audioCollectionEnabled(import.meta.env.VITE_AUDIO_ENABLED) } = {}) {
  const factory = useRef(createController);
  const controller = useRef(null);
  const intentionalDialog = useRef(false);
  const setDialogState = useCallback(value => { intentionalDialog.current = value; }, []);
  const creationApi = useCallback(() => controller.current?.getCreationApi(), []);
  const creationDone = useCallback(receipt => controller.current?.creationComplete(receipt), []);
  const backToInbox = useCallback(() => controller.current?.backToInbox(), []);
  const saveMetadata = useCallback(metadata => controller.current?.saveMetadata(metadata), []);
  const reloadMetadata = useCallback(refreshSession => controller.current?.reloadMetadata({ refreshSession }), []);
  const retryMetadata = useCallback(() => controller.current?.retryMetadata(), []);
  const albumActions = {
    inbox: useCallback(() => controller.current?.loadInbox("PENDING"), []),
    list: useCallback(() => controller.current?.loadAlbums(), []),
    open: useCallback(id => controller.current?.openAlbum(id), []),
    beginCreate: useCallback(() => controller.current?.beginAlbumCreation(), []),
    create: useCallback(name => controller.current?.createAlbum(name), []),
    rename: useCallback(name => controller.current?.renameAlbum(name), []),
    delete: useCallback(() => controller.current?.deleteAlbum(), []),
    add: useCallback(id => controller.current?.addAlbumMember(id), []),
    remove: useCallback(id => controller.current?.removeAlbumMember(id), []),
    move: useCallback((id, direction) => controller.current?.moveAlbumMember(id, direction), []),
    select: useCallback(status => controller.current?.showAlbumSelector(status), []),
    openMemory: useCallback(id => controller.current?.openAlbumMemory(id), []),
    page: useCallback(next => controller.current?.albumPage(next), []),
    reload: useCallback(refreshSession => controller.current?.reloadAlbumMutation({ refreshSession }), []),
    retry: useCallback(name => controller.current?.retryAlbumMutation(name), []),
  };
  const timelineActions = {
    inbox: useCallback(() => controller.current?.loadInbox("PENDING"), []),
    list: useCallback(filters => controller.current?.loadTimeline(filters), []),
    open: useCallback(id => controller.current?.openTimelineEvent(id), []),
    beginCreate: useCallback(() => controller.current?.beginTimelineCreation(), []),
    create: useCallback(fields => controller.current?.createTimelineEvent(fields), []),
    edit: useCallback(fields => controller.current?.updateTimelineEvent(fields), []),
    delete: useCallback(() => controller.current?.deleteTimelineEvent(), []),
    link: useCallback(id => controller.current?.linkTimelineMemory(id), []),
    unlink: useCallback(id => controller.current?.unlinkTimelineMemory(id), []),
    select: useCallback(status => controller.current?.showTimelineSelector(status), []),
    openMemory: useCallback(id => controller.current?.openTimelineMemory(id), []),
    page: useCallback(next => controller.current?.timelinePage(next), []),
    reload: useCallback(refreshSession => controller.current?.reloadTimelineMutation({ refreshSession }), []),
    retry: useCallback(fields => controller.current?.retryTimelineMutation(fields), []),
  };
  const audioPlayback = useRef(null);
  const clearPlayback = useCallback(() => stopAudioPlayback(audioPlayback.current), []);
  const heading = useRef(null);
  const deleteButton = useRef(null);
  const cancelDelete = useRef(null);
  const restoreDeleteFocus = useRef(false);
  const reviewFeedback = useRef(null);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pages, setPages] = useState([null]);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  useEffect(() => {
    const current = factory.current();
    controller.current = current;
    let pageVersion = current.getSnapshot().pageResetVersion;
    const unsubscribe = current.subscribe(next => {
      if (controller.current !== current) return;
      if (audioPlayback.current && (next.photo.phase !== "ready" || next.photo.url !== audioPlayback.current.getAttribute("src"))) {
        clearPlayback();
      }
      if (next.pageResetVersion !== pageVersion) {
        pageVersion = next.pageResetVersion;
        setPages([null]);
      }
      if (next.phase !== "detail" || !next.detail) setDeleteConfirmation(null);
      setSnapshot(next);
    });
    const detachLifecycle = attachInboxPrivacyLifecycle({ controller: current, flush: flushSync,
      isIntentionalDialog: () => intentionalDialog.current, onDialogEnd: () => { intentionalDialog.current = false; }, onHide: () => {
      intentionalDialog.current = false;
      clearPlayback();
      setUsername("");
      setPassword("");
      setDeleteConfirmation(null);
      setPages([null]);
    } });
    if (document.visibilityState === "hidden") current.suspend();
    else void current.loadSession();
    return () => {
      clearPlayback();
      detachLifecycle();
      if (controller.current === current) controller.current = null;
      unsubscribe();
      current.dispose();
    };
  }, [clearPlayback]);

  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId, snapshot.albums?.view, snapshot.albums?.album?.albumId, snapshot.timeline?.view, snapshot.timeline?.event?.eventId]);

  const reviewLocked = snapshot.review.phase !== "idle" || snapshot.metadata.phase !== "idle" || snapshot.albums.mutation.phase !== "idle" || snapshot.timeline.mutation.phase !== "idle";
  const detail = snapshot.detail;
  const confirmingDelete = !reviewLocked && deleteConfirmation !== null
    && detail?.memoryId === deleteConfirmation.memoryId && detail?.revision === deleteConfirmation.revision;

  useEffect(() => {
    if (confirmingDelete) cancelDelete.current?.focus();
    else if (restoreDeleteFocus.current && !reviewLocked) {
      restoreDeleteFocus.current = false;
      deleteButton.current?.focus();
    }
  }, [confirmingDelete, reviewLocked]);

  useEffect(() => {
    if (snapshot.review.error || snapshot.notice) reviewFeedback.current?.focus();
  }, [snapshot.review.error, snapshot.notice]);

  useEffect(() => {
    if (!reviewLocked) return;
    const preventLeaving = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeaving);
    return () => window.removeEventListener("beforeunload", preventLeaving);
  }, [reviewLocked]);

  function login(event) {
    event.preventDefault();
    if (snapshot.busy) return;
    const credentials = { username, password };
    setPassword("");
    setPages([null]);
    void controller.current?.login(credentials);
  }

  function logout() {
    if (reviewLocked) return;
    setPassword("");
    setUsername("");
    setPages([null]);
    void controller.current?.logout();
  }

  function filter(status) {
    if (reviewLocked) return;
    setPages([null]);
    void controller.current?.loadInbox(status);
  }

  function nextPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || !snapshot.nextCursor) return;
    setPages(current => [...current, snapshot.nextCursor]);
    void controller.current?.loadInbox(snapshot.reviewStatus, snapshot.nextCursor);
  }

  function previousPage() {
    if (snapshot.busy || reviewLocked || snapshot.error || pages.length < 2) return;
    const previous = pages.slice(0, -1);
    setPages(previous);
    void controller.current?.loadInbox(snapshot.reviewStatus, previous.at(-1));
  }

  function changeReview(status) {
    if (snapshot.busy || reviewLocked) return;
    setDeleteConfirmation(null);
    void controller.current?.reviewMemory(status);
  }

  function cancelConfirmation() {
    restoreDeleteFocus.current = true;
    setDeleteConfirmation(null);
  }

  const authenticated = snapshot.session?.authenticated
    && ["inbox", "detail", "create", "albums", "timeline"].includes(snapshot.phase);
  const title = snapshot.phase === "timeline" ? "Your life timeline" : snapshot.phase === "albums" ? "Your albums" : snapshot.phase === "detail" ? "Your memory"
    : snapshot.phase === "create" ? "Add a memory" : snapshot.phase === "login" ? "Sign in to your archive"
      : snapshot.phase === "unavailable" ? "Archive access unavailable" : "Memory inbox";

  return (
    <main className="private-inbox">
      <header className="inbox-header">
        <p className="guest-couple">Kevin &amp; Melanie</p>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {authenticated && (
          <div className="inbox-account">
            <p>Signed in as {snapshot.session.user.displayName}</p>
            <button type="button" className="button-secondary" disabled={reviewLocked} onClick={logout}>Sign out</button>
          </div>
        )}
      </header>

      {snapshot.error && <p className="form-error" role="alert">{snapshot.error}</p>}

      {snapshot.phase === "checking" && <p role="status">Checking archive access…</p>}

      {snapshot.phase === "login" && (
        <>
          <p>This archive is private for Kevin and Melanie. Use the account supplied when your archive is ready.</p>
          <form onSubmit={login} aria-label="Sign in to the private archive">
            <div>
              <label htmlFor="archive-username">Username</label>
              <input id="archive-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
                onChange={event => setUsername(event.target.value)} disabled={snapshot.busy} required />
            </div>
            <div>
              <label htmlFor="archive-password">Password</label>
              <input id="archive-password" type="password" autoComplete="current-password" value={password}
                onChange={event => setPassword(event.target.value)} disabled={snapshot.busy} required />
            </div>
            <button type="submit" disabled={snapshot.busy}>{snapshot.busy ? "Signing in…" : "Sign in"}</button>
            <p role="status" className="visually-hidden">{snapshot.busy ? "Signing in to your private archive…" : ""}</p>
          </form>
        </>
      )}

      {snapshot.phase === "unavailable" && (
        <section className="inbox-actions" aria-label="Recover archive access">
          <p>{snapshot.logoutUnconfirmed
            ? "Private content has been cleared from this page. Please retry signing out to confirm that your server session has ended."
            : "The archive may not be ready yet, or access could not be checked. Please try again."}</p>
          <button type="button" disabled={snapshot.busy} onClick={() => {
            if (snapshot.logoutUnconfirmed) logout();
            else { setPages([null]); void controller.current?.loadSession(); }
          }}>
            {snapshot.logoutUnconfirmed ? "Retry signing out" : "Check access again"}
          </button>
          {!snapshot.logoutUnconfirmed && <button type="button" className="button-secondary" disabled={snapshot.busy} onClick={logout}>Sign out of any active session</button>}
        </section>
      )}

      {snapshot.phase === "inbox" && authenticated && (
        <section aria-label="Private memories" aria-busy={snapshot.busy}>
          <button type="button" disabled={snapshot.busy} onClick={() => controller.current?.beginCreation()}>Add a memory</button>
          <button type="button" className="button-secondary" disabled={snapshot.busy} onClick={albumActions.list}>Albums</button>
          <button type="button" className="button-secondary" disabled={snapshot.busy} onClick={() => timelineActions.list()}>Timeline</button>
          <nav className="inbox-filters" aria-label="Review status">
            {Object.entries(LABELS).map(([status, label]) => (
              <button key={status} type="button" className="button-secondary" aria-pressed={snapshot.reviewStatus === status}
                disabled={snapshot.busy} onClick={() => filter(status)}>{label}</button>
            ))}
          </nav>
          {snapshot.busy ? <p role="status">Loading your memories…</p>
            : snapshot.error ? <button type="button" onClick={() => controller.current?.loadInbox(snapshot.reviewStatus, pages.at(-1))}>Try again</button>
              : snapshot.items.length === 0 ? <p role="status">No {LABELS[snapshot.reviewStatus].toLowerCase()} memories right now.</p>
                : (
                  <>
                    <p>{snapshot.items.length} {snapshot.items.length === 1 ? "memory" : "memories"} on this page · times shown in Chicago</p>
                    <ul className="inbox-list">
                      {snapshot.items.map(memory => (
                        <li key={memory.memoryId} className="inbox-card">
                          <h2>{memory.title ?? (memory.source === "COUPLE" ? "Couple memory" : memory.guestName ?? "Name not provided")}</h2>
                          <p>{memory.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${memory.guestName ?? "Name not provided"}`}{memory.memoryDate ? ` · Memory date: ${memory.memoryDate}` : ""}</p>
                          <p>{MEMORY_LABELS[memory.memoryType]} · <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time></p>
                          <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p>
                          <button type="button" onClick={() => controller.current?.openMemory(memory.memoryId)} aria-label={`Open ${memory.title ?? (memory.source === "COUPLE" ? `couple ${MEMORY_SHORT_LABELS[memory.memoryType]}` : `${MEMORY_SHORT_LABELS[memory.memoryType]} from ${memory.guestName ?? "Name not provided"}`)}`}>Open memory</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
          <div className="inbox-pagination">
            <button type="button" className="button-secondary" disabled={snapshot.busy || Boolean(snapshot.error) || pages.length < 2} onClick={previousPage}>Previous page</button>
            <span>{snapshot.error ? `Page ${pages.length} could not be loaded` : `Page ${pages.length}`}</span>
            <button type="button" className="button-secondary" disabled={snapshot.busy || Boolean(snapshot.error) || !snapshot.nextCursor} onClick={nextPage}>Next page</button>
          </div>
        </section>
      )}

      {snapshot.phase === "create" && authenticated && <AddMemory getApi={creationApi} onDone={creationDone} onBack={backToInbox} onDialogStateChange={setDialogState} audioEnabled={audioEnabled} />}
      {snapshot.phase === "albums" && authenticated && <Albums key={`${snapshot.albums.view}:${snapshot.albums.album?.albumId ?? "new"}:${snapshot.albums.album?.revision ?? "new"}`}
        state={snapshot.albums} busy={snapshot.busy} locked={reviewLocked} actions={albumActions} />}
      {snapshot.phase === "timeline" && authenticated && <Timeline key={`${snapshot.timeline.view}:${snapshot.timeline.event?.eventId ?? "new"}:${snapshot.timeline.event?.revision ?? "new"}:${JSON.stringify(snapshot.timeline.filters)}`}
        state={snapshot.timeline} busy={snapshot.busy} locked={reviewLocked} actions={timelineActions} />}

      {snapshot.phase === "detail" && authenticated && (
        <section className="inbox-detail" aria-label="Memory detail" aria-busy={snapshot.busy}>
          <button type="button" className="button-secondary" disabled={reviewLocked} onClick={() => controller.current?.backToInbox()}>{snapshot.timelineReturnId ? "Back to timeline event" : snapshot.albumReturnId ? "Back to album" : "Back to inbox"}</button>
          {snapshot.busy && !detail && <p role="status">Loading memory…</p>}
          {!snapshot.busy && !detail && snapshot.error && (
            <p>This memory could not be loaded. Return to the inbox and try opening it again.</p>
          )}
          {detail && (
            <>
              <h2>{detail.title ?? (detail.source === "COUPLE" ? "Couple memory" : `From ${detail.guestName ?? "Name not provided"}`)}</h2>
              <p>{detail.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${detail.guestName ?? "Name not provided"}`}</p>
              {detail.description && <p className="inbox-note">{detail.description}</p>}
              {detail.memoryDate && <p>Memory date: {detail.memoryDate} ({detail.datePrecision.toLowerCase()} precision)</p>}
              <p>Saved on: <time dateTime={detail.createdAt}>{memoryTime(detail.createdAt)}</time> · Chicago</p>
              <p>Status: {LABELS[detail.reviewStatus]} · Couple only</p>
              {detail.reviewStatus === "DELETE" && (
                <p className="inbox-deletion-window">This individual memory is in Recently deleted. Restore it before <time dateTime={detail.deleteAfter}>{memoryTime(detail.deleteAfter)}</time> (Chicago), when its 30-day recovery window ends. Deleted photos and audio cannot be opened or downloaded.</p>
              )}
              {detail.memoryType === "TEXT"
                ? <p className="inbox-note">{detail.textContent}</p>
                : (
                  <>
                    {detail.caption && <p className="inbox-note">{detail.caption}</p>}
                    <p className="inbox-filename">{detail.media.originalFilename}</p>
                    {detail.memoryType === "AUDIO" && <p>{Math.ceil(detail.media.durationSeconds)} seconds · Original audio</p>}
                    {detail.reviewStatus !== "DELETE" && snapshot.photo.phase === "loading" && <p role="status">Loading and checking the original {detail.memoryType === "AUDIO" ? "audio" : "photo"}…</p>}
                    {detail.reviewStatus !== "DELETE" && snapshot.photo.phase === "error" && (
                      <div className="inbox-actions">
                        <p className="form-error" role="alert">{snapshot.photo.error}</p>
                        <button type="button" disabled={reviewLocked} onClick={() => controller.current?.retryMedia()}>Try loading the {detail.memoryType === "AUDIO" ? "audio" : "photo"} again</button>
                      </div>
                    )}
                    {detail.reviewStatus !== "DELETE" && !reviewLocked && snapshot.photo.phase === "ready" && snapshot.photo.url && (
                      <>
                        {detail.memoryType === "AUDIO"
                          ? <audio ref={audioPlayback} className="inbox-audio" controls preload="metadata" src={snapshot.photo.url} aria-label={detail.title ?? (detail.source === "COUPLE" ? "Couple voice memory" : `Voice memory from ${detail.guestName ?? "an unnamed guest"}`)} />
                          : <img className="inbox-original" src={snapshot.photo.url} alt={detail.caption ?? detail.title ?? (detail.source === "COUPLE" ? "Couple photo" : `Photo shared by ${detail.guestName ?? "an unnamed guest"}`)} />}
                        <a className="inbox-download" href={snapshot.photo.url} download={detail.media.originalFilename}>Download original {detail.memoryType === "AUDIO" ? "audio" : "photo"}</a>
                        {detail.memoryType === "AUDIO" && <p className="guest-help">If this browser cannot play the clip, download the original audio to listen in a supported player.</p>}
                      </>
                    )}
                  </>
                )}
              {snapshot.notice && <p ref={reviewFeedback} tabIndex={-1} className="inbox-review-notice" role="status">{snapshot.notice}</p>}
              {detail.reviewStatus !== "DELETE" && <MemoryMetadataEditor key={`${detail.memoryId}:${detail.revision}`} memory={detail}
                state={snapshot.metadata} busy={snapshot.busy} locked={reviewLocked} onSave={saveMetadata} onReload={reloadMetadata} onRetry={retryMetadata} />}
              <section className="inbox-review" aria-label="Private review actions">
                <p className="guest-help">These actions affect this individual memory. Keeping or archiving it does not publish it or change other memories.</p>
                {["saving", "loading", "refreshing"].includes(snapshot.review.phase) && (
                  <p role="status">{snapshot.review.phase === "saving" ? `Saving: ${REVIEW_LABELS[snapshot.review.targetStatus]}…`
                    : snapshot.review.phase === "refreshing" ? "Refreshing your session and this memory…" : "Loading this memory’s current state…"}</p>
                )}
                {snapshot.review.error && <p ref={reviewFeedback} tabIndex={-1} className="form-error" role="alert">{snapshot.review.error}</p>}
                {reviewLocked && <p className="guest-help">Keep this page open while this change is pending or unconfirmed. Other review actions, navigation, media loading and sign-out are paused.</p>}
                {["uncertain", "conflict"].includes(snapshot.review.phase) && (
                  <div className="inbox-actions">
                    <button type="button" disabled={snapshot.busy} onClick={() => controller.current?.reloadReview()}>Reload current state</button>
                    {snapshot.review.canRetry && <button type="button" className="button-secondary" disabled={snapshot.busy} onClick={() => controller.current?.retryReview()}>Retry this same change</button>}
                  </div>
                )}
                {snapshot.review.phase === "csrf" && <button type="button" disabled={snapshot.busy} onClick={() => controller.current?.refreshReviewSession()}>Refresh session and current memory</button>}
                {!reviewLocked && !confirmingDelete && (
                  <div className="inbox-actions">
                    {detail.reviewStatus !== "KEEP" && detail.reviewStatus !== "DELETE" && <button type="button" disabled={snapshot.busy} onClick={() => changeReview("KEEP")}>Keep privately</button>}
                    {detail.reviewStatus !== "ARCHIVED" && detail.reviewStatus !== "DELETE" && <button type="button" className="button-secondary" disabled={snapshot.busy} onClick={() => changeReview("ARCHIVED")}>Archive</button>}
                    {["ARCHIVED", "DELETE"].includes(detail.reviewStatus) && <button type="button" disabled={snapshot.busy} onClick={() => changeReview("PENDING")}>Restore to inbox</button>}
                    {detail.reviewStatus !== "DELETE" && <button ref={deleteButton} type="button" className="button-secondary" disabled={snapshot.busy} onClick={() => setDeleteConfirmation({ memoryId: detail.memoryId, revision: detail.revision })}>Delete…</button>}
                  </div>
                )}
                {confirmingDelete && (
                  <div className="inbox-delete-confirmation" role="group" aria-labelledby="inbox-delete-title" aria-describedby="inbox-delete-copy">
                    <h3 id="inbox-delete-title">Delete this memory?</h3>
                    <p id="inbox-delete-copy">Only this memory will move to Recently deleted and be removed from every album and timeline event. You can restore it to your inbox for 30 days after its first deletion, then add it to albums or link it to events again yourself. It will no longer be available after that recovery window, and deleted photos and audio cannot be opened or downloaded.</p>
                    <div className="inbox-actions">
                      <button ref={cancelDelete} type="button" className="button-secondary" disabled={snapshot.busy} onClick={cancelConfirmation}>Cancel</button>
                      <button type="button" disabled={snapshot.busy} onClick={() => changeReview("DELETE")}>Confirm delete</button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      )}
    </main>
  );
}
