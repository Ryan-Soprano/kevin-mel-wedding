const FORM_COPY = {
  create: {
    label: "Create a private tag",
    submit: "Create tag",
  },
  rename: {
    label: "Rename this tag",
    submit: "Save tag name",
  },
};

export default function TagNameForm({ view, mode }) {
  const { name, setName, disabled, handlers } = view;
  const copy = FORM_COPY[mode];
  return (
    <form
      className="tag-name-form"
      onSubmit={handlers.submitName}
      aria-label={copy.label}
    >
      <div>
        <label htmlFor="tag-name">Tag name</label>
        <input
          id="tag-name"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={disabled}
        />
      </div>
      <button type="submit" disabled={disabled}>
        {copy.submit}
      </button>
    </form>
  );
}
