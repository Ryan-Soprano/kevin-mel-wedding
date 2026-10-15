import { ArchiveIntro, ArchiveScreen } from "../../inbox/components/ArchiveLayout.jsx";
import { useTimeline } from "../hooks/useTimeline.js";
import { getTimelineFeedback } from "../timelineDisplay.js";
import TimelineList from "./TimelineList.jsx";
import TimelineEditor from "./TimelineEditor.jsx";
import TimelineDetail from "./TimelineDetail.jsx";
import TimelineSelector from "./TimelineSelector.jsx";
import TimelineRecovery from "./TimelineRecovery.jsx";
import TimelinePaging from "./TimelinePaging.jsx";
import "../timeline.css";

function TimelineContent({ view, cancelDelete, deleteTrigger }) {
  switch (view.state.view) {
    case "list":
      return <TimelineList view={view} />;
    case "create":
      return <TimelineEditor fields={view.fields} setFields={view.setFields} disabled={view.disabled} onSubmit={view.handlers.save} create />;
    case "detail":
      return <TimelineDetail view={view} cancelDelete={cancelDelete} deleteTrigger={deleteTrigger} />;
    case "select":
      return <TimelineSelector view={view} />;
    default:
      return null;
  }
}

export default function Timeline({ state, busy, locked, actions }) {
  const { view, feedback, cancelDelete, deleteTrigger } = useTimeline({ state, busy, locked, actions });
  const notice = getTimelineFeedback(view.error, state);
  return (
    <ArchiveScreen className="timeline" label="Private life timeline" busy={busy}>
      <ArchiveIntro actions={<>
        <button className="button-secondary" type="button" disabled={view.disabled} onClick={actions.inbox}>Back to inbox</button>
        {state.view !== "list" && <button className="button-secondary" type="button" disabled={view.disabled} onClick={() => actions.list()}>All timeline events</button>}
        {state.view === "list" && <button type="button" disabled={view.disabled} onClick={actions.beginCreate}>Create a timeline event</button>}
      </>}>
        <p>Your private life events and milestones. Link existing memories without changing their original content, files or memory dates. Nothing here is published.</p>
      </ArchiveIntro>
      {notice.visible && <p ref={feedback} tabIndex={-1} className={notice.className} role={notice.role}>{notice.text}</p>}
      <TimelineRecovery view={view} />
      <TimelineContent view={view} cancelDelete={cancelDelete} deleteTrigger={deleteTrigger} />
      <TimelinePaging view={view} />
    </ArchiveScreen>
  );
}
