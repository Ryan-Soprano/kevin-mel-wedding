export const REVIEW_STATUS_LABELS = { PENDING: "Pending", KEEP: "Kept", ARCHIVED: "Archived", DELETE: "Recently deleted" };
const REVIEW_ACTION_LABELS = { PENDING: "Restore to inbox", KEEP: "Keep privately", ARCHIVED: "Archive", DELETE: "Delete" };
export const VISIBILITY_LABELS = { COUPLE_ONLY: "Private · Kevin & Melanie", FRIENDS_FAMILY: "Friends & Family · Private link", PUBLIC: "Public · Guest site" };
export const MEMORY_TYPE_LABELS = { TEXT: "Written note", PHOTO: "Photo", AUDIO: "Voice memory" };
const MEMORY_SHORT_LABELS = { TEXT: "note", PHOTO: "photo", AUDIO: "voice memory" };
const AUTHENTICATED_PHASES = new Set(["inbox", "detail", "create", "albums", "timeline", "library", "tags", "export"]);
const PHASE_TITLES = Object.freeze({
  export: "Export your private archive",
  library: "Your memory library",
  tags: "Your tags",
  timeline: "Your life timeline",
  albums: "Your albums",
  detail: "Your memory",
  create: "Add a memory",
  login: "Sign in to your archive",
  "password-change": "Choose your password",
  unavailable: "Archive access unavailable",
});

export function getInboxTitle(phase) {
  return PHASE_TITLES[phase] ?? "Memory inbox";
}

export function isInboxAuthenticated(snapshot) {
  return snapshot.session?.authenticated && !snapshot.session.passwordChangeRequired && AUTHENTICATED_PHASES.has(snapshot.phase);
}

export function isInboxLocked(snapshot) {
  return snapshot.review.phase !== "idle" || snapshot.metadata.phase !== "idle"
    || snapshot.albums.mutation.phase !== "idle" || snapshot.timeline.mutation.phase !== "idle"
    || snapshot.tags.mutation.phase !== "idle" || snapshot.export.mutation.phase !== "idle";
}

export function getMemoryCardTitle(memory) {
  if (memory.title != null) return memory.title;
  if (memory.source === "COUPLE") return "Couple memory";
  return memory.guestName ?? "Name not provided";
}

export function getMemoryDetailTitle(memory) {
  if (memory.title != null) return memory.title;
  if (memory.source === "COUPLE") return "Couple memory";
  return `From ${memory.guestName ?? "Name not provided"}`;
}

export function getMemorySourceLabel(memory) {
  if (memory.source === "COUPLE") return "Couple memory";
  return `Guest contribution · From ${memory.guestName ?? "Name not provided"}`;
}

export function getMemoryExcerpt(memory) {
  if (memory.memoryType === "TEXT") return memory.textContent.slice(0, 180);
  return memory.caption ?? (memory.memoryType === "PHOTO" ? "A photo saved in your vault." : "A voice memory saved in your vault.");
}

export function getMemoryOpenLabel(memory) {
  if (memory.title != null) return `Open ${memory.title}`;
  const type = MEMORY_SHORT_LABELS[memory.memoryType];
  if (memory.source === "COUPLE") return `Open couple ${type}`;
  return `Open ${type} from ${memory.guestName ?? "Name not provided"}`;
}

export function getDetailBackLabel(snapshot) {
  if (snapshot.libraryReturn) return "Back to library";
  if (snapshot.tagReturnId) return "Back to tag";
  if (snapshot.timelineReturnId) return "Back to timeline event";
  if (snapshot.albumReturnId) return "Back to album";
  return "Back to inbox";
}

export function getReviewProgressLabel(review) {
  if (review.phase === "saving") return `Saving: ${review.targetStatus === "KEEP" && review.targetVisibility
    ? VISIBILITY_LABELS[review.targetVisibility] : REVIEW_ACTION_LABELS[review.targetStatus]}…`;
  if (review.phase === "refreshing") return "Refreshing your session and this memory…";
  if (review.phase === "loading") return "Loading this memory’s current state…";
  return null;
}

export function getAudioLabel(memory) {
  if (memory.title != null) return memory.title;
  if (memory.source === "COUPLE") return "Couple voice memory";
  return `Voice memory from ${memory.guestName ?? "an unnamed guest"}`;
}

export function getPhotoAlt(memory) {
  if (memory.caption != null) return memory.caption;
  if (memory.title != null) return memory.title;
  if (memory.source === "COUPLE") return "Couple photo";
  return `Photo shared by ${memory.guestName ?? "an unnamed guest"}`;
}
