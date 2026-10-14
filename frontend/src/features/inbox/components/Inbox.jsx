import { createInboxController } from "../api/inboxController.js";
import { audioCollectionEnabled } from "../../audio/audioConstraints.js";
import { getInboxTitle, isInboxAuthenticated } from "../inboxDisplay.js";
import { useInboxController } from "../hooks/useInboxController.js";
import { InboxAccessRecovery, InboxLogin } from "./InboxAccess.jsx";
import InboxList from "./InboxList.jsx";
import MemoryDetail from "./MemoryDetail.jsx";
import AddMemory from "./AddMemory.jsx";
import Albums from "../../albums/components/Albums.jsx";
import Timeline from "../../timeline/components/Timeline.jsx";
import Library from "../../library/components/Library.jsx";
import Tags from "../../library/components/Tags.jsx";
import ExportArchive from "../../export/components/ExportArchive.jsx";
import "../inbox.css";

function InboxContent({ view, authenticated, audioEnabled, audioPlayback, deleteButton, cancelDelete, reviewFeedback }) {
  const { snapshot, actions, reviewLocked } = view;
  if (snapshot.phase === "checking") return <output>Checking archive access…</output>;
  if (snapshot.phase === "login") return <InboxLogin {...view.loginForm} busy={snapshot.busy} />;
  if (snapshot.phase === "unavailable") return <InboxAccessRecovery busy={snapshot.busy} logoutUnconfirmed={snapshot.logoutUnconfirmed} onRetry={view.retryAccess} onLogout={view.logout} />;
  if (!authenticated) return null;

  switch (snapshot.phase) {
    case "inbox":
      return <InboxList state={snapshot} pages={view.pages} actions={actions} onFilter={view.filter} onNext={view.nextPage} onPrevious={view.previousPage} />;
    case "create":
      return <AddMemory {...actions.creation} onDialogStateChange={view.setDialogState} audioEnabled={audioEnabled} />;
    case "albums":
      return <Albums key={`${snapshot.albums.view}:${snapshot.albums.album?.albumId ?? "new"}:${snapshot.albums.album?.revision ?? "new"}`}
        state={snapshot.albums} busy={snapshot.busy} locked={reviewLocked} actions={actions.albums} />;
    case "timeline":
      return <Timeline key={`${snapshot.timeline.view}:${snapshot.timeline.event?.eventId ?? "new"}:${snapshot.timeline.event?.revision ?? "new"}:${JSON.stringify(snapshot.timeline.filters)}`}
        state={snapshot.timeline} busy={snapshot.busy} locked={reviewLocked} actions={actions.timeline} />;
    case "library":
      return <Library key={`${snapshot.library.view}:${JSON.stringify(snapshot.library.filters)}:${snapshot.library.tagQuery}:${snapshot.library.formResetVersion}`}
        state={snapshot.library} busy={snapshot.busy} locked={reviewLocked} actions={actions.library} />;
    case "tags":
      return <Tags key={`${snapshot.tags.view}:${snapshot.tags.tag?.tagId ?? "new"}:${snapshot.tags.tag?.revision ?? "new"}:${snapshot.tags.q}`}
        state={snapshot.tags} busy={snapshot.busy} locked={reviewLocked} actions={actions.tags} />;
    case "export":
      return <ExportArchive state={snapshot.export} busy={snapshot.busy} locked={reviewLocked} actions={actions.export} />;
    case "detail":
      return <MemoryDetail state={snapshot} locked={reviewLocked} actions={actions} audioPlayback={audioPlayback} reviewControls={view.reviewControls}
        deleteButton={deleteButton} cancelDelete={cancelDelete} reviewFeedback={reviewFeedback} />;
    default:
      return null;
  }
}

export default function Inbox({ createController = createInboxController, audioEnabled = audioCollectionEnabled(import.meta.env.VITE_AUDIO_ENABLED) } = {}) {
  const { view, heading, audioPlayback, deleteButton, cancelDelete, reviewFeedback } = useInboxController(createController);
  const { snapshot, reviewLocked } = view;
  const authenticated = isInboxAuthenticated(snapshot);
  return (
    <main className="private-inbox">
      <header className="inbox-header">
        <p className="guest-couple">Kevin &amp; Melanie</p>
        <h1 ref={heading} tabIndex={-1}>{getInboxTitle(snapshot.phase)}</h1>
        {authenticated && (
          <div className="inbox-account">
            <p>Signed in as {snapshot.session.user.displayName}</p>
            <button type="button" className="button-secondary" disabled={reviewLocked} onClick={view.logout}>Sign out</button>
          </div>
        )}
      </header>
      {snapshot.error && <p className="form-error" role="alert">{snapshot.error}</p>}
      <InboxContent view={view} authenticated={authenticated} audioEnabled={audioEnabled} audioPlayback={audioPlayback}
        deleteButton={deleteButton} cancelDelete={cancelDelete} reviewFeedback={reviewFeedback} />
    </main>
  );
}
