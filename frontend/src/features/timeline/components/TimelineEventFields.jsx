import { getTimelineDateInput, TIMELINE_PRECISIONS } from "../timelineDisplay.js";

export default function TimelineEventFields({
  fields,
  onChange,
  disabled,
  errors = {},
  onFieldRef,
  prefix = "timeline",
}) {
  const dateInput = getTimelineDateInput(fields.datePrecision);
  return (
    <div className="timeline-fields">
      <div>
        <label htmlFor={`${prefix}-title`}>Event title</label>
        <input
          id={`${prefix}-title`}
          ref={element => onFieldRef?.("title", element)}
          value={fields.title ?? ""}
          maxLength={200}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? `${prefix}-title-error` : undefined}
          onChange={event => onChange("title", event.target.value)}
        />
        {errors.title && (
          <p id={`${prefix}-title-error`} className="form-error" role="alert">
            {errors.title}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${prefix}-description`}>Event description (optional)</label>
        <textarea
          id={`${prefix}-description`}
          ref={element => onFieldRef?.("description", element)}
          value={fields.description ?? ""}
          maxLength={2000}
          disabled={disabled}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? `${prefix}-description-error` : undefined}
          onChange={event => onChange("description", event.target.value || null)}
        />
        {errors.description && (
          <p id={`${prefix}-description-error`} className="form-error" role="alert">
            {errors.description}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${prefix}-precision`}>Event date precision</label>
        <select
          id={`${prefix}-precision`}
          ref={element => onFieldRef?.("datePrecision", element)}
          value={fields.datePrecision}
          disabled={disabled}
          aria-invalid={Boolean(errors.datePrecision)}
          aria-describedby={errors.datePrecision ? `${prefix}-precision-error` : undefined}
          onChange={event => onChange("datePrecision", event.target.value)}
        >
          {Object.entries(TIMELINE_PRECISIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {errors.datePrecision && (
          <p id={`${prefix}-precision-error`} className="form-error" role="alert">
            {errors.datePrecision}
          </p>
        )}
      </div>
      {fields.datePrecision !== "UNKNOWN" && <div>
        <label htmlFor={`${prefix}-date`}>Event date</label>
        <input
          id={`${prefix}-date`}
          ref={element => onFieldRef?.("eventDate", element)}
          type="text"
          inputMode={dateInput.inputMode}
          value={fields.eventDate ?? ""}
          maxLength={dateInput.maxLength}
          required
          disabled={disabled}
          placeholder={dateInput.placeholder}
          aria-invalid={Boolean(errors.eventDate)}
          aria-describedby={`${prefix}-date-help${errors.eventDate ? ` ${prefix}-date-error` : ""}`}
          onChange={event => onChange("eventDate", event.target.value || null)}
        />
        {errors.eventDate && (
          <p id={`${prefix}-date-error`} className="form-error" role="alert">
            {errors.eventDate}
          </p>
        )}
        <p id={`${prefix}-date-help`} className="guest-help">Use {dateInput.placeholder}. Years 0001–9999, including future dates, are supported. Choose only the precision you know.</p>
      </div>}
    </div>
  );
}
