export const MAX_AUDIO_BYTES = 25_000_000;
export const MAX_AUDIO_SECONDS = 120;
export const AUDIO_CONTENT_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);
export const AUDIO_ACCEPT = [...AUDIO_CONTENT_TYPES].join(",");
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4",
  "audio/ogg;codecs=opus", "audio/webm",
];

export function audioContentType(type) {
  const base = typeof type === "string" ? type.split(";", 1)[0].trim().toLowerCase() : "";
  return AUDIO_CONTENT_TYPES.has(base) ? base : null;
}

export function audioFilename(type) {
  return "voice-memory." + ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" }[type] ?? "audio");
}

// Production collection stays hidden until separate server and device acceptance.
export const audioCollectionEnabled = value => value === "true";
