import { useId, useState } from "react";
import { normalizeMemoryMetadata } from "../memoryMetadata.js";

export default function MemoryMetadataEditor({ memory, state, busy, locked, onSave, onReload, onRetry }) {
  const prefix = `memory-details-${useId()}`;
  const [title, setTitle] = useState(memory.title ?? "");
  const [description, setDescription] = useState(memory.description ?? "");
  const [memoryDate, setMemoryDate] = useState(memory.memoryDate ?? "");
  const [datePrecision, setDatePrecision] = useState(memory.datePrecision);
  const [error, setError] = useState(null);
  async function save(event) {
    event.preventDefault();
    if (busy || locked) return;
    setError(null);
    try {
      const metadata = normalizeMemoryMetadata({ title, description,
        memoryDate: datePrecision === "UNKNOWN" ? null : memoryDate, datePrecision });
      await onSave(metadata);
    } catch (failure) { setError(failure.code === "VALIDATION_FAILED" ? failure.message : "Check the memory details and try again."); }
  }
  return (
    <section className="inbox-metadata" aria-label="Editable memory details">
      <h3>Memory details</h3>
      <p className="guest-help">Add context to this individual memory. Its original note, caption and files stay as they were submitted.</p>
      <form onSubmit={save} noValidate aria-busy={busy}>
        <label htmlFor={`${prefix}-title`}>Title (optional)</label>
        <input id={`${prefix}-title`} maxLength={200} value={title} disabled={busy || locked} onChange={event => setTitle(event.target.value)} />
        <label htmlFor={`${prefix}-description`}>Description (optional)</label>
        <textarea id={`${prefix}-description`} rows={3} maxLength={2000} value={description} disabled={busy || locked} onChange={event => setDescription(event.target.value)} />
        <label htmlFor={`${prefix}-precision`}>How precisely do you know the date?</label>
        <select id={`${prefix}-precision`} value={datePrecision} disabled={busy || locked} onChange={event => { setDatePrecision(event.target.value); setMemoryDate(""); }}>
          <option value="UNKNOWN">Unknown</option><option value="YEAR">Year only</option>
          <option value="MONTH">Year and month</option><option value="DAY">Full date</option>
        </select>
        {datePrecision !== "UNKNOWN" && <>
          <label htmlFor={`${prefix}-date`}>Memory date ({datePrecision === "YEAR" ? "YYYY" : datePrecision === "MONTH" ? "YYYY-MM" : "YYYY-MM-DD"})</label>
          <input id={`${prefix}-date`} type="text" inputMode="numeric" maxLength={10} value={memoryDate}
            placeholder={datePrecision === "YEAR" ? "2024" : datePrecision === "MONTH" ? "2024-06" : "2024-06-15"}
            disabled={busy || locked} onChange={event => setMemoryDate(event.target.value)} />
          <p className="guest-help">Use only the precision you know. This is separate from when the memory was added.</p>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!locked && <button type="submit" disabled={busy}>Save memory details</button>}
      </form>
      {["saving", "loading", "refreshing"].includes(state.phase) && <p role="status">{state.phase === "saving" ? "Saving memory details…" : "Checking the current memory…"}</p>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {["uncertain", "conflict"].includes(state.phase) && <div className="inbox-actions">
        <button type="button" disabled={busy} onClick={() => onReload(false)}>Reload current memory details</button>
        {state.canRetry && <button type="button" className="button-secondary" disabled={busy} onClick={onRetry}>Retry this same metadata edit</button>}
      </div>}
      {state.phase === "csrf" && <button type="button" disabled={busy} onClick={() => onReload(true)}>Refresh session and memory details</button>}
      {state.phase !== "idle" && <p className="guest-help">Other changes, navigation and sign-out pause until this edit is checked. No automatic retry is made.</p>}
    </section>
  );
}
