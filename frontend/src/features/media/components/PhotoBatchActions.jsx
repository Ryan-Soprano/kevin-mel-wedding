import { getPhotoBatchCopy, getPhotoResetLabel, getPhotoRetryLabel, getPhotoReviewLabel } from "../photoBatchDisplay.js";

export default function PhotoBatchActions({ view, privateArchive }) {
  const { busy, retained, complete, globalWait, retryCandidates, selectedEligible, shellActions, snapshot, actions } = view;
  return (
    <>
      <div className="photo-batch-actions">
        {!retained && <button type="submit" disabled={busy || globalWait > 0}>{getPhotoReviewLabel(globalWait)}</button>}
        {retained && !complete && retryCandidates.length > 0 && (
          <button type="button" onClick={actions.retry} disabled={busy || globalWait > 0 || !selectedEligible.length}>
            {getPhotoRetryLabel(busy, globalWait)}
          </button>
        )}
        {complete && shellActions && !busy && (
          <>
            <button type="button" className="button-secondary" onClick={actions.finish}>{getPhotoBatchCopy(privateArchive).finishLabel}</button>
            <button type="button" onClick={actions.shareAnother}>Share another memory</button>
          </>
        )}
        {snapshot.canStartAnother && !busy && (!complete || !shellActions) && (
          <button type="button" className="button-secondary" onClick={() => actions.resetBatch()}>{getPhotoResetLabel(complete)}</button>
        )}
      </div>
      {retained && !complete && retryCandidates.length > 0 && <p className="photo-batch-help">Select only the unsaved photos you want to retry. Confirmed photos will not be uploaded again.</p>}
      {snapshot.canStartAnother && !complete && <p className="photo-batch-help">Starting a new batch leaves confirmed photos saved and abandons the rejected remainder. It does not replace photos inside this batch.</p>}
    </>
  );
}
