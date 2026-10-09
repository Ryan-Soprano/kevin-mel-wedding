import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createAudioCapture } from "../audioCapture.js";
import { createAudioSubmission } from "../api/audioSubmission.js";
import { AUDIO_ACCEPT } from "../audioConstraints.js";

const INITIAL = { phase: "idle", supported: false, clip: null, errorCode: null, elapsedSeconds: 0 };
const CAPTURE_BUSY = new Set(["requesting", "recording", "stopping", "checking"]);
const CAPTURE_MESSAGES = {
  PERMISSION_DENIED: "Microphone access was not allowed. You can choose an audio file or write a note instead.",
  PERMISSION_TIMEOUT: "Microphone access could not be confirmed. Try recording again, choose a file, or write a note.",
  FORMAT_UNSUPPORTED: "This browser’s recording format is not supported. Choose a WebM, Ogg, or M4A file, or write a note.",
  FILE_INVALID: "Choose a non-empty WebM, Ogg, or M4A audio file up to 25 MB.",
  BYTE_LIMIT: "This recording grew beyond 25 MB. Please make a shorter recording or write a note.",
  DURATION_LIMIT: "This clip is longer than two minutes. Please choose a shorter clip or re-record.",
  DECODE_UNSUPPORTED: "This browser cannot check audio playback. Try another browser or write a note.",
  DECODE_TIMEOUT: "This clip took too long to check. Choose a shorter file or write a note.",
  DECODE_FAILED: "This clip could not be played here. Choose another file, re-record, or write a note.",
  INTERRUPTED: "Recording was interrupted and was not saved. You can record again or choose a file.",
  RECORDER_ERROR: "Recording could not be completed. Try again, choose an audio file, or write a note.",
};
const time = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function AudioForm({
  createCapture = createAudioCapture, createSubmission = createAudioSubmission,
  active = true, onFlowStateChange, onDone, onShareAnother,
} = {}) {
  const prefix = `audio-${useId()}`;
  const captureFactory = useRef(createCapture), submissionFactory = useRef(createSubmission);
  const capture = useRef(null), submission = useRef(null), mounted = useRef(false), sending = useRef(false);
  const audio = useRef(null), startButton = useRef(null), result = useRef(null), errorNotice = useRef(null);
  const pausePreview = useCallback(() => audio.current?.pause(), []);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [guestName, setGuestName] = useState(""), [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false), [retryAfter, setRetryAfter] = useState(0);
  const [progress, setProgress] = useState(""), [error, setError] = useState("");

  useEffect(() => {
    mounted.current = true;
    const current = captureFactory.current({ onChange: next => {
      if (mounted.current && capture.current === current) setSnapshot(next);
    } });
    const sender = submissionFactory.current();
    capture.current = current; submission.current = sender;
    queueMicrotask(() => { if (mounted.current && capture.current === current) setSnapshot(current.getSnapshot()); });
    const hide = () => { pausePreview(); current.interrupt(); };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      pausePreview();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      mounted.current = false;
      current.dispose(); sender.dispose();
      if (capture.current === current) capture.current = null;
      if (submission.current === sender) submission.current = null;
    };
  }, [pausePreview]);

  const recordingBusy = CAPTURE_BUSY.has(snapshot.phase);
  const locked = busy || pending || saved;
  const reportFlow = useEffectEvent(state => onFlowStateChange?.(state));
  useEffect(() => {
    reportFlow({ busy: busy || recordingBusy, pending,
      hasDraft: Boolean(snapshot.clip || guestName || caption || recordingBusy), complete: saved });
  }, [busy, recordingBusy, pending, snapshot.clip, guestName, caption, saved]);
  useEffect(() => {
    if (!active) { pausePreview(); capture.current?.interrupt(); }
  }, [active, pausePreview]);
  useEffect(() => { if (active && saved) result.current?.focus(); }, [active, saved]);
  useEffect(() => { if (active && error) errorNotice.current?.focus(); }, [active, error]);
  useEffect(() => {
    if (!retryAfter || busy) return;
    const timer = setTimeout(() => {
      if (mounted.current) setRetryAfter(submission.current?.retryAfterSeconds ?? 0);
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryAfter, busy]);

  async function submit(event) {
    event.preventDefault();
    if (sending.current || recordingBusy) return;
    if (!snapshot.clip) { setError("Record or choose an audio clip before saving."); return; }
    audio.current?.pause();
    sending.current = true; setBusy(true); setError("");
    const current = submission.current;
    try {
      await current.submit({ ...snapshot.clip, guestName, caption }, message => {
        if (mounted.current && submission.current === current) setProgress(message);
      });
      if (mounted.current && submission.current === current) setSaved(true);
    } catch (failure) {
      if (mounted.current && submission.current === current) {
        setError(failure.code === "VALIDATION_FAILED" ? failure.message
          : failure.code === "INVALID_MEDIA" ? "This original clip could not be accepted. Choose another clip or record again."
            : failure.status === 429 || (failure.status === 503 && failure.retryAfterSeconds > 0)
              ? "Please wait before retrying. Keep this page open; your original clip is still here."
              : "We could not confirm your audio. Keep this page open and retry to check this same original clip.");
      }
    } finally {
      if (mounted.current && submission.current === current) {
        setPending(current.pending); setFailed(current.failed); setRetryAfter(current.retryAfterSeconds);
        setProgress(""); setBusy(false);
      }
      sending.current = false;
    }
  }
  function reset() {
    audio.current?.pause();
    submission.current?.startAnother(); capture.current?.discard();
    setGuestName(""); setCaption(""); setError(""); setProgress("");
    setBusy(false); setPending(false); setSaved(false); setFailed(false); setRetryAfter(0);
  }
  function finish(callback) { reset(); callback?.(); }
  function discard() { audio.current?.pause(); capture.current?.discard(); setError(""); startButton.current?.focus(); }
  function choose(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || locked || recordingBusy) return;
    audio.current?.pause(); setError(""); void capture.current?.useFile(file);
  }
  const captureError = snapshot.errorCode ? CAPTURE_MESSAGES[snapshot.errorCode] ?? CAPTURE_MESSAGES.RECORDER_ERROR : null;
  return (
    <section className="audio-memory" aria-labelledby={`${prefix}-title`}>
      <h2 id={`${prefix}-title`}>Share a voice memory</h2>
      <p>Record a message up to two minutes, or choose one WebM, Ogg, or M4A audio file up to 25 MB. It stays private for Kevin and Melanie.</p>
      <form onSubmit={submit} noValidate aria-label="Share a voice memory" aria-busy={busy || recordingBusy}>
        {!saved && (
          <div className="audio-memory-actions">
            {snapshot.supported && snapshot.phase !== "recording" && <button ref={startButton} type="button" disabled={locked || recordingBusy}
              onClick={() => { audio.current?.pause(); setError(""); void capture.current?.start(); }}>{snapshot.clip ? "Re-record" : "Start recording"}</button>}
            {snapshot.phase === "recording" && <button type="button" onClick={() => capture.current?.stop()}>Stop recording</button>}
            {snapshot.clip && !locked && <button type="button" className="button-secondary" onClick={discard}>Discard clip</button>}
          </div>
        )}
        {snapshot.phase === "unsupported" && <p>Recording is unavailable in this browser. Choose an audio file below or use Write a note from memory choices.</p>}
        <p className="guest-help">Microphone access is requested only when you choose Start recording. Listen to the finished clip before saving. An interrupted recording is discarded.</p>
        {snapshot.phase === "requesting" && <p role="status">Waiting for microphone permission…</p>}
        {snapshot.phase === "recording" && <p role="status">Recording · {time(snapshot.elapsedSeconds)} / 2:00. Recording stops automatically just before two minutes.</p>}
        {snapshot.phase === "stopping" && <p role="status">Finishing the recording…</p>}
        {snapshot.phase === "checking" && <p role="status">Checking the clip for playback and length…</p>}
        {captureError && <p className="form-error" role="alert">{captureError} Nothing was uploaded.</p>}
        <div>
          <label htmlFor={`${prefix}-file`}>Choose an existing audio file</label>
          <input id={`${prefix}-file`} type="file" accept={AUDIO_ACCEPT} disabled={locked || recordingBusy} onChange={choose} />
          <p className="guest-help">WebM and Ogg must contain Opus audio; M4A/MP4 must contain AAC audio. Video and other formats are not accepted.</p>
        </div>
        {snapshot.clip && (
          <div className="audio-memory-preview">
            <h3>Listen to your clip</h3>
            <audio ref={audio} controls preload="metadata" src={snapshot.clip.url} aria-label="Your voice memory preview" />
            <p>{snapshot.clip.file.name} · {Math.ceil(snapshot.clip.durationSeconds)} seconds</p>
            <p className="guest-help">Make sure your message can be heard. You can discard or re-record before saving.</p>
          </div>
        )}
        <div>
          <label htmlFor={`${prefix}-name`}>Your name for this clip (optional)</label>
          <input id={`${prefix}-name`} autoComplete="name" maxLength={100} disabled={locked || recordingBusy} value={guestName} onChange={event => setGuestName(event.target.value)} />
        </div>
        <div>
          <label htmlFor={`${prefix}-caption`}>Caption (optional)</label>
          <textarea id={`${prefix}-caption`} rows={2} maxLength={500} disabled={locked || recordingBusy} value={caption} onChange={event => setCaption(event.target.value)} />
        </div>
        <p role="status" aria-live="polite">{progress}</p>
        {error && <p ref={errorNotice} tabIndex={-1} className="form-error" role="alert">{error}</p>}
        {saved ? (
          <div>
            <h3 ref={result} tabIndex={-1}>Your voice memory was saved privately for Kevin and Melanie.</h3>
            <div className="audio-memory-actions">
              <button type="button" onClick={() => finish(onDone)}>Done</button>
              <button type="button" className="button-secondary" onClick={() => finish(onShareAnother)}>Share another memory</button>
            </div>
          </div>
        ) : (
          <>
            {pending && <p>We are keeping this original clip and its submission together for a safe retry. Refreshing or closing the page loses this unfinished work.</p>}
            <button type="submit" disabled={busy || recordingBusy || !snapshot.clip || retryAfter > 0}>
              {busy ? "Saving audio…" : retryAfter > 0 ? `Wait ${retryAfter} seconds before retrying` : pending ? "Retry this original clip" : "Save voice memory"}
            </button>
            {failed && <button type="button" className="button-secondary" disabled={busy || retryAfter > 0} onClick={reset}>Choose or record another clip</button>}
          </>
        )}
      </form>
    </section>
  );
}
