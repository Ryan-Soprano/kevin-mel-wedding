import { memoryTime } from "../memoryDisplay.js";
import { getMemoryCardTitle, getMemoryExcerpt, getMemoryOpenLabel, getMemorySourceLabel, MEMORY_TYPE_LABELS, REVIEW_STATUS_LABELS, VISIBILITY_LABELS } from "../inboxDisplay.js";

function MemoryIcon({ type }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {type === "PHOTO" ? <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 5-5 3 3 4-6 4 7" /></>
        : type === "AUDIO" ? <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M8 21h8" /></>
          : <><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6" /></>}
    </svg>
  );
}

function InboxCard({ memory, onOpen }) {
  return (
    <li className="inbox-card">
      <div className="inbox-card-top">
        <span className="inbox-memory-kind"><MemoryIcon type={memory.memoryType} />{MEMORY_TYPE_LABELS[memory.memoryType]}</span>
        <span className="inbox-visibility">{VISIBILITY_LABELS[memory.visibility] ?? VISIBILITY_LABELS.COUPLE_ONLY}</span>
      </div>
      <h2>{getMemoryCardTitle(memory)}</h2>
      <p className="inbox-card-source">{getMemorySourceLabel(memory)}{memory.memoryDate && ` · Memory date: ${memory.memoryDate}`}</p>
      <p className="inbox-card-date"><time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time></p>
      <p className="inbox-excerpt">{getMemoryExcerpt(memory)}</p>
      <button type="button" onClick={() => onOpen(memory.memoryId)} aria-label={getMemoryOpenLabel(memory)}>Open memory</button>
    </li>
  );
}

function InboxItems({ state, cursor, actions }) {
  if (state.busy) return <output className="inbox-loading"><span className="inbox-loading-dot" aria-hidden="true" />Loading your memories…</output>;
  if (state.error) return <button type="button" onClick={() => actions.reloadInbox(state.reviewStatus, cursor)}>Try again</button>;
  if (state.items.length === 0) return <div className="inbox-empty" role="status"><span aria-hidden="true">♡</span><p>No {REVIEW_STATUS_LABELS[state.reviewStatus].toLowerCase()} memories right now.</p><p className="guest-help">Your memories will be waiting here when they arrive.</p></div>;
  let countLabel = "memories";
  if (state.items.length === 1) countLabel = "memory";
  return (
    <>
      <p className="inbox-page-count">{state.items.length} {countLabel} on this page · times shown in Eastern time</p>
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
    <section className="inbox-memories" aria-label="Private memories" aria-busy={state.busy}>
      <nav className="inbox-tools" aria-label="Your archive">
        <button type="button" disabled={state.busy} onClick={actions.navigation.create}>Add a memory</button>
        <div className="inbox-tool-links">
          <button type="button" className="button-secondary" disabled={state.busy} onClick={actions.albums.list}>Albums</button>
          <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.timeline.list()}>Timeline</button>
          <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.library.list()}>Library</button>
          <button type="button" className="button-secondary" disabled={state.busy} onClick={() => actions.tags.list()}>Tags</button>
          <button type="button" className="button-secondary" disabled={state.busy} onClick={actions.navigation.export}>Export archive</button>
        </div>
      </nav>
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
