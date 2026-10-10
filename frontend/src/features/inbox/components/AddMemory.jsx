import { useEffect, useRef, useState } from "react";
import ContributionForm from "../../contribution/components/ContributionForm.jsx";
import PhotoBatchForm from "../../media/components/PhotoBatchForm.jsx";
import AudioForm from "../../audio/components/AudioForm.jsx";
import { createTextSubmission } from "../../contribution/api/textSubmission.js";
import { createPhotoBatchSubmission } from "../../media/api/photoBatchSubmission.js";
import { createAudioSubmission } from "../../audio/api/audioSubmission.js";

export default function AddMemory({ getApi, onDone, onBack, onDialogStateChange, audioEnabled = false }) {
  const api = useRef(null);
  const [choice, setChoice] = useState(null);
  const [flow, setFlow] = useState({ busy: false, pending: false, hasDraft: false, complete: false });
  const locked = flow.busy || flow.pending;
  useEffect(() => { api.current = getApi(); }, [getApi]);
  useEffect(() => {
    if (!flow.hasDraft && !flow.pending) return;
    const leaving = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [flow.hasDraft, flow.pending]);
  useEffect(() => () => onDialogStateChange?.(false), [onDialogStateChange]);
  function another() { setFlow({ busy: false, pending: false, hasDraft: false, complete: false }); setChoice(null); }
  const props = { privateArchive: true, onFlowStateChange: setFlow, onDialogStateChange,
    onDone: receipt => void onDone(receipt), onShareAnother: another };
  return (
    <section aria-label="Add a private memory">
      <p>Add your own memories alongside guest contributions. Each saved memory starts in Kept and stays private.</p>
      <p className="guest-help">Unfinished drafts and local files are cleared when this page is hidden or left. Confirmed memories stay saved.</p>
      <button type="button" className="button-secondary" disabled={locked} onClick={onBack}>
        {flow.hasDraft && !flow.complete ? "Discard draft and return to inbox" : "Back to inbox"}
      </button>
      {!choice && <div className="inbox-actions" aria-label="Memory type">
        <button type="button" onClick={() => setChoice("TEXT")}>Write a note</button>
        <button type="button" onClick={() => setChoice("PHOTO")}>Add photos</button>
        {audioEnabled && <button type="button" onClick={() => setChoice("AUDIO")}>Add a voice memory</button>}
      </div>}
      {choice === "TEXT" && <ContributionForm {...props} createSubmission={() => createTextSubmission({ api: api.current })} />}
      {choice === "PHOTO" && <PhotoBatchForm {...props} createSubmission={() => createPhotoBatchSubmission({ api: api.current })} />}
      {audioEnabled && choice === "AUDIO" && <AudioForm {...props} createSubmission={() => createAudioSubmission({ api: api.current })} />}
    </section>
  );
}
