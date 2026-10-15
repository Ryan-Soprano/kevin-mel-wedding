import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";
import {
  getTagRecoveryStatus,
  getTagReloadLabel,
} from "../tagDisplay.js";

function TagMutationRecoveryActions({ view }) {
  const { state, busy, originalName, setOriginalName, handlers } = view;
  if (!["uncertain", "conflict", "csrf"].includes(state.mutation.phase)) {
    return null;
  }
  return (
    <>
      <ArchiveActions>
        <button
          type="button"
          disabled={busy}
          onClick={handlers.reloadMutation}
        >
          {getTagReloadLabel(state.mutation.phase)}
        </button>
      </ArchiveActions>
      {state.mutation.canRetry && (
        <>
          {state.mutation.needsName && (
            <div>
              <label htmlFor="tag-original-name">Original tag name</label>
              <input
                id="tag-original-name"
                value={originalName}
                maxLength={200}
                onChange={(event) => setOriginalName(event.target.value)}
                disabled={busy}
              />
              <p className="guest-help">
                The hidden name draft was cleared. Re-enter the same name to
                retry the original change.
              </p>
            </div>
          )}
          <ArchiveActions>
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={handlers.retry}
            >
              Retry this same tag change
            </button>
          </ArchiveActions>
        </>
      )}
    </>
  );
}

export function TagMutationRecovery({ view }) {
  const { state, locked } = view;
  if (!locked) {
    return null;
  }
  const status = getTagRecoveryStatus(state.mutation.phase);
  return (
    <ArchivePanel title="Confirm your tag change" className="tag-recovery">
      <p>
        Keep this page open while the change is pending or unconfirmed. Other
        changes, navigation and sign-out are paused.
      </p>
      {status && <p role="status">{status}</p>}
      <TagMutationRecoveryActions view={view} />
    </ArchivePanel>
  );
}

export default function TagsRecovery({ view }) {
  const { state, disabled, handlers } = view;
  if (!state.error) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handlers.reloadFirstPage}
    >
      Reload tag first page
    </button>
  );
}
