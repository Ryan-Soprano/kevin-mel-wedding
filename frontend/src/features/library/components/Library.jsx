import {
  ArchiveIntro,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import { useLibrary } from "../hooks/useLibrary.js";
import LibraryFilters from "./LibraryFilters.jsx";
import LibraryResults from "./LibraryResults.jsx";
import LibraryTagChooser from "./LibraryTagChooser.jsx";
import LibraryRecovery from "./LibraryRecovery.jsx";
import LibraryPaging from "./LibraryPaging.jsx";
import "../library.css";

export default function Library({ state, busy, locked, actions }) {
  const { view, feedback } = useLibrary({
    state,
    busy,
    locked,
    actions,
  });

  return (
    <ArchiveScreen
      className="library"
      label="Private memory library"
      busy={busy}
    >
      <ArchiveIntro
        actions={
          <>
            <button
              className="button-secondary"
              type="button"
              disabled={view.disabled}
              onClick={actions.inbox}
            >
              Back to inbox
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={view.disabled}
              onClick={actions.tags}
            >
              Manage tags
            </button>
          </>
        }
      >
        <p>
          Find a note, photo or voice memory in your archive. Searching and
          tagging preserve original content, files and each memory’s sharing
          choice.
        </p>
      </ArchiveIntro>
      {(view.error || state.error) && (
        <p
          ref={feedback}
          tabIndex={-1}
          className="form-error"
          role="alert"
        >
          {view.error ?? state.error}
        </p>
      )}
      {!view.choosing && (
        <>
          <LibraryFilters view={view} />
          <LibraryResults view={view} />
        </>
      )}
      {view.choosing && (
        <LibraryTagChooser view={view} />
      )}
      <LibraryRecovery view={view} />
      <LibraryPaging view={view} />
    </ArchiveScreen>
  );
}
