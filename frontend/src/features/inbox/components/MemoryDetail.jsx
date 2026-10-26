import { memoryTime } from "../memoryDisplay.js";
import { getDetailBackLabel, getMemoryDetailTitle, getMemorySourceLabel, REVIEW_STATUS_LABELS, VISIBILITY_LABELS } from "../inboxDisplay.js";
import MemoryMetadataEditor from "./MemoryMetadataEditor.jsx";
import MemoryTags from "../../library/components/MemoryTags.jsx";
import MemoryMedia from "./MemoryMedia.jsx";
import MemoryReview from "./MemoryReview.jsx";
import { ArchiveActions, ArchiveScreen } from "./ArchiveLayout.jsx";

function ContributionNavigation({ navigation, disabled, actions }) {
  if (!navigation) return null;
  return (
    <nav className="inbox-contribution-navigation" aria-label="Browse inbox contributions">
      <button type="button" className="button-secondary" disabled={disabled || !navigation.canPrevious}
        onClick={actions.previousMemory}>
        <span aria-hidden="true">← </span>Previous contribution
      </button>
      <button type="button" className="button-secondary" disabled={disabled || !navigation.canNext}
        onClick={actions.nextMemory}>
        Next contribution<span aria-hidden="true"> →</span>
      </button>
    </nav>
  );
}

function MemoryContents({ state, locked, actions, audioPlayback, reviewControls, deleteButton, cancelDelete, reviewFeedback }) {
  const memory = state.detail;
  if (!memory) return null;
  const deleted = memory.reviewStatus === "DELETE";
  return (
    <>
      <h2>{getMemoryDetailTitle(memory)}</h2>
      <p>{getMemorySourceLabel(memory)}</p>
      {memory.description && <p className="inbox-note">{memory.description}</p>}
      {memory.memoryDate && <p>Memory date: {memory.memoryDate} ({memory.datePrecision.toLowerCase()} precision)</p>}
      <p>Saved on: <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time> · Eastern time</p>
      <p>Status: {REVIEW_STATUS_LABELS[memory.reviewStatus]} · {VISIBILITY_LABELS[memory.visibility]}</p>
      {deleted && (
        <p className="inbox-deletion-window">This individual memory is in Recently deleted. Restore it before <time dateTime={memory.deleteAfter}>{memoryTime(memory.deleteAfter)}</time> (Eastern time), when its 30-day recovery window ends. Deleted photos and audio cannot be opened or downloaded.</p>
      )}
      <MemoryMedia memory={memory} photo={state.photo} locked={locked} audioPlayback={audioPlayback} onRetry={actions.media.retry} />
      {state.notice && <output ref={reviewFeedback} tabIndex={-1} className="inbox-review-notice">{state.notice}</output>}
      <MemoryReview memory={memory} review={state.review} shareLink={state.shareLink} busy={state.busy} locked={locked} controls={reviewControls}
        actions={{ ...actions.review, reloadMemory: () => actions.navigation.openMemory(memory.memoryId) }}
        deleteButton={deleteButton} cancelDelete={cancelDelete} reviewFeedback={reviewFeedback} />
      {!deleted && <details className="inbox-context">
        <summary>Memory details and tags</summary>
        <MemoryMetadataEditor key={`${memory.memoryId}:${memory.revision}`} memory={memory}
          state={state.metadata} busy={state.busy} locked={locked} onSave={actions.metadata.save} onReload={actions.metadata.reload} onRetry={actions.metadata.retry} />
        <MemoryTags
          key={memory.memoryId}
          editorKey={`${memory.memoryId}:${state.tags.view}:${state.tags.q}`}
          state={state.tags}
          busy={state.busy}
          locked={locked}
          actions={actions.memoryTags}
        />
      </details>}
    </>
  );
}

export default function MemoryDetail({ state, locked, actions, audioPlayback, reviewControls, deleteButton, cancelDelete, reviewFeedback }) {
  return (
    <ArchiveScreen className="inbox-detail" label="Memory detail" busy={state.busy}>
      <div className="inbox-detail-toolbar">
        <ArchiveActions>
          <button type="button" className="button-secondary" disabled={locked} onClick={actions.navigation.back}>{getDetailBackLabel(state)}</button>
        </ArchiveActions>
        <ContributionNavigation navigation={state.detailNavigation}
          disabled={state.busy || locked || reviewControls.confirmingDelete} actions={actions.navigation} />
      </div>
      <article className="inbox-detail-body">
        {state.busy && !state.detail && <output>Loading memory…</output>}
        {!state.busy && !state.detail && state.error && <p>This memory could not be loaded. Return to the inbox and try opening it again.</p>}
        <MemoryContents state={state} locked={locked} actions={actions} audioPlayback={audioPlayback} reviewControls={reviewControls}
          deleteButton={deleteButton} cancelDelete={cancelDelete} reviewFeedback={reviewFeedback} />
      </article>
    </ArchiveScreen>
  );
}
