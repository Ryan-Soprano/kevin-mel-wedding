import { ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import {
  getAlbumProgressLabel,
  getAlbumReloadLabel,
} from "../albumDisplay.js";

function AlbumRecoveryActions({ view }) {
  const {
    state,
    busy,
    actions,
    originalName,
    setOriginalName,
    handlers,
  } = view;
  if (!["uncertain", "conflict", "csrf"].includes(state.mutation.phase)) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => actions.reload(state.mutation.phase === "csrf")}
      >
        {getAlbumReloadLabel(state.mutation.phase)}
      </button>
      {state.mutation.canRetry && (
        <>
          {state.mutation.needsName && (
            <div>
              <label htmlFor="album-original-name">Original album name</label>
              <input
                id="album-original-name"
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
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={handlers.retry}
          >
            Retry this same album change
          </button>
        </>
      )}
    </>
  );
}

export default function AlbumRecovery({ view }) {
  if (!view.locked) {
    return null;
  }
  const progress = getAlbumProgressLabel(view.state.mutation.phase);
  return (
    <ArchivePanel className="album-recovery" title="Album change">
      <p>
        Keep this page open while the change is pending or unconfirmed. Other
        changes, navigation and sign-out are paused.
      </p>
      {progress && <output>{progress}</output>}
      <AlbumRecoveryActions view={view} />
    </ArchivePanel>
  );
}
