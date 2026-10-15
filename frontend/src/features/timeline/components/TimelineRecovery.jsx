import { ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import { getTimelineProgressLabel, getTimelineReloadLabel } from "../timelineDisplay.js";
import TimelineEventFields from "./TimelineEventFields.jsx";

function TimelineRecoveryActions({ view }) {
  const { state, busy, actions, retryFields, setRetryFields, handlers } = view;
  if (!["uncertain", "conflict", "csrf"].includes(state.mutation.phase)) return null;
  return (
    <>
      <button type="button" disabled={busy} onClick={() => actions.reload(state.mutation.phase === "csrf")}>{getTimelineReloadLabel(state.mutation.phase)}</button>
      {state.mutation.canRetry && <>
        {state.mutation.needsFields && <>
          <p>The hidden edit was cleared. Re-enter the same four original event fields to retry that change.</p>
          <TimelineEventFields fields={retryFields} setFields={setRetryFields} disabled={busy} prefix="timeline-retry" />
        </>}
        <button className="button-secondary" type="button" disabled={busy} onClick={handlers.retry}>Retry this same timeline change</button>
      </>}
    </>
  );
}

export default function TimelineRecovery({ view }) {
  if (!view.locked) return null;
  const progress = getTimelineProgressLabel(view.state.mutation.phase);
  return (
    <ArchivePanel className="timeline-recovery" title="Timeline change">
      <p>Keep this page open while the change is pending or unconfirmed. Other changes, navigation and sign-out are paused.</p>
      {progress && <p role="status">{progress}</p>}
      <TimelineRecoveryActions view={view} />
    </ArchivePanel>
  );
}
