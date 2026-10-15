import { ArchiveActions, ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import TimelineEventFields from "./TimelineEventFields.jsx";

export default function TimelineEditor({ fields, setFields, disabled, onSubmit, create = false }) {
  let label = "Edit this timeline event";
  let buttonLabel = "Save event details";
  if (create) {
    label = "Create a private timeline event";
    buttonLabel = "Create event";
  }
  const form = (
    <form className="timeline-event-form" onSubmit={onSubmit} aria-label={label}>
      <TimelineEventFields fields={fields} setFields={setFields} disabled={disabled} />
      <ArchiveActions><button type="submit" disabled={disabled}>{buttonLabel}</button></ArchiveActions>
    </form>
  );
  if (create) return <ArchivePanel title="Create an event or milestone">{form}</ArchivePanel>;
  return form;
}
