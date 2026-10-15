import { emptyEventFields, eventFields } from "./timelineFields.js";

export const TIMELINE_REVIEW_LABELS = { KEEP: "Kept", PENDING: "Pending", ARCHIVED: "Archived" };
export const TIMELINE_MEMORY_TYPES = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
export const TIMELINE_PRECISIONS = { UNKNOWN: "Unknown", YEAR: "Year only", MONTH: "Month and year", DAY: "Exact day" };

export function initialTimelineFields(state) {
  if (state.event?.deletedAt === null) return eventFields(state.event);
  return emptyEventFields();
}

export function getTimelineDateInput(precision) {
  if (precision === "YEAR") return { inputMode: "numeric", maxLength: 4, placeholder: "YYYY" };
  if (precision === "MONTH") return { inputMode: undefined, maxLength: 7, placeholder: "YYYY-MM" };
  return { inputMode: undefined, maxLength: 10, placeholder: "YYYY-MM-DD" };
}

export function getTimelineMemoryHeading(memory) {
  if (memory.title != null) return memory.title;
  if (memory.source === "COUPLE") return "Couple memory";
  return `From ${memory.guestName ?? "Name not provided"}`;
}

export function getTimelineMemorySource(memory) {
  if (memory.source === "COUPLE") return "Couple memory";
  return `Guest contribution · From ${memory.guestName ?? "Name not provided"}`;
}

export function getTimelineMemoryExcerpt(memory) {
  if (memory.memoryType === "TEXT") return memory.textContent.slice(0, 180);
  return memory.caption ?? memory.media.originalFilename;
}

export function getTimelineMemoryCount(count) {
  if (count === 1) return "memory";
  return "memories";
}

export function getTimelineFeedback(error, state) {
  let className = "inbox-review-notice";
  let role = "status";
  if (error || state.error || state.mutation.error) {
    className = "form-error";
    role = "alert";
  }
  return {
    visible: Boolean(error || state.error || state.mutation.error || state.notice),
    className, role,
    text: error ?? state.error ?? state.mutation.error ?? state.notice,
  };
}

export function getTimelineProgressLabel(phase) {
  if (phase === "saving") return "Saving timeline change…";
  if (phase === "loading") return "Checking current event…";
  return null;
}

export function getTimelineReloadLabel(phase) {
  if (phase === "csrf") return "Refresh session and current event";
  return "Reload current event";
}

export function getTimelineYear(value) {
  if (value) return Number(value);
  return null;
}
