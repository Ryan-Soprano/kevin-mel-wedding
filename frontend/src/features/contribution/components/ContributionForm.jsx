import { useEffect, useRef, useState } from "react";

import PhotoPicker from "../../media/components/PhotoPicker.jsx";
import { ApiError } from "../../../shared/api/apiClient.js";
import { createTextSubmission } from "../api/textSubmission.js";

export default function ContributionForm() {
  const submission = useRef(null);
  if (submission.current === null) submission.current = createTextSubmission();
  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (!retryAfter) return;
    const timer = setTimeout(() => setRetryAfter(0), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const saved = await submission.current.submit({ guestName, message });
      setReceipt(saved);
    } catch (failure) {
      setRetryAfter(submission.current.retryAfterSeconds);
      setError(failure instanceof ApiError
        ? failure.unknownOutcome
          ? "We could not confirm your message. Keep this page open and retry to check the same submission."
          : failure.message
        : "Could not send your message. Keep this page open and try again.");
    } finally {
      setPending(submission.current.pending);
      setIsSubmitting(false);
    }
  }

  function startAnother(event) {
    event.preventDefault();
    submission.current.startAnother();
    setGuestName("");
    setMessage("");
    setError("");
    setReceipt(null);
    setPending(false);
  }

  const locked = isSubmitting || pending || receipt !== null;
  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <div>
        <label htmlFor="guestName">Your name (optional)</label>
        <input id="guestName" name="guestName" type="text" autoComplete="name"
          maxLength={100} value={guestName} disabled={locked}
          onChange={(event) => setGuestName(event.target.value)} />
      </div>
      <div>
        <label htmlFor="message">Leave a message</label>
        <textarea id="message" name="message" rows="5" maxLength={5000} required
          value={message} disabled={locked} aria-describedby="message-count"
          onChange={(event) => setMessage(event.target.value)} />
        <p id="message-count">{message.length.toLocaleString()} / 5000 characters</p>
      </div>
      {receipt && <p role="status">Your message is saved privately for Kevin and Melanie. Thank you!</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {receipt ? (
        <button type="button" onClick={startAnother}>Write another message</button>
      ) : (
        <button type="submit" disabled={isSubmitting || retryAfter > 0}>
          {isSubmitting ? "Submitting..." : retryAfter > 0 ? "Please wait..." : pending ? "Retry this message" : "Submit message"}
        </button>
      )}
      <p>Photo selections below are previews only. They are not sent with your message.</p>
      <PhotoPicker />
    </form>
  );
}
