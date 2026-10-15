import { useEffect, useRef, useState } from "react";
import { normalizeLibraryFilters, normalizeLibraryQuery } from "../libraryFilters.js";
import { partialDateLabel } from "../../timeline/timelineFields.js";
import { memoryTime } from "../../inbox/memoryDisplay.js";
import { ArchiveActions, ArchiveEmpty, ArchiveIntro, ArchivePagination, ArchivePanel, ArchiveScreen } from "../../inbox/components/ArchiveLayout.jsx";
import "../library.css";

const TYPES = { ALL: "All memory types", TEXT: "Written notes", PHOTO: "Photos", AUDIO: "Voice memories" };
const STATUSES = { ALL: "All active review states", PENDING: "Pending", KEEP: "Kept", ARCHIVED: "Archived" };
const PRECISIONS = { ALL: "All date precisions", UNKNOWN: "Unknown", YEAR: "Year only", MONTH: "Month and year", DAY: "Exact day" };
export default function Library({ state, busy, locked, actions }) {
  const [q, setQ] = useState(state.filters.q), [type, setType] = useState(state.filters.memoryType), [status, setStatus] = useState(state.filters.reviewStatus);
  const [precision, setPrecision] = useState(state.filters.datePrecision), [fromYear, setFromYear] = useState(state.filters.fromYear?.toString() ?? ""), [toYear, setToYear] = useState(state.filters.toYear?.toString() ?? "");
  const [tagQuery, setTagQuery] = useState(state.tagQuery), [error, setError] = useState(null); const feedback = useRef(null);
  const disabled = busy || locked, choosing = state.view === "chooseTag";
  useEffect(() => { if (error || state.error) feedback.current?.focus(); }, [error, state.error]);
  function filters() {
    if ([fromYear, toYear].some(value => value && !/^\d{1,4}$/.test(value))) throw new TypeError("Use years between 1 and 9999.");
    return normalizeLibraryFilters({ q, memoryType: type, reviewStatus: status, datePrecision: precision, fromYear: fromYear ? Number(fromYear) : null,
      toYear: toYear ? Number(toYear) : null, tagId: state.filters.tagId });
  }
  function apply(event) { event.preventDefault(); try { setError(null); void actions.list(filters()); } catch (failure) { setError(failure.message); } }
  function choose() { try { setError(null); void actions.choose(filters()); } catch (failure) { setError(failure.message); } }
  function searchTags(event) { event.preventDefault(); try { setError(null); void actions.choose(state.draftFilters, normalizeLibraryQuery(tagQuery)); } catch (failure) { setError(failure.message); } }
  const cursors = choosing ? state.tagCursors : state.cursors, nextCursor = choosing ? state.tagNextCursor : state.nextCursor;
  return <ArchiveScreen className="library" label="Private memory library" busy={busy}>
    <ArchiveIntro actions={<><button className="button-secondary" type="button" disabled={disabled} onClick={actions.inbox}>Back to inbox</button>
      <button className="button-secondary" type="button" disabled={disabled} onClick={actions.tags}>Manage tags</button></>}>
      <p>Find a note, photo or voice memory in your archive. Searching and tagging preserve original content, files and each memory’s sharing choice.</p>
    </ArchiveIntro>
    {(error || state.error) && <p ref={feedback} tabIndex={-1} className="form-error" role="alert">{error ?? state.error}</p>}
    {!choosing && <>
      <ArchivePanel title="Find a memory" description="Use any combination of the fields below to narrow your search.">
      <form className="library-filters archive-filter-grid" onSubmit={apply} aria-label="Search private memories">
        <div className="archive-field-wide"><label htmlFor="library-query">Search text</label><input id="library-query" type="search" maxLength={200} value={q} disabled={disabled} onChange={event => setQ(event.target.value)} />
          <p className="guest-help">Literal words or characters in titles, descriptions, notes, captions, guest names and original filenames. Photo contents and audio are not searched.</p></div>
        <div><label htmlFor="library-type">Memory type</label><select id="library-type" value={type} disabled={disabled} onChange={event => setType(event.target.value)}>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor="library-review">Review status</label><select id="library-review" value={status} disabled={disabled} onChange={event => setStatus(event.target.value)}>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor="library-precision">Memory date precision</label><select id="library-precision" value={precision} disabled={disabled} onChange={event => setPrecision(event.target.value)}>{Object.entries(PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor="library-from-year">Memory date from year (inclusive)</label><input id="library-from-year" inputMode="numeric" maxLength={4} value={fromYear} disabled={disabled} onChange={event => setFromYear(event.target.value)} /></div>
        <div><label htmlFor="library-to-year">Memory date to year (inclusive)</label><input id="library-to-year" inputMode="numeric" maxLength={4} value={toYear} disabled={disabled} onChange={event => setToYear(event.target.value)} /></div>
        <div className="library-tag-filter archive-field-wide"><p>Tag filter: <strong>{state.tagName ?? "All tags"}</strong></p><ArchiveActions><button className="button-secondary" type="button" disabled={disabled} onClick={choose}>Choose tag filter</button>
          {state.filters.tagId && <button className="button-secondary" type="button" disabled={disabled} onClick={() => { try { setError(null); void actions.list({ ...filters(), tagId: null }); } catch (failure) { setError(failure.message); } }}>Clear tag filter</button>}</ArchiveActions></div>
        <p className="guest-help archive-field-wide">Filters combine. Year bounds use Memory date and exclude unknown dates; they do not use Saved on.</p>
        <ArchiveActions className="archive-field-wide"><button type="submit" disabled={disabled}>Apply library filters</button><button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.list(normalizeLibraryFilters())}>Reset library search</button></ArchiveActions>
      </form>
      </ArchivePanel>
      <ArchivePanel title="Search results" description="Your newest saved memories appear first.">
      {busy ? <p role="status">Loading library…</p> : !state.error && !state.items.length ? <ArchiveEmpty icon="library" title="No matching memories">Change your filters or reset the search.</ArchiveEmpty>
        : <ul className="inbox-list library-results">{state.items.map(memory => <li key={memory.memoryId} className="inbox-card library-result">
          <h3>{memory.title ?? (memory.source === "COUPLE" ? "Couple memory" : `From ${memory.guestName ?? "Name not provided"}`)}</h3>
          <p className="library-result-meta">{TYPES[memory.memoryType]} · {STATUSES[memory.reviewStatus]} · {memory.source === "COUPLE" ? "Couple memory" : `Guest contribution · From ${memory.guestName ?? "Name not provided"}`}</p>
          <p className="library-result-date">Memory date: {partialDateLabel(memory.memoryDate, memory.datePrecision)}</p><p className="library-result-date">Saved on: <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time> · Eastern</p>
          <p className="inbox-excerpt">{memory.memoryType === "TEXT" ? memory.textContent.slice(0, 180) : memory.caption ?? memory.media.originalFilename}</p>
          <button type="button" disabled={disabled} onClick={() => actions.open(memory.memoryId)}>Open memory</button></li>)}</ul>}
      </ArchivePanel>
    </>}
    {choosing && <ArchivePanel title="Choose one tag for your search" actions={<button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.list(state.filters, state.cursors.at(-1), state.cursors)}>Cancel tag filter selection</button>}>
      <form className="library-tag-search" onSubmit={searchTags}><div><label htmlFor="library-tag-query">Search tag names</label><input id="library-tag-query" type="search" maxLength={200} value={tagQuery} disabled={disabled} onChange={event => setTagQuery(event.target.value)} /></div><button type="submit" disabled={disabled}>Search filter tags</button></form>
      {busy ? <p role="status">Loading tags…</p> : !state.error && !state.tagChoices.length ? <ArchiveEmpty icon="tags" title="No matching tags">Change this tag search or manage tags.</ArchiveEmpty>
        : <ul className="inbox-list library-tag-choices">{state.tagChoices.map(tag => <li className="inbox-card" key={tag.tagId}><h3>{tag.name}</h3><p>{tag.memberCount} tagged memories · Created {memoryTime(tag.createdAt)}</p>
          <button type="button" disabled={disabled} onClick={() => actions.selectTag(tag)}>Use this tag</button></li>)}</ul>}
      <p className="guest-help">Choosing a tag applies the other fields you entered and starts at page one. Tag names may repeat; each entry is a separate tag.</p></ArchivePanel>}
    {state.error && <button type="button" disabled={disabled} onClick={() => choosing ? actions.choose(state.draftFilters, state.tagQuery) : actions.list(state.filters)}>Load library first page</button>}
    <ArchivePagination previousLabel="Previous library page" nextLabel="Next library page" page={cursors.length}
      disabled={disabled || Boolean(state.error)} canPrevious={cursors.length > 1} canNext={Boolean(nextCursor)} onPrevious={() => actions.page(false)} onNext={() => actions.page(true)} />
  </ArchiveScreen>;
}
