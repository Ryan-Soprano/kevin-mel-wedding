import { ArchivePagination } from "../../inbox/components/ArchiveLayout.jsx";

export default function TimelinePaging({ view }) {
  const { state, disabled, actions, handlers } = view;
  const paged = ["list", "detail", "select"].includes(state.view) && !state.event?.deletedAt;
  return (
    <>
      {state.error && <button type="button" disabled={disabled} onClick={handlers.reloadFirstPage}>Reload timeline first page</button>}
      {paged && <ArchivePagination previousLabel="Previous timeline page" nextLabel="Next timeline page"
        page={state.cursors.length} disabled={disabled || Boolean(state.error)} canPrevious={state.cursors.length >= 2} canNext={Boolean(state.nextCursor)}
        onPrevious={() => actions.page(false)} onNext={() => actions.page(true)} />}
    </>
  );
}
