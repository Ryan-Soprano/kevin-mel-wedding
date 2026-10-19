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
  const { name, setName, disabled, handlers, fieldErrors = {}, fields = {} } = view;
  const { name: nameField } = fields;
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
          ref={nameField}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={disabled}
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "tag-name-error" : undefined}
        />
        {fieldErrors.name && (
          <p id="tag-name-error" className="form-error" role="alert">
            {fieldErrors.name}
          </p>
        )}
      </div>
      <button type="submit" disabled={disabled}>
        {copy.submit}
      </button>
    </form>
  );
}
