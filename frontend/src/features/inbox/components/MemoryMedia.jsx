import { getAudioLabel, getPhotoAlt } from "../inboxDisplay.js";

function OriginalPreview({ memory, url, audioPlayback }) {
  if (memory.memoryType === "AUDIO") {
    return (
      <audio ref={audioPlayback} className="inbox-audio" controls preload="metadata" src={url} aria-label={getAudioLabel(memory)}>
        <track kind="captions" src="data:text/vtt,WEBVTT" srcLang="en" label="Captions" />
      </audio>
    );
  }
  return <img className="inbox-original" src={url} alt={getPhotoAlt(memory)} />;
}

function VerifiedOriginal({ memory, photo, locked, audioPlayback, mediaLabel }) {
  if (memory.reviewStatus === "DELETE" || locked || photo.phase !== "ready" || !photo.url) return null;
  return (
    <>
      <OriginalPreview memory={memory} url={photo.url} audioPlayback={audioPlayback} />
      <a className="inbox-download" href={photo.url} download={memory.media.originalFilename}>Download original {mediaLabel}</a>
      {memory.memoryType === "AUDIO" && <p className="guest-help">If this browser cannot play the clip, download the original audio to listen in a supported player.</p>}
    </>
  );
}

export default function MemoryMedia({ memory, photo, locked, audioPlayback, onRetry }) {
  if (memory.memoryType === "TEXT") return <p className="inbox-note">{memory.textContent}</p>;
  let mediaLabel = "photo";
  if (memory.memoryType === "AUDIO") mediaLabel = "audio";
  const deleted = memory.reviewStatus === "DELETE";
  return (
    <>
      {memory.caption && <p className="inbox-note">{memory.caption}</p>}
      <p className="inbox-filename">{memory.media.originalFilename}</p>
      {memory.memoryType === "AUDIO" && <p>{Math.ceil(memory.media.durationSeconds)} seconds · Original audio</p>}
      {!deleted && photo.phase === "loading" && <output>Loading and checking the original {mediaLabel}…</output>}
      {!deleted && photo.phase === "error" && (
        <div className="inbox-actions">
          <p className="form-error" role="alert">{photo.error}</p>
          <button type="button" disabled={locked} onClick={onRetry}>Try loading the {mediaLabel} again</button>
        </div>
      )}
      <VerifiedOriginal memory={memory} photo={photo} locked={locked} audioPlayback={audioPlayback} mediaLabel={mediaLabel} />
    </>
  );
}
