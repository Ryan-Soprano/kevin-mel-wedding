import { ArchiveActions, ArchiveEmpty, ArchivePanel } from "../../inbox/components/ArchiveLayout.jsx";
import { partialDateLabel } from "../timelineFields.js";
import { getTimelineMemoryCount, getTimelineMemoryHeading } from "../timelineDisplay.js";
import TimelineEditor from "./TimelineEditor.jsx";
import TimelineMemorySummary from "./TimelineMemorySummary.jsx";

function TimelineMembers({ state, busy, disabled, actions }) {
  if (busy) return <p role="status">Loading linked memories…</p>;
  if (!state.error && !state.members.length) return <ArchiveEmpty title="No linked memories on this page" icon="timeline"><p>Link an existing note, photo or voice memory.</p></ArchiveEmpty>;
  return (
    <ul className="inbox-list timeline-members">
      {state.members.map(({ memory }) => <li key={memory.memoryId} className="inbox-card timeline-member">
        <TimelineMemorySummary memory={memory} />
        <ArchiveActions>
          <button type="button" disabled={disabled} onClick={() => actions.openMemory(memory.memoryId)} aria-label={`Open ${getTimelineMemoryHeading(memory)} from timeline`}>Open memory</button>
          <button className="button-secondary" type="button" disabled={disabled} onClick={() => actions.unlink(memory.memoryId)} aria-label={`Unlink ${getTimelineMemoryHeading(memory)} from event`}>Unlink from event</button>
        </ArchiveActions>
      </li>)}
    </ul>
  );
}

function TimelineDeleteConfirmation({ disabled, handlers, cancelDelete }) {
  return (
    <div className="timeline-delete-confirmation" role="group" aria-labelledby="timeline-delete-heading">
      <h3 id="timeline-delete-heading">Delete this timeline event?</h3>
      <p>Its title, description, date and links will be removed. Linked memories and originals remain in your archive. This event cannot be restored.</p>
      <ArchiveActions>
        <button ref={cancelDelete} className="button-secondary" type="button" disabled={disabled} onClick={handlers.cancelDeletion}>Cancel event deletion</button>
        <button type="button" disabled={disabled} onClick={handlers.confirmDeletion}>Delete this event</button>
      </ArchiveActions>
    </div>
  );
}

export default function TimelineDetail({ view, cancelDelete, deleteTrigger }) {
  const {
    state,
    busy,
    disabled,
    actions,
    fields,
    fieldErrors,
    registerEditorField,
    confirmDelete,
    handlers,
  } = view;
  if (!state.event) return null;
  if (state.event.deletedAt !== null) return <ArchiveEmpty title="Deleted timeline event" icon="timeline">
    <p>This event was deleted. Its links were removed; the memories and original files remain in your archive. Events do not have a restore action.</p>
  </ArchiveEmpty>;
  return (
    <>
      <ArchivePanel title={state.event.title} description={<>
        <p>Event date: {partialDateLabel(state.event.eventDate, state.event.datePrecision)}</p>
        {state.event.description && <p className="inbox-note">{state.event.description}</p>}
        <p>{state.event.memberCount} linked {getTimelineMemoryCount(state.event.memberCount)} · Couple only</p>
      </>}>
        <TimelineEditor
          fields={fields}
          onChange={handlers.changeFields}
          disabled={disabled}
          onSubmit={handlers.save}
          errors={fieldErrors?.editor}
          onFieldRef={registerEditorField}
        />
        <ArchiveActions>
          <button type="button" disabled={disabled} onClick={() => actions.select("KEEP")}>Link memories</button>
          <button ref={deleteTrigger} className="button-secondary" type="button" disabled={disabled} onClick={handlers.beginDelete}>Delete event…</button>
        </ArchiveActions>
      </ArchivePanel>
      {confirmDelete && <TimelineDeleteConfirmation disabled={disabled} handlers={handlers} cancelDelete={cancelDelete} />}
      <h3>Linked memories</h3>
      <TimelineMembers state={state} busy={busy} disabled={disabled} actions={actions} />
      <p className="guest-help">Unlinking preserves the memory. Deleting a memory removes it from every album and timeline event. Restore returns it to the inbox; re-link it yourself.</p>
    </>
  );
}
