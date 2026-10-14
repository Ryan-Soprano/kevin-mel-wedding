import { createPhotoBatchSubmission } from "../api/photoBatchSubmission.js";
import { usePhotoBatchForm } from "../hooks/usePhotoBatchForm.js";
import PhotoBatchCompose from "./PhotoBatchCompose.jsx";
import PhotoBatchReview from "./PhotoBatchReview.jsx";

export default function PhotoBatchForm({
  createSubmission = createPhotoBatchSubmission, active = true, onFlowStateChange, onDone, onShareAnother, privateArchive = false, onDialogStateChange,
} = {}) {
  const { view, picker, nameInput, result, reviewHeading, errorNotice } = usePhotoBatchForm({
    createSubmission, active, onFlowStateChange, onDone, onShareAnother, privateArchive,
  });
  if (view.step === "done") {
    return (
      <section className="photo-submission photo-batch" aria-labelledby={view.prefix + "-finished"}>
        <h2 ref={result} id={view.prefix + "-finished"} tabIndex={-1}>You’re all set.</h2>
        <p>Your photos were saved privately for Kevin and Melanie. You can close this page.</p>
      </section>
    );
  }
  if (view.step === "review" && !view.retained && view.reviewData) {
    return <PhotoBatchReview view={view} privateArchive={privateArchive} reviewHeading={reviewHeading} errorNotice={errorNotice} />;
  }
  return <PhotoBatchCompose view={view} privateArchive={privateArchive} onDialogStateChange={onDialogStateChange}
    picker={picker} nameInput={nameInput} result={result} errorNotice={errorNotice} />;
}
