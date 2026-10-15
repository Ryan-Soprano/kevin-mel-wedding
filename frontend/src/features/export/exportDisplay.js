const TERMINAL_STATES = [
  "FAILED",
  "STALE",
  "CANCELLED",
  "EXPIRED",
];

export const EXPORT_STATE_LABELS = {
  CAPTURING: "Capturing archive details",
  READY: "Ready to prepare a part",
  PREPARING: "Preparing a ZIP part",
  READY_WITH_WARNINGS: "Ready with original-file warnings",
  FAILED: "Export failed",
  STALE: "Archive changed — start a fresh export",
  CANCELLED: "Export cancelled",
  EXPIRED: "Export expired",
};

export const EXPORT_ISSUE_LABELS = {
  MISSING: "Original file missing",
  INTEGRITY_MISMATCH: "Original size or checksum did not match",
  READ_FAILED: "Original could not be read",
};

export function formatExportBytes(value) {
  return (value / (1024 * 1024)).toFixed(2) + " MiB";
}

export function isTerminalExport(job) {
  return job && TERMINAL_STATES.includes(job.state);
}

export function canPrepareExportPart(job) {
  return job && ["READY", "READY_WITH_WARNINGS"].includes(job.state);
}

export function getExportFeedback(state) {
  let className = "inbox-review-notice";
  let role = "status";
  if (state.error || state.mutation.error) {
    className = "form-error";
    role = "alert";
  }
  return {
    visible: state.error || state.mutation.error || state.notice,
    className,
    role,
    text: state.error ?? state.mutation.error ?? state.notice,
  };
}

export function getExportStartLabel(job, unavailable) {
  if (job || unavailable) {
    return "Start a new export";
  }
  return "Prepare archive export";
}

export function getExportRecoveryLabel(phase) {
  if (phase === "csrf") {
    return "Refresh session and export status";
  }
  return "Check unconfirmed export action";
}

export function getExportPartKindLabel(kind) {
  if (kind === "INDEX") {
    return "Final index and offline reader";
  }
  return "Original files";
}

export function getExportPartStateLabel(state) {
  if (state === "UNPROCESSED") {
    return "Not prepared yet";
  }
  if (state === "CACHED") {
    return "Ready to download";
  }
  return "Previously processed";
}

export function getExportPartOriginalSummary(part) {
  if (part.kind === "ORIGINALS") {
    return ` · ${part.availableOriginals} included · ${part.unavailableOriginals} unavailable`;
  }
  return "";
}
