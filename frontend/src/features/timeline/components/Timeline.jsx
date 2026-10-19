import {
  ArchiveIntro,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  useTimeline,
  useTimelinePagingFocus,
} from "../hooks/useTimeline.js";
import {
  getTimelineFeedback,
  TIMELINE_REVIEW_LABELS,
} from "../timelineDisplay.js";
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
      return (
        <TimelineEditor
          fields={view.fields}
          onChange={view.handlers.changeFields}
          disabled={view.disabled}
          onSubmit={view.handlers.save}
          errors={view.fieldErrors.editor}
          onFieldRef={view.registerEditorField}
          create
        />
      );
    case "detail":
      return <TimelineDetail view={view} cancelDelete={cancelDelete} deleteTrigger={deleteTrigger} />;
    case "select":
      return <TimelineSelector view={view} />;
    default:
      return null;
  }
}

export default function Timeline({ state, busy, locked, actions, editorKey }) {
  const pagingFocus = useTimelinePagingFocus({ state, busy, locked });
  return (
    <TimelineScreen
      key={editorKey}
      state={state}
      busy={busy}
      locked={locked}
      actions={actions}
      pagingFocus={pagingFocus}
    />
  );
}

function TimelineScreen({ state, busy, locked, actions, pagingFocus }) {
  const {
    view,
    feedback,
    cancelDelete,
    deleteTrigger,
    pageStatus,
  } = useTimeline({
    state,
    busy,
    locked,
    actions,
    pagingFocus,
  });
  const notice = getTimelineFeedback(view.error, state);
  let pageLabel = "Timeline events";
  if (state.view === "detail") {
    pageLabel = "Linked timeline memories";
  } else if (state.view === "select") {
    pageLabel = `Available ${TIMELINE_REVIEW_LABELS[state.selectorStatus].toLowerCase()} memories`;
  }
  return (
    <ArchiveScreen className="timeline" label="Private life timeline" busy={busy}>
      <ArchiveIntro
        actions={
          <>
            <button
              className="button-secondary"
              type="button"
              disabled={view.disabled}
              onClick={view.actions.inbox}
            >
              Back to inbox
            </button>
            {state.view !== "list" && (
              <button
                className="button-secondary"
                type="button"
                disabled={view.disabled}
                onClick={() => view.actions.list()}
              >
                All timeline events
              </button>
            )}
            {state.view === "list" && (
              <button
                type="button"
                disabled={view.disabled}
                onClick={view.actions.beginCreate}
              >
                Create a timeline event
              </button>
            )}
          </>
        }
      >
        <p>Your private life events and milestones. Link existing memories without changing their original content, files or memory dates. Nothing here is published.</p>
      </ArchiveIntro>
      {["list", "detail", "select"].includes(state.view) && (
        <h2
          ref={pageStatus}
          tabIndex={-1}
          className="visually-hidden"
        >
          {pageLabel} · Page {state.cursors.length}{state.error ? " could not be loaded" : ""}
        </h2>
      )}
      {notice.visible && <p ref={feedback} tabIndex={-1} className={notice.className} role={notice.role}>{notice.text}</p>}
      <TimelineRecovery view={view} />
      <TimelineContent view={view} cancelDelete={cancelDelete} deleteTrigger={deleteTrigger} />
      <TimelinePaging view={view} />
    </ArchiveScreen>
  );
}
