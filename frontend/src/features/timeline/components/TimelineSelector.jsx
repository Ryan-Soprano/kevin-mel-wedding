import { ArchiveEmpty, ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import { getTimelineMemoryHeading, TIMELINE_REVIEW_LABELS } from "../timelineDisplay.js";
import TimelineMemorySummary from "./TimelineMemorySummary.jsx";

function TimelineCandidates({ state, busy, disabled, actions }) {
  if (busy) return <p role="status">Loading available memories…</p>;
  if (!state.error && !state.candidates.length) return <ArchiveEmpty title="No memories on this page" icon="timeline"><p>No completed {TIMELINE_REVIEW_LABELS[state.selectorStatus].toLowerCase()} memories on this page.</p></ArchiveEmpty>;
  return (
    <ul className="inbox-list timeline-candidates">
      {state.candidates.map(memory => <li key={memory.memoryId} className="inbox-card">
        <TimelineMemorySummary memory={memory} />
        <button type="button" disabled={disabled} onClick={() => actions.link(memory.memoryId)} aria-label={`Link ${getTimelineMemoryHeading(memory)} to event`}>Link to event</button>
      </li>)}
    </ul>
  );
}

export default function TimelineSelector({ view }) {
  const { state, busy, disabled, actions } = view;
  if (!state.event) return null;
  return (
    <>
      <ArchivePanel title={<>Link memories to {state.event.title}</>} actions={<button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.open(state.event.eventId)}>Back to event</button>}>
        <nav className="inbox-filters" aria-label="Available timeline memory review status">
          {Object.entries(TIMELINE_REVIEW_LABELS).map(([status, label]) => <button key={status} className="button-secondary" type="button" disabled={disabled}
            aria-pressed={state.selectorStatus === status} onClick={() => actions.select(status)}>{label}</button>)}
        </nav>
      </ArchivePanel>
      <TimelineCandidates state={state} busy={busy} disabled={disabled} actions={actions} />
      <p className="guest-help">Completed memories can link to several events and albums. Linking an existing member keeps one link.</p>
    </>
  );
}
