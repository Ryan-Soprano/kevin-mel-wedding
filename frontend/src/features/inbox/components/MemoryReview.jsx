import { getReviewProgressLabel } from "../inboxDisplay.js";

function ReviewRecovery({ review, busy, actions }) {
  if (["uncertain", "conflict"].includes(review.phase)) {
    return (
      <div className="inbox-actions">
        <button type="button" disabled={busy} onClick={actions.reload}>Reload current state</button>
        {review.canRetry && <button type="button" className="button-secondary" disabled={busy} onClick={actions.retry}>Retry this same change</button>}
      </div>
    );
  }
  if (review.phase === "csrf") return <button type="button" disabled={busy} onClick={actions.refresh}>Refresh session and current memory</button>;
  return null;
}

function ReviewActions({ memory, busy, locked, controls, deleteButton }) {
  if (locked || controls.confirmingDelete) return null;
  const deleted = memory.reviewStatus === "DELETE";
  return (
    <div className="inbox-actions">
      {memory.reviewStatus !== "KEEP" && !deleted && <button type="button" disabled={busy} onClick={() => controls.change("KEEP")}>Keep privately</button>}
      {memory.reviewStatus !== "ARCHIVED" && !deleted && <button type="button" className="button-secondary" disabled={busy} onClick={() => controls.change("ARCHIVED")}>Archive</button>}
      {["ARCHIVED", "DELETE"].includes(memory.reviewStatus) && <button type="button" disabled={busy} onClick={() => controls.change("PENDING")}>Restore to inbox</button>}
      {!deleted && <button ref={deleteButton} type="button" className="button-secondary" disabled={busy} onClick={controls.beginDelete}>Delete…</button>}
    </div>
  );
}

function DeleteConfirmation({ busy, controls, cancelDelete }) {
  if (!controls.confirmingDelete) return null;
  return (
    <fieldset className="inbox-delete-confirmation" aria-describedby="inbox-delete-copy">
      <legend id="inbox-delete-title">Delete this memory?</legend>
      <p id="inbox-delete-copy">Only this memory will move to Recently deleted and be removed from every album, timeline event and tag. You can restore it to your inbox for 30 days after its first deletion, then add it to albums, link it to events or attach tags again yourself. It will no longer be available after that recovery window, and deleted photos and audio cannot be opened or downloaded.</p>
      <div className="inbox-actions">
        <button ref={cancelDelete} type="button" className="button-secondary" disabled={busy} onClick={controls.cancel}>Cancel</button>
        <button type="button" disabled={busy} onClick={() => controls.change("DELETE")}>Confirm delete</button>
      </div>
    </fieldset>
  );
}

export default function MemoryReview({ memory, review, busy, locked, controls, actions, deleteButton, cancelDelete, reviewFeedback }) {
  const progressLabel = getReviewProgressLabel(review);
  return (
    <section className="inbox-review" aria-label="Private review actions">
      <p className="guest-help">These actions affect this individual memory. Keeping or archiving it does not publish it or change other memories.</p>
      {progressLabel && <output>{progressLabel}</output>}
      {review.error && <p ref={reviewFeedback} tabIndex={-1} className="form-error" role="alert">{review.error}</p>}
      {locked && <p className="guest-help">Keep this page open while this change is pending or unconfirmed. Other review actions, navigation, media loading and sign-out are paused.</p>}
      <ReviewRecovery review={review} busy={busy} actions={actions} />
      <ReviewActions memory={memory} busy={busy} locked={locked} controls={controls} deleteButton={deleteButton} />
      <DeleteConfirmation busy={busy} controls={controls} cancelDelete={cancelDelete} />
    </section>
  );
}
