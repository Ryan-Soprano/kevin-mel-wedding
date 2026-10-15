import { isInboxAuthenticated } from "../inboxDisplay.js";
import { InboxAccessRecovery, InboxLogin } from "./InboxAccess.jsx";
import InboxList from "./InboxList.jsx";
import MemoryDetail from "./MemoryDetail.jsx";
import AddMemory from "./AddMemory.jsx";
import Albums from "../../albums/components/Albums.jsx";
import Timeline from "../../timeline/components/Timeline.jsx";
import Library from "../../library/components/Library.jsx";
import Tags from "../../library/components/Tags.jsx";
import ExportArchive from "../../export/components/ExportArchive.jsx";

function CheckingScreen() {
  return <output className="inbox-loading"><span className="inbox-loading-dot" aria-hidden="true" />Checking archive access…</output>;
}

function LoginScreen({ view }) {
  return <InboxLogin {...view.loginForm} busy={view.snapshot.busy} />;
}

function AccessScreen({ view }) {
  return <InboxAccessRecovery busy={view.snapshot.busy} logoutUnconfirmed={view.snapshot.logoutUnconfirmed}
    onRetry={view.retryAccess} onLogout={view.logout} />;
}

function MemoryListScreen({ view }) {
  return <InboxList state={view.snapshot} pages={view.pages} actions={view.actions}
    onFilter={view.filter} onNext={view.nextPage} onPrevious={view.previousPage} />;
}

function CreateScreen({ view, audioEnabled }) {
  return <AddMemory {...view.actions.creation} onDialogStateChange={view.setDialogState}
    onNavigationStateChange={view.setCreationState} audioEnabled={audioEnabled} />;
}

function AlbumsScreen({ view }) {
  const { albums: state, busy } = view.snapshot;
  const key = `${state.view}:${state.album?.albumId ?? "new"}:${state.album?.revision ?? "new"}`;
  return <Albums key={key} state={state} busy={busy} locked={view.reviewLocked} actions={view.actions.albums} />;
}

function TimelineScreen({ view }) {
  const { timeline: state, busy } = view.snapshot;
  const key = `${state.view}:${state.event?.eventId ?? "new"}:${state.event?.revision ?? "new"}:${JSON.stringify(state.filters)}`;
  return <Timeline key={key} state={state} busy={busy} locked={view.reviewLocked} actions={view.actions.timeline} />;
}

function LibraryScreen({ view }) {
  const { library: state, busy } = view.snapshot;
  const key = `${state.view}:${JSON.stringify(state.filters)}:${state.tagQuery}:${state.formResetVersion}`;
  return <Library key={key} state={state} busy={busy} locked={view.reviewLocked} actions={view.actions.library} />;
}

function TagsScreen({ view }) {
  const { tags: state, busy } = view.snapshot;
  const key = `${state.view}:${state.tag?.tagId ?? "new"}:${state.tag?.revision ?? "new"}:${state.q}`;
  return <Tags key={key} state={state} busy={busy} locked={view.reviewLocked} actions={view.actions.tags} />;
}

function ExportScreen({ view }) {
  return <ExportArchive state={view.snapshot.export} busy={view.snapshot.busy}
    locked={view.reviewLocked} actions={view.actions.export} />;
}

function DetailScreen({ view, audioPlayback, deleteButton, cancelDelete, reviewFeedback }) {
  return <MemoryDetail state={view.snapshot} locked={view.reviewLocked} actions={view.actions}
    audioPlayback={audioPlayback} reviewControls={view.reviewControls} deleteButton={deleteButton}
    cancelDelete={cancelDelete} reviewFeedback={reviewFeedback} />;
}

// Adapters keep feature-specific props and reset keys beside their screen.
const SCREENS = Object.freeze({
  checking: CheckingScreen, login: LoginScreen, unavailable: AccessScreen,
  inbox: MemoryListScreen, create: CreateScreen, albums: AlbumsScreen,
  timeline: TimelineScreen, library: LibraryScreen, tags: TagsScreen,
  export: ExportScreen, detail: DetailScreen,
});
const ACCESS_PHASES = new Set(["checking", "login", "unavailable"]);

export default function InboxScreen(props) {
  const { snapshot } = props.view;
  if (!ACCESS_PHASES.has(snapshot.phase) && !isInboxAuthenticated(snapshot)) return null;
  const Screen = SCREENS[snapshot.phase];
  return Screen ? <Screen {...props} /> : null;
}
