import { ApiError } from "../../shared/api/apiClient.js";

const GUEST_COPY = {
  introduction: "Your note goes privately to Kevin and Melanie. Your name is optional.",
  reviewTitle: "Ready to send?", sendLabel: "Send note",
  resultTitle: "Thank you — your note was saved for Kevin and Melanie.",
  resultDescription: "They can review it privately when their archive is ready.",
  finishLabel: "Done",
};
const PRIVATE_COPY = {
  introduction: "Add a written memory to your private archive. You can add a title, description and date after saving.",
  reviewTitle: "Ready to save privately?", sendLabel: "Save note privately",
  resultTitle: "Your note is saved in your private archive.",
  resultDescription: "New memories start in Kept. Open this memory to see its current status and add a title, description or date.",
  finishLabel: "View added memory",
};

export function getContributionCopy(privateArchive) {
  if (privateArchive) return PRIVATE_COPY;
  return GUEST_COPY;
}

export function getContributionGuestName(privateArchive, guestName) {
  if (privateArchive) return null;
  return guestName;
}

export function getContributionValidationField(fields) {
  if (fields.guestName) return "guestName";
  return "message";
}

export function getContributionSubmitError(failure) {
  if (failure instanceof ApiError) {
    if (failure.unknownOutcome) return "We could not confirm whether your note was saved. Keep this page open and try again to check the same note.";
    return failure.message;
  }
  return "We could not confirm whether your note was saved. Keep this page open and try again.";
}

export function getContributionSendLabel({ isSubmitting, retryAfter, pending }, privateArchive) {
  if (isSubmitting) return "Saving…";
  if (retryAfter > 0) return "Please wait before trying again";
  if (pending) return "Try again";
  return getContributionCopy(privateArchive).sendLabel;
}

export function getContributionShareLabel(hasShellActions) {
  if (hasShellActions) return "Share another memory";
  return "Write another note";
}
