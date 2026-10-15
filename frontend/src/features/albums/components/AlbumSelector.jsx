import { ArchiveEmpty, ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import { getAlbumMemoryHeading, ALBUM_REVIEW_LABELS } from "../albumDisplay.js";
import AlbumMemorySummary from "./AlbumMemorySummary.jsx";

function AlbumCandidates({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) return <p role="status">Loading available memories…</p>;
  if (!state.error && !state.candidates.length) return <ArchiveEmpty title="No memories on this page" icon="album"><p>No completed {ALBUM_REVIEW_LABELS[state.selectorStatus].toLowerCase()} memories on this page.</p></ArchiveEmpty>;
  return (
    <ul className="inbox-list album-candidates">
      {state.candidates.map(memory => <li key={memory.memoryId} className="inbox-card">
        <AlbumMemorySummary memory={memory} />
        <button type="button" disabled={disabled} onClick={() => actions.add(memory.memoryId)} aria-label={`Add ${getAlbumMemoryHeading(memory)} to album`}>Add to album</button>
      </li>)}
    </ul>
  );
}

export default function AlbumSelector({ view }) {
  const { state, disabled, actions } = view;
  if (!state.album) return null;
  return (
    <>
      <ArchivePanel title={<>Add memories to {state.album.name}</>} actions={<button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.open(state.album.albumId)}>Back to album</button>}>
        <nav className="inbox-filters" aria-label="Available memory review status">
          {Object.entries(ALBUM_REVIEW_LABELS).map(([status, label]) => <button key={status} className="button-secondary" type="button"
            disabled={disabled} aria-pressed={state.selectorStatus === status} onClick={() => actions.select(status)}>{label}</button>)}
        </nav>
      </ArchivePanel>
      <AlbumCandidates view={view} />
      <p className="guest-help">Completed notes, photos and voice memories can belong to several albums. Adding an existing member keeps one copy in this album.</p>
    </>
  );
}
