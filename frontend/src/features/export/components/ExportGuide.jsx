export default function ExportGuide() {
  return (
    <ol className="export-guide" aria-label="How to save your archive">
      <li>
        <span className="export-step" aria-hidden="true">1</span>
        <h2>Prepare</h2>
        <p>
          Save original files together with readable notes, memory dates, albums,
          timeline events and tags.
        </p>
      </li>
      <li>
        <span className="export-step" aria-hidden="true">2</span>
        <h2>Download</h2>
        <p>
          Download each original part, then the final index part. Extract all ZIP
          parts into the same private folder and open <strong>index.html</strong>.
          Missing or unreadable originals are listed in the final report.
        </p>
      </li>
      <li>
        <span className="export-step" aria-hidden="true">3</span>
        <h2>Keep private</h2>
        <p>
          This copy contains private memories and may contain original photo
          metadata. Files already saved on your device cannot be revoked by
          sign-out, deletion or export expiry.
        </p>
      </li>
    </ol>
  );
}
