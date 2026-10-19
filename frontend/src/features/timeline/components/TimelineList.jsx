import { ArchiveActions, ArchiveEmpty, ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import { partialDateLabel } from "../timelineFields.js";
import { getTimelineMemoryCount, TIMELINE_PRECISIONS } from "../timelineDisplay.js";

function TimelineFilters({ view }) {
  const {
    fromYear,
    setFromYear,
    toYear,
    setToYear,
    precision,
    setPrecision,
    disabled,
    handlers,
    fieldErrors,
    registerFilterField,
  } = view;
  const errors = fieldErrors?.filters ?? {};
  return (
    <ArchivePanel title="Filter your timeline">
      <form className="timeline-filters" onSubmit={handlers.filter} aria-label="Filter timeline events">
        <div className="archive-filter-grid">
          <div>
            <label htmlFor="timeline-from-year">From year (inclusive)</label>
            <input
              id="timeline-from-year"
              ref={element => registerFilterField?.("fromYear", element)}
              inputMode="numeric"
              maxLength={4}
              value={fromYear}
              disabled={disabled}
              aria-invalid={Boolean(errors.fromYear)}
              aria-describedby={errors.fromYear ? "timeline-from-year-error" : undefined}
              onChange={event => setFromYear(event.target.value)}
            />
            {errors.fromYear && (
              <p id="timeline-from-year-error" className="form-error" role="alert">
                {errors.fromYear}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="timeline-to-year">To year (inclusive)</label>
            <input
              id="timeline-to-year"
              ref={element => registerFilterField?.("toYear", element)}
              inputMode="numeric"
              maxLength={4}
              value={toYear}
              disabled={disabled}
              aria-invalid={Boolean(errors.toYear)}
              aria-describedby={errors.toYear ? "timeline-to-year-error" : undefined}
              onChange={event => setToYear(event.target.value)}
            />
            {errors.toYear && (
              <p id="timeline-to-year-error" className="form-error" role="alert">
                {errors.toYear}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="timeline-filter-precision">Date precision</label>
            <select
              id="timeline-filter-precision"
              ref={element => registerFilterField?.("datePrecision", element)}
              value={precision}
              disabled={disabled}
              aria-invalid={Boolean(errors.datePrecision)}
              aria-describedby={errors.datePrecision ? "timeline-filter-precision-error" : undefined}
              onChange={event => setPrecision(event.target.value)}
            >
              <option value="ALL">All precisions</option>
              {Object.entries(TIMELINE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {errors.datePrecision && (
              <p id="timeline-filter-precision-error" className="form-error" role="alert">
                {errors.datePrecision}
              </p>
            )}
          </div>
        </div>
        <ArchiveActions>
          <button type="submit" disabled={disabled}>Apply timeline filters</button>
          <button className="button-secondary" type="button" disabled={disabled} onClick={handlers.clearFilters}>Clear timeline filters</button>
        </ArchiveActions>
        <p className="guest-help">Oldest first. Unknown dates appear separately after dated events. A year range excludes unknown dates.</p>
      </form>
    </ArchivePanel>
  );
}

function TimelineEvents({ state, busy, disabled, actions }) {
  if (busy) return <p role="status">Loading timeline events…</p>;
  if (!state.error && state.items.length === 0) return <ArchiveEmpty title="No events on this timeline page" icon="timeline"><p>Create a milestone or adjust your filters.</p></ArchiveEmpty>;
  return (
    <ol className="inbox-list timeline-events">
      {state.items.map((event, index) => <li key={event.eventId} className="inbox-card timeline-event">
        {event.datePrecision === "UNKNOWN" && (index === 0 || state.items[index - 1].datePrecision !== "UNKNOWN") && <h2>Events with unknown dates</h2>}
        <h3>{event.title}</h3>
        <p>Event date: {partialDateLabel(event.eventDate, event.datePrecision)}</p>
        {event.description && <p className="inbox-excerpt">{event.description}</p>}
        <p>{event.memberCount} linked {getTimelineMemoryCount(event.memberCount)} · Couple only</p>
        <button type="button" disabled={disabled} onClick={() => actions.open(event.eventId)} aria-label={`Open timeline event ${event.title}`}>Open event</button>
      </li>)}
    </ol>
  );
}

export default function TimelineList({ view }) {
  return (
    <>
      <TimelineFilters view={view} />
      <TimelineEvents state={view.state} busy={view.busy} disabled={view.disabled} actions={view.actions} />
    </>
  );
}
