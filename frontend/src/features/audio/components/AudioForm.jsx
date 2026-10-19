import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { createAudioCapture } from "../audioCapture.js";
import { createAudioSubmission } from "../api/audioSubmission.js";
import { AUDIO_ACCEPT } from "../audioConstraints.js";

const INITIAL = {
  phase: "idle",
  supported: false,
  clip: null,
  errorCode: null,
  elapsedSeconds: 0,
};
const CAPTURE_BUSY = new Set([
  "requesting",
  "recording",
  "stopping",
  "checking",
]);
const CAPTURE_MESSAGES = {
  PERMISSION_DENIED:
    "Microphone access was not allowed. You can choose an audio file or write a message instead.",
  PERMISSION_TIMEOUT:
    "Microphone access could not be confirmed. Try recording again, choose a file, or write a message.",
  FORMAT_UNSUPPORTED:
    "This browser’s recording format is not supported. Choose a WebM, Ogg, or M4A file, or write a message.",
  FILE_INVALID: "Choose a non-empty WebM, Ogg, or M4A audio file up to 25 MB.",
  BYTE_LIMIT:
    "This recording grew beyond 25 MB. Please make a shorter recording or write a message.",
  DURATION_LIMIT:
    "This clip is longer than two minutes. Please choose a shorter clip or re-record.",
  DECODE_UNSUPPORTED:
    "This browser cannot check audio playback. Try another browser or write a message.",
  DECODE_TIMEOUT:
    "This clip took too long to check. Choose a shorter file or write a message.",
  DECODE_FAILED:
    "This clip could not be played here. Choose another file, re-record, or write a message.",
  INTERRUPTED:
    "Recording was interrupted and was not saved. You can record again or choose a file.",
  RECORDER_ERROR:
    "Recording could not be completed. Try again, choose an audio file, or write a message.",
};
const time = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function AudioForm({
  createCapture = createAudioCapture,
  createSubmission = createAudioSubmission,
  active = true,
  onFlowStateChange,
  onDone,
  onShareAnother,
  onWriteNote,
  privateArchive = false,
  onDialogStateChange,
} = {}) {
  const prefix = `audio-${useId()}`;
  const captureFactory = useRef(createCapture),
    submissionFactory = useRef(createSubmission);
  const capture = useRef(null),
    submission = useRef(null),
    mounted = useRef(false),
    sending = useRef(false);
  const audio = useRef(null),
    startButton = useRef(null),
    result = useRef(null),
    errorNotice = useRef(null);
  const captionInput = useRef(null);
  const pausePreview = useCallback(() => audio.current?.pause(), []);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [guestName, setGuestName] = useState(""),
    [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false),
    [retryAfter, setRetryAfter] = useState(0);
  const [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [captionError, setCaptionError] = useState("");

  useEffect(() => {
    mounted.current = true;
    const current = captureFactory.current({
      onChange: (next) => {
        if (mounted.current && capture.current === current) setSnapshot(next);
      },
    });
    const sender = submissionFactory.current();
    capture.current = current;
    submission.current = sender;
    queueMicrotask(() => {
      if (mounted.current && capture.current === current)
        setSnapshot(current.getSnapshot());
    });
    const hide = () => {
      pausePreview();
      current.interrupt();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      pausePreview();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      mounted.current = false;
      current.dispose();
      sender.dispose();
      if (capture.current === current) capture.current = null;
      if (submission.current === sender) submission.current = null;
    };
  }, [pausePreview]);

  const recordingBusy = CAPTURE_BUSY.has(snapshot.phase);
  const locked = busy || pending || saved;
  const reportFlow = useEffectEvent((state) => onFlowStateChange?.(state));
  useEffect(() => {
    reportFlow({
      busy: busy || recordingBusy,
      capturing: recordingBusy,
      pending,
      hasDraft: Boolean(snapshot.clip || guestName || caption || recordingBusy),
      complete: saved,
    });
  }, [busy, recordingBusy, pending, snapshot.clip, guestName, caption, saved]);
  useEffect(() => {
    if (!active) {
      pausePreview();
      capture.current?.interrupt();
    }
  }, [active, pausePreview]);
  useEffect(() => {
    if (active && saved) result.current?.focus();
  }, [active, saved]);
  useEffect(() => {
    if (!active || !error) return;
    if (captionError) captionInput.current?.focus();
    else errorNotice.current?.focus();
  }, [active, error, captionError]);
  useEffect(() => {
    if (!retryAfter || busy) return;
    const timer = setTimeout(() => {
      if (mounted.current)
        setRetryAfter(submission.current?.retryAfterSeconds ?? 0);
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryAfter, busy]);

  async function submit(event) {
    event.preventDefault();
    if (sending.current || recordingBusy) return;
    if (!snapshot.clip) {
      setError("Record or choose an audio clip before saving.");
      return;
    }
    audio.current?.pause();
    sending.current = true;
    setBusy(true);
    setError("");
    setCaptionError("");
    const current = submission.current;
    try {
      await current.submit(
        {
          ...snapshot.clip,
          guestName: privateArchive ? null : guestName,
          caption,
        },
        (message) => {
          if (mounted.current && submission.current === current)
            setProgress(message);
        },
      );
      if (mounted.current && submission.current === current) setSaved(true);
    } catch (failure) {
      if (mounted.current && submission.current === current) {
        setCaptionError(failure.fieldErrors?.["items[0].caption"] ?? "");
        setError(
          failure.code === "VALIDATION_FAILED"
            ? failure.message
            : failure.code === "INVALID_MEDIA"
              ? "This original clip could not be accepted. Choose another clip or record again."
              : failure.status === 429 ||
                  (failure.status === 503 && failure.retryAfterSeconds > 0)
                ? "Please wait before retrying. Keep this page open; your original clip is still here."
                : "We could not confirm your audio. Keep this page open and retry to check this same original clip.",
        );
      }
    } finally {
      if (mounted.current && submission.current === current) {
        setPending(current.pending);
        setFailed(current.failed);
        setRetryAfter(current.retryAfterSeconds);
        setProgress("");
        setBusy(false);
      }
      sending.current = false;
    }
  }
  function reset() {
    audio.current?.pause();
    submission.current?.startAnother();
    capture.current?.discard();
    setGuestName("");
    setCaption("");
    setCaptionError("");
    setError("");
    setProgress("");
    setBusy(false);
    setPending(false);
    setSaved(false);
    setFailed(false);
    setRetryAfter(0);
  }
  function finish(callback) {
    const receipt = submission.current?.receipt;
    reset();
    callback?.(receipt);
  }
  async function startRecording() {
    audio.current?.pause();
    setError("");
    onDialogStateChange?.(true);
    try {
      await capture.current?.start();
    } finally {
      onDialogStateChange?.(false);
    }
  }
  function discard() {
    audio.current?.pause();
    capture.current?.discard();
    setError("");
    startButton.current?.focus();
  }
  function choose(event) {
    onDialogStateChange?.(false);
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || locked || recordingBusy) return;
    audio.current?.pause();
    setError("");
    void capture.current?.useFile(file);
  }
  const captureError = snapshot.errorCode
    ? (CAPTURE_MESSAGES[snapshot.errorCode] ?? CAPTURE_MESSAGES.RECORDER_ERROR)
    : null;
  const recordingStatus =
    snapshot.phase === "requesting"
      ? "Waiting for microphone permission…"
      : snapshot.phase === "recording"
        ? "Recording. Tap Stop when you’re finished."
        : snapshot.phase === "stopping"
          ? "Finishing the recording…"
          : snapshot.phase === "checking"
            ? "Checking your clip…"
            : "";
  return (
    <section
      className="audio-memory"
      aria-label={
        privateArchive ? "Add a voice memory" : "Share a voice memory"
      }
    >
      <h2 className={privateArchive ? undefined : "visually-hidden"}>
        {privateArchive ? "Add a voice memory" : "Share a voice memory"}
      </h2>
      <form
        className="memory-form audio-compose"
        onSubmit={submit}
        noValidate
        aria-label="Share a voice memory"
        aria-busy={busy}
      >
        {saved ? (
          <div className="memory-success">
            <h3 ref={result} tabIndex={-1}>
              {privateArchive
                ? "Your voice memory was saved in your private archive."
                : "Thank you for sharing your voice."}
            </h3>
            {!privateArchive && (
              <p>
                Your message is saved privately for Kevin and Melanie to listen
                to and treasure.
              </p>
            )}
            <div className="audio-memory-actions">
              <button type="button" onClick={() => finish(onDone)}>
                {privateArchive ? "View added memory" : "Back to our photos"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => finish(onShareAnother)}
              >
                Share another memory
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="memory-form-introduction">
              {privateArchive
                ? "Add a voice message to your private archive."
                : "A favorite memory, a little advice, or a wish for the two of us. We’d love to hear it in your voice."}
            </p>
            <div
              className={`audio-recording-panel${snapshot.phase === "recording" ? " is-recording" : ""}`}
            >
              <span className="audio-recording-icon" aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
                </svg>
              </span>
              <h3>
                {snapshot.phase === "recording"
                  ? "Recording your message"
                  : snapshot.clip
                    ? "Your voice memory is ready"
                    : "A few words from the heart"}
              </h3>
              {snapshot.phase === "recording" ? (
                <>
                  <p
                    className="audio-recording-timer"
                    aria-label={`${time(snapshot.elapsedSeconds)} of two minutes`}
                  >
                    {time(snapshot.elapsedSeconds)} <span>/ 2:00</span>
                  </p>
                  <p className="guest-help">
                    Recording stops automatically just before two minutes.
                  </p>
                </>
              ) : (
                <p className="guest-help">
                  {snapshot.clip
                    ? "Listen below before you send it."
                    : "Take your time. You have up to two minutes."}
                </p>
              )}
              <div className="audio-recording-actions">
                {snapshot.supported && snapshot.phase !== "recording" && (
                  <button
                    ref={startButton}
                    type="button"
                    disabled={locked || recordingBusy}
                    aria-describedby={`${prefix}-recording-help`}
                    onClick={() => void startRecording()}
                  >
                    {snapshot.clip ? "Record again" : "Start recording"}
                  </button>
                )}
                {snapshot.phase === "recording" && (
                  <button
                    type="button"
                    className="audio-stop-button"
                    aria-describedby={`${prefix}-recording-help`}
                    onClick={() => capture.current?.stop()}
                  >
                    <span aria-hidden="true">■</span> Stop recording
                  </button>
                )}
              </div>
              <p
                className="audio-capture-status"
                role="status"
                aria-live="polite"
              >
                {recordingStatus}
              </p>
              {snapshot.supported && (
                <p id={`${prefix}-recording-help`} className="guest-help">
                  While recording, keep this page open and your phone unlocked.
                  Switching apps or locking the phone discards the unfinished
                  recording.
                </p>
              )}
              {!snapshot.clip &&
                snapshot.phase !== "recording" &&
                snapshot.phase !== "unsupported" && (
                  <p className="guest-help">
                    We’ll ask for microphone access when you start.
                  </p>
                )}
            </div>
            {snapshot.phase === "unsupported" && (
              <p className="guest-help">
                Recording is unavailable in this browser. You can upload an
                audio file below.
              </p>
            )}
            {captureError && (
              <p className="form-error" role="alert">
                {captureError} Nothing was uploaded.
              </p>
            )}
            {(snapshot.phase === "unsupported" || captureError) &&
              onWriteNote && (
                <button
                  type="button"
                  className="button-secondary audio-note-fallback"
                  disabled={locked || recordingBusy}
                  onClick={onWriteNote}
                >
                  Write a message instead
                </button>
              )}
            {snapshot.clip && (
              <div className="audio-memory-preview">
                <h3>Listen to your message</h3>
                <audio
                  ref={audio}
                  controls
                  preload="metadata"
                  src={snapshot.clip.url}
                  aria-label="Your voice memory preview"
                />
                <p className="guest-help">
                  {snapshot.clip.file.name} ·{" "}
                  {time(Math.ceil(snapshot.clip.durationSeconds))}
                </p>
                {!locked && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={discard}
                  >
                    Discard clip
                  </button>
                )}
              </div>
            )}
            <details
              className="audio-file-option"
              open={snapshot.phase === "unsupported" ? true : undefined}
            >
              <summary>Upload an existing audio file instead</summary>
              <div>
                <label htmlFor={`${prefix}-file`}>Choose an audio file</label>
                <input
                  id={`${prefix}-file`}
                  type="file"
                  accept={AUDIO_ACCEPT}
                  disabled={locked || recordingBusy}
                  onChange={choose}
                  aria-describedby={`${prefix}-file-help`}
                  onClick={() => onDialogStateChange?.(true)}
                  onCancel={() => onDialogStateChange?.(false)}
                />
                <p id={`${prefix}-file-help`} className="guest-help">
                  Up to two minutes and 25 MB. WebM or Ogg with Opus audio, or
                  M4A/MP4 with AAC audio. Video and other formats aren’t
                  supported.
                </p>
              </div>
            </details>
            <div className="memory-optional-fields">
              {!privateArchive && (
                <div>
                  <label htmlFor={`${prefix}-name`}>Your name (optional)</label>
                  <input
                    id={`${prefix}-name`}
                    autoComplete="name"
                    maxLength={100}
                    disabled={locked || recordingBusy}
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                  />
                </div>
              )}
              <details
                className="memory-caption-option"
                open={captionError ? true : undefined}
              >
                <summary>Add a caption (optional)</summary>
                <label
                  className="visually-hidden"
                  htmlFor={`${prefix}-caption`}
                >
                  Caption (optional)
                </label>
                <textarea
                  ref={captionInput}
                  id={`${prefix}-caption`}
                  rows={2}
                  maxLength={500}
                  placeholder="A little context for your message…"
                  disabled={locked || recordingBusy}
                  value={caption}
                  aria-invalid={Boolean(captionError)}
                  aria-describedby={
                    captionError ? `${prefix}-caption-error` : undefined
                  }
                  onChange={(event) => {
                    setCaption(event.target.value);
                    setCaptionError("");
                  }}
                />
                {captionError && (
                  <p id={`${prefix}-caption-error`} className="form-error">
                    {captionError}
                  </p>
                )}
              </details>
            </div>
            <p className="audio-submit-status" role="status" aria-live="polite">
              {progress}
            </p>
            {error && (
              <p
                ref={errorNotice}
                tabIndex={-1}
                className="form-error"
                role="alert"
              >
                {error}
              </p>
            )}
            {pending && (
              <p className="memory-pending">
                Your original clip is kept here for a safe retry. Keep this page
                open until it’s saved.
              </p>
            )}
            <div className="memory-form-footer">
              <p className="memory-privacy">
                <svg
                  width="17"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3" />
                </svg>
                {privateArchive
                  ? "Your recording starts private in your archive."
                  : "Sent privately to Kevin and Melanie. They may choose to share it."}
              </p>
              <button
                type="submit"
                disabled={
                  busy || recordingBusy || !snapshot.clip || retryAfter > 0
                }
              >
                {busy
                  ? "Saving audio…"
                  : retryAfter > 0
                    ? `Wait ${retryAfter} seconds before retrying`
                    : pending
                      ? "Retry this original clip"
                      : privateArchive
                        ? "Save voice memory"
                        : "Send voice memory"}
              </button>
            </div>
            {failed && (
              <button
                type="button"
                className="button-secondary"
                disabled={busy || retryAfter > 0}
                onClick={reset}
              >
                Choose or record another clip
              </button>
            )}
          </>
        )}
      </form>
    </section>
  );
}
