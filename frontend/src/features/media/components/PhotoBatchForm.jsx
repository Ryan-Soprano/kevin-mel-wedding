import { useEffect, useId, useRef, useState } from "react";
import { createPhotoBatchSubmission } from "../api/photoBatchSubmission.js";
import PhotoPicker from "./PhotoPicker.jsx";

const EMPTY = {
  phase: "idle", items: [], retained: false, complete: false, pending: false,
  canStartAnother: false, retryAfterSeconds: 0, savedCount: 0, totalCount: 0,
};

function statusText(item) {
  if (!item) return "Queued";
  const labels = {
    queued: "Queued", preparing: "Preparing original photo", uploading: "Uploading original photo",
    finalizing: "Verifying original photo", saved: "Saved privately", rejected: "Photo rejected",
  };
  if (item.status === "failed") return item.error?.unknownOutcome ? "Not confirmed" : "Needs retry";
  return labels[item.status] || "Not confirmed";
}

function safeError(error) {
  if (error?.status === 429) return "Please wait before retrying. Your original photos are still here.";
  if (["VALIDATION_FAILED", "INVALID_MEDIA"].includes(error?.code) && typeof error.message === "string") return error.message;
  return "We could not confirm every photo. Keep this page open and retry the original photos that still need attention.";
}

export default function PhotoBatchForm({ createSubmission = createPhotoBatchSubmission }) {
  const generatedId = useId();
  const prefix = `photo-batch-${generatedId}`;
  const factory = useRef(createSubmission);
  const coordinator = useRef(null);
  const mounted = useRef(false);
  const sending = useRef(false);
  const picker = useRef(null);
  const nameInput = useRef(null);
  const captionInputs = useRef(new Map());
  const result = useRef(null);
  const errorNotice = useRef(null);
  const focusRequest = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [guestName, setGuestName] = useState("");
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState({});
  const [selectedRetry, setSelectedRetry] = useState(new Set());
  const [batchNumber, setBatchNumber] = useState(0);

  useEffect(() => {
    // Effect setup creates a fresh controller after StrictMode's cleanup rehearsal.
    const current = factory.current();
    coordinator.current = current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.dispose();
      if (coordinator.current === current) coordinator.current = null;
    };
  }, []);

  useEffect(() => {
    if (busy || !focusRequest.current) return;
    const target = focusRequest.current;
    focusRequest.current = null;
    if (target === "picker") picker.current?.focus();
    else if (target === "name") nameInput.current?.focus();
    else if (target === "result") result.current?.focus();
    else if (target === "error") errorNotice.current?.focus();
    else captionInputs.current.get(target)?.focus();
  }, [busy, snapshot, error, photos, batchNumber]);

  useEffect(() => {
    const waiting = snapshot.retryAfterSeconds > 0 || snapshot.items.some(item => item.retryAfterSeconds > 0);
    if (busy || !waiting) return;
    const current = coordinator.current;
    const timer = setTimeout(() => {
      if (mounted.current && coordinator.current === current) setSnapshot(current.getSnapshot());
    }, 1000);
    return () => clearTimeout(timer);
  }, [snapshot, busy]);

  const retained = snapshot.retained || snapshot.items.length > 0;
  const locked = busy || retained || snapshot.complete || snapshot.phase === "complete";
  const savedCount = snapshot.items.filter(item => item.status === "saved").length;
  const totalCount = retained ? snapshot.items.length : photos.length;
  const globalWait = Math.max(0, Math.ceil(snapshot.retryAfterSeconds || 0));
  const byId = new Map(snapshot.items.map(item => [item.id, item]));
  const retryCandidates = snapshot.items.filter(item => item.status !== "saved" && item.terminal !== true);
  const eligible = retryCandidates.filter(item => item.retryEligible);
  const selectedEligible = eligible.filter(item => selectedRetry.has(item.id) && !(item.retryAfterSeconds > 0));
  const active = snapshot.items.find(item => ["preparing", "uploading", "finalizing"].includes(item.status));
  const summary = busy
    ? (active ? `${statusText(active)}: ${active.fileName}. ${savedCount} of ${totalCount} photos saved.` : "Preparing your photo batch…")
    : retained ? `${savedCount} of ${totalCount} photos saved privately.` : "Choose your photos and add optional captions before saving.";
  const complete = snapshot.complete || snapshot.phase === "complete";

  function updateSelection(next) {
    if (locked) return;
    setPhotos(next);
    setError("");
    setFields({});
  }

  function changeCaption(id, caption) {
    if (locked) return;
    setPhotos(current => current.map(photo => photo.id === id ? { ...photo, caption } : photo));
    setFields(current => ({ ...current, [id]: undefined }));
    setError("");
  }

  function applyFailure(failure) {
    const nextFields = {};
    for (const fieldError of failure?.fieldErrors || []) {
      if (fieldError.field === "guestName") nextFields.name = fieldError.message;
      const match = fieldError.field?.match(/^items\[(\d+)\]\.caption$/);
      if (match && photos[Number(match[1])]) nextFields[photos[Number(match[1])].id] = fieldError.message;
    }
    setFields(nextFields);
    setError(safeError(failure));
    const editable = !coordinator.current?.getSnapshot().retained;
    focusRequest.current = editable && nextFields.name ? "name"
      : editable && photos.find(photo => nextFields[photo.id])?.id || "error";
  }

  async function run(action) {
    const current = coordinator.current;
    if (!current || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setFields({});
    const update = next => {
      if (mounted.current && coordinator.current === current) setSnapshot(next);
    };
    try {
      const next = await action(current, update);
      if (mounted.current && coordinator.current === current) {
        const finalSnapshot = next || current.getSnapshot();
        update(finalSnapshot);
        if (finalSnapshot.error) applyFailure(finalSnapshot.error);
        else focusRequest.current = "result";
      }
    } catch (failure) {
      if (mounted.current && coordinator.current === current) applyFailure(failure);
    } finally {
      if (mounted.current && coordinator.current === current) {
        setSnapshot(current.getSnapshot());
        sending.current = false;
        setBusy(false);
      }
    }
  }

  function submit(event) {
    event.preventDefault();
    if (sending.current || retained) return;
    if (!photos.length) {
      setError("Choose at least one photo before saving.");
      picker.current?.focus();
      return;
    }
    void run((current, update) => current.submit({ guestName, photos }, update));
  }

  function retry() {
    if (globalWait || !selectedEligible.length) return;
    const ids = selectedEligible.map(item => item.id);
    void run((current, update) => current.retry(ids, update));
  }

  function another() {
    const current = coordinator.current;
    if (sending.current || !current?.canStartAnother) return;
    current.startAnother();
    setPhotos([]);
    setGuestName("");
    setSnapshot(current.getSnapshot());
    setSelectedRetry(new Set());
    setError("");
    setFields({});
    setBatchNumber(number => number + 1);
    focusRequest.current = "picker";
  }

  function toggleRetry(id) {
    setSelectedRetry(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="photo-submission photo-batch" aria-labelledby={prefix + "-title"}>
      <h2 id={prefix + "-title"}>Share photos</h2>
      <p>Send up to five original JPEG, PNG, or WebP photos, up to 10 MB each. They stay private for Kevin and Melanie.</p>
      <form onSubmit={submit} noValidate aria-label="Share photos" aria-busy={busy}>
        <div>
          <label htmlFor={prefix + "-name"}>Your name for this batch (optional)</label>
          <input ref={nameInput} id={prefix + "-name"} autoComplete="name" maxLength={100}
            value={guestName} disabled={locked}
            aria-invalid={fields.name ? "true" : undefined}
            aria-describedby={fields.name ? prefix + "-name-error" : undefined}
            onChange={event => { setGuestName(event.target.value); setFields(current => ({ ...current, name: undefined })); setError(""); }} />
          {fields.name && <p id={prefix + "-name-error"} className="form-error">{fields.name}</p>}
        </div>
        <PhotoPicker key={batchNumber} photos={photos} onPhotosChange={updateSelection} inputRef={picker}
          disabled={locked} idPrefix={prefix + "-picker"} showHeading={false}
          note="Keep this page open until every photo is confirmed. HEIC photos are not supported."
          renderPhoto={(photo, index) => {
            const item = byId.get(photo.id);
            const captionId = prefix + "-caption-" + photo.id;
            const stateId = prefix + "-state-" + photo.id;
            const filenameId = prefix + "-filename-" + photo.id;
            const itemWait = Math.max(0, Math.ceil(item?.retryAfterSeconds || 0));
            return (
              <div className="photo-batch-card">
                <p id={filenameId} className="photo-card__filename">Photo {index + 1}: {photo.file.name}</p>
                <label htmlFor={captionId}>Caption for photo {index + 1} (optional)</label>
                <textarea id={captionId} rows={2} maxLength={500} value={photo.caption || ""} disabled={locked}
                  ref={node => { if (node) captionInputs.current.set(photo.id, node); else captionInputs.current.delete(photo.id); }}
                  onChange={event => changeCaption(photo.id, event.target.value)}
                  aria-invalid={fields[photo.id] ? "true" : undefined}
                  aria-describedby={fields[photo.id] ? filenameId + " " + captionId + "-error" : filenameId} />
                {fields[photo.id] && <p id={captionId + "-error"} className="form-error">{fields[photo.id]}</p>}
                <p id={stateId} className={`photo-batch-state photo-batch-state--${item?.status || "queued"}`}>
                  {statusText(item)}
                </p>
                {item?.status === "rejected" && <p className="photo-batch-help">Retry this original photo, or deliberately start a new batch to choose different photos.</p>}
                {item?.status === "failed" && <p className="photo-batch-help">Keep the original photo here. A retry checks its saved state before transferring again.</p>}
                {item && item.status !== "saved" && item.terminal !== true && (
                  <label className="photo-retry-choice">
                    <input type="checkbox" checked={selectedRetry.has(photo.id)} disabled={busy || globalWait > 0 || itemWait > 0 || !item.retryEligible}
                      onChange={() => toggleRetry(photo.id)} aria-describedby={filenameId + " " + stateId} />
                    <span>Select photo {index + 1} to retry{Math.max(globalWait, itemWait) ? ` (wait ${Math.max(globalWait, itemWait)} seconds)` : ""}</span>
                  </label>
                )}
              </div>
            );
          }} />
        <p role="status" aria-live="polite" aria-atomic="true" className="photo-batch-summary">{summary}</p>
        {error && <p ref={errorNotice} className="form-error" role="alert" tabIndex={-1}>{error}</p>}
        {retained && <div className="photo-batch-result">
          <h3 ref={result} tabIndex={-1}>
            {complete ? "All your photos were saved privately." : `${savedCount} of ${totalCount} photos are confirmed saved.`}
          </h3>
          {!complete && <p>Saved photos stay saved. Your original selection, name and captions are kept together until the remaining photos are resolved.</p>}
        </div>}
        <div className="photo-batch-actions">
          {!retained && <button type="submit" disabled={busy}>{busy ? "Preparing photos…" : "Save photos"}</button>}
          {retained && !complete && retryCandidates.length > 0 && (
            <button type="button" onClick={retry} disabled={busy || globalWait > 0 || !selectedEligible.length}>
              {busy ? "Saving photos…" : globalWait ? `Wait ${globalWait} seconds before retrying` : "Retry selected photos"}
            </button>
          )}
          {snapshot.canStartAnother && !busy && <button type="button" className="button-secondary" onClick={another}>
            {complete ? "Share another batch" : "Start a new batch"}
          </button>}
        </div>
        {retained && !complete && retryCandidates.length > 0 && <p className="photo-batch-help">Select only the unsaved photos you want to retry. Confirmed photos will not be uploaded again.</p>}
        {snapshot.canStartAnother && !complete && <p className="photo-batch-help">Starting a new batch leaves confirmed photos saved and abandons the rejected remainder. It does not replace photos inside this batch.</p>}
      </form>
    </section>
  );
}
