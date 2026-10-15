import {
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  TAG_REVIEW_STATUSES,
  getTagMemoryHeading,
} from "../tagDisplay.js";
import TagMemorySummary from "./TagMemorySummary.jsx";

function TagCandidates({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) {
    return <p role="status">Loading available memories…</p>;
  }
  if (!state.error && !state.candidates.length) {
    return (
      <ArchiveEmpty
        icon="library"
        title={`No completed ${TAG_REVIEW_STATUSES[state.selectorStatus].toLowerCase()} memories on this page`}
      />
    );
  }
  return (
    <ul className="inbox-list tag-candidates">
      {state.candidates.map((memory) => (
        <li key={memory.memoryId} className="inbox-card">
          <TagMemorySummary memory={memory} />
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.add(memory.memoryId)}
            aria-label={`Add ${getTagMemoryHeading(memory)} to tag`}
          >
            Add to tag
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function TagSelector({ view }) {
  const { state, disabled, actions } = view;
  if (!state.tag) {
    return null;
  }
  return (
    <ArchivePanel
      title={<>Add memories to {state.tag.name}</>}
      actions={
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={() => actions.open(state.tag.tagId)}
        >
          Back to tag
        </button>
      }
    >
      <nav className="inbox-filters" aria-label="Available memory review status">
        {Object.entries(TAG_REVIEW_STATUSES).map(([status, label]) => (
          <button
            key={status}
            className="button-secondary"
            type="button"
            disabled={disabled}
            aria-pressed={state.selectorStatus === status}
            onClick={() => actions.select(status)}
          >
            {label}
          </button>
        ))}
      </nav>
      <TagCandidates view={view} />
      <p className="guest-help">
        Completed notes, photos and voice memories can belong to several tags.
        Adding an existing member keeps one copy in this tag.
      </p>
    </ArchivePanel>
  );
}
