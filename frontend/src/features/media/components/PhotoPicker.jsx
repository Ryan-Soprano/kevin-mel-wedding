import { useId, useState } from "react";
import { ACCEPTED_FILE_TYPES, ALLOWED_FILE_TYPE_LABELS, MAX_PHOTO_SIZE_MB, MAX_PHOTOS } from "../mediaConstraints.js";
import { addPhotoSelection, removePhotoSelection } from "../photoSelection.js";
import PhotoPreview from "./PhotoPreview.jsx";

/** Controlled selection for the batch form, or a standalone local preview. */
export default function PhotoPicker({
  photos: controlledPhotos, onPhotosChange, disabled = false, inputRef,
  idPrefix, showHeading = true, renderPhoto,
  note = "Photo previews are available to try. Sending and saving photos is coming next.",
}) {
  const generatedId = useId();
  const prefix = idPrefix || `photos-${generatedId}`;
  const [localPhotos, setLocalPhotos] = useState([]);
  const [selectedForRemoval, setSelectedForRemoval] = useState(new Set());
  const [photoError, setPhotoError] = useState("");
  const photos = controlledPhotos ?? localPhotos;
  const changePhotos = onPhotosChange ?? setLocalPhotos;
  const removalCount = photos.filter(photo => selectedForRemoval.has(photo.id)).length;

  function choose(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (disabled || !files.length) return;
    try {
      changePhotos(addPhotoSelection(photos, files));
      setPhotoError("");
    } catch (error) {
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
    setPhotoError("");
  }

  return (
    <section className="photo-picker" aria-labelledby={showHeading ? prefix + "-heading" : undefined}>
      {showHeading && <h2 id={prefix + "-heading"}>Add photos (optional)</h2>}
      <p id={prefix + "-note"}>{note}</p>
      <label htmlFor={prefix + "-input"}>Choose photos</label>
      <p id={prefix + "-guidance"}>
        Select up to {MAX_PHOTOS} photos ({ALLOWED_FILE_TYPE_LABELS}) no larger than {MAX_PHOTO_SIZE_MB} MB each.
      </p>
      <input ref={inputRef} type="file" id={prefix + "-input"} accept={ACCEPTED_FILE_TYPES} multiple
        disabled={disabled} onChange={choose} aria-invalid={photoError ? "true" : undefined}
        aria-describedby={`${prefix}-guidance ${prefix}-note ${prefix}-error`} />
      <p id={prefix + "-error"} className="form-error" role="alert">{photoError}</p>
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
                {renderPhoto ? renderPhoto(photo, index) : <p className="photo-card__filename">{photo.file.name}</p>}
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
