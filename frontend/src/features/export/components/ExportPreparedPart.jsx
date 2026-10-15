import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  formatExportBytes,
  getExportPartKindLabel,
} from "../exportDisplay.js";

function ExportDownload({ download, actions }) {
  if (download.phase === "loading") {
    return (
      <div role="status">
        <p>
          Loading {formatExportBytes(download.receivedBytes)} of{" "}
          {formatExportBytes(download.totalBytes)}. A size and checksum check follows.
        </p>
        <progress
          value={download.receivedBytes}
          max={download.totalBytes}
          aria-label="ZIP part bytes received"
        />
      </div>
    );
  }
  if (download.phase === "ready") {
    return (
      <>
        <p>Size and SHA-256 verified for this ZIP part.</p>
        <ArchiveActions>
          <a
            className="inbox-download"
            href={download.url}
            download={download.filename}
            onClick={actions.started}
          >
            Save verified ZIP part
          </a>
        </ArchiveActions>
        <p className="guest-help">
          Check your browser’s downloads to confirm it saved. Keep this page
          visible while loading a part.
        </p>
      </>
    );
  }
  return null;
}

export default function ExportPreparedPart({ view }) {
  const {
    state,
    job,
    disabled,
    actions,
  } = view;
  const part = job.preparedPart;

  return (
    <ArchivePanel
      title={<>Prepared part {part.partNumber}</>}
      className="export-prepared"
    >
      <p>
        {getExportPartKindLabel(part.kind)} · {formatExportBytes(part.byteSize)}
      </p>
      <p className="export-filename">{part.filename}</p>
      <ArchiveActions>
        <button
          type="button"
          disabled={disabled}
          onClick={actions.download}
        >
          Load and verify ZIP part
        </button>
      </ArchiveActions>
      <ExportDownload download={state.download} actions={actions} />
    </ArchivePanel>
  );
}
