import PhotoBatchActions from "./PhotoBatchActions.jsx";
import { getPhotoResultLabel } from "../photoBatchDisplay.js";
import "../photoBatchSuccess.css";

export default function PhotoBatchSuccess({ view, privateArchive, result }) {
  const titleId = view.prefix + "-success";
  return (
    <section
      className="photo-submission photo-batch photo-batch--success memory-form"
      aria-labelledby={titleId}
    >
      <div className="photo-batch-success-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 4 4L19 6" />
        </svg>
      </div>
      <h2 ref={result} id={titleId} tabIndex={-1}>
        {getPhotoResultLabel(true, view.savedCount, view.totalCount, privateArchive)}
      </h2>
      <p>
        {privateArchive
          ? "Your original photos are saved in your private archive."
          : "Thanks for sharing. You can close this page."}
      </p>
      <PhotoBatchActions view={view} privateArchive={privateArchive} />
    </section>
  );
}
