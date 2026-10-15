import "../archiveLayout.css";

export function ArchiveScreen({ children, className = "", label, busy = false }) {
  return <section className={`archive-screen ${className}`.trim()} aria-label={label} aria-busy={busy}>{children}</section>;
}

export function ArchiveActions({ children, className = "" }) {
  return <div className={`archive-actions ${className}`.trim()}>{children}</div>;
}

export function ArchiveIntro({ children, actions }) {
  return <div className="archive-intro">
    <div className="archive-intro-description">{children}</div>
    {actions && <ArchiveActions>{actions}</ArchiveActions>}
  </div>;
}

export function ArchivePanel({ title, children, description, actions, className = "" }) {
  return <section className={`archive-panel ${className}`.trim()}>
    {(title || description || actions) && <header className="archive-panel-header">
      <div>{title && <h2 className="archive-panel-title">{title}</h2>}{description && <div className="archive-panel-description">{description}</div>}</div>
      {actions && <ArchiveActions>{actions}</ArchiveActions>}
    </header>}
    {children && <div className="archive-panel-content">{children}</div>}
  </section>;
}

function EmptyIcon({ icon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {icon === "timeline" ? <><path d="M6 3v18M9 6h10M9 12h7M9 18h10" /><circle cx="6" cy="6" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="6" cy="18" r="2" /></>
      : icon === "library" ? <><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1zM4 8h4M10 8h4" /></>
        : icon === "tags" ? <><path d="m3 12 9 9 9-9V3h-9z" /><circle cx="16" cy="8" r="1" /></>
          : icon === "export" ? <><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" /></>
            : <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M12 8h4M12 12h4" /></>}
  </svg>;
}

export function ArchiveEmpty({ title, children, icon = "album" }) {
  return <div className="archive-empty" role="status">
    <div className="archive-empty-icon"><EmptyIcon icon={icon} /></div>
    {title && <h3>{title}</h3>}
    {children && <div className="archive-empty-copy">{children}</div>}
  </div>;
}

export function ArchivePagination({ previousLabel = "Previous page", nextLabel = "Next page", page,
  disabled, canPrevious, canNext, onPrevious, onNext }) {
  return <nav className="archive-pagination" aria-label="Archive pages">
    <button className="button-secondary" type="button" disabled={disabled || !canPrevious} onClick={onPrevious}>{previousLabel}</button>
    <span className="archive-page-number">Page {page}</span>
    <button className="button-secondary" type="button" disabled={disabled || !canNext} onClick={onNext}>{nextLabel}</button>
  </nav>;
}
