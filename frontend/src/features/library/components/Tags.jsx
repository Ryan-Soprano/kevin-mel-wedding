import {
  ArchiveIntro,
  ArchivePanel,
  ArchiveScreen,
} from "../../inbox/components/ArchiveLayout.jsx";
import { useTags } from "../hooks/useTags.js";
import { getTagsFeedback } from "../tagDisplay.js";
import TagList from "./TagList.jsx";
import TagNameForm from "./TagNameForm.jsx";
import TagDetail from "./TagDetail.jsx";
import TagSelector from "./TagSelector.jsx";
import TagsRecovery, { TagMutationRecovery } from "./TagsRecovery.jsx";
import TagPaging from "./TagPaging.jsx";
import "../library.css";

function TagsContent({ view, cancelDelete, deleteTrigger }) {
  switch (view.state.view) {
    case "list":
      return <TagList view={view} />;
    case "create":
      return (
        <ArchivePanel
          title="Create a tag"
          description="Choose a label that will help you find these memories again."
        >
          <TagNameForm view={view} mode="create" />
        </ArchivePanel>
      );
    case "detail":
      return (
        <TagDetail
          view={view}
          cancelDelete={cancelDelete}
          deleteTrigger={deleteTrigger}
        />
      );
    case "select":
      return <TagSelector view={view} />;
    default:
      return null;
  }
}

export default function Tags({ state, busy, locked, actions }) {
  const { view, feedback, cancelDelete, deleteTrigger } = useTags({
    state,
    busy,
    locked,
    actions,
  });
  const notice = getTagsFeedback(view.error, state);
  return (
    <ArchiveScreen className="tags" label="Private tags" busy={busy}>
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
            {state.view !== "list" && (
              <button
                className="button-secondary"
                type="button"
                disabled={view.disabled}
                onClick={view.handlers.listAll}
              >
                All tags
              </button>
            )}
          </>
        }
      >
        <p>
          Give your memories private labels, such as people, places or occasions.
          One memory can have several tags. Tagging does not change who can see
          a memory.
        </p>
      </ArchiveIntro>
      {notice.visible && (
        <p
          ref={feedback}
          tabIndex={-1}
          className={notice.className}
          role={notice.role}
        >
          {notice.text}
        </p>
      )}
      <TagMutationRecovery view={view} />
      <TagsContent
        view={view}
        cancelDelete={cancelDelete}
        deleteTrigger={deleteTrigger}
      />
      <TagsRecovery view={view} />
      <TagPaging view={view} />
    </ArchiveScreen>
  );
}
