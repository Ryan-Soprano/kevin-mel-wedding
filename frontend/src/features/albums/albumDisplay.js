export const ALBUM_REVIEW_LABELS = {
  KEEP: "Kept",
  PENDING: "Pending",
  ARCHIVED: "Archived",
};

export const ALBUM_MEMORY_TYPES = {
  TEXT: "Written note",
  PHOTO: "Photo",
  AUDIO: "Voice memory",
};

export function getAlbumMemoryHeading(memory) {
  if (memory.title != null) {
    return memory.title;
  }
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `From ${memory.guestName ?? "Name not provided"}`;
}

export function getAlbumMemorySource(memory) {
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `Guest contribution · From ${memory.guestName ?? "Name not provided"}`;
}

export function getAlbumMemoryExcerpt(memory) {
  if (memory.memoryType === "TEXT") {
    return memory.textContent.slice(0, 180);
  }
  return memory.caption ?? memory.media.originalFilename;
}

export function getAlbumMemoryCount(count) {
  if (count === 1) {
    return "memory";
  }
  return "memories";
}

export function getAlbumFeedback(state) {
  let className = "inbox-review-notice";
  let role = "status";
  if (state.error || state.mutation.error) {
    className = "form-error";
    role = "alert";
  }
  return {
    visible: Boolean(state.error || state.mutation.error || state.notice),
    className,
    role,
    text: state.error ?? state.mutation.error ?? state.notice,
  };
}

export function getAlbumProgressLabel(phase) {
  if (phase === "saving") {
    return "Saving album change…";
  }
  if (phase === "loading") {
    return "Checking the current album…";
  }
  return null;
}

export function getAlbumReloadLabel(phase) {
  if (phase === "csrf") {
    return "Refresh session and current album";
  }
  return "Reload current album";
}
