import PhotoPreview from "./PhotoPreview.jsx";
import { getPhotoBatchCopy, getPhotoSendLabel } from "../photoBatchDisplay.js";

export default function PhotoBatchReview({ view, privateArchive, reviewHeading, errorNotice }) {
  const { prefix, photos, reviewData, busy, error, globalWait, actions } = view;
  const copy = getPhotoBatchCopy(privateArchive);
  let progress = "";
  if (busy) progress = "Preparing your original photos…";
  return (
    <section className="photo-submission photo-batch note-review" aria-labelledby={prefix + "-review"} aria-busy={busy}>
      <h2 ref={reviewHeading} id={prefix + "-review"} tabIndex={-1}>{copy.reviewTitle}</h2>
      {!privateArchive && <p>From: {reviewData.guestName ?? "Name not provided"}</p>}
      <ul className="photo-grid photo-grid--batch">
        {photos.map((photo, index) => (
          <li key={photo.id} className="photo-card">
            <PhotoPreview file={photo.file} alt={`Photo ${index + 1}`} />
            <div className="photo-batch-card">
              <p className="note-review__message">{reviewData.items[index].caption ?? "No caption provided"}</p>
            </div>
          </li>
        ))}
      </ul>
      <p>{copy.reviewDescription}</p>
      <p role="status" aria-live="polite" aria-atomic="true">{progress}</p>
      {error && <p ref={errorNotice} className="form-error" role="alert" tabIndex={-1}>{error}</p>}
      <div className="photo-batch-actions">
        <button type="button" onClick={actions.sendPhotos} disabled={busy || globalWait > 0}>{getPhotoSendLabel(busy, globalWait, privateArchive)}</button>
        <button type="button" className="button-secondary" onClick={actions.editPhotos} disabled={busy}>Edit photos</button>
      </div>
    </section>
  );
}
