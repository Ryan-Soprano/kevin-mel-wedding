import { getReviewProgressLabel } from "../inboxDisplay.js";
import { useState } from "react";

function PrivateShareLink({ memory, shareLink, busy, locked, actions }) {
  const [copyFeedback, setCopyFeedback] = useState(null);
  if (memory.visibility !== "FRIENDS_FAMILY" || memory.reviewStatus !== "KEEP") return null;
  const url = shareLink?.url ? (typeof window === "undefined" ? shareLink.url : new URL(shareLink.url, window.location.origin).href) : null;
  async function copyLink() {
    try { await navigator.clipboard.writeText(url); setCopyFeedback("Link copied."); }
    catch { setCopyFeedback("Select the link above to copy it manually."); }
  }
  return <div className="inbox-sharing-note">
    <p>Anyone with this private link can view this memory. Send it only to the people you choose. Creating a new link replaces the previous one.</p>
    {url && <><label htmlFor="memory-share-link">Private link</label>
      <input id="memory-share-link" type="text" readOnly value={url} onFocus={event => event.target.select()} />
      <button type="button" className="button-secondary" onClick={copyLink}>Copy private link</button>
      {copyFeedback && <output role="status">{copyFeedback}</output>}</>}
    {shareLink?.error && <p className="form-error" role="alert">{shareLink.error}</p>}
    <div className="inbox-actions">
      <button type="button" className="button-secondary" disabled={busy || locked} onClick={actions.createLink}>Create new private link</button>
      {shareLink?.error && <button type="button" className="button-secondary" disabled={busy || locked} onClick={actions.reloadMemory}>Reload memory</button>}
    </div>
  </div>;
}

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
    <>
      {!deleted && <div className="inbox-actions inbox-sharing-actions">
        <button type="button" className="button-secondary" aria-pressed={memory.reviewStatus === "KEEP" && memory.visibility === "COUPLE_ONLY"} disabled={busy} onClick={() => controls.change("KEEP", "COUPLE_ONLY")}>Keep Private</button>
        <button type="button" className="button-secondary" aria-pressed={memory.visibility === "FRIENDS_FAMILY"} disabled={busy} onClick={() => controls.change("KEEP", "FRIENDS_FAMILY")}>Share with Friends &amp; Family</button>
        <button type="button" className="button-secondary" aria-pressed={memory.visibility === "PUBLIC"} disabled={busy} onClick={() => controls.change("KEEP", "PUBLIC")}>Share with Public</button>
        <button ref={deleteButton} type="button" className="button-secondary inbox-delete-action" disabled={busy} onClick={controls.beginDelete}>Delete</button>
      </div>}
      <div className="inbox-actions">
        {!deleted && memory.reviewStatus !== "ARCHIVED" && <button type="button" className="button-secondary" disabled={busy} onClick={() => controls.change("ARCHIVED")}>Archive</button>}
        {["ARCHIVED", "DELETE"].includes(memory.reviewStatus) && <button type="button" disabled={busy} onClick={() => controls.change("PENDING")}>Restore to inbox</button>}
      </div>
      {!deleted && <p className="guest-help">Archiving keeps this memory private and removes shared access. You can restore it to your inbox.</p>}
    </>
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

export default function MemoryReview({ memory, review, shareLink, busy, locked, controls, actions, deleteButton, cancelDelete, reviewFeedback }) {
  const progressLabel = getReviewProgressLabel(review);
  return (
    <section className="inbox-review" aria-label="Memory sharing and review">
      <h3>Who can see this memory?</h3>
      <p className="guest-help">Keep it in your private vault, send a private link to friends and family, or share it on the public guest site. Each choice affects only this memory.</p>
      {progressLabel && <output>{progressLabel}</output>}
      {review.error && <p ref={reviewFeedback} tabIndex={-1} className="form-error" role="alert">{review.error}</p>}
      {locked && <p className="guest-help">Keep this page open while this change is pending or unconfirmed. Other review actions, navigation, media loading and sign-out are paused.</p>}
      <ReviewRecovery review={review} busy={busy} actions={actions} />
      <ReviewActions memory={memory} busy={busy} locked={locked} controls={controls} deleteButton={deleteButton} />
      <PrivateShareLink key={`${memory.memoryId}:${shareLink?.url ?? "none"}`} memory={memory} shareLink={shareLink} busy={busy} locked={locked} actions={actions} />
      <DeleteConfirmation busy={busy} controls={controls} cancelDelete={cancelDelete} />
    </section>
  );
}
