import { useEffect, useRef, useState } from "react";
import { emptyEventFields, eventFields, normalizeEventFields, normalizeTimelineFilters, partialDateLabel } from "../timelineFields.js";
import { memoryTime } from "../../inbox/memoryDisplay.js";
import { ArchiveActions, ArchiveEmpty, ArchiveIntro, ArchivePagination, ArchivePanel, ArchiveScreen } from "../../inbox/components/ArchiveLayout.jsx";
import "../timeline.css";

const LABELS = { KEEP: "Kept", PENDING: "Pending", ARCHIVED: "Archived" };
const TYPES = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
const heading = memory => memory.title ?? (memory.source === "COUPLE" ? "Couple memory" : `From ${memory.guestName ?? "Name not provided"}`);
const PRECISIONS = { UNKNOWN: "Unknown", YEAR: "Year only", MONTH: "Month and year", DAY: "Exact day" };

function EventFields({ fields, setFields, disabled, prefix = "timeline" }) {
  const change = (field, value) => setFields(previous => ({ ...previous, [field]: value }));
  return <div className="timeline-fields">
    <div><label htmlFor={`${prefix}-title`}>Event title</label><input id={`${prefix}-title`} value={fields.title ?? ""} maxLength={200}
      required disabled={disabled} onChange={event => change("title", event.target.value)} /></div>
    <div><label htmlFor={`${prefix}-description`}>Event description (optional)</label><textarea id={`${prefix}-description`} value={fields.description ?? ""}
      maxLength={2000} disabled={disabled} onChange={event => change("description", event.target.value || null)} /></div>
    <div><label htmlFor={`${prefix}-precision`}>Event date precision</label><select id={`${prefix}-precision`} value={fields.datePrecision} disabled={disabled}
      onChange={event => setFields(previous => ({ ...previous, datePrecision: event.target.value, eventDate: null }))}>
      {Object.entries(PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {fields.datePrecision !== "UNKNOWN" && <div><label htmlFor={`${prefix}-date`}>Event date</label><input id={`${prefix}-date`} type="text" inputMode={fields.datePrecision === "YEAR" ? "numeric" : undefined}
      value={fields.eventDate ?? ""} maxLength={fields.datePrecision === "YEAR" ? 4 : fields.datePrecision === "MONTH" ? 7 : 10} required disabled={disabled}
      placeholder={fields.datePrecision === "YEAR" ? "YYYY" : fields.datePrecision === "MONTH" ? "YYYY-MM" : "YYYY-MM-DD"}
      aria-describedby={`${prefix}-date-help`} onChange={event => change("eventDate", event.target.value || null)} />
      <p id={`${prefix}-date-help`} className="guest-help">Use {fields.datePrecision === "YEAR" ? "YYYY" : fields.datePrecision === "MONTH" ? "YYYY-MM" : "YYYY-MM-DD"}. Years 0001–9999, including future dates, are supported. Choose only the precision you know.</p></div>}
  </div>;
}
function MemorySummary({ memory }) {
  return <><h3>{heading(memory)}</h3>
    <p>{TYPES[memory.memoryType]} · {LABELS[memory.reviewStatus]} · {memory.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${memory.guestName ?? "Name not provided"}`}</p>
    <p>Memory date: {partialDateLabel(memory.memoryDate, memory.datePrecision)}</p>
    <p>Saved on: <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time> · Eastern</p>
    <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p></>;
}
export default function Timeline({ state, busy, locked, actions }) {
  const [fields, setFields] = useState(state.event?.deletedAt === null ? eventFields(state.event) : emptyEventFields());
  const [retryFields, setRetryFields] = useState(emptyEventFields());
  const [fromYear, setFromYear] = useState(state.filters.fromYear?.toString() ?? "");
  const [toYear, setToYear] = useState(state.filters.toYear?.toString() ?? "");
  const [precision, setPrecision] = useState(state.filters.datePrecision);
  const [error, setError] = useState(null), [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useRef(null), cancelDelete = useRef(null), deleteTrigger = useRef(null), restoreDeleteFocus = useRef(false);
  useEffect(() => { if (error || state.error || state.mutation.error || state.notice) feedback.current?.focus(); }, [error, state.error, state.mutation.error, state.notice]);
  const disabled = busy || locked;
  useEffect(() => {
    if (confirmDelete) cancelDelete.current?.focus();
    else if (restoreDeleteFocus.current && !disabled) { restoreDeleteFocus.current = false; deleteTrigger.current?.focus(); }
  }, [confirmDelete, disabled]);
  function save(event) {
    event.preventDefault();
    try { setError(null); const normalized = normalizeEventFields(fields); void (state.view === "create" ? actions.create(normalized) : actions.edit(normalized)); }
    catch (failure) { setError(failure.message); }
  }
  function retry() {
    try { setError(null); void actions.retry(state.mutation.needsFields ? normalizeEventFields(retryFields) : undefined); }
    catch (failure) { setError(failure.message); }
  }
  function filter(event) {
    event.preventDefault();
    try {
      if ([fromYear, toYear].some(value => value && !/^\d{1,4}$/.test(value))) throw new TypeError("Use a year between 1 and 9999.");
      const filters = normalizeTimelineFilters({ fromYear: fromYear ? Number(fromYear) : null, toYear: toYear ? Number(toYear) : null, datePrecision: precision });
      setError(null); void actions.list(filters);
    } catch (failure) { setError(failure.message); }
  }
  return <ArchiveScreen className="timeline" label="Private life timeline" busy={busy}>
    <ArchiveIntro actions={<><button className="button-secondary" type="button" disabled={disabled} onClick={actions.inbox}>Back to inbox</button>
      {state.view !== "list" && <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.list()}>All timeline events</button>}
      {state.view === "list" && <button type="button" disabled={disabled} onClick={actions.beginCreate}>Create a timeline event</button>}
    </>}><p>Your private life events and milestones. Link existing memories without changing their original content, files or memory dates. Nothing here is published.</p></ArchiveIntro>
    {(error || state.error || state.mutation.error || state.notice) && <p ref={feedback} tabIndex={-1} className={error || state.error || state.mutation.error ? "form-error" : "inbox-review-notice"}
      role={error || state.error || state.mutation.error ? "alert" : "status"}>{error ?? state.error ?? state.mutation.error ?? state.notice}</p>}
    {locked && <ArchivePanel className="timeline-recovery" title="Timeline change"><p>Keep this page open while the change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
      {["saving", "loading"].includes(state.mutation.phase) && <p role="status">{state.mutation.phase === "saving" ? "Saving timeline change…" : "Checking current event…"}</p>}
      {["uncertain", "conflict", "csrf"].includes(state.mutation.phase) && <>
        <button type="button" disabled={busy} onClick={() => actions.reload(state.mutation.phase === "csrf")}>{state.mutation.phase === "csrf" ? "Refresh session and current event" : "Reload current event"}</button>
        {state.mutation.canRetry && <>{state.mutation.needsFields && <><p>The hidden edit was cleared. Re-enter the same four original event fields to retry that change.</p>
          <EventFields fields={retryFields} setFields={setRetryFields} disabled={busy} prefix="timeline-retry" /></>}
          <button className="button-secondary" type="button" disabled={busy} onClick={retry}>Retry this same timeline change</button></>}
      </>}
    </ArchivePanel>}
    {state.view === "list" && <>
      <ArchivePanel title="Filter your timeline">
      <form className="timeline-filters" onSubmit={filter} aria-label="Filter timeline events">
        <div className="archive-filter-grid">
        <div><label htmlFor="timeline-from-year">From year (inclusive)</label><input id="timeline-from-year" inputMode="numeric" maxLength={4} value={fromYear} disabled={disabled} onChange={event => setFromYear(event.target.value)} /></div>
        <div><label htmlFor="timeline-to-year">To year (inclusive)</label><input id="timeline-to-year" inputMode="numeric" maxLength={4} value={toYear} disabled={disabled} onChange={event => setToYear(event.target.value)} /></div>
        <div><label htmlFor="timeline-filter-precision">Date precision</label><select id="timeline-filter-precision" value={precision} disabled={disabled} onChange={event => setPrecision(event.target.value)}>
          <option value="ALL">All precisions</option>{Object.entries(PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        </div>
        <ArchiveActions><button type="submit" disabled={disabled}>Apply timeline filters</button><button className="button-secondary" type="button" disabled={disabled}
          onClick={() => { setFromYear(""); setToYear(""); setPrecision("ALL"); setError(null); void actions.list(normalizeTimelineFilters()); }}>Clear timeline filters</button></ArchiveActions>
        <p className="guest-help">Oldest first. Unknown dates appear separately after dated events. A year range excludes unknown dates.</p>
      </form>
      </ArchivePanel>
      {busy ? <p role="status">Loading timeline events…</p> : !state.error && state.items.length === 0 ? <ArchiveEmpty title="No events on this timeline page" icon="timeline"><p>Create a milestone or adjust your filters.</p></ArchiveEmpty>
        : <ol className="inbox-list timeline-events">{state.items.map((event, index) => <li key={event.eventId} className="inbox-card timeline-event">
          {event.datePrecision === "UNKNOWN" && (index === 0 || state.items[index - 1].datePrecision !== "UNKNOWN") && <h2>Events with unknown dates</h2>}
          <h3>{event.title}</h3><p>Event date: {partialDateLabel(event.eventDate, event.datePrecision)}</p>
          {event.description && <p className="inbox-excerpt">{event.description}</p>}<p>{event.memberCount} linked {event.memberCount === 1 ? "memory" : "memories"} · Couple only</p>
          <button type="button" disabled={disabled} onClick={() => actions.open(event.eventId)} aria-label={`Open timeline event ${event.title}`}>Open event</button>
        </li>)}</ol>}
    </>}
    {state.view === "create" && <ArchivePanel title="Create an event or milestone"><form className="timeline-event-form" onSubmit={save} aria-label="Create a private timeline event">
      <EventFields fields={fields} setFields={setFields} disabled={disabled} /><ArchiveActions><button type="submit" disabled={disabled}>Create event</button></ArchiveActions></form></ArchivePanel>}
    {state.view === "detail" && state.event && (state.event.deletedAt !== null ? <ArchiveEmpty title="Deleted timeline event" icon="timeline">
      <p>This event was deleted. Its links were removed; the memories and original files remain in your archive. Events do not have a restore action.</p></ArchiveEmpty>
      : <><ArchivePanel title={state.event.title} description={<><p>Event date: {partialDateLabel(state.event.eventDate, state.event.datePrecision)}</p>
        {state.event.description && <p className="inbox-note">{state.event.description}</p>}<p>{state.event.memberCount} linked {state.event.memberCount === 1 ? "memory" : "memories"} · Couple only</p></>}>
        <form className="timeline-event-form" onSubmit={save} aria-label="Edit this timeline event"><EventFields fields={fields} setFields={setFields} disabled={disabled} /><ArchiveActions><button type="submit" disabled={disabled}>Save event details</button></ArchiveActions></form>
        <ArchiveActions><button type="button" disabled={disabled} onClick={() => actions.select("KEEP")}>Link memories</button>
          <button ref={deleteTrigger} className="button-secondary" type="button" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete event…</button></ArchiveActions>
        </ArchivePanel>
        {confirmDelete && <div className="timeline-delete-confirmation" role="group" aria-labelledby="timeline-delete-heading"><h3 id="timeline-delete-heading">Delete this timeline event?</h3>
          <p>Its title, description, date and links will be removed. Linked memories and originals remain in your archive. This event cannot be restored.</p>
          <ArchiveActions><button ref={cancelDelete} className="button-secondary" type="button" disabled={disabled} onClick={() => { restoreDeleteFocus.current = true; setConfirmDelete(false); }}>Cancel event deletion</button>
            <button type="button" disabled={disabled} onClick={() => { setConfirmDelete(false); void actions.delete(); }}>Delete this event</button></ArchiveActions></div>}
        <h3>Linked memories</h3>
        {busy ? <p role="status">Loading linked memories…</p> : !state.error && !state.members.length ? <ArchiveEmpty title="No linked memories on this page" icon="timeline"><p>Link an existing note, photo or voice memory.</p></ArchiveEmpty>
          : <ul className="inbox-list timeline-members">{state.members.map(({ memory }) => <li key={memory.memoryId} className="inbox-card timeline-member"><MemorySummary memory={memory} />
            <ArchiveActions><button type="button" disabled={disabled} onClick={() => actions.openMemory(memory.memoryId)} aria-label={`Open ${heading(memory)} from timeline`}>Open memory</button>
              <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.unlink(memory.memoryId)} aria-label={`Unlink ${heading(memory)} from event`}>Unlink from event</button></ArchiveActions></li>)}</ul>}
        <p className="guest-help">Unlinking preserves the memory. Deleting a memory removes it from every album and timeline event. Restore returns it to the inbox; re-link it yourself.</p>
      </>)}
    {state.view === "select" && state.event && <><ArchivePanel title={<>Link memories to {state.event.title}</>} actions={<button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.open(state.event.eventId)}>Back to event</button>}>
      <nav className="inbox-filters" aria-label="Available timeline memory review status">{Object.entries(LABELS).map(([status, label]) => <button key={status} className="button-secondary" type="button" disabled={disabled}
        aria-pressed={state.selectorStatus === status} onClick={() => actions.select(status)}>{label}</button>)}</nav>
      </ArchivePanel>
      {busy ? <p role="status">Loading available memories…</p> : !state.error && !state.candidates.length ? <ArchiveEmpty title="No memories on this page" icon="timeline"><p>No completed {LABELS[state.selectorStatus].toLowerCase()} memories on this page.</p></ArchiveEmpty>
        : <ul className="inbox-list timeline-candidates">{state.candidates.map(memory => <li key={memory.memoryId} className="inbox-card"><MemorySummary memory={memory} />
          <button type="button" disabled={disabled} onClick={() => actions.link(memory.memoryId)} aria-label={`Link ${heading(memory)} to event`}>Link to event</button></li>)}</ul>}
      <p className="guest-help">Completed memories can link to several events and albums. Linking an existing member keeps one link.</p></>}
    {state.error && <button type="button" disabled={disabled} onClick={() => state.view === "list" ? actions.list() : state.requestedId ? actions.open(state.requestedId) : actions.list()}>Reload timeline first page</button>}
    {["list", "detail", "select"].includes(state.view) && !state.event?.deletedAt && <ArchivePagination previousLabel="Previous timeline page" nextLabel="Next timeline page"
      page={state.cursors.length} disabled={disabled || Boolean(state.error)} canPrevious={state.cursors.length >= 2} canNext={Boolean(state.nextCursor)}
      onPrevious={() => actions.page(false)} onNext={() => actions.page(true)} />}
  </ArchiveScreen>;
}
