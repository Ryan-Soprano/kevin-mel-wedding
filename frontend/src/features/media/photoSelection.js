import {
  ALLOWED_FILE_TYPES, ALLOWED_FILE_TYPE_LABELS, MAX_PHOTO_BYTES, MAX_PHOTO_SIZE_MB, MAX_PHOTOS,
} from "./mediaConstraints.js";

function getPhotoRejection(file) {
  if (!(file instanceof Blob) || !ALLOWED_FILE_TYPES.has(file.type)) {
    return `Use a ${ALLOWED_FILE_TYPE_LABELS} file. For HEIC or HEIF, export or convert a copy to JPEG or PNG and keep your original.`;
  }
  if (!file.size) return "This file is empty. Choose a different copy of the photo.";
  if (file.size > MAX_PHOTO_BYTES) return `This file is larger than ${MAX_PHOTO_SIZE_MB} MB. Choose a smaller copy and keep your original.`;
  return null;
}

/** Validate a whole addition before changing the retained selection or allocating IDs. */
export function addPhotoSelection(current, files, createId = () => crypto.randomUUID()) {
  if (!files.length) return current;
  if (current.length + files.length > MAX_PHOTOS) {
    throw new Error(`You can select up to ${MAX_PHOTOS} photos. No photos from this selection were added.`);
  }
  const invalidIndex = files.findIndex(file => getPhotoRejection(file));
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

/** Keep acceptable originals from a picker addition and explain each skipped file. */
export function addPhotoSelectionWithFeedback(current, files, createId = () => crypto.randomUUID()) {
  const accepted = [];
  const rejections = [];
  for (const file of files) {
    let reason = getPhotoRejection(file);
    if (!reason && current.length + accepted.length >= MAX_PHOTOS) {
      reason = `You can select up to ${MAX_PHOTOS} photos. Remove a selected photo to make room for this one.`;
    }
    if (reason) rejections.push({ fileName: file?.name || "This photo", reason });
    else accepted.push(file);
  }
  return {
    photos: addPhotoSelection(current, accepted, createId),
    addedCount: accepted.length,
    rejections,
  };
}

export function removePhotoSelection(current, selectedIds) {
  return current.filter(photo => !selectedIds.has(photo.id));
}
