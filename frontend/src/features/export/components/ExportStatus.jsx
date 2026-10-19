import { memoryTime } from "../../inbox/memoryDisplay.js";
import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  EXPORT_STATE_LABELS,
  formatExportBytes,
} from "../exportDisplay.js";

function ExportSummary({ job }) {
  return (
    <div className="export-summary">
      <p><strong>{job.totalMemories}</strong> completed memories</p>
      <p><strong>{job.totalOriginals}</strong> original files</p>
      <p><strong>{formatExportBytes(job.totalOriginalBytes)}</strong> original bytes</p>
    </div>
  );
}

function ExportTiming({ job, terminal }) {
  return (
    <div className="export-timing">
      <p>
        Created <time dateTime={job.createdAt}>{memoryTime(job.createdAt)}</time> · Eastern
      </p>
      {job.capturedAt && (
        <p>
          Archive captured <time dateTime={job.capturedAt}>{memoryTime(job.capturedAt)}</time> · Eastern
        </p>
      )}
      {!terminal && (
        <>
          <p>
            Expires after 30 minutes without activity, and by{" "}
            <time dateTime={job.hardExpiresAt}>{memoryTime(job.hardExpiresAt)}</time>{" "}
            (Eastern). App restart makes this job unavailable; start a fresh export
            explicitly.
          </p>
          <p>
            Current inactivity deadline: <time dateTime={job.expiresAt}>{memoryTime(job.expiresAt)}</time> · Eastern
          </p>
        </>
      )}
    </div>
  );
}

function ExportCancellation({ view, cancelButton }) {
  const {
    busy,
    locked,
    terminal,
    confirmCancel,
    handlers,
  } = view;
  if (!confirmCancel || locked || terminal) {
    return null;
  }
  return (
    <div
      className="export-cancel-confirmation"
      role="group"
      aria-labelledby="export-cancel-title"
    >
      <h3 id="export-cancel-title">Cancel this export?</h3>
      <p>
        Its temporary files will be discarded. Your archive and files already
        saved on your device remain unchanged.
      </p>
      <ArchiveActions>
        <button
          ref={cancelButton}
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={handlers.keepExport}
        >
          Keep export
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handlers.confirmCancellation}
        >
          Confirm cancel export
        </button>
      </ArchiveActions>
    </div>
  );
}

function ExportResults({ job, terminal }) {
  return (
    <>
      <p>
        {job.processedOriginalParts} of {job.originalPartCount} original parts
        processed · {job.availableOriginals} originals included · {job.unavailableOriginals} originals unavailable
      </p>
      {Object.keys(job.excludedCounts).length > 0 && (
        <p className="export-exclusions">
          Excluded from this capture: {job.excludedCounts.deletedOrPurgingMemories} deleted or purging memories;{" "}
          {job.excludedCounts.unfinishedOrUnavailableMemories} unfinished or unavailable memories;{" "}
          {job.excludedCounts.deletedAlbums} deleted albums;{" "}
          {job.excludedCounts.deletedTimelineEvents} deleted timeline events;{" "}
          {job.excludedCounts.deletedTags} deleted tags.
        </p>
      )}
      {job.unavailableOriginals > 0 && (
        <p className="form-error">
          This export is incomplete. Unavailable files are reported rather than
          replaced or silently omitted.
        </p>
      )}
      {job.complete && (
        <p className="export-complete">
          All original parts were processed without original-file warnings, and a
          fresh final index was prepared. Download every part; this status does
          not confirm browser saves.
        </p>
      )}
      {job.indexNeedsRefresh && (
        <p>
          Prepare the final index again after the latest original-part results so
          its report is current.
        </p>
      )}
      {!terminal && (
        <p className="guest-help">
          Only one prepared ZIP is ready to download at a time across exports.
          Download this part before preparing another; you can prepare it again
          if needed. Another preparation or download may make the service briefly
          busy.
        </p>
      )}
    </>
  );
}

export default function ExportStatus({
  view,
  cancelTrigger,
  cancelButton,
  statusTarget,
}) {
  const {
    job,
    terminal,
    disabled,
    actions,
    handlers,
  } = view;
  return (
    <ArchivePanel
      title={EXPORT_STATE_LABELS[job.state]}
      className="export-status"
    >
      <h3
        ref={statusTarget}
        tabIndex={-1}
        className="visually-hidden"
      >
        Export progress · {EXPORT_STATE_LABELS[job.state]}
      </h3>
      <ExportSummary job={job} />
      <ExportTiming job={job} terminal={terminal} />
      {!terminal && (
        <ArchiveActions>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.check(false)}
          >
            Check export progress
          </button>
          <button
            ref={cancelTrigger}
            className="button-secondary"
            type="button"
            disabled={disabled}
            onClick={handlers.beginCancel}
          >
            Cancel export…
          </button>
        </ArchiveActions>
      )}
      <ExportCancellation view={view} cancelButton={cancelButton} />
      <ExportResults job={job} terminal={terminal} />
    </ArchivePanel>
  );
}
