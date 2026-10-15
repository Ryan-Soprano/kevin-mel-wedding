import {
  ArchivePagination,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import { EXPORT_ISSUE_LABELS } from "../exportDisplay.js";

export default function ExportIssues({ view }) {
  const {
    state,
    disabled,
    actions,
  } = view;
  return (
    <section aria-label="Unavailable export originals">
      <ArchivePanel title="Original-file warnings" className="export-issues">
        <ul className="inbox-list">
          {state.issues.map((issue, index) => (
            <li
              className="inbox-card"
              key={`${issue.partNumber}:${issue.assetId}:${index}`}
            >
              <p>Part {issue.partNumber}: {EXPORT_ISSUE_LABELS[issue.code]}</p>
              <p>Memory {issue.memoryId}</p>
            </li>
          ))}
        </ul>
        <ArchivePagination
          previousLabel="Previous export warnings"
          nextLabel="Next export warnings"
          page={state.issueCursors.length}
          disabled={disabled}
          canPrevious={state.issueCursors.length > 1}
          canNext={Boolean(state.issuesNextCursor)}
          onPrevious={() => actions.page("issues", false)}
          onNext={() => actions.page("issues", true)}
        />
      </ArchivePanel>
    </section>
  );
}
