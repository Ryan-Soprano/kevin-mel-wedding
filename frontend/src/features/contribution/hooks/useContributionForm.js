import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/apiClient.js";
import { normalizeTextContribution } from "../../../shared/api/archiveApi.js";
import {
  getContributionGuestName,
  getContributionSubmitError,
  getContributionValidationField,
} from "../contributionDisplay.js";

const FIELD_NAMES = new Set(["guestName", "message"]);

export function useContributionForm({
  active,
  onFlowStateChange,
  onDone,
  onShareAnother,
  createSubmission,
  privateArchive,
}) {
  const submission = useRef(null);
  const factory = useRef(createSubmission);
  const mounted = useRef(false);
  const nameInput = useRef(null);
  const messageInput = useRef(null);
  const resultHeading = useRef(null);
  const focusField = useRef(null);
  const sending = useRef(false);

  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState("compose");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const busy = isSubmitting || retryAfter > 0;
  const complete = step === "success" || step === "done";
  const hasDraft = !complete && (guestName.length > 0 || message.length > 0);
  const reportFlow = useEffectEvent((state) => onFlowStateChange?.(state));

  useEffect(() => {
    const current = factory.current();
    submission.current = current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.dispose?.();
      if (submission.current === current) submission.current = null;
    };
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
    if (!active || isSubmitting) return;
    if (step === "compose" && focusField.current) {
      if (focusField.current === "guestName") nameInput.current?.focus();
      else messageInput.current?.focus();
      focusField.current = null;
    } else if (step === "success" || step === "done") {
      resultHeading.current?.focus();
    }
  }, [active, step, isSubmitting]);

  function showValidation(failure) {
    const next = {};
    for (const item of failure.fieldErrors ?? []) {
      if (FIELD_NAMES.has(item.field) && !next[item.field])
        next[item.field] = item.message;
    }
    if (Object.keys(next).length === 0) {
      setError(failure.message);
      return;
    }
    setFieldErrors(next);
    setError("");
    focusField.current = getContributionValidationField(next);
    if (step === "compose") {
      if (active && !sending.current) {
        if (focusField.current === "guestName") nameInput.current?.focus();
        else messageInput.current?.focus();
        focusField.current = null;
      }
    } else {
      setStep("compose");
    }
  }

  function handleSubmitFailure(failure, current) {
    if (!mounted.current || submission.current !== current) return;
    setRetryAfter(current.retryAfterSeconds);
    if (
      failure instanceof ApiError &&
      failure.code === "VALIDATION_FAILED" &&
      !failure.unknownOutcome
    ) {
      showValidation(failure);
      return;
    }
    setError(getContributionSubmitError(failure));
  }

  async function send(event) {
    event?.preventDefault();
    const current = submission.current;
    if (sending.current || busy || !current) return;
    setError("");
    setFieldErrors({});
    try {
      normalizeTextContribution({
        guestName: getContributionGuestName(privateArchive, guestName),
        message,
      });
    } catch (error_) {
      if (error_ instanceof ApiError && error_.code === "VALIDATION_FAILED")
        showValidation(error_);
      else setError("Please check your message and try again.");
      return;
    }
    sending.current = true;
    setIsSubmitting(true);
    try {
      await current.submit({
        guestName: getContributionGuestName(privateArchive, guestName),
        message,
      });
      if (!mounted.current || submission.current !== current) return;
      setPending(false);
      setStep("success");
    } catch (error_) {
      handleSubmitFailure(error_, current);
    } finally {
      if (mounted.current && submission.current === current) {
        setPending(current.pending);
        setIsSubmitting(false);
        sending.current = false;
      }
    }
  }

  function startAnother(shouldFocus = true) {
    submission.current.startAnother();
    setGuestName("");
    setMessage("");
    setFieldErrors({});
    setError("");
    setPending(false);
    setRetryAfter(0);
    focusField.current = null;
    if (shouldFocus) focusField.current = "message";
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

  function changeGuestName(value) {
    if (sending.current || pending) return;
    setGuestName(value);
    setFieldErrors((old) => ({ ...old, guestName: "" }));
  }

  function changeMessage(value) {
    if (sending.current || pending) return;
    setMessage(value);
    setFieldErrors((old) => ({ ...old, message: "" }));
  }

  return {
    nameInput,
    messageInput,
    resultHeading,
    view: {
      guestName,
      message,
      step,
      fieldErrors,
      error,
      isSubmitting,
      pending,
      retryAfter,
      busy,
      hasShellActions: Boolean(onDone || onShareAnother),
      actions: { send, finish, shareAnother, changeGuestName, changeMessage },
    },
  };
}
