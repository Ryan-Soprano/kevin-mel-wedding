import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  LIBRARY_MEMORY_TYPES,
  LIBRARY_REVIEW_STATUSES,
  LIBRARY_DATE_PRECISIONS,
} from "../libraryDisplay.js";

export default function LibraryFilters({ view }) {
  const {
    state,
    disabled,
    q,
    setQ,
    type,
    setType,
    status,
    setStatus,
    precision,
    setPrecision,
    fromYear,
    setFromYear,
    toYear,
    setToYear,
    handlers,
  } = view;

  return (
    <ArchivePanel
      title="Find a memory"
      description="Use any combination of the fields below to narrow your search."
    >
      <form
        className="library-filters archive-filter-grid"
        onSubmit={handlers.apply}
        aria-label="Search private memories"
      >
        <div className="archive-field-wide">
          <label htmlFor="library-query">Search text</label>
          <input
            id="library-query"
            type="search"
            maxLength={200}
            value={q}
            disabled={disabled}
            onChange={(event) => setQ(event.target.value)}
          />
          <p className="guest-help">
            Literal words or characters in titles, descriptions, notes,
            captions, guest names and original filenames. Photo contents and
            audio are not searched.
          </p>
        </div>
        <div>
          <label htmlFor="library-type">Memory type</label>
          <select
            id="library-type"
            value={type}
            disabled={disabled}
            onChange={(event) => setType(event.target.value)}
          >
            {Object.entries(LIBRARY_MEMORY_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="library-review">Review status</label>
          <select
            id="library-review"
            value={status}
            disabled={disabled}
            onChange={(event) => setStatus(event.target.value)}
          >
            {Object.entries(LIBRARY_REVIEW_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="library-precision">Memory date precision</label>
          <select
            id="library-precision"
            value={precision}
            disabled={disabled}
            onChange={(event) => setPrecision(event.target.value)}
          >
            {Object.entries(LIBRARY_DATE_PRECISIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="library-from-year">
            Memory date from year (inclusive)
          </label>
          <input
            id="library-from-year"
            inputMode="numeric"
            maxLength={4}
            value={fromYear}
            disabled={disabled}
            onChange={(event) => setFromYear(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="library-to-year">
            Memory date to year (inclusive)
          </label>
          <input
            id="library-to-year"
            inputMode="numeric"
            maxLength={4}
            value={toYear}
            disabled={disabled}
            onChange={(event) => setToYear(event.target.value)}
          />
        </div>
        <div className="library-tag-filter archive-field-wide">
          <p>
            Tag filter: <strong>{state.tagName ?? "All tags"}</strong>
          </p>
          <ArchiveActions>
            <button
              className="button-secondary"
              type="button"
              disabled={disabled}
              onClick={handlers.choose}
            >
              Choose tag filter
            </button>
            {state.filters.tagId && (
              <button
                className="button-secondary"
                type="button"
                disabled={disabled}
                onClick={handlers.clearTag}
              >
                Clear tag filter
              </button>
            )}
          </ArchiveActions>
        </div>
        <p className="guest-help archive-field-wide">
          Filters combine. Year bounds use Memory date and exclude unknown
          dates; they do not use Saved on.
        </p>
        <ArchiveActions className="archive-field-wide">
          <button type="submit" disabled={disabled}>
            Apply library filters
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={disabled}
            onClick={handlers.resetSearch}
          >
            Reset library search
          </button>
        </ArchiveActions>
      </form>
    </ArchivePanel>
  );
}
