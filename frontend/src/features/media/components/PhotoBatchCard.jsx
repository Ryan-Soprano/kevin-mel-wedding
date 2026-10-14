import { getPhotoRetryChoiceLabel, getPhotoStatusText } from "../photoBatchDisplay.js";

function PhotoRetryChoice({ item, index, selected, busy, globalWait, itemWait, filenameId, stateId, onToggle }) {
  if (!item || item.status === "saved" || item.terminal === true) return null;
  return (
    <label className="photo-retry-choice">
      <input type="checkbox" checked={selected} disabled={busy || globalWait > 0 || itemWait > 0 || !item.retryEligible}
        onChange={onToggle} aria-describedby={filenameId + " " + stateId} />
      <span>{getPhotoRetryChoiceLabel(index, globalWait, itemWait)}</span>
    </label>
  );
}

export default function PhotoBatchCard({ photo, index, prefix, item, locked, busy, globalWait, error, selected, onCaptionChange, onCaptionRef, onToggleRetry }) {
  const captionId = prefix + "-caption-" + photo.id;
  const stateId = prefix + "-state-" + photo.id;
  const filenameId = prefix + "-filename-" + photo.id;
  const itemWait = Math.max(0, Math.ceil(item?.retryAfterSeconds || 0));
  let invalid;
  let description = filenameId;
  if (error) {
    invalid = "true";
    description = filenameId + " " + captionId + "-error";
  }
  return (
    <div className="photo-batch-card">
      <p id={filenameId} className="photo-card__filename">Photo {index + 1}: {photo.file.name}</p>
      <label htmlFor={captionId}>Caption for photo {index + 1} (optional)</label>
      <textarea id={captionId} rows={2} maxLength={500} value={photo.caption || ""} disabled={locked}
        ref={node => onCaptionRef(photo.id, node)} onChange={event => onCaptionChange(photo.id, event.target.value)}
        aria-invalid={invalid} aria-describedby={description} />
      {error && <p id={captionId + "-error"} className="form-error">{error}</p>}
      <p id={stateId} className={`photo-batch-state photo-batch-state--${item?.status || "queued"}`}>{getPhotoStatusText(item)}</p>
      {item?.status === "rejected" && <p className="photo-batch-help">Retry this original photo, or deliberately start a new batch to choose different photos.</p>}
      {item?.status === "failed" && <p className="photo-batch-help">Keep the original photo here. A retry checks its saved state before transferring again.</p>}
      <PhotoRetryChoice item={item} index={index} selected={selected} busy={busy} globalWait={globalWait} itemWait={itemWait}
        filenameId={filenameId} stateId={stateId} onToggle={() => onToggleRetry(photo.id)} />
    </div>
  );
}
