const ICONS = {
  note: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  photos: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
  audio: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
};

export default function MemoryChoice({ kind, title, prompt, children, onClick, disabled = false }) {
  return <button type="button" className={`memory-choice memory-choice--${kind}`} onClick={onClick} disabled={disabled}>
    <span className="memory-choice-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[kind]}</svg></span>
    <span className="memory-choice-copy">{prompt && <span className="memory-choice-prompt">{prompt}</span>}<span className="memory-choice-title">{title}</span><span className="memory-choice-description">{children}</span></span>
    <svg className="memory-choice-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
  </button>;
}
