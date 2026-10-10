import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ApiError } from "../../../shared/api/apiClient.js";
import { normalizeTextContribution } from "../../../shared/api/archiveApi.js";
import { createTextSubmission } from "../api/textSubmission.js";

const FIELD_NAMES = new Set(["guestName", "message"]);

export default function ContributionForm({
  active = true, onFlowStateChange, onDone, onShareAnother, createSubmission = createTextSubmission, privateArchive = false,
} = {}) {
  const submission = useRef(null);
  const factory = useRef(createSubmission);
  const mounted = useRef(false);
  const nameInput = useRef(null);
  const messageInput = useRef(null);
  const reviewHeading = useRef(null);
  const resultHeading = useRef(null);
  const focusField = useRef(null);
  const sending = useRef(false);

  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState("compose");
  const [preview, setPreview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const busy = isSubmitting || retryAfter > 0;
  const complete = step === "success" || step === "done";
  const hasDraft = !complete && (guestName.length > 0 || message.length > 0 || preview !== null);
  const reportFlow = useEffectEvent(state => onFlowStateChange?.(state));

  useEffect(() => {
    const current = factory.current();
    submission.current = current;
    mounted.current = true;
    return () => { mounted.current = false; current.dispose?.(); if (submission.current === current) submission.current = null; };
  }, []);

  useEffect(() => {
    reportFlow({ busy, pending, hasDraft, complete });
  }, [busy, pending, hasDraft, complete]);

  useEffect(() => {
    if (!retryAfter) return;
    const timer = setTimeout(() => setRetryAfter(0), retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  useEffect(() => {
    if (!active) return;
    if (step === "compose" && focusField.current) {
      (focusField.current === "guestName" ? nameInput : messageInput).current?.focus();
      focusField.current = null;
    } else if (step === "review") {
      reviewHeading.current?.focus();
    } else if (step === "success" || step === "done") {
      resultHeading.current?.focus();
    }
  }, [active, step]);

  function showValidation(failure) {
    const next = {};
    for (const item of failure.fieldErrors ?? []) {
      if (FIELD_NAMES.has(item.field) && !next[item.field]) next[item.field] = item.message;
    }
    if (Object.keys(next).length === 0) {
      setError(failure.message);
      return;
    }
    setFieldErrors(next);
    setError("");
    focusField.current = next.guestName ? "guestName" : "message";
    if (step === "compose") {
      if (active) {
        (focusField.current === "guestName" ? nameInput : messageInput).current?.focus();
        focusField.current = null;
      }
    } else {
      setStep("compose");
    }
  }

  function review(event) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    try {
      setPreview(normalizeTextContribution({ guestName: privateArchive ? null : guestName, message }));
      setStep("review");
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "VALIDATION_FAILED") showValidation(failure);
      else setError("Please check your message and try again.");
    }
  }

  function edit() {
    if (isSubmitting || pending) return;
    focusField.current = "message";
    setStep("compose");
  }

  async function send() {
    const current = submission.current;
    if (sending.current || !preview || !current) return;
    sending.current = true;
    setError("");
    setIsSubmitting(true);
    try {
      await current.submit({ guestName: privateArchive ? null : guestName, message });
      if (!mounted.current || submission.current !== current) return;
      setPending(false);
      setStep("success");
    } catch (failure) {
      if (!mounted.current || submission.current !== current) return;
      setRetryAfter(current.retryAfterSeconds);
      if (failure instanceof ApiError && failure.code === "VALIDATION_FAILED" && !failure.unknownOutcome) {
        showValidation(failure);
      } else {
        setError(failure instanceof ApiError
          ? failure.unknownOutcome
            ? "We could not confirm whether your note was saved. Keep this page open and try again to check the same note."
            : failure.message
          : "We could not confirm whether your note was saved. Keep this page open and try again.");
      }
    } finally {
      if (mounted.current && submission.current === current) {
        setPending(current.pending); setIsSubmitting(false); sending.current = false;
      }
    }
  }

  function startAnother(shouldFocus = true) {
    submission.current.startAnother();
    setGuestName("");
    setMessage("");
    setPreview(null);
    setFieldErrors({});
    setError("");
    setPending(false);
    setRetryAfter(0);
    focusField.current = shouldFocus ? "message" : null;
    setStep("compose");
  }

  function finish() {
    if (onDone) {
      const receipt = submission.current.receipt;
      startAnother(false);
      onDone(receipt);
    } else {
      setStep("done");
    }
  }

  function shareAnother() {
    startAnother(!onShareAnother);
    onShareAnother?.();
  }

  return (
    <div className="contribution-flow">
      {step === "compose" && (
        <form onSubmit={review} noValidate aria-label="Write a note">
          <h2>Write a note</h2>
          <p>{privateArchive ? "Add a written memory to your private archive. You can add a title, description and date after saving." : "Your note goes privately to Kevin and Melanie. Your name is optional."}</p>
          {!privateArchive && <div>
            <label htmlFor="guestName">Your name (optional)</label>
            <input ref={nameInput} id="guestName" name="guestName" type="text" autoComplete="name"
              maxLength={100} value={guestName} aria-invalid={Boolean(fieldErrors.guestName)}
              aria-describedby={fieldErrors.guestName ? "guestName-error" : undefined}
              onChange={(event) => { setGuestName(event.target.value); setFieldErrors((old) => ({ ...old, guestName: "" })); }} />
            {fieldErrors.guestName && <p id="guestName-error" className="form-error" role="alert">{fieldErrors.guestName}</p>}
          </div>}
          <div>
            <label htmlFor="message">Leave a message</label>
            <textarea ref={messageInput} id="message" name="message" rows="5" maxLength={5000} required
              value={message} aria-invalid={Boolean(fieldErrors.message)}
              aria-describedby={`message-count${fieldErrors.message ? " message-error" : ""}`}
              onChange={(event) => { setMessage(event.target.value); setFieldErrors((old) => ({ ...old, message: "" })); }} />
            <p id="message-count">{message.length.toLocaleString()} / 5,000 characters</p>
            {fieldErrors.message && <p id="message-error" className="form-error" role="alert">{fieldErrors.message}</p>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit">Review note</button>
        </form>
      )}

      {step === "review" && (
        <section className="note-review" aria-labelledby="review-heading" aria-busy={isSubmitting}>
          <h2 id="review-heading" ref={reviewHeading} tabIndex={-1}>{privateArchive ? "Ready to save privately?" : "Ready to send?"}</h2>
          {!privateArchive && <p style={{ overflowWrap: "anywhere" }}>From: {preview.guestName ?? "Name not provided"}</p>}
          <p className="note-review__message">{preview.message}</p>
          <p>Only Kevin and Melanie can review this note. It will not appear publicly.</p>
          <p className="visually-hidden" role="status" aria-live="polite">{isSubmitting ? "Sending your note…" : ""}</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {pending && <p>Your note is locked until we confirm it. Trying again checks this same submission.</p>}
          <div className="note-actions">
            <button type="button" onClick={send} disabled={busy}>
              {isSubmitting ? "Saving…" : retryAfter > 0 ? "Please wait before trying again" : pending ? "Try again" : privateArchive ? "Save note privately" : "Send note"}
            </button>
            {!pending && <button type="button" className="button-secondary" onClick={edit} disabled={isSubmitting}>Edit note</button>}
          </div>
        </section>
      )}

      {step === "success" && (
        <section className="note-result" aria-labelledby="result-heading">
          <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>{privateArchive ? "Your note is saved in your private archive." : "Thank you — your note was saved for Kevin and Melanie."}</h2>
          <p>{privateArchive ? "New memories start in Kept. Open this memory to see its current status and add a title, description or date." : "They can review it privately when their archive is ready."}</p>
          <button type="button" className="button-secondary" onClick={finish}>{privateArchive ? "View added memory" : "Done"}</button>
          <button type="button" onClick={shareAnother}>{onDone || onShareAnother ? "Share another memory" : "Write another note"}</button>
        </section>
      )}

      {step === "done" && (
        <section className="note-result" aria-labelledby="result-heading">
          <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>You’re all set.</h2>
          <p>Your note was saved privately for Kevin and Melanie. You can close this page.</p>
        </section>
      )}

    </div>
  );
}
