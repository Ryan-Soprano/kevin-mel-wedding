import { ArchivePagination } from "../../inbox/components/ArchiveLayout.jsx";

export default function AlbumPaging({ view }) {
  const { state, disabled, actions, handlers } = view;
  const paged =
    ["list", "detail", "select"].includes(state.view) &&
    !state.album?.deletedAt;
  return (
    <>
      {state.error && (
        <button
          type="button"
          disabled={disabled}
          onClick={handlers.reloadFirstPage}
        >
          Reload album first page
        </button>
      )}
      {paged && (
        <ArchivePagination
          previousLabel="Previous album page"
          nextLabel="Next album page"
          page={state.cursors.length}
          disabled={disabled || Boolean(state.error)}
          canPrevious={state.cursors.length >= 2}
          canNext={Boolean(state.nextCursor)}
          onPrevious={() => actions.page(false)}
          onNext={() => actions.page(true)}
        />
      )}
    </>
  );
}
