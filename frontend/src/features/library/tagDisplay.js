export const TAG_REVIEW_STATUSES = {
  KEEP: "Kept",
  PENDING: "Pending",
  ARCHIVED: "Archived",
};

export const TAG_MEMORY_TYPES = {
  TEXT: "Written note",
  PHOTO: "Photo",
  AUDIO: "Voice memory",
};

export function getTagMemoryNoun(count) {
  if (count === 1) {
    return "memory";
  }
  return "memories";
}

export function getTagMemoryHeading(memory) {
  if (memory.title !== null && memory.title !== undefined) {
    return memory.title;
  }
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `From ${memory.guestName ?? "Name not provided"}`;
}

export function getTagMemorySource(memory) {
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `Guest contribution · From ${memory.guestName ?? "Name not provided"}`;
}

export function getTagMemoryExcerpt(memory) {
  if (memory.memoryType === "TEXT") {
    return memory.textContent.slice(0, 180);
  }
  return memory.caption ?? memory.media.originalFilename;
}

export function getTagsFeedback(error, state) {
  const hasError = Boolean(error || state.error || state.mutation.error);
  let className = "inbox-review-notice";
  let role = "status";
  if (hasError) {
    className = "form-error";
    role = "alert";
  }
  return {
    visible: Boolean(error || state.error || state.mutation.error || state.notice),
    className,
    role,
    text: state.error ?? state.mutation.error ?? error ?? state.notice,
  };
}

export function getTagRecoveryStatus(phase) {
  if (phase === "saving") {
    return "Saving tag change…";
  }
  if (phase === "loading") {
    return "Checking the current tag…";
  }
  return null;
}

export function getTagReloadLabel(phase) {
  if (phase === "csrf") {
    return "Refresh session and current tag";
  }
  return "Reload current tag";
}
