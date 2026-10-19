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
    fieldErrors,
    registerField,
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
            ref={element => registerField("q", element)}
            type="search"
            maxLength={200}
            value={q}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.q)}
            aria-describedby={
              fieldErrors.q ? "library-query-error" : undefined
            }
            onChange={(event) => setQ(event.target.value)}
          />
          {fieldErrors.q && (
            <p id="library-query-error" className="form-error" role="alert">
              {fieldErrors.q}
            </p>
          )}
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
            ref={element => registerField("memoryType", element)}
            value={type}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.memoryType)}
            aria-describedby={
              fieldErrors.memoryType ? "library-type-error" : undefined
            }
            onChange={(event) => setType(event.target.value)}
          >
            {Object.entries(LIBRARY_MEMORY_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {fieldErrors.memoryType && (
            <p id="library-type-error" className="form-error" role="alert">
              {fieldErrors.memoryType}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="library-review">Review status</label>
          <select
            id="library-review"
            ref={element => registerField("reviewStatus", element)}
            value={status}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.reviewStatus)}
            aria-describedby={
              fieldErrors.reviewStatus ? "library-review-error" : undefined
            }
            onChange={(event) => setStatus(event.target.value)}
          >
            {Object.entries(LIBRARY_REVIEW_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {fieldErrors.reviewStatus && (
            <p id="library-review-error" className="form-error" role="alert">
              {fieldErrors.reviewStatus}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="library-precision">Memory date precision</label>
          <select
            id="library-precision"
            ref={element => registerField("datePrecision", element)}
            value={precision}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.datePrecision)}
            aria-describedby={
              fieldErrors.datePrecision ? "library-precision-error" : undefined
            }
            onChange={(event) => setPrecision(event.target.value)}
          >
            {Object.entries(LIBRARY_DATE_PRECISIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {fieldErrors.datePrecision && (
            <p id="library-precision-error" className="form-error" role="alert">
              {fieldErrors.datePrecision}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="library-from-year">
            Memory date from year (inclusive)
          </label>
          <input
            id="library-from-year"
            ref={element => registerField("fromYear", element)}
            inputMode="numeric"
            maxLength={4}
            value={fromYear}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.fromYear)}
            aria-describedby={
              fieldErrors.fromYear ? "library-from-year-error" : undefined
            }
            onChange={(event) => setFromYear(event.target.value)}
          />
          {fieldErrors.fromYear && (
            <p id="library-from-year-error" className="form-error" role="alert">
              {fieldErrors.fromYear}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="library-to-year">
            Memory date to year (inclusive)
          </label>
          <input
            id="library-to-year"
            ref={element => registerField("toYear", element)}
            inputMode="numeric"
            maxLength={4}
            value={toYear}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors.toYear)}
            aria-describedby={
              fieldErrors.toYear ? "library-to-year-error" : undefined
            }
            onChange={(event) => setToYear(event.target.value)}
          />
          {fieldErrors.toYear && (
            <p id="library-to-year-error" className="form-error" role="alert">
              {fieldErrors.toYear}
            </p>
          )}
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
