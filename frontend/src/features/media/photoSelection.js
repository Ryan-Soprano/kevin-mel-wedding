import {
  ALLOWED_FILE_TYPES, ALLOWED_FILE_TYPE_LABELS, MAX_PHOTO_BYTES, MAX_PHOTO_SIZE_MB, MAX_PHOTOS,
} from "./mediaConstraints.js";

/** Validate a whole addition before changing the retained selection or allocating IDs. */
export function addPhotoSelection(current, files, createId = () => crypto.randomUUID()) {
  if (!files.length) return current;
  if (current.length + files.length > MAX_PHOTOS) {
    throw new Error(`You can select up to ${MAX_PHOTOS} photos. No photos from this selection were added.`);
  }
  const invalidIndex = files.findIndex(file => !(file instanceof Blob) || !ALLOWED_FILE_TYPES.has(file.type)
    || !file.size || file.size > MAX_PHOTO_BYTES);
  if (invalidIndex >= 0) {
    const invalid = files[invalidIndex];
    throw new Error(`"${invalid?.name || "This photo"}" must be a non-empty ${ALLOWED_FILE_TYPE_LABELS} file no larger than ${MAX_PHOTO_SIZE_MB} MB. No photos from this selection were added.`);
  }
  const seen = new Set(current.map(photo => photo.id));
  const added = files.map(file => {
    const id = createId();
    if (!id || seen.has(id)) throw new Error("Could not identify this selection. Please choose the photos again.");
    seen.add(id);
    return { id, file, caption: "" };
  });
  return [...current, ...added];
}

export function removePhotoSelection(current, selectedIds) {
  return current.filter(photo => !selectedIds.has(photo.id));
}
