import {
  ArchiveActions,
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  getTagMemoryNoun,
  getTagMemoryHeading,
} from "../tagDisplay.js";
import TagNameForm from "./TagNameForm.jsx";
import TagMemorySummary from "./TagMemorySummary.jsx";

function TagMembers({ view }) {
  const { state, busy, locked, disabled, actions } = view;
  if (busy && !state.members.length) {
    return <p role="status">Loading tag memories…</p>;
  }
  if (!state.error && !locked && !state.members.length) {
    return (
      <ArchiveEmpty icon="tags" title="This tag is empty">
        Add memories from your private archive.
      </ArchiveEmpty>
    );
  }
  return (
    <ol className="inbox-list tag-members">
      {state.members.map((item) => (
        <li
          key={item.memory.memoryId}
          className="inbox-card tag-member"
        >
          <TagMemorySummary memory={item.memory} />
          <ArchiveActions>
            <button
              type="button"
              disabled={disabled}
              onClick={() => actions.openMemory(item.memory.memoryId)}
              aria-label={`Open memory ${getTagMemoryHeading(item.memory)}`}
            >
              Open memory
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={disabled}
              onClick={() => actions.remove(item.memory.memoryId)}
              aria-label={`Remove ${getTagMemoryHeading(item.memory)} from tag`}
            >
              Remove from tag
            </button>
          </ArchiveActions>
        </li>
      ))}
    </ol>
  );
}

function TagDeleteConfirmation({ view, cancelDelete }) {
  const { busy, handlers } = view;
  return (
    <div
      className="inbox-delete-confirmation"
      role="group"
      aria-labelledby="tag-delete-title"
    >
      <h3 id="tag-delete-title">Delete this tag?</h3>
      <p>
        Only this tag and its membership will be removed. Every memory and
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
          Cancel tag deletion
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handlers.confirmDeletion}
        >
          Confirm delete tag
        </button>
      </ArchiveActions>
    </div>
  );
}

export default function TagDetail({ view, cancelDelete, deleteTrigger }) {
  const { state, locked, disabled, actions, confirmDelete, handlers } = view;
  if (!state.tag) {
    return null;
  }
  if (state.tag.deletedAt !== null) {
    return (
      <ArchivePanel title="Deleted tag" className="tag-tombstone">
        <p>
          This tag was deleted. Its memories and original files remain in your
          archive. Deleting a tag does not move memories to Recently deleted.
        </p>
      </ArchivePanel>
    );
  }
  return (
    <>
      <ArchivePanel
        title={state.tag.name}
        description={`${state.tag.memberCount} ${getTagMemoryNoun(state.tag.memberCount)} · Couple only`}
      >
        <TagNameForm view={view} mode="rename" />
        <ArchiveActions>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.select("KEEP")}
          >
            Add memories
          </button>
          <button
            ref={deleteTrigger}
            className="button-secondary"
            type="button"
            disabled={disabled}
            onClick={handlers.beginDelete}
          >
            Delete tag…
          </button>
        </ArchiveActions>
        {confirmDelete && !locked && (
          <TagDeleteConfirmation view={view} cancelDelete={cancelDelete} />
        )}
      </ArchivePanel>
      <ArchivePanel title="Tagged memories">
        <TagMembers view={view} />
        <p className="guest-help">
          Removing a memory here preserves it in your archive. Deleting a memory
          from its detail removes it from every tag; restoring it to the inbox
          does not add it back.
        </p>
      </ArchivePanel>
    </>
  );
}
