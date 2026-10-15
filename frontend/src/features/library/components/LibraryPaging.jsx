import { ArchivePagination } from "../../inbox/components/ArchiveLayout.jsx";

export default function LibraryPaging({ view }) {
  const { state, choosing, disabled, handlers } = view;
  let cursors = state.cursors;
  let nextCursor = state.nextCursor;
  if (choosing) {
    cursors = state.tagCursors;
    nextCursor = state.tagNextCursor;
  }

  return (
    <ArchivePagination
      previousLabel="Previous library page"
      nextLabel="Next library page"
      page={cursors.length}
      disabled={disabled || Boolean(state.error)}
      canPrevious={cursors.length > 1}
      canNext={Boolean(nextCursor)}
      onPrevious={handlers.previousPage}
      onNext={handlers.nextPage}
    />
  );
}
