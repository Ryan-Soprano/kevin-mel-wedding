import { useEffect, useRef, useState } from "react";
import { normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";
import "../library.css";

export function TagRecovery({ state, busy, actions }) {
  const [name, setName] = useState(""), [error, setError] = useState(null);
  const feedback = useRef(null); useEffect(() => { if (error) feedback.current?.focus(); }, [error]);
  function retry() { try { setError(null); void actions.retry(state.mutation.needsName ? normalizeTagName(name) : undefined); } catch (failure) { setError(failure.message); } }
  return <div className="tag-recovery"><p>Keep this page open while the tag change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
    {error && <p ref={feedback} tabIndex={-1} className="form-error" role="alert">{error}</p>}
    {["saving", "loading"].includes(state.mutation.phase) && <p role="status">Checking the tag change…</p>}
    {["uncertain", "conflict", "csrf"].includes(state.mutation.phase) && <><button type="button" disabled={busy} onClick={() => actions.reload(state.mutation.phase === "csrf")}>{state.mutation.phase === "csrf" ? "Refresh session and current tag" : "Reload current tag"}</button>
      {state.mutation.canRetry && <>{state.mutation.needsName && <><label htmlFor="tag-retry-name">Original tag name</label><input id="tag-retry-name" maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /><p className="guest-help">The hidden name was cleared. Re-enter the same original name.</p></>}
        <button className="button-secondary" type="button" disabled={busy} onClick={retry}>Retry this same tag change</button></>}</>}
  </div>;
}
export default function MemoryTags({ state, busy, locked, actions }) {
  const [q, setQ] = useState(state.q), [error, setError] = useState(null); const feedback = useRef(null);
  const disabled = busy || locked, choosing = state.view === "attach";
  useEffect(() => { if (error || state.error || state.mutation.error || state.notice) feedback.current?.focus(); }, [error, state.error, state.mutation.error, state.notice]);
  function search(event) { event.preventDefault(); try { setError(null); void actions.choose(normalizeLibraryQuery(q)); } catch (failure) { setError(failure.message); } }
  return <section className="memory-tags" aria-label="Tags attached to this memory" aria-busy={busy}><h3>Memory tags</h3>
    <p>Private labels organize this memory without changing its original content, files, memory date or saved time.</p>
    {(error || state.error || state.mutation.error || state.notice) && <p ref={feedback} tabIndex={-1} className={error || state.error || state.mutation.error ? "form-error" : "inbox-review-notice"}
      role={error || state.error || state.mutation.error ? "alert" : "status"}>{error ?? state.error ?? state.mutation.error ?? state.notice}</p>}
    {state.mutation.phase !== "idle" && <TagRecovery state={state} busy={busy} actions={actions} />}
    {choosing ? <><h4>Add an existing tag</h4><button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.attached()}>Back to attached tags</button>
      <form className="memory-tag-search" onSubmit={search}><label htmlFor="memory-tag-query">Search available tags</label><input id="memory-tag-query" type="search" maxLength={200} value={q} disabled={disabled} onChange={event => setQ(event.target.value)} /><button type="submit" disabled={disabled}>Search available tags</button></form></>
      : <button type="button" disabled={disabled} onClick={() => actions.choose()}>Add tags</button>}
    {busy ? <p role="status">Loading memory tags…</p> : !state.error && !state.items.length ? <p role="status">{choosing ? "No matching tags. Create tags from Manage tags in your Library." : "No attached tags on this page."}</p>
      : <ul className="inbox-list memory-tag-list">{state.items.map(tag => <li key={tag.tagId} className="inbox-card"><h4>{tag.name}</h4><p>{tag.memberCount} tagged memories</p>
        <button className={choosing ? undefined : "button-secondary"} type="button" disabled={disabled} onClick={() => actions.change(tag.tagId, !choosing)}>{choosing ? "Attach tag" : "Remove tag"}</button></li>)}</ul>}
    {state.error && <button type="button" disabled={disabled} onClick={() => choosing ? actions.choose(state.q) : actions.attached()}>Reload tags first page</button>}
    <div className="inbox-pagination memory-tag-pagination"><button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || state.cursors.length < 2} onClick={() => actions.page(false)}>Previous memory tags page</button>
      <span>Page {state.cursors.length}</span><button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || !state.nextCursor} onClick={() => actions.page(true)}>Next memory tags page</button></div>
  </section>;
}
