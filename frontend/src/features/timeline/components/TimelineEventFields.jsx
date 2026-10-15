import { getTimelineDateInput, TIMELINE_PRECISIONS } from "../timelineDisplay.js";

export default function TimelineEventFields({ fields, setFields, disabled, prefix = "timeline" }) {
  const change = (field, value) => setFields(previous => ({ ...previous, [field]: value }));
  const dateInput = getTimelineDateInput(fields.datePrecision);
  return (
    <div className="timeline-fields">
      <div>
        <label htmlFor={`${prefix}-title`}>Event title</label>
        <input id={`${prefix}-title`} value={fields.title ?? ""} maxLength={200} required disabled={disabled}
          onChange={event => change("title", event.target.value)} />
      </div>
      <div>
        <label htmlFor={`${prefix}-description`}>Event description (optional)</label>
        <textarea id={`${prefix}-description`} value={fields.description ?? ""} maxLength={2000} disabled={disabled}
          onChange={event => change("description", event.target.value || null)} />
      </div>
      <div>
        <label htmlFor={`${prefix}-precision`}>Event date precision</label>
        <select id={`${prefix}-precision`} value={fields.datePrecision} disabled={disabled}
          onChange={event => setFields(previous => ({ ...previous, datePrecision: event.target.value, eventDate: null }))}>
          {Object.entries(TIMELINE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {fields.datePrecision !== "UNKNOWN" && <div>
        <label htmlFor={`${prefix}-date`}>Event date</label>
        <input id={`${prefix}-date`} type="text" inputMode={dateInput.inputMode} value={fields.eventDate ?? ""}
          maxLength={dateInput.maxLength} required disabled={disabled} placeholder={dateInput.placeholder}
          aria-describedby={`${prefix}-date-help`} onChange={event => change("eventDate", event.target.value || null)} />
        <p id={`${prefix}-date-help`} className="guest-help">Use {dateInput.placeholder}. Years 0001–9999, including future dates, are supported. Choose only the precision you know.</p>
      </div>}
    </div>
  );
}
