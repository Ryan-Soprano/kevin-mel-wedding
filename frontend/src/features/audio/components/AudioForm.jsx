import { createAudioCapture } from "../audioCapture.js";
import { createAudioSubmission } from "../api/audioSubmission.js";
import { useAudioForm } from "../hooks/useAudioForm.js";
import AudioCompose from "./AudioCompose.jsx";

export default function AudioForm({
  createCapture = createAudioCapture,
  createSubmission = createAudioSubmission,
  active = true,
  onFlowStateChange,
  onDone,
  onShareAnother,
  onWriteNote,
  privateArchive = false,
  onDialogStateChange,
} = {}) {
  const { view, audio, startButton, result, errorNotice, captionInput } =
    useAudioForm({
      createCapture,
      createSubmission,
      active,
      onFlowStateChange,
      onDone,
      onShareAnother,
      privateArchive,
      onDialogStateChange,
    });

  return (
    <section
      className="audio-memory"
      aria-label={
        privateArchive ? "Add a voice memory" : "Share a voice memory"
      }
    >
      <h2 className={privateArchive ? undefined : "visually-hidden"}>
        {privateArchive ? "Add a voice memory" : "Share a voice memory"}
      </h2>
      <form
        className="memory-form audio-compose"
        onSubmit={view.actions.submit}
        noValidate
        aria-label="Share a voice memory"
        aria-busy={view.busy}
      >
        {view.saved ? (
          <div className="memory-success">
            <h3 ref={result} tabIndex={-1}>
              {privateArchive
                ? "Your voice memory was saved in your private archive."
                : "Thank you for sharing your voice."}
            </h3>
            {!privateArchive && (
              <p>
                Your message is saved privately for Kevin and Melanie to listen
                to and treasure.
              </p>
            )}
            <div className="audio-memory-actions">
              <button type="button" onClick={view.actions.finish}>
                {privateArchive ? "View added memory" : "Back to our photos"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={view.actions.shareAnother}
              >
                Share another memory
              </button>
            </div>
          </div>
        ) : (
          <AudioCompose
            view={view}
            privateArchive={privateArchive}
            onWriteNote={onWriteNote}
            onDialogStateChange={onDialogStateChange}
            audio={audio}
            startButton={startButton}
            errorNotice={errorNotice}
            captionInput={captionInput}
          />
        )}
      </form>
    </section>
  );
}
