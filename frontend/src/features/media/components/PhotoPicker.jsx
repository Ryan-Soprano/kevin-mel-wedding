import { useId, useState } from "react";
import { ACCEPTED_FILE_TYPES, ALLOWED_FILE_TYPE_LABELS, MAX_PHOTO_SIZE_MB, MAX_PHOTOS } from "../mediaConstraints.js";
import { addPhotoSelectionWithFeedback, removePhotoSelection } from "../photoSelection.js";
import PhotoPreview from "./PhotoPreview.jsx";

/** Controlled selection for the batch form, or a standalone local preview. */
export default function PhotoPicker({
  photos: controlledPhotos, onPhotosChange, disabled = false, inputRef,
  idPrefix, showHeading = true, renderPhoto, onDialogStateChange,
  note = "Photo previews are available to try. Sending and saving photos is coming next.",
}) {
  const generatedId = useId();
  const prefix = idPrefix || `photos-${generatedId}`;
  const [localPhotos, setLocalPhotos] = useState([]);
  const [selectedForRemoval, setSelectedForRemoval] = useState(new Set());
  const [photoError, setPhotoError] = useState("");
  const [selectionFeedback, setSelectionFeedback] = useState(null);
  const photos = controlledPhotos ?? localPhotos;
  const changePhotos = onPhotosChange ?? setLocalPhotos;
  const removalCount = photos.filter(photo => selectedForRemoval.has(photo.id)).length;
  const hasSelectionError = Boolean(photoError || selectionFeedback?.rejections.length);

  function choose(event) {
    onDialogStateChange?.(false);
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (disabled || !files.length) return;
    try {
      const next = addPhotoSelectionWithFeedback(photos, files);
      if (next.addedCount) changePhotos(next.photos);
      setSelectionFeedback(next.rejections.length ? { addedCount: next.addedCount, rejections: next.rejections } : null);
      setPhotoError("");
    } catch (error) {
      setSelectionFeedback(null);
      setPhotoError(error.message);
    }
  }

  function toggleRemoval(id) {
    setSelectedForRemoval(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeSelected() {
    if (disabled) return;
    changePhotos(removePhotoSelection(photos, selectedForRemoval));
    setSelectedForRemoval(new Set());
    setSelectionFeedback(null);
    setPhotoError("");
  }

  return (
    <section className="photo-picker" aria-labelledby={showHeading ? prefix + "-heading" : undefined}>
      {showHeading && <h2 id={prefix + "-heading"}>Add photos (optional)</h2>}
      <p id={prefix + "-note"}>{note}</p>
      <label htmlFor={prefix + "-input"}>Choose photos</label>
      <p id={prefix + "-guidance"}>
        Select up to {MAX_PHOTOS} photos ({ALLOWED_FILE_TYPE_LABELS}) no larger than {MAX_PHOTO_SIZE_MB} MB each.
        {" "}For HEIC or HEIF, export or convert a copy to JPEG or PNG, then choose that copy. Keep your original.
      </p>
      <input ref={inputRef} type="file" id={prefix + "-input"} accept={ACCEPTED_FILE_TYPES} multiple
        onClick={() => onDialogStateChange?.(true)} onCancel={() => onDialogStateChange?.(false)}
        disabled={disabled} onChange={choose} aria-invalid={hasSelectionError ? "true" : undefined}
        aria-describedby={`${prefix}-guidance ${prefix}-note ${prefix}-error`} />
      <div id={prefix + "-error"} className="form-error" role="alert">
        {photoError && <p>{photoError}</p>}
        {selectionFeedback && <>
          <p>{selectionFeedback.addedCount
            ? `${selectionFeedback.addedCount} ${selectionFeedback.addedCount === 1 ? "photo was" : "photos were"} added. The following files were skipped:`
            : "No photos were added. The following files were skipped:"}</p>
          <ul>{selectionFeedback.rejections.map((rejection, index) => (
            <li key={`${index}-${rejection.fileName}`}><strong>{rejection.fileName}</strong>: {rejection.reason}</li>
          ))}</ul>
        </>}
      </div>
      <output aria-live="polite">{photos.length} of {MAX_PHOTOS} photos selected.</output>
      {photos.length > 0 && (
        <fieldset className="photo-selection">
          <legend>{disabled ? "Selected photos" : "Select photos to remove"}</legend>
          <ul className={`photo-grid${renderPhoto ? " photo-grid--batch" : ""}`}>
            {photos.map((photo, index) => (
              <li key={photo.id} className={`photo-card${selectedForRemoval.has(photo.id) ? " photo-card--selected" : ""}`}>
                <label className="photo-card__label">
                  <input className="photo-card__checkbox" type="checkbox" disabled={disabled}
                    checked={selectedForRemoval.has(photo.id)} onChange={() => toggleRemoval(photo.id)}
                    aria-label={`Select photo ${index + 1}, ${photo.file.name}, for removal`} />
                  <PhotoPreview file={photo.file} />
                </label>
                {renderPhoto?.(photo, index)}
              </li>
            ))}
          </ul>
          <button className="photo-remove-button" type="button" disabled={disabled || removalCount === 0} onClick={removeSelected}>
            Remove selected photos
          </button>
        </fieldset>
      )}
    </section>
  );
}
