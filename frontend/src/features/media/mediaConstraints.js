export const MAX_PHOTOS = 5;
export const MAX_PHOTO_SIZE_MB = 10;

// MIME types identify formats to both the file picker and our validation.
export const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// File.size is measured in bytes; one MB is 1,000 × 1,000 bytes.
export const MAX_PHOTO_BYTES = MAX_PHOTO_SIZE_MB * 1_000_000;

// Derive picker options and readable labels from the same allowed types.
export const ACCEPTED_FILE_TYPES = Array.from(ALLOWED_FILE_TYPES).join(",");
export const ALLOWED_FILE_TYPE_LABELS = new Intl.ListFormat("en", {
  style: "long",
  type: "disjunction",
}).format(
  Array.from(ALLOWED_FILE_TYPES, (type) =>
    type.replace("image/", "").toUpperCase(),
  ),
);
