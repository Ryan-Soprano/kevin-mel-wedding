export default function LibraryRecovery({ view }) {
  const { state, disabled, handlers } = view;
  if (!state.error) {
    return null;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handlers.reloadFirstPage}
    >
      Load library first page
    </button>
  );
}
