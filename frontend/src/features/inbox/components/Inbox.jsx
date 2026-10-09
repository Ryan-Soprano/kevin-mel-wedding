import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { attachInboxPrivacyLifecycle } from "../api/inboxPrivacyLifecycle.js";
import { createInboxController } from "../api/inboxController.js";
import { memoryTime } from "../memoryDisplay.js";
import "../inbox.css";

const INITIAL = {
  phase: "checking", session: null, busy: true, error: null,
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null,
  photo: { phase: "idle", url: null, error: null },
  review: { phase: "idle", targetStatus: null, error: null, canRetry: false },
  notice: null, pageResetVersion: 0, logoutUnconfirmed: false,
};
const LABELS = { PENDING: "Pending", KEEP: "Kept", ARCHIVED: "Archived", DELETE: "Recently deleted" };
const REVIEW_LABELS = { PENDING: "Restore to inbox", KEEP: "Keep privately", ARCHIVED: "Archive", DELETE: "Delete" };

export default function Inbox({ createController = createInboxController } = {}) {
  const factory = useRef(createController);
  const controller = useRef(null);
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
      if (next.pageResetVersion !== pageVersion) {
        pageVersion = next.pageResetVersion;
        setPages([null]);
      }
      if (next.phase !== "detail" || !next.detail) setDeleteConfirmation(null);
      setSnapshot(next);
    });
    const detachLifecycle = attachInboxPrivacyLifecycle({ controller: current, flush: flushSync, onHide: () => {
      setUsername("");
      setPassword("");
      setDeleteConfirmation(null);
      setPages([null]);
    } });
    if (document.visibilityState === "hidden") current.suspend();
    else void current.loadSession();
    return () => {
      detachLifecycle();
      if (controller.current === current) controller.current = null;
      unsubscribe();
      current.dispose();
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId]);

  const reviewLocked = snapshot.review.phase !== "idle";
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
    && ["inbox", "detail"].includes(snapshot.phase);
  const title = snapshot.phase === "detail" ? "Your memory"
    : snapshot.phase === "login" ? "Sign in to your archive"
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
                          <h2>{memory.guestName ?? "Name not provided"}</h2>
                          <p>{memory.memoryType === "TEXT" ? "Written note" : "Photo"} · <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time></p>
                          <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p>
                          <button type="button" onClick={() => controller.current?.openMemory(memory.memoryId)} aria-label={`Open ${memory.memoryType === "TEXT" ? "note" : "photo"} from ${memory.guestName ?? "Name not provided"}`}>Open memory</button>
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

      {snapshot.phase === "detail" && authenticated && (
        <section className="inbox-detail" aria-label="Memory detail" aria-busy={snapshot.busy}>
          <button type="button" className="button-secondary" disabled={reviewLocked} onClick={() => controller.current?.backToInbox()}>Back to inbox</button>
          {snapshot.busy && !detail && <p role="status">Loading memory…</p>}
          {!snapshot.busy && !detail && snapshot.error && (
            <p>This memory could not be loaded. Return to the inbox and try opening it again.</p>
          )}
          {detail && (
            <>
              <h2>From {detail.guestName ?? "Name not provided"}</h2>
              <p><time dateTime={detail.createdAt}>{memoryTime(detail.createdAt)}</time> · Chicago</p>
              <p>Status: {LABELS[detail.reviewStatus]} · Couple only</p>
              {detail.reviewStatus === "DELETE" && (
                <p className="inbox-deletion-window">This individual memory is in Recently deleted. Restore it before <time dateTime={detail.deleteAfter}>{memoryTime(detail.deleteAfter)}</time> (Chicago), when its 30-day recovery window ends. Deleted photos cannot be opened or downloaded.</p>
              )}
              {detail.memoryType === "TEXT"
                ? <p className="inbox-note">{detail.textContent}</p>
                : (
                  <>
                    {detail.caption && <p className="inbox-note">{detail.caption}</p>}
                    <p className="inbox-filename">{detail.media.originalFilename}</p>
                    {detail.reviewStatus !== "DELETE" && snapshot.photo.phase === "loading" && <p role="status">Loading and checking the original photo…</p>}
                    {detail.reviewStatus !== "DELETE" && snapshot.photo.phase === "error" && (
                      <div className="inbox-actions">
                        <p className="form-error" role="alert">{snapshot.photo.error}</p>
                        <button type="button" disabled={reviewLocked} onClick={() => controller.current?.retryPhoto()}>Try loading the photo again</button>
                      </div>
                    )}
                    {detail.reviewStatus !== "DELETE" && !reviewLocked && snapshot.photo.phase === "ready" && snapshot.photo.url && (
                      <>
                        <img className="inbox-original" src={snapshot.photo.url} alt={detail.caption ?? `Photo shared by ${detail.guestName ?? "an unnamed guest"}`} />
                        <a className="inbox-download" href={snapshot.photo.url} download={detail.media.originalFilename}>Download original photo</a>
                      </>
                    )}
                  </>
                )}
              {snapshot.notice && <p ref={reviewFeedback} tabIndex={-1} className="inbox-review-notice" role="status">{snapshot.notice}</p>}
              <section className="inbox-review" aria-label="Private review actions">
                <p className="guest-help">These actions affect this individual memory. Keeping or archiving it does not publish it or change other photos from the same batch.</p>
                {["saving", "loading", "refreshing"].includes(snapshot.review.phase) && (
                  <p role="status">{snapshot.review.phase === "saving" ? `Saving: ${REVIEW_LABELS[snapshot.review.targetStatus]}…`
                    : snapshot.review.phase === "refreshing" ? "Refreshing your session and this memory…" : "Loading this memory’s current state…"}</p>
                )}
                {snapshot.review.error && <p ref={reviewFeedback} tabIndex={-1} className="form-error" role="alert">{snapshot.review.error}</p>}
                {reviewLocked && <p className="guest-help">Keep this page open while this change is pending or unconfirmed. Other review actions, navigation, photo loading and sign-out are paused.</p>}
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
                    <p id="inbox-delete-copy">Only this memory will move to Recently deleted. You can restore it to your inbox for 30 days after its first deletion. It will no longer be available after that recovery window, and deleted photos cannot be opened or downloaded.</p>
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
