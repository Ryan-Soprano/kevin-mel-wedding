import { useEffect, useRef, useState } from "react";
import { normalizeLibraryQuery, normalizeTagName } from "../libraryFilters.js";
import { memoryTime } from "../../inbox/memoryDisplay.js";
import "../library.css";

const LABELS = { KEEP: "Kept", PENDING: "Pending", ARCHIVED: "Archived" };
const TYPES = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
const heading = memory => memory.title ?? (memory.source === "COUPLE" ? "Couple memory" : `From ${memory.guestName ?? "Name not provided"}`);

function MemorySummary({ memory }) {
  return <>
    <h3>{heading(memory)}</h3>
    <p>{TYPES[memory.memoryType]} · {LABELS[memory.reviewStatus]} · {memory.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${memory.guestName ?? "Name not provided"}`}</p>
    {memory.memoryDate && <p>Memory date: {memory.memoryDate}</p>}
    <p>Saved on: {memoryTime(memory.createdAt)} · Eastern</p>
    <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p>
  </>;
}

export default function Tags({ state, busy, locked, actions }) {
  const [name, setName] = useState(state.tag?.name ?? "");
  const [q, setQ] = useState(state.q);
  const [originalName, setOriginalName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  const deleteTrigger = useRef(null), restoreDeleteFocus = useRef(false);
  useEffect(() => { if (error || state.mutation.error || state.notice || state.error) feedback.current?.focus(); },
    [error, state.mutation.error, state.notice, state.error]);
  const disabled = busy || locked;
  useEffect(() => { if (confirmDelete) cancelDelete.current?.focus(); else if (restoreDeleteFocus.current && !disabled) { restoreDeleteFocus.current = false; deleteTrigger.current?.focus(); } }, [confirmDelete, disabled]);
  function submitName(event) {
    event.preventDefault();
    try {
      const normalized = normalizeTagName(name); setError(null);
      void (state.view === "create" ? actions.create(normalized) : actions.rename(normalized));
    } catch (failure) { setError(failure.message); }
  }
  function retry() {
    try { setError(null); void actions.retry(state.mutation.needsName ? normalizeTagName(originalName) : undefined); }
    catch (failure) { setError(failure.message); }
  }
  return <section className="tags" aria-label="Private tags" aria-busy={busy}>
    <p>Tags organize your private memories. One memory can belong to several tags. Nothing here is published.</p>
    <div className="inbox-actions">
      <button className="button-secondary" type="button" disabled={disabled} onClick={actions.inbox}>Back to inbox</button>
      {state.view !== "list" && <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.list("")}>All tags</button>}
    </div>
    {(error || state.error || state.mutation.error || state.notice) && <p ref={feedback} tabIndex={-1}
      className={error || state.error || state.mutation.error ? "form-error" : "inbox-review-notice"}
      role={error || state.error || state.mutation.error ? "alert" : "status"}>{error ?? state.error ?? state.mutation.error ?? state.notice}</p>}
    {locked && <div className="tag-recovery">
      <p>Keep this page open while the change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
      {["saving", "loading"].includes(state.mutation.phase) && <p role="status">{state.mutation.phase === "saving" ? "Saving tag change…" : "Checking the current tag…"}</p>}
      {["uncertain", "conflict", "csrf"].includes(state.mutation.phase) && <>
        <button type="button" disabled={busy} onClick={() => actions.reload(state.mutation.phase === "csrf")}>{state.mutation.phase === "csrf" ? "Refresh session and current tag" : "Reload current tag"}</button>
        {state.mutation.canRetry && <>
          {state.mutation.needsName && <div><label htmlFor="tag-original-name">Original tag name</label>
            <input id="tag-original-name" value={originalName} maxLength={200} onChange={event => setOriginalName(event.target.value)} disabled={busy} />
            <p className="guest-help">The hidden name draft was cleared. Re-enter the same name to retry the original change.</p></div>}
          <button className="button-secondary" type="button" disabled={busy} onClick={retry}>Retry this same tag change</button>
        </>}
      </>}
    </div>}
    {state.view === "list" && <>
      <button type="button" disabled={disabled} onClick={actions.beginCreate}>Create a tag</button>
      <form className="tag-search" onSubmit={event => { event.preventDefault(); try { setError(null); void actions.list(normalizeLibraryQuery(q)); } catch (failure) { setError(failure.message); } }}>
        <label htmlFor="tag-query">Search tag names</label><input id="tag-query" type="search" value={q} maxLength={200} disabled={disabled} onChange={event => setQ(event.target.value)} /><button type="submit" disabled={disabled}>Search tags</button>
      </form><p className="guest-help">Tag names may repeat. Each entry is a separate tag. Newest tags appear first.</p>
      {busy ? <p role="status">Loading tags…</p> : !state.error && state.items.length === 0 ? <p role="status">No tags yet. Create one for your wedding, a trip or an anniversary.</p>
        : <ul className="inbox-list tag-list">{state.items.map(tag => <li key={tag.tagId} className="inbox-card">
          <h2>{tag.name}</h2><p>{tag.memberCount} {tag.memberCount === 1 ? "memory" : "memories"} · Couple only</p>
          <button type="button" disabled={disabled} onClick={() => actions.open(tag.tagId)} aria-label={`Open tag ${tag.name}`}>Open tag</button>
        </li>)}</ul>}
    </>}
    {state.view === "create" && <form className="tag-name-form" onSubmit={submitName} aria-label="Create a private tag">
      <h2>Create a tag</h2><label htmlFor="tag-name">Tag name</label>
      <input id="tag-name" value={name} maxLength={200} onChange={event => setName(event.target.value)} required disabled={disabled} />
      <button type="submit" disabled={disabled}>Create tag</button>
    </form>}
    {state.view === "detail" && state.tag && (state.tag.deletedAt !== null
      ? <div className="tag-tombstone"><h2>Deleted tag</h2><p>This tag was deleted. Its memories and original files remain in your archive. Deleting a tag does not move memories to Recently deleted.</p></div>
      : <>
        <h2 className="tag-title">{state.tag.name}</h2><p>{state.tag.memberCount} {state.tag.memberCount === 1 ? "memory" : "memories"} · Couple only</p>
        <form className="tag-name-form" onSubmit={submitName} aria-label="Rename this tag">
          <label htmlFor="tag-name">Tag name</label><input id="tag-name" value={name} maxLength={200} onChange={event => setName(event.target.value)} required disabled={disabled} />
          <button type="submit" disabled={disabled}>Save tag name</button>
        </form>
        <div className="inbox-actions"><button type="button" disabled={disabled} onClick={() => actions.select("KEEP")}>Add memories</button>
          <button ref={deleteTrigger} className="button-secondary" type="button" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete tag…</button></div>
        {confirmDelete && !locked && <div className="inbox-delete-confirmation" role="group" aria-labelledby="tag-delete-title">
          <h3 id="tag-delete-title">Delete this tag?</h3><p>Only this tag and its membership will be removed. Every memory and original file stays in your archive.</p>
          <div className="inbox-actions"><button ref={cancelDelete} className="button-secondary" type="button" disabled={busy} onClick={() => { restoreDeleteFocus.current = true; setConfirmDelete(false); }}>Cancel tag deletion</button>
            <button type="button" disabled={busy} onClick={() => { setConfirmDelete(false); void actions.delete(); }}>Confirm delete tag</button></div>
        </div>}
        {busy && !state.members.length ? <p role="status">Loading tag memories…</p> : !state.error && !locked && !state.members.length ? <p role="status">This tag is empty. Add memories from your private archive.</p>
          : <ol className="inbox-list tag-members">{state.members.map(item => <li key={item.memory.memoryId} className="inbox-card tag-member">
            <MemorySummary memory={item.memory} /><div className="inbox-actions">
              <button type="button" disabled={disabled} onClick={() => actions.openMemory(item.memory.memoryId)} aria-label={`Open memory ${heading(item.memory)}`}>Open memory</button>
              <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.remove(item.memory.memoryId)} aria-label={`Remove ${heading(item.memory)} from tag`}>Remove from tag</button>
            </div>
          </li>)}</ol>}
        <p className="guest-help">Removing a memory here preserves it in your archive. Deleting a memory from its detail removes it from every tag; restoring it to the inbox does not add it back.</p>
      </>)}
    {state.view === "select" && state.tag && <>
      <h2>Add memories to {state.tag.name}</h2>
      <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.open(state.tag.tagId)}>Back to tag</button>
      <nav className="inbox-filters" aria-label="Available memory review status">{Object.entries(LABELS).map(([status, label]) => <button key={status} className="button-secondary" type="button"
        disabled={disabled} aria-pressed={state.selectorStatus === status} onClick={() => actions.select(status)}>{label}</button>)}</nav>
      {busy ? <p role="status">Loading available memories…</p> : !state.error && !state.candidates.length ? <p role="status">No completed {LABELS[state.selectorStatus].toLowerCase()} memories on this page.</p>
        : <ul className="inbox-list tag-candidates">{state.candidates.map(memory => <li key={memory.memoryId} className="inbox-card">
          <MemorySummary memory={memory} /><button type="button" disabled={disabled} onClick={() => actions.add(memory.memoryId)} aria-label={`Add ${heading(memory)} to tag`}>Add to tag</button>
        </li>)}</ul>}
      <p className="guest-help">Completed notes, photos and voice memories can belong to several tags. Adding an existing member keeps one copy in this tag.</p>
    </>}
    {state.error && <button type="button" disabled={disabled} onClick={() => state.view === "list" ? actions.list()
      : state.requestedId ? actions.open(state.requestedId) : actions.list()}>Reload tag first page</button>}
    {["list", "detail", "select"].includes(state.view) && !state.tag?.deletedAt && <div className="inbox-pagination tag-pagination">
      <button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || state.cursors.length < 2} onClick={() => actions.page(false)}>Previous tag page</button>
      <span>Page {state.cursors.length}</span><button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || !state.nextCursor} onClick={() => actions.page(true)}>Next tag page</button>
    </div>}
  </section>;
}
