import {
  ArchiveActions,
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  getAlbumMemoryCount,
  getAlbumMemoryHeading,
} from "../albumDisplay.js";
import AlbumNameForm from "./AlbumNameForm.jsx";
import AlbumMemorySummary from "./AlbumMemorySummary.jsx";

function AlbumMembers({ view }) {
  const { state, busy, locked, disabled, actions } = view;
  if (busy && !state.members.length) {
    return <output>Loading album memories…</output>;
  }
  if (!state.error && !locked && !state.members.length) {
    return (
      <ArchiveEmpty title="This album is empty" icon="album">
        <p>Add memories from your private archive.</p>
      </ArchiveEmpty>
    );
  }
  return (
    <ol className="inbox-list album-members">
      {state.members.map((item) => (
        <li key={item.memory.memoryId} className="inbox-card album-member">
          <AlbumMemorySummary memory={item.memory} />
          <ArchiveActions>
            <button
              type="button"
              disabled={disabled}
              onClick={() => actions.openMemory(item.memory.memoryId)}
              aria-label={`Open memory ${getAlbumMemoryHeading(item.memory)}`}
            >
              Open memory
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={disabled || !item.canMoveEarlier}
              onClick={() => actions.move(item.memory.memoryId, "EARLIER")}
              aria-label={`Move ${getAlbumMemoryHeading(item.memory)} earlier`}
            >
              Move earlier
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={disabled || !item.canMoveLater}
              onClick={() => actions.move(item.memory.memoryId, "LATER")}
              aria-label={`Move ${getAlbumMemoryHeading(item.memory)} later`}
            >
              Move later
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={disabled}
              onClick={() => actions.remove(item.memory.memoryId)}
              aria-label={`Remove ${getAlbumMemoryHeading(item.memory)} from album`}
            >
              Remove from album
            </button>
          </ArchiveActions>
        </li>
      ))}
    </ol>
  );
}

function AlbumDeleteConfirmation({ view, cancelDelete }) {
  const { busy, handlers } = view;
  return (
    <fieldset
      className="inbox-delete-confirmation"
      aria-describedby="album-delete-copy"
    >
      <legend id="album-delete-title">Delete this album?</legend>
      <p id="album-delete-copy">
        Only this album and its membership will be removed. Every memory and
        original file stays in your archive.
      </p>
      <ArchiveActions>
        <button
          ref={cancelDelete}
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={handlers.cancelDeletion}
        >
          Cancel album deletion
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handlers.confirmDeletion}
        >
          Confirm delete album
        </button>
      </ArchiveActions>
    </fieldset>
  );
}

export default function AlbumDetail({ view, cancelDelete }) {
  const { state, locked, disabled, actions, confirmDelete, handlers } = view;
  if (!state.album) {
    return null;
  }
  if (state.album.deletedAt !== null) {
    return (
      <ArchiveEmpty title="Deleted album" icon="album">
        <p>
          This album was deleted. Its memories and original files remain in your
          archive. Deleting an album does not move memories to Recently deleted.
        </p>
      </ArchiveEmpty>
    );
  }
  return (
    <>
      <ArchivePanel
        title={state.album.name}
        description={
          <p>
            {state.album.memberCount}{" "}
            {getAlbumMemoryCount(state.album.memberCount)} · Couple only
          </p>
        }
      >
        <AlbumNameForm view={view} />
        <ArchiveActions>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.select("KEEP")}
          >
            Add memories
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={disabled}
            onClick={handlers.beginDelete}
          >
            Delete album…
          </button>
        </ArchiveActions>
      </ArchivePanel>
      {confirmDelete && !locked && (
        <AlbumDeleteConfirmation view={view} cancelDelete={cancelDelete} />
      )}
      <AlbumMembers view={view} />
      <p className="guest-help">
        Removing a memory here preserves it in your archive. Deleting a memory
        from its detail removes it from every album; restoring it to the inbox
        does not add it back.
      </p>
    </>
  );
}
