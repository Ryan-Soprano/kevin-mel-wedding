import {
  ArchivePagination,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  getExportPartKindLabel,
  getExportPartOriginalSummary,
  getExportPartStateLabel,
} from "../exportDisplay.js";

function ExportPart({ part, view }) {
  const {
    job,
    disabled,
    canPrepare,
    actions,
  } = view;
  const indexHasUnprocessedParts = part.kind === "INDEX"
    && job.processedOriginalParts !== job.originalPartCount;
  const preparationDisabled = disabled || !canPrepare || indexHasUnprocessedParts;

  return (
    <li className="inbox-card">
      <h3>
        Part {part.partNumber} · {getExportPartKindLabel(part.kind)}
      </h3>
      <p>
        {getExportPartStateLabel(part.state)}
        {getExportPartOriginalSummary(part)}
      </p>
      <button
        type="button"
        disabled={preparationDisabled}
        onClick={() => actions.prepare(part.partNumber)}
        aria-label={`Prepare ZIP part ${part.partNumber}`}
      >
        Prepare this part
      </button>
    </li>
  );
}

export default function ExportParts({ view }) {
  const {
    state,
    disabled,
    actions,
  } = view;
  return (
    <ArchivePanel
      title="ZIP parts"
      description="Save each original part before preparing the next. Prepare the final index last."
    >
      <ol className="inbox-list export-parts">
        {state.parts.map((part) => (
          <ExportPart key={part.partNumber} part={part} view={view} />
        ))}
      </ol>
      <ArchivePagination
        previousLabel="Previous ZIP parts"
        nextLabel="Next ZIP parts"
        page={state.partCursors.length}
        disabled={disabled}
        canPrevious={state.partCursors.length > 1}
        canNext={Boolean(state.partsNextCursor)}
        onPrevious={() => actions.page("parts", false)}
        onNext={() => actions.page("parts", true)}
      />
    </ArchivePanel>
  );
}
