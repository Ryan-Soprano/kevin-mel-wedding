import {
  LocalAudioProbe,
  validateLocalAudio,
  MAX_BYTES,
  MAX_SECONDS,
} from "./probe-model.js";

const element = (id) => document.getElementById(id);
const phaseCopy = {
  idle: "Ready. Choose Start recording when you want to test the microphone.",
  unsupported:
    "Recording is unavailable here. Open the approved HTTPS staging address, or choose an existing audio file or written note.",
  requesting:
    "Waiting for your microphone permission. Nothing has been recorded yet.",
  recording: "Recording on this device. Choose Stop recording when you finish.",
  stopping: "Microphone stopped. Finishing the local clip…",
  checking: "Checking the actual audio bytes and duration on this device…",
  ready:
    "The local clip decodes. Use the player to check that your words are audible, then discard it.",
  denied:
    "Microphone access was denied or blocked. Allow it in browser settings and try again, or choose an existing audio file or written note.",
  unavailable:
    "The microphone or recorder could not start. Try again, choose an existing audio file, or use a written note.",
  interrupted:
    "Recording was interrupted and discarded. Return to this page and start a new test, or choose a fallback.",
  rejected:
    "This local clip could not be accepted. Discard it and try another short recording or audio file.",
};
const errorCopy = {
  BYTE_LIMIT: "The clip exceeds 25,000,000 bytes and was discarded.",
  DURATION_LIMIT: "The decoded clip exceeds two minutes and was discarded.",
  EMPTY: "The clip contains no audio bytes.",
  DECODE_FAILED:
    "This browser could not decode the audio bytes. Try another recording or file.",
  DECODE_UNSUPPORTED:
    "Local byte decoding is unsupported in this browser. Use a written note and record this result.",
};
const checks = [
  ["speaker", "Generated speaker test: two beeps are audible"],
  ["permission", "Permission allow and deny paths"],
  ["recordStop", "Start, stop and microphone indicator off"],
  ["replay", "Listen: audio is audible and replay works"],
  ["discard", "Discard: player clears and microphone stays off"],
  ["fallback", "Existing-file fallback and written-note link"],
  ["interruption", "Lock/background interruption and clear recovery"],
  ["limits", "Two-minute / 25 MB boundaries"],
  ["accessibility", "Screen-reader announcements and focus"],
];
for (const [id, label] of checks) {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const select = document.createElement("select");
  select.id = "check-" + id;
  for (const value of ["not tested", "pass", "fail"]) {
    const option = document.createElement("option");
    option.textContent = value;
    select.append(option);
  }
  wrapper.append(select);
  element("checks").append(wrapper);
}
const ua = navigator.userAgent;
const chromeMatch = /(?:CriOS|Chrome)\/(\d+(?:\.\d+)*)/.exec(ua);
const safariMatch = /Version\/(\d+(?:\.\d+)*).*Safari/.exec(ua);

let browserVersion = "";
if (chromeMatch) {
  browserVersion = "Chrome " + chromeMatch[1];
} else if (safariMatch) {
  browserVersion = "Safari " + safariMatch[1];
}
element("browser-version").value = browserVersion;
let previousPhase;
let lastClipEvidence = null;
const exports = new Set();
let speakerUrl = null;
let speakerPlaybackRequested = false;
// Decoding needs no speaker connection. Prefer an offline context so validation
// does not open a second hardware audio session after microphone capture.
const OfflineContext =
  window.OfflineAudioContext || window.webkitOfflineAudioContext;
const DecodeContext = OfflineContext
  ? class extends OfflineContext {
      constructor() {
        super(1, 1, 48_000);
      }
    }
  : window.AudioContext || window.webkitAudioContext;
const probe = new LocalAudioProbe({
  Recorder: window.MediaRecorder,
  requestStream: navigator.mediaDevices?.getUserMedia?.bind(
    navigator.mediaDevices,
  ),
  secure: window.isSecureContext,
  validate: (blob) => validateLocalAudio(blob, DecodeContext),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  onChange: render,
});
function report() {
  return {
    spike: "AUD-01",
    probeRevision: "signal-check-1",
    timestampUtc: new Date().toISOString(),
    environment: element("environment").value,
    deviceModel: element("device").value.trim(),
    osVersion: element("os-version").value.trim(),
    browserVersion: element("browser-version").value.trim(),
    secureContext: window.isSecureContext,
    recordingApiAvailable: probe.supported,
    limits: { maxSeconds: MAX_SECONDS, maxBytes: MAX_BYTES },
    localAudioOnly: true,
    uploaded: false,
    decodeContext: OfflineContext ? "offline" : "realtime fallback",
    speakerTest: {
      source: "locally generated two-beep WAV; no microphone",
      playbackRequested: speakerPlaybackRequested,
      playerErrorCode: element("speaker-audio").error?.code || null,
    },
    phase: probe.phase,
    events: probe.snapshot().events,
    lastValidatedClip: lastClipEvidence,
    manualObservations: Object.fromEntries(
      checks.map(([id]) => [id, element("check-" + id).value]),
    ),
    acceptance:
      "Preparation evidence only; actual iPhone Safari and Android Chrome HTTPS acceptance remains required",
  };
}
function render(snapshot) {
  element("start").disabled =
    !snapshot.supported ||
    ["requesting", "recording", "stopping", "checking"].includes(
      snapshot.phase,
    );
  element("speaker-test").disabled = [
    "requesting",
    "recording",
    "stopping",
    "checking",
  ].includes(snapshot.phase);
  element("speaker-audio").controls = !element("speaker-test").disabled;
  element("stop").disabled = snapshot.phase !== "recording";
  element("file").disabled = [
    "requesting",
    "recording",
    "stopping",
    "checking",
  ].includes(snapshot.phase);
  element("status").textContent =
    (phaseCopy[snapshot.phase] || "") +
    (snapshot.errorCode && errorCopy[snapshot.errorCode]
      ? " " + errorCopy[snapshot.errorCode]
      : "");
  const audio = element("audio");
  if (snapshot.clip) {
    if (audio.getAttribute("src") !== snapshot.clip.url)
      audio.src = snapshot.clip.url;
    lastClipEvidence = { ...snapshot.clip.evidence };
    element("clip-info").textContent =
      `${snapshot.clip.evidence.decodedDurationSeconds.toFixed(1)} seconds · ${snapshot.clip.evidence.byteSize.toLocaleString()} bytes · ${snapshot.clip.evidence.containerFromBytes}. Declared MIME is recorded separately; no production format is approved.`;
    const signal = snapshot.clip.evidence.signal;
    element("signal-info").textContent = !signal
      ? "Signal measurement unavailable. Audible replay still needs your check."
      : signal.allZeroSamples
        ? "No sound signal: every decoded sample is zero. The clip contains digital silence. Try recording again or choose an existing file."
        : signal.lowSignal
          ? `Very low sound level (${signal.rmsDbfs.toFixed(1)} dBFS). This is a diagnostic warning, not a speech test. If you spoke, check the selected microphone and try again.`
          : `Sound signal detected (${signal.rmsDbfs.toFixed(1)} dBFS average). This may be your words or background noise; listen to confirm. If the speaker test works but your words are missing, try an existing file.`;
    if (signal?.allZeroSamples)
      element("status").textContent =
        "The clip decodes, but it contains digital silence. Replay has not passed.";
    else if (signal?.lowSignal)
      element("status").textContent =
        "The clip decodes, but its sound level is very low. Replay has not passed.";
  } else if (audio.hasAttribute("src")) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  element("playback").hidden = !snapshot.clip;
  if (
    ["ready", "denied", "unavailable", "interrupted", "rejected"].includes(
      snapshot.phase,
    ) &&
    snapshot.phase !== previousPhase
  )
    element("status").focus();
  previousPhase = snapshot.phase;
  element("report").textContent = JSON.stringify(report(), null, 2);
}
element("support").textContent = probe.supported
  ? "Recording APIs are present. Actual recording bytes and replay still need this test."
  : "Recording APIs or a secure context are unavailable. The local-file and written-note fallbacks remain below.";
element("start").addEventListener("click", () => {
  element("speaker-audio").pause();
  void probe.start();
});
element("stop").addEventListener("click", () => probe.stop());
element("discard").addEventListener("click", () => {
  probe.discard();
  element("file").value = "";
  element(probe.supported ? "start" : "file").focus();
});
element("download-clip").addEventListener("click", () => {
  if (!probe.clip) return;
  const extension =
    { WAV: "wav", "MP4 family": "mp4", Ogg: "ogg", WebM: "webm" }[
      probe.clip.evidence.containerFromBytes
    ] || "bin";
  const link = document.createElement("a");
  link.href = probe.clip.url;
  link.download = "aud01-synthetic-test." + extension;
  link.click();
  probe.events.push({ event: "local-synthetic-clip-download-clicked" });
  element("status").textContent =
    "Local test-clip download requested. Transfer it yourself; this page has not uploaded or submitted it.";
  element("report").textContent = JSON.stringify(report(), null, 2);
});
element("file").addEventListener(
  "change",
  () => void probe.useFile(element("file").files[0]),
);
element("audio").addEventListener("error", () => {
  if (!probe.clip || !element("audio").error) return;
  element("status").textContent =
    "The player could not replay this clip. Record replay as fail, then discard or try a fallback.";
  element("status").focus();
});
function speakerTestWav() {
  const sampleRate = 16_000;
  const frames = sampleRate;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const text = (offset, value) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.codePointAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    let withinBeep = -1;
    if (time >= 0.1 && time < 0.35) {
      withinBeep = time - 0.1;
    } else if (time >= 0.55 && time < 0.8) {
      withinBeep = time - 0.55;
    }
    const envelope =
      withinBeep < 0
        ? 0
        : Math.min(1, withinBeep / 0.015, (0.25 - withinBeep) / 0.015);
    view.setInt16(
      44 + i * 2,
      Math.round(0.18 * envelope * Math.sin(2 * Math.PI * 440 * time) * 32767),
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
element("speaker-test").addEventListener("click", () => {
  const audio = element("speaker-audio");
  element("audio").pause();
  if (!speakerUrl) {
    speakerUrl = URL.createObjectURL(speakerTestWav());
    audio.src = speakerUrl;
  }
  audio.currentTime = 0;
  speakerPlaybackRequested = true;
  element("speaker-status").textContent =
    "Listen for two beeps, then mark the speaker check pass or fail below. Playback starting does not prove audibility.";
  element("report").textContent = JSON.stringify(report(), null, 2);
  void audio.play().catch(() => {
    element("speaker-status").textContent =
      "The speaker test could not start. Try the player’s Play control and record whether you hear it.";
    element("report").textContent = JSON.stringify(report(), null, 2);
  });
});
element("speaker-audio").addEventListener("error", () => {
  element("speaker-status").textContent =
    "The generated speaker test could not play. Record the speaker check as fail and try a known audio file.";
  element("report").textContent = JSON.stringify(report(), null, 2);
});
element("download").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report(), null, 2)], { type: "application/json" }),
  );
  exports.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = "aud01-technical-results.json";
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    exports.delete(url);
  }, 1000);
});
document.addEventListener("change", () => {
  element("report").textContent = JSON.stringify(report(), null, 2);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) probe.interrupt();
});
window.addEventListener("pagehide", () => {
  probe.dispose();
  element("speaker-audio").pause();
  if (speakerUrl) URL.revokeObjectURL(speakerUrl);
  speakerUrl = null;
  element("speaker-audio").removeAttribute("src");
  element("speaker-audio").load();
  for (const url of exports) URL.revokeObjectURL(url);
  exports.clear();
});
setInterval(() => {
  const seconds =
    probe.phase === "recording"
      ? Math.min(
          MAX_SECONDS,
          Math.floor((performance.now() - probe.startedAt) / 1000),
        )
      : Math.floor(probe.elapsedSeconds || 0);
  element("timer").textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} / 2:00`;
}, 250);
render(probe.snapshot());
