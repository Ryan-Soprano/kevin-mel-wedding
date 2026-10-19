import {
  ArchiveIntro,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import { useLibrary } from "../hooks/useLibrary.js";
import { useLibraryReadFocus } from "../hooks/useLibraryReadFocus.js";
import { getLibraryFeedback } from "../libraryDisplay.js";
import LibraryFilters from "./LibraryFilters.jsx";
import LibraryResults from "./LibraryResults.jsx";
import LibraryTagChooser from "./LibraryTagChooser.jsx";
import LibraryRecovery from "./LibraryRecovery.jsx";
import LibraryPaging from "./LibraryPaging.jsx";
import "../library.css";

export default function Library({ state, busy, locked, actions, editorKey }) {
  const readFocus = useLibraryReadFocus({
    state,
    busy,
    locked,
    context: state.view,
  });
  return (
    <LibraryScreen
      key={editorKey}
      state={state}
      busy={busy}
      locked={locked}
      actions={actions}
      readFocus={readFocus}
    />
  );
}

function LibraryScreen({ state, busy, locked, actions, readFocus }) {
  const { view, feedback, pageStatus } = useLibrary({
    state,
    busy,
    locked,
    actions,
    readFocus,
  });
  const notice = getLibraryFeedback(view.error, state);
  const page = view.choosing ? state.tagCursors.length : state.cursors.length;
  const pageLabel = view.choosing ? "Library filter tags" : "Library memories";

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
              onClick={view.actions.inbox}
            >
              Back to inbox
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={view.disabled}
              onClick={view.actions.tags}
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
      <h2
        ref={pageStatus}
        tabIndex={-1}
        className="visually-hidden"
      >
        {pageLabel} · Page {page}{state.error ? " could not be loaded" : ""}
      </h2>
      {notice && (
        <p
          ref={feedback}
          tabIndex={-1}
          className="form-error"
          role="alert"
        >
          {notice}
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
