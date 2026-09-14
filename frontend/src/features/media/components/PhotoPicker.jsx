import { useRef, useState } from "react";

import {
  ACCEPTED_FILE_TYPES,
  ALLOWED_FILE_TYPE_LABELS,
  ALLOWED_FILE_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIZE_MB,
  MAX_PHOTOS,
} from "../mediaConstraints.js";
import PhotoPreview from "./PhotoPreview.jsx";

export default function PhotoPicker() {
  // These file references are local state and are not part of App's text request.
  const nextPhotoId = useRef(0);
  const [photos, setPhotos] = useState([]);
  const [photoIdsSelectedForRemoval, setPhotoIdsSelectedForRemoval] = useState(
    new Set(),
  );
  const [photoError, setPhotoError] = useState("");

  function handlePhotoSelection(event) {
    const selectedFiles = Array.from(event.target.files ?? []);

    // Allow selecting the same file after a rejected selection
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    // Check the entire new selection before adding any files. Previously
    // accepted photos remain selected if this batch fails validation.
    if (photos.length + selectedFiles.length > MAX_PHOTOS) {
      setPhotoError(
        `You can only select up to ${MAX_PHOTOS} photos. ` +
          "No photos from this selection were added.",
      );
      return;
    }

    // The input's accept attribute guides the picker, but does not validate files.
    const invalidFile = selectedFiles.find(
      (file) =>
        !ALLOWED_FILE_TYPES.has(file.type) ||
        file.size === 0 ||
        file.size > MAX_PHOTO_BYTES,
    );

    if (invalidFile) {
      setPhotoError(
        `"${invalidFile.name}" must be a non-empty ${ALLOWED_FILE_TYPE_LABELS} ` +
          `file no larger than ${MAX_PHOTO_SIZE_MB} MB. ` +
          "No photos from this selection were added.",
      );
      return;
    }

    const newPhotos = selectedFiles.map((file) => ({
      id: nextPhotoId.current++,
      file,
    }));
    setPhotos((currentPhotos) => [...currentPhotos, ...newPhotos]);
    setPhotoError("");
  }

  function handlePhotoRemovalSelection(photoId) {
    setPhotoIdsSelectedForRemoval((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(photoId)) {
        nextIds.delete(photoId);
      } else {
        nextIds.add(photoId);
      }

      return nextIds;
    });
  }

  function handleRemoveSelectedPhotos() {
    setPhotos((currentPhotos) =>
      currentPhotos.filter(
        (photo) => !photoIdsSelectedForRemoval.has(photo.id),
      ),
    );

    setPhotoIdsSelectedForRemoval(new Set());
    setPhotoError("");
  }

  return (
    <section aria-labelledby="photos-heading">
      <h2 id="photos-heading">Add photos (optional)</h2>
      <p id="photos-local-note">
        Photo previews are available to try. Sending and saving photos is coming
        next.
      </p>

      <label htmlFor="photos">Choose photos</label>
      <p id="photos-guidance">
        Select up to {MAX_PHOTOS} photos ({ALLOWED_FILE_TYPE_LABELS}) no larger
        than {MAX_PHOTO_SIZE_MB} MB each.
      </p>

      {/* Associate the guidance and feedback with the picker for screen readers. */}
      <input
        type="file"
        id="photos"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        onChange={handlePhotoSelection}
        aria-describedby="photos-guidance photos-local-note photos-error"
      />

      <p id="photos-error" className="form-error" role="alert">
        {photoError}
      </p>

      <output aria-live="polite">
        {photos.length} of {MAX_PHOTOS} photos selected.
      </output>

      {photos.length > 0 && (
        <fieldset className="photo-selection">
          <legend>Select photos to remove</legend>

          <ul className="photo-grid">
            {photos.map((photo) => {
              const isSelectedForRemoval = photoIdsSelectedForRemoval.has(
                photo.id,
              );

              return (
                <li
                  key={photo.id}
                  className={
                    isSelectedForRemoval
                      ? "photo-card photo-card--selected"
                      : "photo-card"
                  }
                >
                  <label className="photo-card__label">
                    <input
                      className="photo-card__checkbox"
                      type="checkbox"
                      checked={isSelectedForRemoval}
                      onChange={() => handlePhotoRemovalSelection(photo.id)}
                      aria-label={`Select ${photo.file.name} for removal`}
                    />

                    <PhotoPreview file={photo.file} />
                  </label>
                </li>
              );
            })}
          </ul>

          <button
            className="photo-remove-button"
            type="button"
            disabled={photoIdsSelectedForRemoval.size === 0}
            onClick={handleRemoveSelectedPhotos}
          >
            Remove selected photos
          </button>
        </fieldset>
      )}
    </section>
  );
}
