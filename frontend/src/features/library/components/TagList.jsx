import {
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import { getTagMemoryNoun } from "../tagDisplay.js";

function TagResults({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) {
    return <p role="status">Loading tags…</p>;
  }
  if (!state.error && state.items.length === 0) {
    return (
      <ArchiveEmpty icon="tags" title="No tags yet">
        Create one for your wedding, a trip or an anniversary.
      </ArchiveEmpty>
    );
  }
  return (
    <ul className="inbox-list tag-list">
      {state.items.map((tag) => (
        <li key={tag.tagId} className="inbox-card">
          <h3>{tag.name}</h3>
          <p className="library-result-meta">
            {tag.memberCount} {getTagMemoryNoun(tag.memberCount)} · Couple only
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.open(tag.tagId)}
            aria-label={`Open tag ${tag.name}`}
          >
            Open tag
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function TagList({ view }) {
  const { q, setQ, disabled, actions, handlers, fieldErrors = {}, fields = {} } = view;
  const { query: queryField } = fields;
  return (
    <ArchivePanel
      title="Your tags"
      actions={
        <button
          type="button"
          disabled={disabled}
          onClick={actions.beginCreate}
        >
          Create a tag
        </button>
      }
    >
      <form className="tag-search" onSubmit={handlers.search}>
        <div>
          <label htmlFor="tag-query">Search tag names</label>
          <input
            id="tag-query"
            ref={queryField}
            type="search"
            value={q}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => setQ(event.target.value)}
            aria-invalid={Boolean(fieldErrors.query)}
            aria-describedby={fieldErrors.query ? "tag-query-error" : undefined}
          />
          {fieldErrors.query && (
            <p id="tag-query-error" className="form-error" role="alert">
              {fieldErrors.query}
            </p>
          )}
        </div>
        <button type="submit" disabled={disabled}>
          Search tags
        </button>
      </form>
      <p className="guest-help">
        Tag names may repeat. Each entry is a separate tag. Newest tags
        appear first.
      </p>
      <TagResults view={view} />
    </ArchivePanel>
  );
}
