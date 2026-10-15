import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import { getExportRecoveryLabel } from "../exportDisplay.js";

function ExportRecoveryActions({ view }) {
  const {
    state,
    busy,
    actions,
  } = view;
  if (["saving", "loading"].includes(state.mutation.phase)) {
    return <p role="status">Checking this export action…</p>;
  }
  return (
    <ArchiveActions>
      <button
        type="button"
        disabled={busy}
        onClick={() => actions.check(state.mutation.phase === "csrf")}
      >
        {getExportRecoveryLabel(state.mutation.phase)}
      </button>
      {state.mutation.canRetry && (
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={actions.retry}
        >
          Retry this same export action
        </button>
      )}
    </ArchiveActions>
  );
}

export default function ExportRecovery({ view }) {
  if (!view.locked) {
    return null;
  }
  return (
    <ArchivePanel
      title="Confirm your export action"
      className="export-recovery"
    >
      <p>
        Other changes, navigation and sign-out are paused until this export action
        is confirmed. Checking never silently creates another job or retries
        preparation.
      </p>
      <ExportRecoveryActions view={view} />
    </ArchivePanel>
  );
}
