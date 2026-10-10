import { useEffect, useRef, useState } from "react";
import { normalizeAlbumName } from "../albumName.js";
import "../albums.css";

const LABELS = { KEEP: "Kept", PENDING: "Pending", ARCHIVED: "Archived" };
const TYPES = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
const heading = memory => memory.title ?? (memory.source === "COUPLE" ? "Couple memory" : `From ${memory.guestName ?? "Name not provided"}`);

function MemorySummary({ memory }) {
  return <>
    <h3>{heading(memory)}</h3>
    <p>{TYPES[memory.memoryType]} · {LABELS[memory.reviewStatus]} · {memory.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${memory.guestName ?? "Name not provided"}`}</p>
    {memory.memoryDate && <p>Memory date: {memory.memoryDate}</p>}
    <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p>
  </>;
}

export default function Albums({ state, busy, locked, actions }) {
  const [name, setName] = useState(state.album?.name ?? "");
  const [originalName, setOriginalName] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null);
  const cancelDelete = useRef(null);
  useEffect(() => { if (state.mutation.error || state.notice || state.error) feedback.current?.focus(); },
    [state.mutation.error, state.notice, state.error]);
  useEffect(() => { if (confirmDelete) cancelDelete.current?.focus(); }, [confirmDelete]);
  const disabled = busy || locked;
  function submitName(event) {
    event.preventDefault();
    try {
      const normalized = normalizeAlbumName(name); setError(null);
      void (state.view === "create" ? actions.create(normalized) : actions.rename(normalized));
    } catch (failure) { setError(failure.message); }
  }
  function retry() {
    try { setError(null); void actions.retry(state.mutation.needsName ? normalizeAlbumName(originalName) : undefined); }
    catch (failure) { setError(failure.message); }
  }
  return <section className="albums" aria-label="Private albums" aria-busy={busy}>
    <p>Albums organize your private memories. One memory can belong to several albums. Nothing here is published.</p>
    <div className="inbox-actions">
      <button className="button-secondary" type="button" disabled={disabled} onClick={actions.inbox}>Back to inbox</button>
      {state.view !== "list" && <button className="button-secondary" type="button" disabled={disabled} onClick={actions.list}>All albums</button>}
    </div>
    {(state.error || state.mutation.error || state.notice) && <p ref={feedback} tabIndex={-1}
      className={state.error || state.mutation.error ? "form-error" : "inbox-review-notice"}
      role={state.error || state.mutation.error ? "alert" : "status"}>{state.error ?? state.mutation.error ?? state.notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {locked && <div className="album-recovery">
      <p>Keep this page open while the change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
      {["saving", "loading"].includes(state.mutation.phase) && <p role="status">{state.mutation.phase === "saving" ? "Saving album change…" : "Checking the current album…"}</p>}
      {["uncertain", "conflict", "csrf"].includes(state.mutation.phase) && <>
        <button type="button" disabled={busy} onClick={() => actions.reload(state.mutation.phase === "csrf")}>{state.mutation.phase === "csrf" ? "Refresh session and current album" : "Reload current album"}</button>
        {state.mutation.canRetry && <>
          {state.mutation.needsName && <div><label htmlFor="album-original-name">Original album name</label>
            <input id="album-original-name" value={originalName} maxLength={200} onChange={event => setOriginalName(event.target.value)} disabled={busy} />
            <p className="guest-help">The hidden name draft was cleared. Re-enter the same name to retry the original change.</p></div>}
          <button className="button-secondary" type="button" disabled={busy} onClick={retry}>Retry this same album change</button>
        </>}
      </>}
    </div>}
    {state.view === "list" && <>
      <button type="button" disabled={disabled} onClick={actions.beginCreate}>Create an album</button>
      {busy ? <p role="status">Loading albums…</p> : !state.error && state.items.length === 0 ? <p role="status">No albums yet. Create one for your wedding, a trip or an anniversary.</p>
        : <ul className="inbox-list album-list">{state.items.map(album => <li key={album.albumId} className="inbox-card">
          <h2>{album.name}</h2><p>{album.memberCount} {album.memberCount === 1 ? "memory" : "memories"} · Couple only</p>
          <button type="button" disabled={disabled} onClick={() => actions.open(album.albumId)} aria-label={`Open album ${album.name}`}>Open album</button>
        </li>)}</ul>}
    </>}
    {state.view === "create" && <form className="album-name-form" onSubmit={submitName} aria-label="Create a private album">
      <h2>Create an album</h2><label htmlFor="album-name">Album name</label>
      <input id="album-name" value={name} maxLength={200} onChange={event => setName(event.target.value)} required disabled={disabled} />
      <button type="submit" disabled={disabled}>Create album</button>
    </form>}
    {state.view === "detail" && state.album && (state.album.deletedAt !== null
      ? <div className="album-tombstone"><h2>Deleted album</h2><p>This album was deleted. Its memories and original files remain in your archive. Deleting an album does not move memories to Recently deleted.</p></div>
      : <>
        <h2 className="album-title">{state.album.name}</h2><p>{state.album.memberCount} {state.album.memberCount === 1 ? "memory" : "memories"} · Couple only</p>
        <form className="album-name-form" onSubmit={submitName} aria-label="Rename this album">
          <label htmlFor="album-name">Album name</label><input id="album-name" value={name} maxLength={200} onChange={event => setName(event.target.value)} required disabled={disabled} />
          <button type="submit" disabled={disabled}>Save album name</button>
        </form>
        <div className="inbox-actions"><button type="button" disabled={disabled} onClick={() => actions.select("KEEP")}>Add memories</button>
          <button className="button-secondary" type="button" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete album…</button></div>
        {confirmDelete && !locked && <div className="inbox-delete-confirmation" role="group" aria-labelledby="album-delete-title">
          <h3 id="album-delete-title">Delete this album?</h3><p>Only this album and its membership will be removed. Every memory and original file stays in your archive.</p>
          <div className="inbox-actions"><button ref={cancelDelete} className="button-secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel album deletion</button>
            <button type="button" disabled={busy} onClick={() => { setConfirmDelete(false); void actions.delete(); }}>Confirm delete album</button></div>
        </div>}
        {busy && !state.members.length ? <p role="status">Loading album memories…</p> : !state.error && !locked && !state.members.length ? <p role="status">This album is empty. Add memories from your private archive.</p>
          : <ol className="inbox-list album-members">{state.members.map(item => <li key={item.memory.memoryId} className="inbox-card album-member">
            <MemorySummary memory={item.memory} /><div className="inbox-actions">
              <button type="button" disabled={disabled} onClick={() => actions.openMemory(item.memory.memoryId)} aria-label={`Open memory ${heading(item.memory)}`}>Open memory</button>
              <button className="button-secondary" type="button" disabled={disabled || !item.canMoveEarlier} onClick={() => actions.move(item.memory.memoryId, "EARLIER")} aria-label={`Move ${heading(item.memory)} earlier`}>Move earlier</button>
              <button className="button-secondary" type="button" disabled={disabled || !item.canMoveLater} onClick={() => actions.move(item.memory.memoryId, "LATER")} aria-label={`Move ${heading(item.memory)} later`}>Move later</button>
              <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.remove(item.memory.memoryId)} aria-label={`Remove ${heading(item.memory)} from album`}>Remove from album</button>
            </div>
          </li>)}</ol>}
        <p className="guest-help">Removing a memory here preserves it in your archive. Deleting a memory from its detail removes it from every album; restoring it to the inbox does not add it back.</p>
      </>)}
    {state.view === "select" && state.album && <>
      <h2>Add memories to {state.album.name}</h2>
      <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.open(state.album.albumId)}>Back to album</button>
      <nav className="inbox-filters" aria-label="Available memory review status">{Object.entries(LABELS).map(([status, label]) => <button key={status} className="button-secondary" type="button"
        disabled={disabled} aria-pressed={state.selectorStatus === status} onClick={() => actions.select(status)}>{label}</button>)}</nav>
      {busy ? <p role="status">Loading available memories…</p> : !state.error && !state.candidates.length ? <p role="status">No completed {LABELS[state.selectorStatus].toLowerCase()} memories on this page.</p>
        : <ul className="inbox-list album-candidates">{state.candidates.map(memory => <li key={memory.memoryId} className="inbox-card">
          <MemorySummary memory={memory} /><button type="button" disabled={disabled} onClick={() => actions.add(memory.memoryId)} aria-label={`Add ${heading(memory)} to album`}>Add to album</button>
        </li>)}</ul>}
      <p className="guest-help">Completed notes, photos and voice memories can belong to several albums. Adding an existing member keeps one copy in this album.</p>
    </>}
    {state.error && <button type="button" disabled={disabled} onClick={() => state.view === "list" ? actions.list()
      : state.requestedId ? actions.open(state.requestedId) : actions.list()}>Reload album first page</button>}
    {["list", "detail", "select"].includes(state.view) && !state.album?.deletedAt && <div className="inbox-pagination album-pagination">
      <button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || state.cursors.length < 2} onClick={() => actions.page(false)}>Previous album page</button>
      <span>Page {state.cursors.length}</span><button className="button-secondary" type="button" disabled={disabled || Boolean(state.error) || !state.nextCursor} onClick={() => actions.page(true)}>Next album page</button>
    </div>}
  </section>;
}
