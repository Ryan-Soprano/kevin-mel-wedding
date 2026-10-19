import { useEffect, useMemo, useRef, useState } from "react";
import { createSharingApi } from "./sharingApi.js";
import "./sharing.css";

function SharedMedia({ memory, token, api, active = true }) {
  const [playback, setPlayback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(null);
  const mounted = useRef(true);
  const audio = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => { if (!active) audio.current?.pause(); }, [active, playback]);
  useEffect(() => {
    if (!playback) return;
    const timer = setTimeout(() => setPlayback(null), Math.max(0, Date.parse(playback.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [playback]);
  async function loadMedia() {
    setLoading(true); setError(false);
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    try { const result = await api.getSharedPlayback(memory.memoryId, { token, signal: controller.signal }); if (mounted.current) setPlayback(result); }
    catch { if (mounted.current) setError(true); }
    finally { clearTimeout(timer); if (mounted.current) setLoading(false); }
  }
  if (memory.memoryType === "TEXT") return null;
  return <div className="shared-media">
    {playback ? memory.memoryType === "PHOTO"
      ? <img src={playback.url} alt={memory.caption ?? memory.title ?? "A shared wedding photo"} referrerPolicy="no-referrer" onError={() => { setPlayback(null); setError(true); }} />
      : <audio ref={audio} src={playback.url} controls preload="none" aria-label={memory.title ?? "Shared voice memory"} onError={() => { setPlayback(null); setError(true); }} />
      : <button type="button" className="button-secondary" disabled={loading} onClick={loadMedia}>{loading ? "Loading…" : memory.memoryType === "PHOTO" ? "View photo" : "Listen to voice memory"}</button>}
    {error && <p className="guest-help" role="status">This memory may no longer be shared, or its original could not be loaded. Try again.</p>}
  </div>;
}

function SharedMemory({ memory, token, api, active = true }) {
  return <article className="shared-memory">
    <p className="shared-memory-kind">{({ TEXT: "A wedding note", PHOTO: "A wedding photo", AUDIO: "A voice memory" })[memory.memoryType]}</p>
    {memory.title && <h3>{memory.title}</h3>}
    {memory.textContent && <p className="shared-memory-note">{memory.textContent}</p>}
    <SharedMedia memory={memory} token={token} api={api} active={active} />
    {memory.caption && <p>{memory.caption}</p>}
    {memory.description && <p className="shared-memory-note">{memory.description}</p>}
  </article>;
}

export function PublicMemoriesView({ state, active = true, api, showNewest, onRetry, onNewest, onMore, headingRef, statusRef }) {
  if (!state.visible) return null;
  return <section className="shared-memories" aria-label="Memories shared by Kevin and Melanie">
    <p className="guest-couple">From the vault</p>
    <h2 ref={headingRef} tabIndex={-1}>Memories Kevin and Melanie have shared</h2>
    <p className="guest-help">These memories were chosen by Kevin and Melanie to share publicly. New contributions go to their private vault.</p>
    {(state.loading || state.error) && <p ref={statusRef} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1}>
      {state.loading ? "Loading shared memories…" : "Shared memories couldn’t be loaded."}
      {!state.loading && state.error && state.items.length > 0 && " Your current page is still here."}
    </p>}
    {!state.loading && !state.error && state.items.length === 0 && <p>No more shared memories here.</p>}
    <div className="shared-memory-list" aria-busy={state.loading}>{state.items.map(memory => <SharedMemory key={memory.memoryId} memory={memory} api={api} active={active} />)}</div>
    <div className="shared-pagination">
      {state.error && <button type="button" className="button-secondary" disabled={state.loading} onClick={onRetry}>Try again</button>}
      {showNewest && <button type="button" className="button-secondary" disabled={state.loading} onClick={onNewest}>Back to newest memories</button>}
      {!state.error && state.nextCursor && <button type="button" className="button-secondary" disabled={state.loading} onClick={onMore}>More shared memories</button>}
    </div>
  </section>;
}

export function PublicMemories({ active = true } = {}) {
  const api = useMemo(() => createSharingApi(), []);
  const [state, setState] = useState({ items: [], nextCursor: null, pageCursor: null, loading: true, error: false, visible: false });
  const [request, setRequest] = useState({ cursor: null });
  const busy = useRef(true);
  const focusAfterLoad = useRef(false);
  const heading = useRef(null);
  const status = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let current = true;
    api.listPublicMemories({ cursor: request.cursor, signal: controller.signal }).then(page => {
      if (!current) return;
      busy.current = false;
      setState(previous => ({ items: page.items, nextCursor: page.nextCursor, pageCursor: request.cursor,
        loading: false, error: false, visible: previous.visible || page.items.length > 0 || request.cursor !== null }));
    }).catch(() => {
      if (!current) return;
      busy.current = false;
      setState(previous => ({ ...previous, loading: false, error: true, visible: true }));
    }).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [api, request]);
  useEffect(() => {
    if (!active) { focusAfterLoad.current = false; return; }
    if (state.loading || !focusAfterLoad.current) return;
    focusAfterLoad.current = false;
    (state.error ? status : heading).current?.focus();
  }, [state, active]);
  function loadPage(cursor) {
    if (busy.current) return;
    busy.current = true;
    focusAfterLoad.current = active;
    setState(previous => ({ ...previous, loading: true }));
    setRequest({ cursor });
  }
  return <PublicMemoriesView state={state} active={active} api={api}
    showNewest={request.cursor !== null || state.pageCursor !== null}
    onRetry={() => loadPage(request.cursor)} onNewest={() => loadPage(null)} onMore={() => loadPage(state.nextCursor)}
    headingRef={heading} statusRef={status} />;
}

export default function SharedMemoryPage({ memoryId, token }) {
  const api = useMemo(() => createSharingApi(), []);
  const [state, setState] = useState({ memory: null, loading: true });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    Promise.resolve().then(() => api.getSharedMemory(memoryId, { token, signal: controller.signal })).then(memory => {
      if (active) setState({ memory, loading: false });
    }).catch(() => { if (active) setState({ memory: null, loading: false }); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [api, memoryId, token]);
  return <main className="shared-page">
    <p className="guest-couple">Kevin &amp; Melanie</p>
    <h1>A memory shared with you</h1>
    {state.loading ? <p role="status">Loading shared memory…</p>
      : state.memory ? <SharedMemory memory={state.memory} token={token} api={api} />
      : <p role="status">This memory is no longer shared, or the link is unavailable. Ask Kevin and Melanie for a current link.</p>}
    <a href="/">Visit Kevin and Melanie’s wedding site</a>
  </main>;
}
