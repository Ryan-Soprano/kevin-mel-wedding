import PhotoPicker from "./PhotoPicker.jsx";
import PhotoBatchCard from "./PhotoBatchCard.jsx";
import PhotoBatchActions from "./PhotoBatchActions.jsx";
import { getPhotoBatchCopy, getPhotoResultLabel } from "../photoBatchDisplay.js";

function BatchGuestName({ prefix, guestName, error, locked, onChange, nameInput }) {
  let invalid;
  let description;
  if (error) {
    invalid = "true";
    description = prefix + "-name-error";
  }
  return (
    <div>
      <label htmlFor={prefix + "-name"}>Your name (optional)</label>
      <input ref={nameInput} id={prefix + "-name"} autoComplete="name" maxLength={100}
        value={guestName} disabled={locked} aria-invalid={invalid} aria-describedby={description}
        onChange={event => onChange(event.target.value)} />
      {error && <p id={prefix + "-name-error"} className="form-error">{error}</p>}
    </div>
  );
}

export default function PhotoBatchCompose({ view, privateArchive, onDialogStateChange, picker, nameInput, result, errorNotice }) {
  const { prefix, photos, guestName, fields, locked, busy, batchNumber, byId, globalWait, selectedRetry, summary,
    error, retained, complete, savedCount, totalCount, actions } = view;
  const copy = getPhotoBatchCopy(privateArchive);
  return (
    <section className="photo-submission photo-batch photo-batch--compose memory-form" aria-labelledby={prefix + "-title"}>
      <h2 id={prefix + "-title"}>{copy.title}</h2>
      <p>{copy.introduction}</p>
      <form onSubmit={actions.review} noValidate aria-label="Share photos" aria-busy={busy}>
        <PhotoPicker key={batchNumber} photos={photos} onPhotosChange={actions.updateSelection} inputRef={picker}
          onDialogStateChange={onDialogStateChange} disabled={locked} idPrefix={prefix + "-picker"} showHeading={false}
          note="Keep this page open until every photo is confirmed. Your selected files are sent as originals."
          renderPhoto={(photo, index) => <PhotoBatchCard photo={photo} index={index} prefix={prefix} item={byId.get(photo.id)}
            locked={locked} busy={busy} globalWait={globalWait} error={fields[photo.id]} selected={selectedRetry.has(photo.id)}
            onCaptionChange={actions.changeCaption} onCaptionRef={actions.registerCaptionInput} onToggleRetry={actions.toggleRetry} />} />
        {!privateArchive && photos.length > 0 && !retained && (
          <p className="guest-help">Not sent yet. Keep this page open—refreshing or closing can clear your selection.</p>
        )}
        {!privateArchive && <BatchGuestName prefix={prefix} guestName={guestName} error={fields.name} locked={locked} onChange={actions.changeName} nameInput={nameInput} />}
        <p role="status" aria-live="polite" aria-atomic="true" className={summary ? "photo-batch-summary" : "visually-hidden"}>{summary}</p>
        {error && <p ref={errorNotice} className="form-error" role="alert" tabIndex={-1}>{error}</p>}
        {retained && <div className="photo-batch-result memory-success">
          <h3 ref={result} tabIndex={-1}>{getPhotoResultLabel(complete, savedCount, totalCount)}</h3>
          {!complete && <p>Saved photos stay saved. Your original selection, name and captions are kept together until the remaining photos are resolved.</p>}
        </div>}
        <div className="memory-form-footer">
          {!retained && <p className="memory-privacy">
            <svg width="17" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3" /></svg>
            {privateArchive ? "These photos start private." : "Sent privately to Kevin and Melanie. They may choose to share your photos."}
          </p>}
          <PhotoBatchActions view={view} privateArchive={privateArchive} />
        </div>
      </form>
    </section>
  );
}
