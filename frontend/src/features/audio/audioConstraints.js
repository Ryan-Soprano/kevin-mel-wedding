export const MAX_AUDIO_BYTES = 25_000_000;
export const MAX_AUDIO_SECONDS = 120;
export const AUDIO_CONTENT_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);
const AUDIO_EXTENSIONS = new Map([
  [".webm", "audio/webm"], [".ogg", "audio/ogg"], [".oga", "audio/ogg"],
  [".m4a", "audio/mp4"], [".mp4", "audio/mp4"],
]);
const FILE_MIME_ALIASES = new Map([
  ["video/webm", "audio/webm"], ["audio/x-webm", "audio/webm"],
  ["application/ogg", "audio/ogg"], ["application/x-ogg", "audio/ogg"],
  ["video/ogg", "audio/ogg"], ["audio/x-ogg", "audio/ogg"],
  ["audio/x-m4a", "audio/mp4"], ["audio/m4a", "audio/mp4"],
  ["audio/x-mp4", "audio/mp4"], ["video/mp4", "audio/mp4"], ["application/mp4", "audio/mp4"],
]);
const GENERIC_FILE_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/binary"]);
export const AUDIO_ACCEPT = [...AUDIO_CONTENT_TYPES, ...AUDIO_EXTENSIONS.keys()].join(",");
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4",
  "audio/ogg;codecs=opus", "audio/webm",
];

export function audioContentType(type) {
  const base = typeof type === "string" ? type.split(";", 1)[0].trim().toLowerCase() : "";
  return AUDIO_CONTENT_TYPES.has(base) ? base : null;
}

/** Browser file labels describe containers, not their streams; the server verifies audio-only originals. */
export function audioFileContentType(file) {
  const type = typeof file?.type === "string" ? file.type.split(";", 1)[0].trim().toLowerCase() : "";
  const extension = typeof file?.name === "string" ? file.name.toLowerCase().match(/\.[^.]+$/)?.[0] : undefined;
  const inferred = AUDIO_EXTENSIONS.get(extension);
  if (extension && !inferred) return null;
  const canonical = audioContentType(type);
  if (canonical) return !inferred || inferred === canonical ? canonical : null;
  const alias = FILE_MIME_ALIASES.get(type);
  if (alias) return inferred === alias ? alias : null;
  return GENERIC_FILE_TYPES.has(type) ? inferred ?? null : null;
}

export function audioFilename(type) {
  return "voice-memory." + ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" }[type] ?? "audio");
}

// The guest build opts in explicitly; server admission is configured independently.
export const audioCollectionEnabled = value => value === "true";
