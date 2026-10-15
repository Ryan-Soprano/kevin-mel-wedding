import { ArchivePagination } from "../../inbox/components/ArchiveLayout.jsx";

export default function TagPaging({ view }) {
  const { state, disabled, handlers } = view;
  if (!["list", "detail", "select"].includes(state.view) || state.tag?.deletedAt) {
    return null;
  }
  return (
    <ArchivePagination
      previousLabel="Previous tag page"
      nextLabel="Next tag page"
      page={state.cursors.length}
      disabled={disabled || Boolean(state.error)}
      canPrevious={state.cursors.length > 1}
      canNext={Boolean(state.nextCursor)}
      onPrevious={handlers.previousPage}
      onNext={handlers.nextPage}
    />
  );
}
