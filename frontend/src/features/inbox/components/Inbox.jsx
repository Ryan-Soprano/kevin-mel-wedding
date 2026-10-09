import { useEffect, useRef, useState } from "react";
import { createInboxController } from "../api/inboxController.js";
import { memoryTime } from "../memoryDisplay.js";
import "../inbox.css";

const INITIAL = {
  phase: "checking", session: null, busy: true, error: null,
  reviewStatus: "PENDING", items: [], nextCursor: null, detail: null,
  photo: { phase: "idle", url: null, error: null }, logoutUnconfirmed: false,
};
const LABELS = { PENDING: "Pending", KEEP: "Kept", ARCHIVED: "Archived" };

export default function Inbox({ createController = createInboxController } = {}) {
  const factory = useRef(createController);
  const controller = useRef(null);
  const heading = useRef(null);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pages, setPages] = useState([null]);

  useEffect(() => {
    const current = factory.current();
    controller.current = current;
    const unsubscribe = current.subscribe(next => {
      if (controller.current === current) setSnapshot(next);
    });
    void current.loadSession();
    return () => {
      if (controller.current === current) controller.current = null;
      unsubscribe();
      current.dispose();
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.phase, snapshot.detail?.memoryId]);

  function login(event) {
    event.preventDefault();
    if (snapshot.busy) return;
    const credentials = { username, password };
    setPassword("");
    setPages([null]);
    void controller.current?.login(credentials);
  }

  function logout() {
    setPassword("");
    setUsername("");
    setPages([null]);
    void controller.current?.logout();
  }

  function filter(status) {
    setPages([null]);
    void controller.current?.loadInbox(status);
  }

  function nextPage() {
    if (snapshot.busy || snapshot.error || !snapshot.nextCursor) return;
    setPages(current => [...current, snapshot.nextCursor]);
    void controller.current?.loadInbox(snapshot.reviewStatus, snapshot.nextCursor);
  }

  function previousPage() {
    if (snapshot.busy || snapshot.error || pages.length < 2) return;
    const previous = pages.slice(0, -1);
    setPages(previous);
    void controller.current?.loadInbox(snapshot.reviewStatus, previous.at(-1));
  }

  const detail = snapshot.detail;
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
            <button type="button" className="button-secondary" onClick={logout}>Sign out</button>
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
          <button type="button" className="button-secondary" onClick={() => controller.current?.backToInbox()}>Back to inbox</button>
          {snapshot.busy && !detail && <p role="status">Loading memory…</p>}
          {!snapshot.busy && !detail && snapshot.error && (
            <p>This memory could not be loaded. Return to the inbox and try opening it again.</p>
          )}
          {detail && (
            <>
              <h2>From {detail.guestName ?? "Name not provided"}</h2>
              <p><time dateTime={detail.createdAt}>{memoryTime(detail.createdAt)}</time> · Chicago</p>
              <p>Status: {LABELS[detail.reviewStatus]} · Couple only</p>
              {detail.memoryType === "TEXT"
                ? <p className="inbox-note">{detail.textContent}</p>
                : (
                  <>
                    {detail.caption && <p className="inbox-note">{detail.caption}</p>}
                    <p className="inbox-filename">{detail.media.originalFilename}</p>
                    {snapshot.photo.phase === "loading" && <p role="status">Loading and checking the original photo…</p>}
                    {snapshot.photo.phase === "error" && (
                      <div className="inbox-actions">
                        <p className="form-error" role="alert">{snapshot.photo.error}</p>
                        <button type="button" onClick={() => controller.current?.retryPhoto()}>Try loading the photo again</button>
                      </div>
                    )}
                    {snapshot.photo.phase === "ready" && snapshot.photo.url && (
                      <>
                        <img className="inbox-original" src={snapshot.photo.url} alt={detail.caption ?? `Photo shared by ${detail.guestName ?? "an unnamed guest"}`} />
                        <a className="inbox-download" href={snapshot.photo.url} download={detail.media.originalFilename}>Download original photo</a>
                      </>
                    )}
                  </>
                )}
              <p className="guest-help">This memory stays private. Review actions are not available in this read-only inbox yet.</p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
