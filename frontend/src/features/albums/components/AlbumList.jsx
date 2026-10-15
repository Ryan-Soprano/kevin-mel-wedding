import { ArchiveEmpty } from "../../inbox/components/ArchiveLayout.jsx";
import { getAlbumMemoryCount } from "../albumDisplay.js";

export default function AlbumList({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) return <p role="status">Loading albums…</p>;
  if (!state.error && state.items.length === 0) return <ArchiveEmpty title="No albums yet" icon="album"><p>Create one for your wedding, a trip or an anniversary.</p></ArchiveEmpty>;
  return (
    <ul className="inbox-list album-list">
      {state.items.map(album => <li key={album.albumId} className="inbox-card">
        <h2>{album.name}</h2>
        <p>{album.memberCount} {getAlbumMemoryCount(album.memberCount)} · Couple only</p>
        <button type="button" disabled={disabled} onClick={() => actions.open(album.albumId)} aria-label={`Open album ${album.name}`}>Open album</button>
      </li>)}
    </ul>
  );
}
