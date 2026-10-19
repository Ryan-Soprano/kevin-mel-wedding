import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, RECORDER_MIME_CANDIDATES,
  audioContentType, audioFileContentType, audioFilename } from "./audioConstraints.js";

const ACTIVE_PHASES = new Set(["requesting", "recording", "stopping", "checking"]);

export class AudioCaptureError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Local replay/duration checks are advisory; the server verifies original codecs and bytes. */
export async function validateAudioFile(file, {
  AudioContextType = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
  timeoutMs = 20_000,
} = {}) {
  const type = audioFileContentType(file);
  if (!(file instanceof Blob) || !type || !file.size || file.size > MAX_AUDIO_BYTES) {
    throw new AudioCaptureError("FILE_INVALID");
  }
  if (!AudioContextType) throw new AudioCaptureError("DECODE_UNSUPPORTED");
  let timer, context;
  try {
    context = new AudioContextType();
    const decode = async () => context.decodeAudioData(await file.arrayBuffer());
    const decoded = await Promise.race([decode(), new Promise((_, reject) => {
      timer = setTimeoutImpl(() => reject(new AudioCaptureError("DECODE_TIMEOUT")), timeoutMs);
    })]);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new AudioCaptureError("DECODE_FAILED");
    if (decoded.duration > MAX_AUDIO_SECONDS) throw new AudioCaptureError("DURATION_LIMIT");
    const filename = typeof file.name === "string" ? file.name : audioFilename(type);
    // Canonical Content-Type, unchanged bytes. Retain this exact File throughout retries.
    return { file: new File([file], filename, { type }), durationSeconds: decoded.duration };
  } catch (error) {
    if (error instanceof AudioCaptureError) throw error;
    throw new AudioCaptureError("DECODE_FAILED");
  } finally {
    clearTimeoutImpl(timer);
    try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Cleanup cannot alter validation outcome. */ }
  }
}

export function createAudioCapture({
  Recorder = globalThis.MediaRecorder,
  requestStream = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices),
  secure = globalThis.isSecureContext,
  validate = validateAudioFile, createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
  now = () => performance.now(), setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
  onChange = () => {},
} = {}) {
  const supported = Boolean(secure && Recorder && requestStream);
  let state = Object.freeze({ phase: supported ? "idle" : "unsupported", supported,
    clip: null, errorCode: null, elapsedSeconds: 0 });
  let generation = 0, disposed = false, recorder = null, stream = null, chunks = [], bytes = 0, startedAt = 0;
  let deadline = null, tick = null, stopDeadline = null, trackEnded = null;

  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    try { onChange(state); } catch { /* Capture lifetime does not depend on rendering. */ }
  }
  function clearTimers() {
    [deadline, tick, stopDeadline].forEach(clearTimeoutImpl);
    deadline = tick = stopDeadline = null;
  }
  function stopTracks(incoming, endedListener) {
    for (const track of incoming?.getTracks() ?? []) {
      if (endedListener) track.removeEventListener("ended", endedListener);
      try { track.stop(); } catch { /* Release every other track as well. */ }
    }
  }
  function releaseTracks() {
    stopTracks(stream, trackEnded);
    stream = null;
  }
  function clearClip() {
    if (state.clip) { try { revokeUrl(state.clip.url); } catch { /* Clear state regardless. */ } }
  }
  function discard() {
    generation++;
    clearTimers(); clearClip(); chunks = []; bytes = 0;
    const previous = recorder;
    recorder = null;
    if (previous && previous.state !== "inactive") { try { previous.stop(); } catch { /* Tracks are still stopped. */ } }
    releaseTracks();
    const cleared = { phase: supported ? "idle" : "unsupported", clip: null, errorCode: null, elapsedSeconds: 0 };
    // Disposal clears the exposed snapshot without reentering its subscriber.
    if (disposed) state = Object.freeze({ ...state, ...cleared });
    else publish(cleared);
  }
  function interrupt(code = "INTERRUPTED") {
    if (!ACTIVE_PHASES.has(state.phase)) return;
    const token = generation + 1;
    discard();
    if (token !== generation || disposed) return;
    publish({ phase: "error", errorCode: code });
  }
  async function check(file, token) {
    if (token !== generation || disposed) return;
    publish({ phase: "checking", errorCode: null });
    if (token !== generation || disposed) return;
    try {
      const accepted = await validate(file);
      if (token !== generation || disposed) return;
      if (!(accepted.file instanceof Blob) || !AUDIO_CONTENT_TYPES.has(accepted.file.type)
        || !accepted.file.size || accepted.file.size > MAX_AUDIO_BYTES
        || !Number.isFinite(accepted.durationSeconds) || accepted.durationSeconds <= 0
        || accepted.durationSeconds > MAX_AUDIO_SECONDS) throw new AudioCaptureError("FILE_INVALID");
      const url = createUrl(accepted.file);
      if (token !== generation || disposed) { revokeUrl(url); return; }
      publish({ phase: "ready", clip: Object.freeze({ ...accepted, url }), errorCode: null });
    } catch (error) {
      if (token !== generation || disposed) return;
      publish({ phase: "error", clip: null, errorCode: error.code ?? "DECODE_FAILED" });
    }
  }
  function updateClock(token) {
    if (disposed || token !== generation || state.phase !== "recording") return;
    publish({ elapsedSeconds: Math.floor((now() - startedAt) / 1000) });
    if (disposed || token !== generation || state.phase !== "recording") return;
    tick = setTimeoutImpl(() => updateClock(token), 1000);
  }
  function stop() {
    if (state.phase !== "recording") return;
    const token = generation;
    clearTimeoutImpl(deadline); clearTimeoutImpl(tick); deadline = tick = null;
    publish({ phase: "stopping", elapsedSeconds: Math.floor((now() - startedAt) / 1000) });
    if (token !== generation || disposed || state.phase !== "stopping") return;
    stopDeadline = setTimeoutImpl(() => interrupt("RECORDER_ERROR"), 5000);
    try { recorder.stop(); } catch { interrupt("RECORDER_ERROR"); }
    releaseTracks();
  }
  const capture = {
    getSnapshot: () => state,
    async start() {
      if (disposed || !supported || ACTIVE_PHASES.has(state.phase)) return;
      const token = generation + 1;
      discard();
      if (token !== generation || disposed) return;
      publish({ phase: "requesting" });
      if (token !== generation || disposed || state.phase !== "requesting") return;
      deadline = setTimeoutImpl(() => interrupt("PERMISSION_TIMEOUT"), 30_000);
      try {
        const incoming = await requestStream({ audio: true, video: false });
        if (token !== generation || disposed) { stopTracks(incoming); return; }
        clearTimeoutImpl(deadline); deadline = null; stream = incoming;
        let selected;
        for (const mimeType of RECORDER_MIME_CANDIDATES) {
          if (!Recorder.isTypeSupported?.(mimeType)) continue;
          try { selected = new Recorder(stream, { mimeType }); break; } catch { /* Try the next supported hint. */ }
        }
        selected ??= new Recorder(stream);
        if (!audioContentType(selected.mimeType)) throw new AudioCaptureError("FORMAT_UNSUPPORTED");
        recorder = selected;
        trackEnded = () => { if (token === generation) interrupt("INTERRUPTED"); };
        stream.getTracks().forEach(track => track.addEventListener("ended", trackEnded));
        selected.ondataavailable = ({ data }) => {
          if (token !== generation || disposed || !data?.size) return;
          bytes += data.size;
          if (bytes > MAX_AUDIO_BYTES) { interrupt("BYTE_LIMIT"); return; }
          chunks.push(data);
        };
        selected.onerror = () => { if (token === generation) interrupt("RECORDER_ERROR"); };
        selected.onstop = () => {
          if (token !== generation || disposed) return;
          if (state.phase !== "stopping") { interrupt("INTERRUPTED"); return; }
          clearTimers(); releaseTracks(); recorder = null;
          const file = new File(chunks, audioFilename(audioContentType(selected.mimeType)), { type: selected.mimeType });
          chunks = [];
          void check(file, token);
        };
        startedAt = now(); selected.start(1000);
        if (token !== generation || disposed) return;
        publish({ phase: "recording", elapsedSeconds: 0 });
        if (token !== generation || disposed || state.phase !== "recording") return;
        // Encoder finishing time fits inside the independently checked two-minute limit.
        deadline = setTimeoutImpl(stop, 119_000);
        tick = setTimeoutImpl(() => updateClock(token), 1000);
      } catch (error) {
        if (token !== generation || disposed) return;
        const discardedToken = generation + 1;
        discard();
        if (discardedToken !== generation || disposed) return;
        publish({ phase: "error", errorCode: ["NotAllowedError", "SecurityError"].includes(error.name)
          ? "PERMISSION_DENIED" : error.code ?? "RECORDER_ERROR" });
      }
    },
    stop, discard, interrupt,
    useFile(file) {
      if (disposed) return Promise.resolve();
      const token = generation + 1;
      discard();
      return file ? check(file, token) : Promise.resolve();
    },
    dispose() { if (disposed) return; disposed = true; discard(); },
  };
  return Object.freeze(capture);
}
