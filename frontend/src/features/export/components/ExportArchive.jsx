import { useEffect, useRef, useState } from "react";
import { memoryTime } from "../../inbox/memoryDisplay.js";
import "../export.css";
const TERMINAL = ["FAILED", "STALE", "CANCELLED", "EXPIRED"];
const STATES = { CAPTURING: "Capturing archive details", READY: "Ready to prepare a part", PREPARING: "Preparing a ZIP part",
  READY_WITH_WARNINGS: "Ready with original-file warnings", FAILED: "Export failed", STALE: "Archive changed — start a fresh export", CANCELLED: "Export cancelled", EXPIRED: "Export expired" };
const ISSUE = { MISSING: "Original file missing", INTEGRITY_MISMATCH: "Original size or checksum did not match", READ_FAILED: "Original could not be read" };
const bytes = value => (value / (1024 * 1024)).toFixed(2) + " MiB";
export default function ExportArchive({ state, busy, locked, actions }) {
  const feedback = useRef(null), cancelTrigger = useRef(null), cancelButton = useRef(null), restoreCancel = useRef(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const disabled = busy || locked, job = state.job, terminal = job && TERMINAL.includes(job.state), canPrepare = job && ["READY", "READY_WITH_WARNINGS"].includes(job.state);
  useEffect(() => { if (state.error || state.mutation.error || state.notice) feedback.current?.focus(); }, [state.error, state.mutation.error, state.notice]);
  useEffect(() => { if (confirmCancel) cancelButton.current?.focus(); else if (restoreCancel.current && !disabled) { restoreCancel.current = false; cancelTrigger.current?.focus(); } }, [confirmCancel, disabled]);
  return <section className="archive-export" aria-label="Private portable archive export" aria-busy={busy}>
    <p>Save original files together with readable notes, memory dates, albums, timeline events and tags. The portable archive includes a JSON manifest and an offline reader.</p>
    <p>Download each original part, then the final index part. Extract all ZIP parts into the same private folder and open <strong>index.html</strong>. Missing or unreadable originals are listed in the final report.</p>
    <p className="guest-help">This copy contains private memories and may contain original photo metadata. Files already saved on your device cannot be revoked by sign-out, deletion or export expiry.</p>
    <button className="button-secondary" type="button" disabled={disabled} onClick={actions.inbox}>Back to inbox</button>
    {(state.error || state.mutation.error || state.notice) && <p className={state.error || state.mutation.error ? "form-error" : "inbox-review-notice"} role={state.error || state.mutation.error ? "alert" : "status"} ref={feedback} tabIndex={-1}>{state.error ?? state.mutation.error ?? state.notice}</p>}
    {state.retryAfterSeconds !== null && <p role="status">Wait at least {state.retryAfterSeconds} seconds before trying again.</p>}
    {locked && <div className="export-recovery"><p>Other changes, navigation and sign-out are paused until this export action is confirmed. Checking never silently creates another job or retries preparation.</p>
      {["saving", "loading"].includes(state.mutation.phase) ? <p role="status">Checking this export action…</p> : <>
        <button type="button" disabled={busy} onClick={() => actions.check(state.mutation.phase === "csrf")}>{state.mutation.phase === "csrf" ? "Refresh session and export status" : "Check unconfirmed export action"}</button>
        {state.mutation.canRetry && <button className="button-secondary" type="button" disabled={busy} onClick={actions.retry}>Retry this same export action</button>}</>}
    </div>}
    {(!job || terminal || state.unavailable) && !locked && <button type="button" disabled={busy} onClick={actions.create}>{job || state.unavailable ? "Start a new export" : "Prepare archive export"}</button>}
    {job && <div className="export-status">
      <h2>{STATES[job.state]}</h2>
      <p>Created <time dateTime={job.createdAt}>{memoryTime(job.createdAt)}</time> · Eastern</p>
      {job.capturedAt && <p>Archive captured <time dateTime={job.capturedAt}>{memoryTime(job.capturedAt)}</time> · Eastern</p>}
      {!terminal && <><p>Expires after 30 minutes without activity, and by <time dateTime={job.hardExpiresAt}>{memoryTime(job.hardExpiresAt)}</time> (Eastern). App restart makes this job unavailable; start a fresh export explicitly.</p>
        <p>Current inactivity deadline: <time dateTime={job.expiresAt}>{memoryTime(job.expiresAt)}</time> · Eastern</p>
        <div className="inbox-actions"><button type="button" disabled={disabled} onClick={() => actions.check(false)}>Check export progress</button>
          <button ref={cancelTrigger} className="button-secondary" type="button" disabled={disabled} onClick={() => setConfirmCancel(true)}>Cancel export…</button></div></>}
      {confirmCancel && !locked && !terminal && <div className="export-cancel-confirmation" role="group" aria-labelledby="export-cancel-title"><h3 id="export-cancel-title">Cancel this export?</h3><p>Its temporary files will be discarded. Your archive and files already saved on your device remain unchanged.</p>
        <button ref={cancelButton} className="button-secondary" type="button" disabled={busy} onClick={() => { restoreCancel.current = true; setConfirmCancel(false); }}>Keep export</button>
        <button type="button" disabled={busy} onClick={() => { setConfirmCancel(false); void actions.cancel(); }}>Confirm cancel export</button></div>}
      <p>{job.totalMemories} completed memories · {job.totalOriginals} original files · {bytes(job.totalOriginalBytes)} original bytes</p>
      <p>{job.processedOriginalParts} of {job.originalPartCount} original parts processed · {job.availableOriginals} originals included · {job.unavailableOriginals} originals unavailable</p>
      {Object.keys(job.excludedCounts).length > 0 && <p className="export-exclusions">Excluded from this capture: {job.excludedCounts.deletedOrPurgingMemories} deleted or purging memories; {job.excludedCounts.unfinishedOrUnavailableMemories} unfinished or unavailable memories; {job.excludedCounts.deletedAlbums} deleted albums; {job.excludedCounts.deletedTimelineEvents} deleted timeline events; {job.excludedCounts.deletedTags} deleted tags.</p>}
      {job.unavailableOriginals > 0 && <p className="form-error">This export is incomplete. Unavailable files are reported rather than replaced or silently omitted.</p>}
      {job.complete && <p className="export-complete">All original parts were processed without original-file warnings, and a fresh final index was prepared. Download every part; this status does not confirm browser saves.</p>}
      {job.indexNeedsRefresh && <p>Prepare the final index again after the latest original-part results so its report is current.</p>}
      {!terminal && <p className="guest-help">Only one prepared ZIP is cached at a time across exports. Preparing another part replaces the cached part. Download this part first; you can explicitly prepare it again if needed. Another preparation or download may make the service briefly busy.</p>}
    </div>}
    {job?.capturedAt && !terminal && <>
      <h2>ZIP parts</h2><ol className="inbox-list export-parts">{state.parts.map(part => <li className="inbox-card" key={part.partNumber}><h3>Part {part.partNumber} · {part.kind === "INDEX" ? "Final index and offline reader" : "Original files"}</h3>
        <p>{part.state === "UNPROCESSED" ? "Not prepared yet" : part.state === "CACHED" ? "Currently cached" : "Previously processed"}{part.kind === "ORIGINALS" ? ` · ${part.availableOriginals} included · ${part.unavailableOriginals} unavailable` : ""}</p>
        <button type="button" disabled={disabled || !canPrepare || (part.kind === "INDEX" && job.processedOriginalParts !== job.originalPartCount)} onClick={() => actions.prepare(part.partNumber)} aria-label={`Prepare ZIP part ${part.partNumber}`}>Prepare this part</button></li>)}</ol>
      <div className="inbox-pagination export-parts-pagination"><button className="button-secondary" type="button" disabled={disabled || state.partCursors.length < 2} onClick={() => actions.page("parts", false)}>Previous ZIP parts</button><span>Page {state.partCursors.length}</span><button className="button-secondary" type="button" disabled={disabled || !state.partsNextCursor} onClick={() => actions.page("parts", true)}>Next ZIP parts</button></div>
    </>}
    {job?.preparedPart && !terminal && <div className="export-prepared"><h2>Prepared part {job.preparedPart.partNumber}</h2><p>{job.preparedPart.kind === "INDEX" ? "Final index and offline reader" : "Original files"} · {bytes(job.preparedPart.byteSize)}</p><p className="export-filename">{job.preparedPart.filename}</p>
      <button type="button" disabled={disabled} onClick={actions.download}>Load and verify ZIP part</button>
      {state.download.phase === "loading" && <div role="status"><p>Loading {bytes(state.download.receivedBytes)} of {bytes(state.download.totalBytes)}. A size and checksum check follows.</p><progress value={state.download.receivedBytes} max={state.download.totalBytes} aria-label="ZIP part bytes received" /></div>}
      {state.download.phase === "ready" && <><p>Size and SHA-256 verified for this ZIP part.</p><a className="inbox-download" href={state.download.url} download={state.download.filename} onClick={actions.started}>Save verified ZIP part</a><p className="guest-help">Check your browser’s downloads to confirm it saved. Keep this page visible while loading a part.</p></>}
    </div>}
    {job && state.issues.length > 0 && <section className="export-issues" aria-label="Unavailable export originals"><h2>Original-file warnings</h2><ul className="inbox-list">{state.issues.map((issue, index) => <li className="inbox-card" key={`${issue.partNumber}:${issue.assetId}:${index}`}><p>Part {issue.partNumber}: {ISSUE[issue.code]}</p><p>Memory {issue.memoryId}</p></li>)}</ul>
      <div className="inbox-pagination"><button className="button-secondary" type="button" disabled={disabled || state.issueCursors.length < 2} onClick={() => actions.page("issues", false)}>Previous export warnings</button><span>Page {state.issueCursors.length}</span><button className="button-secondary" type="button" disabled={disabled || !state.issuesNextCursor} onClick={() => actions.page("issues", true)}>Next export warnings</button></div></section>}
  </section>;
}
