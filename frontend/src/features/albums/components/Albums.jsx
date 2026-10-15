import { ArchiveIntro, ArchiveScreen } from "../../inbox/components/ArchiveLayout.jsx";
import { useAlbums } from "../hooks/useAlbums.js";
import { getAlbumFeedback } from "../albumDisplay.js";
import AlbumList from "./AlbumList.jsx";
import AlbumNameForm from "./AlbumNameForm.jsx";
import AlbumDetail from "./AlbumDetail.jsx";
import AlbumSelector from "./AlbumSelector.jsx";
import AlbumRecovery from "./AlbumRecovery.jsx";
import AlbumPaging from "./AlbumPaging.jsx";
import "../albums.css";

function AlbumsContent({ view, cancelDelete }) {
  switch (view.state.view) {
    case "list":
      return <AlbumList view={view} />;
    case "create":
      return <AlbumNameForm view={view} create />;
    case "detail":
      return <AlbumDetail view={view} cancelDelete={cancelDelete} />;
    case "select":
      return <AlbumSelector view={view} />;
    default:
      return null;
  }
}

export default function Albums({ state, busy, locked, actions }) {
  const { view, feedback, cancelDelete } = useAlbums({ state, busy, locked, actions });
  const notice = getAlbumFeedback(state);
  return (
    <ArchiveScreen className="albums" label="Private albums" busy={busy}>
      <ArchiveIntro actions={<>
        <button className="button-secondary" type="button" disabled={view.disabled} onClick={actions.inbox}>Back to inbox</button>
        {state.view !== "list" && <button className="button-secondary" type="button" disabled={view.disabled} onClick={actions.list}>All albums</button>}
        {state.view === "list" && <button type="button" disabled={view.disabled} onClick={actions.beginCreate}>Create an album</button>}
      </>}>
        <p>Albums organize your private memories. One memory can belong to several albums. Nothing here is published.</p>
      </ArchiveIntro>
      {notice.visible && <p ref={feedback} tabIndex={-1} className={notice.className} role={notice.role}>{notice.text}</p>}
      {view.error && <p className="form-error" role="alert">{view.error}</p>}
      <AlbumRecovery view={view} />
      <AlbumsContent view={view} cancelDelete={cancelDelete} />
      <AlbumPaging view={view} />
    </ArchiveScreen>
  );
}
