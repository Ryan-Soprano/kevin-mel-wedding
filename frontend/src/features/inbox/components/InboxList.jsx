import { memoryTime } from "../memoryDisplay.js";
import { getMemoryCardTitle, getMemoryExcerpt, getMemoryOpenLabel, getMemorySourceLabel, MEMORY_TYPE_LABELS, REVIEW_STATUS_LABELS } from "../inboxDisplay.js";

function InboxCard({ memory, onOpen }) {
  return (
    <li className="inbox-card">
      <h2>{getMemoryCardTitle(memory)}</h2>
      <p>{getMemorySourceLabel(memory)}{memory.memoryDate && ` · Memory date: ${memory.memoryDate}`}</p>
      <p>{MEMORY_TYPE_LABELS[memory.memoryType]} · <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time></p>
      <p className="inbox-excerpt">{getMemoryExcerpt(memory)}</p>
      <button type="button" onClick={() => onOpen(memory.memoryId)} aria-label={getMemoryOpenLabel(memory)}>Open memory</button>
    </li>
  );
}

function InboxItems({ state, cursor, actions }) {
  if (state.busy) return <output>Loading your memories…</output>;
  if (state.error) return <button type="button" onClick={() => actions.reloadInbox(state.reviewStatus, cursor)}>Try again</button>;
  if (state.items.length === 0) return <p role="status">No {REVIEW_STATUS_LABELS[state.reviewStatus].toLowerCase()} memories right now.</p>;
  let countLabel = "memories";
  if (state.items.length === 1) countLabel = "memory";
  return (
    <>
      <p>{state.items.length} {countLabel} on this page · times shown in Eastern time</p>
      <ul className="inbox-list">
        {state.items.map(memory => <InboxCard key={memory.memoryId} memory={memory} onOpen={actions.openMemory} />)}
      </ul>
    </>
  );
}

function InboxPagination({ state, pageCount, onNext, onPrevious }) {
  let pageLabel = `Page ${pageCount}`;
  if (state.error) pageLabel = `Page ${pageCount} could not be loaded`;
  return (
    <div className="inbox-pagination">
      <button type="button" className="button-secondary" disabled={state.busy || Boolean(state.error) || pageCount < 2} onClick={onPrevious}>Previous page</button>
      <span>{pageLabel}</span>
      <button type="button" className="button-secondary" disabled={state.busy || Boolean(state.error) || !state.nextCursor} onClick={onNext}>Next page</button>
    </div>
  );
}

export default function InboxList({ state, pages, actions, onFilter, onNext, onPrevious }) {
  return (
    <section aria-label="Private memories" aria-busy={state.busy}>
      <button type="button" disabled={state.busy} onClick={actions.navigation.create}>Add a memory</button>
      <button type="button" className="button-secondary" disabled={state.busy} onClick={actions.albums.list}>Albums</button>
      <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.timeline.list()}>Timeline</button>
      <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.library.list()}>Library</button>
      <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.tags.list()}>Tags</button>
      <button type="button" className="button-secondary" disabled={state.busy} onClick={actions.navigation.export}>Export archive</button>
      <nav className="inbox-filters" aria-label="Review status">
        {Object.entries(REVIEW_STATUS_LABELS).map(([status, label]) => (
          <button key={status} type="button" className="button-secondary" aria-pressed={state.reviewStatus === status}
            disabled={state.busy} onClick={() => onFilter(status)}>{label}</button>
        ))}
      </nav>
      <InboxItems state={state} cursor={pages.at(-1)} actions={actions.navigation} />
      <InboxPagination state={state} pageCount={pages.length} onNext={onNext} onPrevious={onPrevious} />
    </section>
  );
}
