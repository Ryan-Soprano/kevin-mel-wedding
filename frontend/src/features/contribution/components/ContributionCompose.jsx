import { getContributionCopy } from "../contributionDisplay.js";

export default function ContributionCompose({ view, privateArchive, nameInput, messageInput }) {
  const { guestName, message, fieldErrors, error, actions } = view;
  let nameDescription;
  if (fieldErrors.guestName) nameDescription = "guestName-error";
  let messageDescription = "message-count";
  if (fieldErrors.message) messageDescription += " message-error";
  return (
    <form onSubmit={actions.review} noValidate aria-label="Write a note">
      <h2>Write a note</h2>
      <p>{getContributionCopy(privateArchive).introduction}</p>
      {!privateArchive && <div>
        <label htmlFor="guestName">Your name (optional)</label>
        <input ref={nameInput} id="guestName" name="guestName" type="text" autoComplete="name"
          maxLength={100} value={guestName} aria-invalid={Boolean(fieldErrors.guestName)} aria-describedby={nameDescription}
          onChange={event => actions.changeGuestName(event.target.value)} />
        {fieldErrors.guestName && <p id="guestName-error" className="form-error" role="alert">{fieldErrors.guestName}</p>}
      </div>}
      <div>
        <label htmlFor="message">Leave a message</label>
        <textarea ref={messageInput} id="message" name="message" rows="5" maxLength={5000} required
          value={message} aria-invalid={Boolean(fieldErrors.message)} aria-describedby={messageDescription}
          onChange={event => actions.changeMessage(event.target.value)} />
        <p id="message-count">{message.length.toLocaleString()} / 5,000 characters</p>
        {fieldErrors.message && <p id="message-error" className="form-error" role="alert">{fieldErrors.message}</p>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit">Review note</button>
    </form>
  );
}
