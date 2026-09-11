import { useState } from "react";

export default function App() {
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
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(contribution),
      });

      if (response.status === 400) {
        const validation = await response.json();
        setError(validation.errors.join(" "));
        return;
      }

      if (!response.ok) {
        throw new Error(`Request failed: HTTP ${response.status}`);
      }

      const receivedContribution = await response.json();
      console.log("Backend returned:", receivedContribution);
    } catch (error) {
      console.error("Error sending contribution:", error);
      setError("Could not send your message. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1> Kevin &amp; Melanie</h1>
      <p> Help us remember tonight.</p>
      <p>Leave a message for us to treasure for the years ahead!</p>

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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit message"}
        </button>
      </form>
    </main>
  );
}
