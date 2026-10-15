import {
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import { memoryTime } from "../../inbox/memoryDisplay.js";
import { partialDateLabel } from "../../timeline/timelineFields.js";
import {
  LIBRARY_MEMORY_TYPES,
  LIBRARY_REVIEW_STATUSES,
  getLibraryMemoryHeading,
  getLibraryMemorySource,
  getLibraryMemoryExcerpt,
} from "../libraryDisplay.js";

function LibraryResultList({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) {
    return <p role="status">Loading library…</p>;
  }
  if (!state.error && state.items.length === 0) {
    return (
      <ArchiveEmpty icon="library" title="No matching memories">
        Change your filters or reset the search.
      </ArchiveEmpty>
    );
  }

  return (
    <ul className="inbox-list library-results">
      {state.items.map((memory) => (
        <li
          key={memory.memoryId}
          className="inbox-card library-result"
        >
          <h3>{getLibraryMemoryHeading(memory)}</h3>
          <p className="library-result-meta">
            {LIBRARY_MEMORY_TYPES[memory.memoryType]} ·{" "}
            {LIBRARY_REVIEW_STATUSES[memory.reviewStatus]} ·{" "}
            {getLibraryMemorySource(memory)}
          </p>
          <p className="library-result-date">
            Memory date:{" "}
            {partialDateLabel(memory.memoryDate, memory.datePrecision)}
          </p>
          <p className="library-result-date">
            Saved on:{" "}
            <time dateTime={memory.createdAt}>
              {memoryTime(memory.createdAt)}
            </time>
            {" "}· Eastern
          </p>
          <p className="inbox-excerpt">
            {getLibraryMemoryExcerpt(memory)}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.open(memory.memoryId)}
          >
            Open memory
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryResults({ view }) {
  return (
    <ArchivePanel
      title="Search results"
      description="Your newest saved memories appear first."
    >
      <LibraryResultList view={view} />
    </ArchivePanel>
  );
}
