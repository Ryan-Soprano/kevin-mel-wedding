import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import ContributionForm from "../features/contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../features/media/components/PhotoBatchForm.jsx";
import { audioCollectionEnabled } from "../features/audio/audioConstraints.js";
import {
  createGuestFlow,
  guestFlowReducer,
  hasUnfinishedWork,
  navigationLocked,
} from "./guestFlow.js";
import GuestGallery from "../features/guestGallery/GuestGallery.jsx";
import CoupleScrapbook from "../features/guestGallery/CoupleScrapbook.jsx";
import MemoryChoice from "../shared/components/MemoryChoice.jsx";
import { useGuestHistory } from "./useGuestHistory.js";
import "../styles/guest.css";
import "../styles/guestWelcome.css";

const AudioForm = lazy(
  () => import("../features/audio/components/AudioForm.jsx"),
);
const PublicMemories = lazy(() =>
  import("../features/sharing/SharedMemories.jsx").then((module) => ({
    default: module.PublicMemories,
  })),
);

function getChoiceLabel(form, savedLabel, draftLabel, emptyLabel) {
  if (form.complete) return savedLabel;
  if (form.hasDraft) return draftLabel;
  return emptyLabel;
}

function getNavigationHelp(locked, complete) {
  if (locked) {
    return "Keep this page open until your submission is confirmed. Use the retry controls below if needed.";
  }
  if (complete) {
    return "Your memory is saved. Return to our photos or share another memory below.";
  }
  return null;
}

export default function App({
  audioEnabled = audioCollectionEnabled(import.meta.env.VITE_AUDIO_ENABLED),
  createNoteSubmission,
} = {}) {
  const [flow, dispatch] = useReducer(
    guestFlowReducer,
    { audioEnabled },
    createGuestFlow,
  );
  useGuestHistory(flow, dispatch);
  const heading = useRef(null);
  const started = new Set(flow.started);
  const locked = navigationLocked(flow);
  const unfinished = hasUnfinishedWork(flow);
  const welcome = flow.screen === "welcome";
  const navigationHelp = getNavigationHelp(
    locked,
    flow.forms[flow.screen]?.complete,
  );
  const reportNote = useCallback(
    (state) => dispatch({ type: "FORM_STATE", kind: "note", state }),
    [],
  );
  const reportPhotos = useCallback(
    (state) => dispatch({ type: "FORM_STATE", kind: "photos", state }),
    [],
  );
  const reportAudio = useCallback(
    (state) => dispatch({ type: "FORM_STATE", kind: "audio", state }),
    [],
  );
  const noteDone = useCallback(
    () => dispatch({ type: "FINISHED", kind: "note" }),
    [],
  );
  const photosDone = useCallback(
    () => dispatch({ type: "FINISHED", kind: "photos" }),
    [],
  );
  const audioDone = useCallback(
    () => dispatch({ type: "FINISHED", kind: "audio" }),
    [],
  );
  const anotherNote = useCallback(
    () => dispatch({ type: "ANOTHER", kind: "note" }),
    [],
  );
  const anotherPhotos = useCallback(
    () => dispatch({ type: "ANOTHER", kind: "photos" }),
    [],
  );
  const anotherAudio = useCallback(
    () => dispatch({ type: "ANOTHER", kind: "audio" }),
    [],
  );

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [flow.screen]);

  useEffect(() => {
    if (!unfinished) return;
    const protectDraft = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [unfinished]);

  const title = {
    welcome: "A little love for Kevin & Melanie",
    choose: "What would you like to share?",
    note: "A note for Kevin and Melanie",
    photos: "Photos for Kevin and Melanie",
    audio: "A voice memory for Kevin and Melanie",
    done: "You’re all set.",
  }[flow.screen];

  const noteChoiceLabel = getChoiceLabel(
    flow.forms.note,
    "View your saved note",
    "Continue your note",
    "Write a message",
  );
  const photosChoiceLabel = getChoiceLabel(
    flow.forms.photos,
    "View your saved photos",
    "Continue your photos",
    "Add photos",
  );
  const audioChoiceLabel = getChoiceLabel(
    flow.forms.audio,
    "View your saved voice memory",
    "Continue your voice memory",
    "Record a message",
  );

  return (
    <main className={`guest-page guest-page--${flow.screen}`}>
      <header className={`guest-header${welcome ? " guest-header--welcome" : ""}`}>
        {welcome ? (
          <p className="guest-eyebrow">Good stories deserve a place to stay.</p>
        ) : (
          <p className="guest-couple">Kevin &amp; Melanie</p>
        )}
        <h1 ref={heading} tabIndex={-1}>
          {welcome ? (
            <>
              <span className="guest-welcome-title">A little love for</span>
              <span className="guest-names">
                Kevin <span className="guest-ampersand">&amp;</span> Melanie
              </span>
            </>
          ) : title}
        </h1>
        {welcome && (
          <p className="guest-welcome-introduction">
            {flow.audioEnabled
              ? "A favorite photo, a good story, a few words from the heart."
              : "A favorite photo, a good story, a wish for their next chapter."}
            {" "}From the wedding day or years before, help them keep the moments
            that matter.
          </p>
        )}
      </header>

      {welcome && <CoupleScrapbook />}

      {(welcome || flow.screen === "choose") && (
        <section
          className={`guest-choices${welcome ? " guest-choices--welcome" : ""}`}
          aria-labelledby="share-wedding-memory"
        >
          <div className="guest-choices-heading">
            <h2 id="share-wedding-memory" tabIndex={-1}>
              {welcome ? "Share a memory" : "Choose a memory"}
            </h2>
            <p className="guest-help">No account needed. Your name is optional.</p>
          </div>
          <div className={`memory-choices${flow.audioEnabled ? " memory-choices--three" : ""}`}>
            <MemoryChoice
              kind="photos"
              prompt="Caught a good moment?"
              title={photosChoiceLabel}
              onClick={() => dispatch({ type: "SELECT", kind: "photos" })}
            >
              A favorite snapshot or a few from the day. Up to 5 photos · 10 MB each.
            </MemoryChoice>
            <MemoryChoice
              kind="note"
              prompt="Tell us a story."
              title={noteChoiceLabel}
              onClick={() => dispatch({ type: "SELECT", kind: "note" })}
            >
              A good memory, a little advice, or a wish for what’s next.
            </MemoryChoice>
            {flow.audioEnabled && (
              <MemoryChoice
                kind="audio"
                prompt="Leave a little love."
                title={audioChoiceLabel}
                onClick={() => dispatch({ type: "SELECT", kind: "audio" })}
              >
                Say it in your own voice. Record or upload a clip up to two minutes.
              </MemoryChoice>
            )}
          </div>
          <p className="guest-help guest-privacy">
            Sent privately to Kevin and Melanie. They choose which memories to share.
          </p>
          {welcome && unfinished && <p className="guest-draft-notice" role="status">You have an unfinished memory here. Choose its memory type above to continue before closing this page.</p>}
          {!welcome && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => dispatch({ type: "BACK" })}
            >
              Back to welcome
            </button>
          )}
        </section>
      )}

      {welcome && <GuestGallery />}
      {welcome && (
        <Suspense fallback={null}>
          <PublicMemories />
        </Suspense>
      )}

      {(flow.screen === "note" ||
        flow.screen === "photos" ||
        flow.screen === "audio") && (
        <nav className="guest-navigation" aria-label="Memory navigation">
          <button
            type="button"
            className="button-secondary"
            disabled={locked}
            aria-describedby={locked ? "guest-navigation-help" : undefined}
            onClick={() => dispatch({ type: "BACK" })}
          >
            Back to memory choices
          </button>
          {navigationHelp && (
            <p id="guest-navigation-help" className="guest-help">
              {navigationHelp}
            </p>
          )}
        </nav>
      )}

      {/* Keep visited forms mounted: original files, drafts and retry keys live in memory. */}
      {started.has("note") && (
        <div hidden={flow.screen !== "note"}>
          <ContributionForm
            active={flow.screen === "note"}
            createSubmission={createNoteSubmission}
            onFlowStateChange={reportNote}
            onDone={noteDone}
            onShareAnother={anotherNote}
          />
        </div>
      )}
      {started.has("photos") && (
        <div hidden={flow.screen !== "photos"}>
          <PhotoBatchForm
            active={flow.screen === "photos"}
            onFlowStateChange={reportPhotos}
            onDone={photosDone}
            onShareAnother={anotherPhotos}
          />
        </div>
      )}
      {started.has("audio") && (
        <div hidden={flow.screen !== "audio"}>
          <Suspense fallback={<output>Loading voice memory controls…</output>}>
            <AudioForm
              active={flow.screen === "audio"}
              onFlowStateChange={reportAudio}
              onDone={audioDone}
              onShareAnother={anotherAudio}
              onWriteNote={() => dispatch({ type: "SELECT", kind: "note" })}
            />
          </Suspense>
        </div>
      )}

      {flow.screen === "done" && (
        <section className="guest-finished" aria-label="Memory saved">
          <p>
            Your memory was saved privately for Kevin and Melanie. They can
            review it when their archive is ready.
          </p>
          {unfinished ? (
            <p>
              You also have an unfinished draft here. Choose its memory type to
              continue before closing this page.
            </p>
          ) : (
            <p>You can close this page, or share another memory.</p>
          )}
          <button type="button" onClick={() => dispatch({ type: "CHOOSE" })}>
            {unfinished
              ? "Continue or share another memory"
              : "Share another memory"}
          </button>
          <button type="button" className="button-secondary" onClick={() => dispatch({ type: "NAVIGATE", screen: "welcome" })}>Back to our photos</button>
        </section>
      )}
    </main>
  );
}
