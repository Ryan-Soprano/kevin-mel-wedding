import { getContributionCopy, getContributionSendLabel } from "../contributionDisplay.js";

export default function ContributionReview({ view, privateArchive, reviewHeading }) {
  const { preview, isSubmitting, error, pending, busy, actions } = view;
  let progress = "";
  if (isSubmitting) progress = "Sending your note…";
  return (
    <section className="note-review" aria-labelledby="review-heading" aria-busy={isSubmitting}>
      <h2 id="review-heading" ref={reviewHeading} tabIndex={-1}>{getContributionCopy(privateArchive).reviewTitle}</h2>
      {!privateArchive && <p style={{ overflowWrap: "anywhere" }}>From: {preview.guestName ?? "Name not provided"}</p>}
      <p className="note-review__message">{preview.message}</p>
      <p>Only Kevin and Melanie can review this note. It will not appear publicly.</p>
      <p className="visually-hidden" role="status" aria-live="polite">{progress}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {pending && <p>Your note is locked until we confirm it. Trying again checks this same submission.</p>}
      <div className="note-actions">
        <button type="button" onClick={actions.send} disabled={busy}>{getContributionSendLabel(view, privateArchive)}</button>
        {!pending && <button type="button" className="button-secondary" onClick={actions.edit} disabled={isSubmitting}>Edit note</button>}
      </div>
    </section>
  );
}
