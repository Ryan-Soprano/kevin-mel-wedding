const STATUS_LABELS = {
  queued: "Queued", preparing: "Preparing original photo", uploading: "Uploading original photo",
  finalizing: "Verifying original photo", saved: "Sent", rejected: "Photo rejected",
};
const GUEST_COPY = {
  title: "Share photos",
  introduction: "A favorite moment, a candid smile, or a little glimpse of the day.",
  reviewTitle: "Ready to send your photos?",
  reviewDescription: "Your photos will be sent to Kevin and Melanie. They may choose to share them. Keep this page open until every photo is confirmed.",
  sendLabel: "Send photos", finishLabel: "Back to our photos",
};
const PRIVATE_COPY = {
  title: "Add photos",
  introduction: "Keep a few favorite moments together in your private archive.",
  reviewTitle: "Ready to save your photos privately?",
  reviewDescription: "These originals will be kept in your private archive. Add a title, description and date to each after saving.",
  sendLabel: "Save photos privately", finishLabel: "View added memory",
};

export function getPhotoBatchCopy(privateArchive) {
  if (privateArchive) return PRIVATE_COPY;
  return GUEST_COPY;
}

export function getPhotoStatusText(item, privateArchive = false) {
  if (!item) return "Queued";
  if (item.status === "saved" && privateArchive) return "Saved privately";
  if (item.status === "failed") {
    if (item.error?.unknownOutcome) return "Not confirmed";
    return "Needs retry";
  }
  return STATUS_LABELS[item.status] || "Not confirmed";
}

export function getPhotoBatchSafeError(error) {
  if (error?.status === 429 || (error?.status === 503 && error?.retryAfterSeconds > 0)) {
    return "Please wait before retrying. Keep this page open; your original photos are still here.";
  }
  if (["VALIDATION_FAILED", "INVALID_MEDIA"].includes(error?.code) && typeof error.message === "string") return error.message;
  return "We could not confirm every photo. Keep this page open and retry the original photos that still need attention.";
}

export function getPhotoBatchSummary({ busy, activeItem, savedCount, totalCount, retained, privateArchive = false }) {
  if (busy) {
    if (activeItem) return `${getPhotoStatusText(activeItem, privateArchive)}: ${activeItem.fileName}. ${savedCount} of ${totalCount} photos ${privateArchive ? "saved" : "sent"}.`;
    return "Preparing your photo batch…";
  }
  if (retained) return `${savedCount} of ${totalCount} photos ${privateArchive ? "saved privately" : "sent"}.`;
  return "";
}

export function getPhotoBatchGuestName(privateArchive, guestName) {
  if (privateArchive) return null;
  return guestName;
}

export function getPhotoBatchFailureFocus(editable, fields, photos) {
  if (!editable) return "error";
  if (fields.name) return "name";
  return photos.find(photo => fields[photo.id])?.id || "error";
}

export function getPhotoSendLabel(busy, globalWait, privateArchive) {
  if (busy) return privateArchive ? "Saving photos…" : "Sending photos…";
  if (globalWait) return `Wait ${globalWait} seconds before sending`;
  return getPhotoBatchCopy(privateArchive).sendLabel;
}

export function getPhotoReviewLabel(globalWait) {
  if (globalWait) return `Wait ${globalWait} seconds before reviewing`;
  return "Review photos";
}

export function getPhotoRetryLabel(busy, globalWait, privateArchive = false) {
  if (busy) return privateArchive ? "Saving photos…" : "Sending photos…";
  if (globalWait) return `Wait ${globalWait} seconds before retrying`;
  return "Retry selected photos";
}

export function getPhotoRetryChoiceLabel(index, globalWait, itemWait) {
  const label = `Select photo ${index + 1} to retry`;
  const wait = Math.max(globalWait, itemWait);
  if (wait) return `${label} (wait ${wait} seconds)`;
  return label;
}

export function getPhotoResultLabel(complete, savedCount, totalCount, privateArchive = false) {
  if (complete) {
    if (privateArchive) return "All your photos were saved privately.";
    if (totalCount === 1) return "Your photo has been sent to Kevin and Melanie!";
    return `Your ${totalCount} photos have been sent to Kevin and Melanie!`;
  }
  if (privateArchive) return `${savedCount} of ${totalCount} photos are confirmed saved.`;
  return `${savedCount} of ${totalCount} photos sent.`;
}

export function getPhotoResetLabel(complete) {
  if (complete) return "Share another batch";
  return "Start a new batch";
}
