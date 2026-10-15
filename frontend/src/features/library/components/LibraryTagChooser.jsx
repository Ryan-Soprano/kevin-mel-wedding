import {
  ArchiveEmpty,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import { memoryTime } from "../../inbox/memoryDisplay.js";

function LibraryTagChoices({ view }) {
  const { state, busy, disabled, actions } = view;
  if (busy) {
    return <p role="status">Loading tags…</p>;
  }
  if (!state.error && state.tagChoices.length === 0) {
    return (
      <ArchiveEmpty icon="tags" title="No matching tags">
        Change this tag search or manage tags.
      </ArchiveEmpty>
    );
  }

  return (
    <ul className="inbox-list library-tag-choices">
      {state.tagChoices.map((tag) => (
        <li className="inbox-card" key={tag.tagId}>
          <h3>{tag.name}</h3>
          <p>
            {tag.memberCount} tagged memories · Created{" "}
            {memoryTime(tag.createdAt)}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.selectTag(tag)}
          >
            Use this tag
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryTagChooser({ view }) {
  const {
    disabled,
    tagQuery,
    setTagQuery,
    handlers,
  } = view;

  return (
    <ArchivePanel
      title="Choose one tag for your search"
      actions={
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={handlers.cancelTagSelection}
        >
          Cancel tag filter selection
        </button>
      }
    >
      <form
        className="library-tag-search"
        onSubmit={handlers.searchTags}
      >
        <div>
          <label htmlFor="library-tag-query">Search tag names</label>
          <input
            id="library-tag-query"
            type="search"
            maxLength={200}
            value={tagQuery}
            disabled={disabled}
            onChange={(event) => setTagQuery(event.target.value)}
          />
        </div>
        <button type="submit" disabled={disabled}>
          Search filter tags
        </button>
      </form>
      <LibraryTagChoices view={view} />
      <p className="guest-help">
        Choosing a tag applies the other fields you entered and starts at
        page one. Tag names may repeat; each entry is a separate tag.
      </p>
    </ArchivePanel>
  );
}
