import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";

const INITIAL = { phase: "idle", supported: false, clip: null, errorCode: null, elapsedSeconds: 0 };
const CAPTURE_BUSY = new Set(["requesting", "recording", "stopping", "checking"]);

export function getAudioCaptionError(failure) {
  if (!Array.isArray(failure?.fieldErrors)) return "";
  const message = failure.fieldErrors.find(field => field?.field === "items[0].caption")?.message;
  return typeof message === "string" ? message : "";
}

export function useAudioForm({
  createCapture, createSubmission, active, onFlowStateChange, onDone, onShareAnother, privateArchive, onDialogStateChange,
}) {
  const prefix = `audio-${useId()}`;
  const captureFactory = useRef(createCapture), submissionFactory = useRef(createSubmission);
  const capture = useRef(null), submission = useRef(null), mounted = useRef(false), sending = useRef(false);
  const audio = useRef(null), startButton = useRef(null), result = useRef(null), errorNotice = useRef(null);
  const captionInput = useRef(null);
  const pausePreview = useCallback(() => audio.current?.pause(), []);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [guestName, setGuestName] = useState(""), [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false), [retryAfter, setRetryAfter] = useState(0);
  const [progress, setProgress] = useState(""), [error, setError] = useState("");
  const [captionError, setCaptionError] = useState("");
  const [captionExpanded, setCaptionExpanded] = useState(false);

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
    reportFlow({ busy: busy || recordingBusy, capturing: recordingBusy, pending,
      hasDraft: Boolean(snapshot.clip || guestName || caption || recordingBusy), complete: saved });
  }, [busy, recordingBusy, pending, snapshot.clip, guestName, caption, saved]);
  useEffect(() => {
    if (!active) { pausePreview(); capture.current?.interrupt(); }
  }, [active, pausePreview]);
  useEffect(() => { if (active && saved) result.current?.focus(); }, [active, saved]);
  useEffect(() => {
    if (!active || !error) return;
    if (captionError) captionInput.current?.focus();
    else errorNotice.current?.focus();
  }, [active, error, captionError]);
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
    sending.current = true; setBusy(true); setError(""); setCaptionError("");
    const current = submission.current;
    try {
      await current.submit({ ...snapshot.clip, guestName: privateArchive ? null : guestName, caption }, message => {
        if (mounted.current && submission.current === current) setProgress(message);
      });
      if (mounted.current && submission.current === current) setSaved(true);
    } catch (failure) {
      if (mounted.current && submission.current === current) {
        const captionFailure = getAudioCaptionError(failure);
        setCaptionError(captionFailure);
        if (captionFailure) setCaptionExpanded(true);
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
    setGuestName(""); setCaption(""); setCaptionError(""); setCaptionExpanded(false); setError(""); setProgress("");
    setBusy(false); setPending(false); setSaved(false); setFailed(false); setRetryAfter(0);
  }
  function finish(callback) { const receipt = submission.current?.receipt; reset(); callback?.(receipt); }
  async function startRecording() {
    audio.current?.pause(); setError(""); onDialogStateChange?.(true);
    try { await capture.current?.start(); } finally { onDialogStateChange?.(false); }
  }
  function discard() { audio.current?.pause(); capture.current?.discard(); setError(""); startButton.current?.focus(); }
  function choose(event) {
    onDialogStateChange?.(false);
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || locked || recordingBusy) return;
    audio.current?.pause(); setError(""); void capture.current?.useFile(file);
  }

  return {
    audio, startButton, result, errorNotice, captionInput,
    view: {
      prefix, snapshot, guestName, caption, busy, pending, saved, failed, retryAfter,
      progress, error, captionError, captionExpanded, recordingBusy, locked,
      actions: {
        submit, reset, startRecording, discard, choose,
        finish: () => finish(onDone),
        shareAnother: () => finish(onShareAnother),
        stopRecording: () => capture.current?.stop(),
        changeGuestName: setGuestName,
        changeCaption: value => { setCaption(value); setCaptionError(""); setError(""); },
        toggleCaption: setCaptionExpanded,
      },
    },
  };
}
