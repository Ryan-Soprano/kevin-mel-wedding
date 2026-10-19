import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ContributionForm from "../../contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../../media/components/PhotoBatchForm.jsx";
import AudioForm from "../../audio/components/AudioForm.jsx";
import { createTextSubmission } from "../../contribution/api/textSubmission.js";
import { createPhotoBatchSubmission } from "../../media/api/photoBatchSubmission.js";
import { createAudioSubmission } from "../../audio/api/audioSubmission.js";
import MemoryChoice from "../../../shared/components/MemoryChoice.jsx";
import {
  ArchiveActions,
  ArchiveIntro,
  ArchiveScreen,
} from "./ArchiveLayout.jsx";
import "../../../styles/guest.css";

export default function AddMemory({
  getApi,
  onDone,
  onBack,
  onDialogStateChange,
  onNavigationStateChange,
  audioEnabled = false,
}) {
  const api = useRef(null);
  const choices = useRef(null);
  const compose = useRef(null);
  const focusRequest = useRef(undefined);
  const [choice, setChoice] = useState(null);
  const [flow, setFlow] = useState({
    busy: false,
    pending: false,
    hasDraft: false,
    complete: false,
  });
  const locked = flow.busy || flow.pending;
  const reportFlow = useCallback(
    (next) => {
      onNavigationStateChange?.(next);
      setFlow(next);
    },
    [onNavigationStateChange],
  );
  useEffect(
    () => () => onNavigationStateChange?.(null),
    [onNavigationStateChange],
  );
  useLayoutEffect(() => {
    if (focusRequest.current !== choice) return;
    focusRequest.current = undefined;
    // Only a deliberate type change owns focus; initial mount and later form updates do not.
    const target = choice ? compose.current : choices.current;
    if (target?.isConnected) target.focus();
  }, [choice]);
  useEffect(() => {
    api.current = getApi();
  }, [getApi]);
  useEffect(() => {
    if (!flow.hasDraft && !flow.pending) return;
    const leaving = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [flow.hasDraft, flow.pending]);
  useEffect(() => () => onDialogStateChange?.(false), [onDialogStateChange]);
  function choose(kind) {
    focusRequest.current = kind;
    setChoice(kind);
  }
  function another() {
    focusRequest.current = null;
    reportFlow({
      busy: false,
      pending: false,
      hasDraft: false,
      complete: false,
    });
    setChoice(null);
  }
  const props = {
    privateArchive: true,
    onFlowStateChange: reportFlow,
    onDialogStateChange,
    onDone: (receipt) => void onDone(receipt),
    onShareAnother: another,
  };
  return (
    <ArchiveScreen label="Add a private memory">
      <ArchiveIntro
        actions={
          <ArchiveActions>
            <button
              type="button"
              className="button-secondary"
              disabled={locked}
              onClick={onBack}
            >
              {flow.hasDraft && !flow.complete
                ? "Discard draft and return to inbox"
                : "Back to inbox"}
            </button>
          </ArchiveActions>
        }
      >
        <p>
          Add your own memories alongside guest contributions. Each saved memory
          starts in Kept and stays private.
        </p>
        <p className="guest-help">
          Unfinished drafts and local files are cleared when you leave this
          page. Confirmed memories stay saved.
        </p>
      </ArchiveIntro>
      {!choice && (
        <div ref={choices} className="memory-choices" role="group" aria-label="Memory type" tabIndex={-1}>
          <MemoryChoice
            kind="note"
            title="Write a note"
            onClick={() => choose("TEXT")}
          >
            Save a story, a thought, or a favorite moment.
          </MemoryChoice>
          <MemoryChoice
            kind="photos"
            title="Add photos"
            onClick={() => choose("PHOTO")}
          >
            Keep up to 5 original photos together with your memories.
          </MemoryChoice>
          {audioEnabled && (
            <MemoryChoice
              kind="audio"
              title="Add a voice memory"
              onClick={() => choose("AUDIO")}
            >
              Record a moment in your own words.
            </MemoryChoice>
          )}
        </div>
      )}
      {choice && (
        <div ref={compose} role="group" tabIndex={-1}
          aria-label={choice === "TEXT" ? "Write a private note" : choice === "PHOTO" ? "Add private photos" : "Add a voice memory"}>
          {choice === "TEXT" && (
            <ContributionForm
              {...props}
              createSubmission={() => createTextSubmission({ api: api.current })}
            />
          )}
          {choice === "PHOTO" && (
            <PhotoBatchForm
              {...props}
              createSubmission={() =>
                createPhotoBatchSubmission({ api: api.current })
              }
            />
          )}
          {audioEnabled && choice === "AUDIO" && (
            <AudioForm
              {...props}
              createSubmission={() => createAudioSubmission({ api: api.current })}
            />
          )}
        </div>
      )}
    </ArchiveScreen>
  );
}
