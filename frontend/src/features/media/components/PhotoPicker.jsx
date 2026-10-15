import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { ACCEPTED_FILE_TYPES, ALLOWED_FILE_TYPE_LABELS, MAX_PHOTO_SIZE_MB, MAX_PHOTOS } from "../mediaConstraints.js";
import { addPhotoSelectionWithFeedback, removePhotoSelection } from "../photoSelection.js";
import PhotoPreview from "./PhotoPreview.jsx";

/** Controlled selection for the batch form, or a standalone local preview. */
export default function PhotoPicker({
  photos: controlledPhotos, onPhotosChange, disabled = false, inputRef,
  idPrefix, showHeading = true, renderPhoto, onDialogStateChange,
  note = "",
}) {
  const generatedId = useId();
  const prefix = idPrefix || `photos-${generatedId}`;
  const fileInput = useRef(null);
  const uploadPanel = useRef(null);
  const removeButtons = useRef(new Map());
  const removalFocus = useRef(null);
  const [localPhotos, setLocalPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const [selectionFeedback, setSelectionFeedback] = useState(null);
  const photos = controlledPhotos ?? localPhotos;
  const changePhotos = onPhotosChange ?? setLocalPhotos;
  const hasSelectionError = Boolean(photoError || selectionFeedback?.rejections.length);
  const atLimit = photos.length >= MAX_PHOTOS;

  // Editing a full selection still needs a visible focus target; its picker is disabled.
  useImperativeHandle(inputRef, () => atLimit ? uploadPanel.current : fileInput.current, [atLimit]);

  useEffect(() => {
    const request = removalFocus.current;
    if (!request) return;
    removalFocus.current = null;
    // Only the selection produced by Remove may move focus. Ignore unrelated updates
    // if a controlled parent declined or replaced that selection.
    if (disabled || photos.length !== request.photos.length
      || photos.some((photo, index) => photo.id !== request.photos[index].id)) return;
    const nextPhoto = photos[Math.min(request.index, photos.length - 1)];
    const nextButton = removeButtons.current.get(nextPhoto?.id);
    if (nextButton) nextButton.focus();
    else if (!fileInput.current?.disabled) fileInput.current?.focus();
    else uploadPanel.current?.focus();
  }, [photos, disabled]);

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

  function removePhoto(id) {
    if (disabled) return;
    const next = removePhotoSelection(photos, new Set([id]));
    removalFocus.current = { index: photos.findIndex(photo => photo.id === id), photos: next };
    changePhotos(next);
    setSelectionFeedback(null);
    setPhotoError("");
  }

  return (
    <section className="photo-picker" aria-labelledby={showHeading ? prefix + "-heading" : undefined}>
      {showHeading && <h2 id={prefix + "-heading"}>Your photos</h2>}
      <div ref={uploadPanel} className="photo-picker__upload" data-disabled={disabled || atLimit}
        tabIndex={-1} role="group" aria-label={atLimit ? "Your photos are ready" : "Choose photos"}>
        <svg className="photo-picker__icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="4" y="5" width="24" height="22" rx="4" />
          <circle cx="12" cy="12" r="2" />
          <path d="m5 23 7-7 5 5 4-4 6 6" />
        </svg>
        <label className="photo-picker__trigger" htmlFor={prefix + "-input"}>
          {atLimit ? "Your photos are ready" : photos.length ? "Add more photos" : "Choose photos"}
        </label>
        <p id={prefix + "-limits"} className="photo-picker__hint">Up to {MAX_PHOTOS} photos · {MAX_PHOTO_SIZE_MB} MB each</p>
        <input ref={fileInput} className="photo-picker__input" type="file" id={prefix + "-input"} accept={ACCEPTED_FILE_TYPES} multiple
          onClick={() => onDialogStateChange?.(true)} onCancel={() => onDialogStateChange?.(false)}
          disabled={disabled || atLimit} onChange={choose} aria-invalid={hasSelectionError ? "true" : undefined}
          aria-describedby={`${prefix}-limits ${prefix}-guidance${note ? ` ${prefix}-note` : ""} ${prefix}-error`} />
      </div>
      <details className="photo-picker__help">
        <summary>Photo formats and tips</summary>
        <p id={prefix + "-guidance"} className="photo-picker__guidance">
          {ALLOWED_FILE_TYPE_LABELS}. For HEIC or HEIF, export or convert a copy to JPEG or PNG, then choose that copy. Keep your original.
        </p>
        {note && !disabled && <p id={prefix + "-note"} className="photo-picker__guidance">{note}</p>}
      </details>
      {atLimit && !disabled && <p className="photo-picker__guidance">Remove a photo below to choose another.</p>}
      {note && disabled && <p id={prefix + "-note"} className="photo-picker__guidance">{note}</p>}
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
      <output className="photo-picker__count" aria-live="polite">{photos.length} of {MAX_PHOTOS} photos selected.</output>
      {photos.length > 0 && (
        <fieldset className="photo-selection">
          <legend className="visually-hidden">Selected photos</legend>
          <ul className={`photo-grid photo-grid--compact${renderPhoto ? " photo-grid--batch" : ""}`}>
            {photos.map((photo, index) => (
              <li key={photo.id} className="photo-card photo-card--compact">
                <div className="photo-card__preview"><PhotoPreview file={photo.file} alt={`Photo ${index + 1}`} /></div>
                <div className="photo-card__content">
                  <div className="photo-card__heading">
                    <span>Photo {index + 1}</span>
                    {!disabled && <button className="photo-card__remove" type="button" onClick={() => removePhoto(photo.id)}
                      ref={node => { if (node) removeButtons.current.set(photo.id, node); else removeButtons.current.delete(photo.id); }}
                      aria-label={`Remove photo ${index + 1}, ${photo.file.name}`}>Remove</button>}
                  </div>
                  {renderPhoto?.(photo, index)}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </section>
  );
}
