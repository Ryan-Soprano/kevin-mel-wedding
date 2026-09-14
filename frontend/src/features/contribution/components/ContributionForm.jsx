import { useState } from "react";

import PhotoPicker from "../../media/components/PhotoPicker.jsx";
import {
  ContributionValidationError,
  createContribution,
} from "../api/contributionApi.js";

export default function ContributionForm() {
  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    // Handle form submission logic here
    const contribution = {
      guestName: guestName.trim(),
      message: message.trim(),
    };

    if (!contribution.message) {
      setError("Please write a message before submitting.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const receivedContribution = await createContribution(contribution);
      console.log("Backend returned:", receivedContribution);
    } catch (error) {
      console.error("Error sending contribution:", error);
      setError(
        error instanceof ContributionValidationError
          ? error.message
          : "Could not send your message. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="guestName">Your name (optional)</label>
        <input
          id="guestName"
          name="guestName"
          type="text"
          autoComplete="name"
          maxLength={100}
          value={guestName}
          onChange={(event) => setGuestName(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="message">Leave a message</label>
        <textarea
          id="message"
          name="message"
          rows="5"
          maxLength={5000}
          required
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <p>{message.length.toLocaleString()} / 5000 characters</p>
      </div>
      <PhotoPicker />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit message"}
      </button>
    </form>
  );
}
