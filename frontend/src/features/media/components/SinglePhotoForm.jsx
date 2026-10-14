import { useEffect, useRef, useState } from "react";
import { createPhotoSubmission } from "../api/photoSubmission.js";
import PhotoPreview from "./PhotoPreview.jsx";
import { ALLOWED_FILE_TYPES, MAX_PHOTO_BYTES } from "../mediaConstraints.js";

export default function SinglePhotoForm({ createSubmission = createPhotoSubmission }) {
  const submission = useRef(null);
  if (submission.current === null) submission.current = createSubmission();
  const picker = useRef(null);
  const result = useRef(null);
  const sending = useRef(false);
  const focusPicker = useRef(false);
  const [file, setFile] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => { if (saved) result.current?.focus(); }, [saved]);
  useEffect(() => {
    if (focusPicker.current && !busy && !pending && !saved) {
      picker.current?.focus();
      focusPicker.current = false;
    }
  }, [busy, pending, saved]);
  useEffect(() => {
    if (!retryAfter) return;
    const timer = setTimeout(() => setRetryAfter(0), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  function choose(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!ALLOWED_FILE_TYPES.has(selected.type) || !selected.size || selected.size > MAX_PHOTO_BYTES) {
      setError("Choose a non-empty JPEG, PNG, or WebP photo up to 10 MB.");
      return;
    }
    setFile(selected);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (sending.current) return;
    if (!file) { setError("Choose a photo before submitting."); picker.current?.focus(); return; }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await submission.current.submit({ file, guestName, caption }, setProgress);
      setSaved(true);
    } catch (failure) {
      setError(failure.code === "VALIDATION_FAILED" || failure.code === "INVALID_MEDIA"
        ? failure.message
        : "We could not confirm your photo. Keep this page open and try again to check the same photo.");
      setRetryAfter(submission.current.retryAfterSeconds);
    } finally {
      setPending(submission.current.pending);
      setFailed(submission.current.failed);
      setProgress("");
      setBusy(false);
      sending.current = false;
    }
  }

  function another(event) {
    event.preventDefault();
    submission.current.startAnother();
    setFile(null); setGuestName(""); setCaption(""); setError(""); setSaved(false);
    setPending(false); setFailed(false); setRetryAfter(0);
    focusPicker.current = true;
  }

  const locked = busy || pending || saved;
  return (
    <section className="photo-submission" aria-labelledby="photo-title">
      <h2 id="photo-title">Share a photo</h2>
      <p>Send one original JPEG, PNG, or WebP photo, up to 10 MB. It stays private for Kevin and Melanie.</p>
      <form onSubmit={submit} noValidate aria-label="Share a photo" aria-busy={busy}>
        <div>
          <label htmlFor="photo-file">Choose a photo</label>
          <input ref={picker} id="photo-file" type="file" accept="image/jpeg,image/png,image/webp"
            disabled={locked} onChange={choose} aria-describedby="photo-guidance" />
          <p id="photo-guidance">Keep this page open until your photo is confirmed. HEIC photos are not supported yet.</p>
        </div>
        {file && <div className="photo-original-preview"><PhotoPreview file={file} alt="Selected photo" /></div>}
        <div>
          <label htmlFor="photo-name">Your name for this photo (optional)</label>
          <input id="photo-name" autoComplete="name" maxLength={100} value={guestName} disabled={locked}
            onChange={(event) => setGuestName(event.target.value)} />
        </div>
        <div>
          <label htmlFor="photo-caption">Caption (optional)</label>
          <textarea id="photo-caption" rows={2} maxLength={500} value={caption} disabled={locked}
            onChange={(event) => setCaption(event.target.value)} />
        </div>
        <p role="status" aria-live="polite">{progress}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved ? (
          <>
            <h3 ref={result} tabIndex={-1}>Your photo was saved privately for Kevin and Melanie.</h3>
            <button type="button" onClick={another}>Share another photo</button>
          </>
        ) : (
          <>
            {pending && <p>We are keeping this original photo and its submission together for a safe retry.</p>}
            <button type="submit" disabled={busy || retryAfter > 0}>
              {busy ? "Saving photo…" : retryAfter > 0 ? "Please wait before trying again" : pending ? "Retry this photo" : "Save photo"}
            </button>
            {failed && <button type="button" className="button-secondary" onClick={another}>Choose another photo</button>}
          </>
        )}
      </form>
    </section>
  );
}
