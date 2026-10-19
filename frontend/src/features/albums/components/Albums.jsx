import {
  ArchiveIntro,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  useAlbums,
  useAlbumPagingFocus,
} from "../hooks/useAlbums.js";
import {
  ALBUM_REVIEW_LABELS,
  getAlbumFeedback,
} from "../albumDisplay.js";
import AlbumList from "./AlbumList.jsx";
import AlbumNameForm from "./AlbumNameForm.jsx";
import AlbumDetail from "./AlbumDetail.jsx";
import AlbumSelector from "./AlbumSelector.jsx";
import AlbumRecovery from "./AlbumRecovery.jsx";
import AlbumPaging from "./AlbumPaging.jsx";
import "../albums.css";

function AlbumsContent({ view, cancelDelete, deleteTrigger }) {
  switch (view.state.view) {
    case "list":
      return <AlbumList view={view} />;
    case "create":
      return <AlbumNameForm view={view} create />;
    case "detail":
      return (
        <AlbumDetail
          view={view}
          cancelDelete={cancelDelete}
          deleteTrigger={deleteTrigger}
        />
      );
    case "select":
      return <AlbumSelector view={view} />;
    default:
      return null;
  }
}

export default function Albums({ state, busy, locked, actions, editorKey }) {
  const pagingFocus = useAlbumPagingFocus({ state, busy, locked });
  return (
    <AlbumsEditor
      key={editorKey}
      state={state}
      busy={busy}
      locked={locked}
      actions={actions}
      pagingFocus={pagingFocus}
    />
  );
}

function AlbumsEditor({ state, busy, locked, actions, pagingFocus }) {
  const { view, feedback, cancelDelete, deleteTrigger, pageStatus } = useAlbums({
    state,
    busy,
    locked,
    actions,
    pagingFocus,
  });
  const notice = getAlbumFeedback(state);
  const pageLabel = state.view === "select"
    ? `Available ${ALBUM_REVIEW_LABELS[state.selectorStatus].toLowerCase()} memories`
    : state.view === "detail" ? "Album memories" : "Albums";
  return (
    <ArchiveScreen className="albums" label="Private albums" busy={busy}>
      <ArchiveIntro
        actions={
          <>
            <button
              className="button-secondary"
              type="button"
              disabled={view.disabled}
              onClick={view.actions.inbox}
            >
              Back to inbox
            </button>
            {state.view !== "list" && (
              <button
                className="button-secondary"
                type="button"
                disabled={view.disabled}
                onClick={view.actions.list}
              >
                All albums
              </button>
            )}
            {state.view === "list" && (
              <button
                type="button"
                disabled={view.disabled}
                onClick={view.actions.beginCreate}
              >
                Create an album
              </button>
            )}
          </>
        }
      >
        <p>
          Albums organize your private memories. One memory can belong to
          several albums. Nothing here is published.
        </p>
      </ArchiveIntro>
      {["list", "detail", "select"].includes(state.view) && (
        <h2
          ref={pageStatus}
          tabIndex={-1}
          className="visually-hidden"
        >
          {pageLabel} · Page {state.cursors.length}{state.error ? " could not be loaded" : ""}
        </h2>
      )}
      {notice.visible && (
        <p
          ref={feedback}
          tabIndex={-1}
          className={notice.className}
          role={notice.role}
        >
          {notice.text}
        </p>
      )}
      <AlbumRecovery view={view} />
      <AlbumsContent
        view={view}
        cancelDelete={cancelDelete}
        deleteTrigger={deleteTrigger}
      />
      <AlbumPaging view={view} />
    </ArchiveScreen>
  );
}
