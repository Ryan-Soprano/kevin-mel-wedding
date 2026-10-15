import {
  ArchiveActions,
  ArchivePanel,
} from "../../inbox/components/ArchiveLayout.jsx";

export default function AlbumNameForm({ view, create = false }) {
  const { name, setName, disabled, handlers } = view;
  let label = "Rename this album";
  let buttonLabel = "Save album name";
  if (create) {
    label = "Create a private album";
    buttonLabel = "Create album";
  }
  const form = (
    <form
      className="album-name-form"
      onSubmit={handlers.submitName}
      aria-label={label}
    >
      <div>
        <label htmlFor="album-name">Album name</label>
        <input
          id="album-name"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={disabled}
        />
      </div>
      <ArchiveActions>
        <button type="submit" disabled={disabled}>
          {buttonLabel}
        </button>
      </ArchiveActions>
    </form>
  );
  if (create) {
    return <ArchivePanel title="Create an album">{form}</ArchivePanel>;
  }
  return form;
}
