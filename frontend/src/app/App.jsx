import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import ContributionForm from "../features/contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../features/media/components/PhotoBatchForm.jsx";
import { audioCollectionEnabled } from "../features/audio/audioConstraints.js";
import {
  createGuestFlow,
  guestFlowReducer,
  hasUnfinishedWork,
  MEMORY_TYPES,
  navigationLocked,
} from "./guestFlow.js";
import GuestGallery from "../features/guestGallery/GuestGallery.jsx";
import CoupleScrapbook from "../features/guestGallery/CoupleScrapbook.jsx";
import MemoryChoice from "../shared/components/MemoryChoice.jsx";
import { restoreGuestHomeView } from "./guestHistory.js";
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

function getNavigationHelp(locked, complete, capturing) {
  if (capturing) {
    return "Keep this page open while recording or checking your clip. Nothing is sent until you choose Send voice memory.";
  }
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
  const heading = useRef(null);
  const choices = useRef(null);
  const homeAlbum = useRef(null);
  const previousScreen = useRef("welcome");
  const homeReturn = useRef({ kind: null, scrollY: null, showOpening: false });
  const [homeRevision, setHomeRevision] = useState(0);
  const previousHomeRevision = useRef(0);
  const getHomeView = useCallback(
    () => ({
      ...homeReturn.current,
      // A browser traversal can leave home without another memory-button click.
      // During a form transition, keep the position captured before its DOM replaced home.
      scrollY:
        flow.screen === "welcome" ? window.scrollY : homeReturn.current.scrollY,
      showOpening:
        homeReturn.current.showOpening &&
        (flow.screen !== "welcome" || window.scrollY <= 0),
    }),
    [flow.screen],
  );
  const restoreHomeView = useCallback((view) => {
    homeReturn.current = view ?? {
      kind: null,
      scrollY: null,
      showOpening: true,
    };
    setHomeRevision((revision) => revision + 1);
  }, []);
  useGuestHistory(flow, dispatch, { getHomeView, restoreHomeView });
  const started = new Set(flow.started);
  const locked = navigationLocked(flow);
  const unfinished = hasUnfinishedWork(flow);
  const welcome = flow.screen === "welcome";
  const navigationHelp = getNavigationHelp(
    locked,
    flow.forms[flow.screen]?.complete,
    flow.forms[flow.screen]?.capturing,
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
  const prepareGalleryReturn = useCallback((kind = null) => {
    homeReturn.current = {
      kind,
      scrollY: null,
      showOpening: false,
      target: "gallery",
    };
  }, []);
  const finishMemory = useCallback(
    (kind) => {
      prepareGalleryReturn(kind);
      dispatch({ type: "FINISHED", kind });
    },
    [prepareGalleryReturn],
  );
  const returnToGallery = useCallback(() => {
    prepareGalleryReturn();
    dispatch({ type: "NAVIGATE", screen: "welcome" });
  }, [prepareGalleryReturn]);
  const noteDone = useCallback(() => finishMemory("note"), [finishMemory]);
  const photosDone = useCallback(() => finishMemory("photos"), [finishMemory]);
  const audioDone = useCallback(() => finishMemory("audio"), [finishMemory]);
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
    const previous = previousScreen.current;
    previousScreen.current = flow.screen;
    const restoredHome = homeRevision !== previousHomeRevision.current;
    previousHomeRevision.current = homeRevision;
    if (MEMORY_TYPES.includes(flow.screen)) {
      homeReturn.current.kind = flow.screen;
      homeReturn.current.showOpening = false;
      delete homeReturn.current.target;
    }
    if (flow.screen === "welcome" && (previous !== "welcome" || restoredHome)) {
      if (
        restoreGuestHomeView(homeReturn.current, {
          choices: choices.current,
          gallery: homeAlbum.current,
          restoredHome,
        })
      )
        return;
    }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [flow.screen, homeRevision]);

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
    welcome: "Lot's of love for Kevin & Melanie",
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

  function openMemory(kind) {
    homeReturn.current = { kind, scrollY: window.scrollY, showOpening: false };
    dispatch({ type: "SELECT", kind });
  }

  function returnToSharing(event) {
    const target = choices.current?.querySelector("h2");
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: "instant" });
    homeReturn.current = {
      kind: null,
      scrollY: window.scrollY,
      showOpening: false,
    };
  }

  return (
    <main className={`guest-page guest-page--${flow.screen}`}>
      <div className={welcome ? "guest-opening" : undefined}>
        <header
          className={`guest-header${welcome ? " guest-header--welcome" : ""}`}
        >
          {welcome ? (
            <p className="guest-eyebrow">Lot's of love for</p>
          ) : (
            <p className="guest-couple">Kevin &amp; Melanie</p>
          )}
          <h1 ref={heading} tabIndex={-1}>
            {welcome ? (
              <>
                Kevin <span className="guest-ampersand">&amp;</span> Melanie
              </>
            ) : (
              title
            )}
          </h1>
        </header>

        {welcome && <CoupleScrapbook />}
        {welcome && (
          <div className="guest-invitation">
            <p className="guest-invitation-copy">
              A favorite photo. A good story.
              <br />
              Help kickstart their next chapter.
            </p>
          </div>
        )}
      </div>

      {welcome && (
        <section
          ref={choices}
          className="guest-choices guest-choices--welcome"
          aria-labelledby="share-wedding-memory"
        >
          <div className="guest-choices-heading">
            <h2 id="share-wedding-memory" tabIndex={-1}>
              Share a memory
            </h2>
            <p className="guest-help">
              No account needed. Your name is optional.
            </p>
          </div>
          {unfinished && (
            <output className="guest-draft-notice">
              You have an unfinished memory here. Choose its memory type below
              to continue. Refreshing or closing this page can clear unsent
              drafts.
            </output>
          )}
          <div
            className={`memory-choices${flow.audioEnabled ? " memory-choices--three" : ""}`}
          >
            <MemoryChoice
              kind="photos"
              prompt="Caught a good moment?"
              title={photosChoiceLabel}
              onClick={() => openMemory("photos")}
            >
              A favorite snapshot or a few from the day. Up to 5 photos · 10 MB
              each.
            </MemoryChoice>
            <MemoryChoice
              kind="note"
              prompt="Tell us a story."
              title={noteChoiceLabel}
              onClick={() => openMemory("note")}
            >
              A good memory, a little advice, or a wish for what’s next.
            </MemoryChoice>
            {flow.audioEnabled && (
              <MemoryChoice
                kind="audio"
                prompt="Leave a little love."
                title={audioChoiceLabel}
                onClick={() => openMemory("audio")}
              >
                Say it in your own voice. Record or upload a clip up to two
                minutes.
              </MemoryChoice>
            )}
          </div>
          <p className="guest-help guest-privacy">
            Sent privately to Kevin and Melanie. They choose which memories to
            share.
          </p>
        </section>
      )}

      {welcome && (
        <aside className="guest-registry" aria-labelledby="wedding-registry">
          <div className="guest-registry-copy">
            <h2 id="wedding-registry">A little note of thanks</h2>
            <p className="guest-registry-description">
              Having you in our lives is the greatest gift. Thank you for all
              the love, laughter, and memories as we start this next chapter.
            </p>
            <p className="guest-registry-signature">
              With love, <span>Kevin &amp; Melanie</span>
            </p>
          </div>
          <div className="guest-registry-actions">
            <p className="guest-registry-invitation">
              If you feel inclined, here is the link to our registry
            </p>
            <a
              className="guest-registry-link"
              href="https://www.zola.com/wedding/melaniekevinfollybeach"
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit our registry
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h14m-5-5 5 5-5 5" />
              </svg>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <p className="guest-registry-password">
              Zola password <span>ODIE123</span>
            </p>
          </div>
        </aside>
      )}

      {/* Retain the home album and loaded public content so history restores the page guests left. */}
      <div ref={homeAlbum} hidden={!welcome}>
        <GuestGallery
          deferInitialPhoto
          active={welcome}
          onBackToSharing={returnToSharing}
        />
        <Suspense fallback={null}>
          <PublicMemories active={welcome} />
        </Suspense>
      </div>

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
            <span aria-hidden="true">← </span>Back to home
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
          <button type="button" onClick={() => dispatch({ type: "BACK" })}>
            {unfinished
              ? "Continue or share another memory"
              : "Share another memory"}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={returnToGallery}
          >
            Back to our photos
          </button>
        </section>
      )}
    </main>
  );
}
