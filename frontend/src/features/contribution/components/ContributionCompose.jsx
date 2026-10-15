import { getContributionCopy, getContributionSendLabel } from "../contributionDisplay.js";

export default function ContributionCompose({ view, privateArchive, nameInput, messageInput }) {
  const { guestName, message, fieldErrors, error, isSubmitting, pending, busy, actions } = view;
  const fieldsLocked = isSubmitting || pending;
  let nameDescription;
  if (fieldErrors.guestName) nameDescription = "guestName-error";
  let messageDescription = "message-count";
  if (fieldErrors.message) messageDescription += " message-error";
  return (
    <form className="note-compose" onSubmit={actions.send} noValidate aria-label="Write a note" aria-busy={isSubmitting}>
      <p className="note-compose-introduction">{getContributionCopy(privateArchive).introduction}</p>
      {!privateArchive && <div>
        <label htmlFor="guestName">Your name (optional)</label>
        <input ref={nameInput} id="guestName" name="guestName" type="text" autoComplete="name"
          maxLength={100} value={guestName} aria-invalid={Boolean(fieldErrors.guestName)} aria-describedby={nameDescription}
          disabled={fieldsLocked} onChange={event => actions.changeGuestName(event.target.value)} />
        {fieldErrors.guestName && <p id="guestName-error" className="form-error" role="alert">{fieldErrors.guestName}</p>}
      </div>}
      <div>
        <label htmlFor="message">Leave a message</label>
        <textarea ref={messageInput} id="message" name="message" rows="6" maxLength={5000} required
          value={message} aria-invalid={Boolean(fieldErrors.message)} aria-describedby={messageDescription}
          disabled={fieldsLocked} onChange={event => actions.changeMessage(event.target.value)} />
        <p id="message-count">{message.length.toLocaleString()} / 5,000 characters</p>
        {fieldErrors.message && <p id="message-error" className="form-error" role="alert">{fieldErrors.message}</p>}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{isSubmitting ? "Sending your note…" : ""}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {pending && <p className="note-pending">Your note is locked until we confirm it. Trying again checks this same submission.</p>}
      <div className="note-compose-footer">
        <p className="note-privacy"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3" /></svg>{privateArchive ? "This note starts private." : "Your contribution is not posted publicly."}</p>
        <button type="submit" disabled={busy}>{getContributionSendLabel(view, privateArchive)}</button>
      </div>
    </form>
  );
}
