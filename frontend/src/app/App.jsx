import { lazy, Suspense, useCallback, useEffect, useReducer, useRef } from "react";
import ContributionForm from "../features/contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../features/media/components/PhotoBatchForm.jsx";
import { audioCollectionEnabled } from "../features/audio/audioConstraints.js";
import { createGuestFlow, guestFlowReducer, hasUnfinishedWork, navigationLocked } from "./guestFlow.js";
import GuestGallery from "../features/guestGallery/GuestGallery.jsx";

const AudioForm = lazy(() => import("../features/audio/components/AudioForm.jsx"));
const PublicMemories = lazy(() => import("../features/sharing/SharedMemories.jsx").then(module => ({ default: module.PublicMemories })));

function getChoiceLabel(form, savedLabel, draftLabel, emptyLabel) {
  if (form.complete) return savedLabel;
  if (form.hasDraft) return draftLabel;
  return emptyLabel;
}

export default function App({ audioEnabled = audioCollectionEnabled(import.meta.env.VITE_AUDIO_ENABLED) } = {}) {
  const [flow, dispatch] = useReducer(guestFlowReducer, { audioEnabled }, createGuestFlow);
  const heading = useRef(null);
  const started = new Set(flow.started);
  const locked = navigationLocked(flow);
  const unfinished = hasUnfinishedWork(flow);
  const reportNote = useCallback(state => dispatch({ type: "FORM_STATE", kind: "note", state }), []);
  const reportPhotos = useCallback(state => dispatch({ type: "FORM_STATE", kind: "photos", state }), []);
  const reportAudio = useCallback(state => dispatch({ type: "FORM_STATE", kind: "audio", state }), []);
  const noteDone = useCallback(() => dispatch({ type: "FINISHED", kind: "note" }), []);
  const photosDone = useCallback(() => dispatch({ type: "FINISHED", kind: "photos" }), []);
  const audioDone = useCallback(() => dispatch({ type: "FINISHED", kind: "audio" }), []);
  const anotherNote = useCallback(() => dispatch({ type: "ANOTHER", kind: "note" }), []);
  const anotherPhotos = useCallback(() => dispatch({ type: "ANOTHER", kind: "photos" }), []);
  const anotherAudio = useCallback(() => dispatch({ type: "ANOTHER", kind: "audio" }), []);

  useEffect(() => {
    heading.current?.focus();
  }, [flow.screen]);

  useEffect(() => {
    if (!unfinished) return;
    const protectDraft = event => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [unfinished]);

  const title = {
    welcome: "Help Kevin and Melanie remember their wedding.",
    choose: "What would you like to share?",
    note: "A note for Kevin and Melanie",
    photos: "Photos for Kevin and Melanie",
    audio: "A voice memory for Kevin and Melanie",
    done: "You’re all set.",
  }[flow.screen];

  const noteChoiceLabel = getChoiceLabel(flow.forms.note, "View your saved note", "Continue your note", "Write a note");
  const photosChoiceLabel = getChoiceLabel(flow.forms.photos, "View your saved photos", "Continue your photos", "Add photos");
  const audioChoiceLabel = getChoiceLabel(flow.forms.audio, "View your saved voice memory", "Continue your voice memory", "Record a voice memory");

  return (
    <main className="guest-page">
      <header className="guest-header">
        <p className="guest-couple">Kevin &amp; Melanie</p>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
      </header>

      {flow.screen === "welcome" && (
        <section className="guest-welcome" aria-label="Share a wedding memory">
          <p>{flow.audioEnabled ? "Share a note, your favorite photos, or a voice memory from the day." : "Share a note or your favorite photos from the day."}</p>
          <p>Your contribution goes directly to Kevin and Melanie’s private vault. It is not posted publicly.</p>
          <button id="share-wedding-memory" type="button" onClick={() => dispatch({ type: "CHOOSE" })}>Share a memory</button>
          <p className="guest-help">No account needed. Your name is optional.</p>
        </section>
      )}
      {flow.screen === "welcome" && <GuestGallery />}
      {flow.screen === "welcome" && <Suspense fallback={null}><PublicMemories /></Suspense>}

      {flow.screen === "choose" && (
        <section className="guest-choices" aria-label="Choose your memory type">
          <p>Choose one type at a time. You can share another memory after it is saved.</p>
          <button type="button" className="guest-choice" onClick={() => dispatch({ type: "SELECT", kind: "note" })}>
            <span className="guest-choice__title">{noteChoiceLabel}</span>
            <span>A message up to 5,000 characters</span>
          </button>
          <button type="button" className="guest-choice" onClick={() => dispatch({ type: "SELECT", kind: "photos" })}>
            <span className="guest-choice__title">{photosChoiceLabel}</span>
            <span>Up to 5 original JPEG, PNG or WebP photos · 10 MB each</span>
          </button>
          {flow.audioEnabled && <button type="button" className="guest-choice" onClick={() => dispatch({ type: "SELECT", kind: "audio" })}>
            <span className="guest-choice__title">{audioChoiceLabel}</span>
            <span>Record or choose one audio clip · up to two minutes and 25 MB</span>
          </button>}
          <p className="guest-help">Your memories stay private. No account needed.</p>
          <button type="button" className="button-secondary" onClick={() => dispatch({ type: "BACK" })}>Back</button>
        </section>
      )}

      {(flow.screen === "note" || flow.screen === "photos" || flow.screen === "audio") && (
        <nav className="guest-navigation" aria-label="Memory navigation">
          <button type="button" className="button-secondary" disabled={locked} aria-describedby={locked ? "guest-navigation-help" : undefined} onClick={() => dispatch({ type: "BACK" })}>Back to memory choices</button>
          <p id="guest-navigation-help" className="guest-help">
            {locked
              ? "Keep this page open until your submission is confirmed. Use the retry controls below if needed."
              : flow.forms[flow.screen].complete ? "Your memory is saved. Choose Done or Share another memory below to finish."
              : "Back keeps your draft here. Refreshing or closing the page does not save an unfinished memory."}
          </p>
        </nav>
      )}

      {/* Keep visited forms mounted: original files, drafts and retry keys live in memory. */}
      {started.has("note") && (
        <div hidden={flow.screen !== "note"}>
          <ContributionForm active={flow.screen === "note"} onFlowStateChange={reportNote} onDone={noteDone} onShareAnother={anotherNote} />
        </div>
      )}
      {started.has("photos") && (
        <div hidden={flow.screen !== "photos"}>
          <PhotoBatchForm active={flow.screen === "photos"} onFlowStateChange={reportPhotos} onDone={photosDone} onShareAnother={anotherPhotos} />
        </div>
      )}
      {started.has("audio") && (
        <div hidden={flow.screen !== "audio"}>
          <Suspense fallback={<output>Loading voice memory controls…</output>}>
            <AudioForm active={flow.screen === "audio"} onFlowStateChange={reportAudio} onDone={audioDone} onShareAnother={anotherAudio} />
          </Suspense>
        </div>
      )}

      {flow.screen === "done" && (
        <section className="guest-finished" aria-label="Memory saved">
          <p>Your memory was saved privately for Kevin and Melanie. They can review it when their archive is ready.</p>
          {unfinished
            ? <p>You also have an unfinished draft here. Choose its memory type to continue before closing this page.</p>
            : <p>You can close this page, or share another memory.</p>}
          <button type="button" onClick={() => dispatch({ type: "CHOOSE" })}>{unfinished ? "Continue or share another memory" : "Share another memory"}</button>
        </section>
      )}
    </main>
  );
}
