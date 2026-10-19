import {
  ArchiveActions,
  ArchiveIntro,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import { useExportArchive } from "../hooks/useExportArchive.js";
import {
  getExportFeedback,
  getExportStartLabel,
} from "../exportDisplay.js";
import ExportGuide from "./ExportGuide.jsx";
import ExportRecovery from "./ExportRecovery.jsx";
import ExportStatus from "./ExportStatus.jsx";
import ExportParts from "./ExportParts.jsx";
import ExportPreparedPart from "./ExportPreparedPart.jsx";
import ExportIssues from "./ExportIssues.jsx";
import "../export.css";

export default function ExportArchive({ state, busy, locked, actions }) {
  const {
    view,
    feedback,
    cancelTrigger,
    cancelButton,
    statusTarget,
    partsTarget,
    issuesTarget,
  } = useExportArchive({
    state,
    busy,
    locked,
    actions,
  });
  const notice = getExportFeedback(state);
  const showStartAction = (
    !view.job || view.terminal || state.unavailable
  ) && !locked;

  return (
    <ArchiveScreen
      className="archive-export"
      label="Private portable archive export"
      busy={busy}
    >
      <ArchiveIntro
        actions={
          <button
            className="button-secondary"
            type="button"
            disabled={view.disabled}
            onClick={view.actions.inbox}
          >
            Back to inbox
          </button>
        }
      >
        <p>
          Keep a copy of your memories to browse on your own device, even when
          you’re offline.
        </p>
      </ArchiveIntro>
      <ExportGuide />
      {notice.visible && (
        <p
          className={notice.className}
          role={notice.role}
          ref={feedback}
          tabIndex={-1}
        >
          {notice.text}
        </p>
      )}
      {state.retryAfterSeconds !== null && (
        <p role="status">
          Wait at least {state.retryAfterSeconds} seconds before trying again.
        </p>
      )}
      <ExportRecovery view={view} />
      {showStartAction && (
        <ArchiveActions>
          <button
            type="button"
            disabled={busy}
            onClick={view.actions.create}
          >
            {getExportStartLabel(view.job, state.unavailable)}
          </button>
        </ArchiveActions>
      )}
      {view.job && (
        <ExportStatus
          view={view}
          cancelTrigger={cancelTrigger}
          cancelButton={cancelButton}
          statusTarget={statusTarget}
        />
      )}
      {view.job?.capturedAt && !view.terminal && (
        <ExportParts view={view} pageTarget={partsTarget} />
      )}
      {view.job?.preparedPart && !view.terminal && (
        <ExportPreparedPart view={view} />
      )}
      {view.job && (state.issues.length > 0 || state.issueCursors.length > 1) && (
        <ExportIssues view={view} pageTarget={issuesTarget} />
      )}
    </ArchiveScreen>
  );
}
