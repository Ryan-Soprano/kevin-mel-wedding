export const LIBRARY_MEMORY_TYPES = {
  ALL: "All memory types",
  TEXT: "Written notes",
  PHOTO: "Photos",
  AUDIO: "Voice memories",
};

export const LIBRARY_REVIEW_STATUSES = {
  ALL: "All active review states",
  PENDING: "Pending",
  KEEP: "Kept",
  ARCHIVED: "Archived",
};

export const LIBRARY_DATE_PRECISIONS = {
  ALL: "All date precisions",
  UNKNOWN: "Unknown",
  YEAR: "Year only",
  MONTH: "Month and year",
  DAY: "Exact day",
};

export function getLibraryMemoryHeading(memory) {
  if (memory.title != null) {
    return memory.title;
  }
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `From ${memory.guestName ?? "Name not provided"}`;
}

export function getLibraryMemorySource(memory) {
  if (memory.source === "COUPLE") {
    return "Couple memory";
  }
  return `Guest contribution · From ${memory.guestName ?? "Name not provided"}`;
}

export function getLibraryMemoryExcerpt(memory) {
  if (memory.memoryType === "TEXT") {
    return memory.textContent.slice(0, 180);
  }
  return memory.caption ?? memory.media.originalFilename;
}
