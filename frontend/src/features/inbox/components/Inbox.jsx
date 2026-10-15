import { createInboxController } from "../api/inboxController.js";
import { audioCollectionEnabled } from "../../audio/audioConstraints.js";
import { getInboxTitle, isInboxAuthenticated } from "../inboxDisplay.js";
import { useInboxController } from "../hooks/useInboxController.js";
import InboxScreen from "./InboxScreens.jsx";
import "../inbox.css";

export default function Inbox({
  createController = createInboxController,
  audioEnabled = audioCollectionEnabled(import.meta.env.VITE_AUDIO_ENABLED),
} = {}) {
  const {
    view,
    heading,
    audioPlayback,
    deleteButton,
    cancelDelete,
    reviewFeedback,
  } = useInboxController(createController);
  const { snapshot, reviewLocked } = view;
  const authenticated = isInboxAuthenticated(snapshot);
  return (
    <main className="private-inbox">
      <header className="inbox-header">
        <div className="inbox-header-top">
          <p className="guest-couple">Kevin &amp; Melanie</p>
          <span className="inbox-vault-label">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3" />
            </svg>
            Private vault
          </span>
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {getInboxTitle(snapshot.phase)}
        </h1>
        <p className="inbox-header-description">
          {authenticated
            ? "Your life memories, gathered in one place. New contributions arrive privately; you choose what to share."
            : "A home for the stories, photos, and little moments you want to remember."}
        </p>
        {authenticated && (
          <div className="inbox-account">
            <p>Signed in as {snapshot.session.user.displayName}</p>
            <button
              type="button"
              className="button-secondary"
              disabled={reviewLocked}
              onClick={view.logout}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      {snapshot.error && (
        <p className="form-error" role="alert">
          {snapshot.error}
        </p>
      )}
      {view.navigationNotice && (
        <p className="inbox-review-notice" role="status">
          {view.navigationNotice}
        </p>
      )}
      <div className="inbox-content">
        <InboxScreen
          view={view}
          audioEnabled={audioEnabled}
          audioPlayback={audioPlayback}
          deleteButton={deleteButton}
          cancelDelete={cancelDelete}
          reviewFeedback={reviewFeedback}
        />
      </div>
    </main>
  );
}
