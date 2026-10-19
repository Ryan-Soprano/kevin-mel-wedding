import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  canPrepareExportPart,
  isTerminalExport,
} from "../exportDisplay.js";

export function useExportArchive({ state, busy, locked, actions }) {
  const feedback = useRef(null);
  const statusTarget = useRef(null);
  const partsTarget = useRef(null);
  const issuesTarget = useRef(null);
  const cancelTrigger = useRef(null);
  const cancelButton = useRef(null);
  const readIntent = useRef(null);
  const feedbackAllowed = useRef(true);
  const focusCancel = useRef(null);
  const restoreCancel = useRef(null);
  const [cancelRequest, setCancelRequest] = useState(null);
  const disabled = busy || locked;
  const job = state.job;
  const jobId = job?.exportId ?? null;
  const terminal = isTerminalExport(job);
  const confirmCancel = Boolean(
    jobId && !terminal && cancelRequest?.exportId === jobId,
  );
  const cancelPendingFocus = useCallback(() => {
    readIntent.current = null;
    feedbackAllowed.current = false;
    focusCancel.current = null;
    restoreCancel.current = null;
  }, []);

  useEffect(() => {
    feedbackAllowed.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancelPendingFocus();
      }
    };
    const focusElsewhere = (event) => {
      const next = event.target;
      if (
        readIntent.current
        && (next?.tabIndex >= 0 || next?.isContentEditable)
      ) {
        cancelPendingFocus();
      }
    };
    window.addEventListener("blur", cancelPendingFocus);
    window.addEventListener("pagehide", cancelPendingFocus);
    window.addEventListener("popstate", cancelPendingFocus);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("focusin", focusElsewhere);
    return () => {
      cancelPendingFocus();
      window.removeEventListener("blur", cancelPendingFocus);
      window.removeEventListener("pagehide", cancelPendingFocus);
      window.removeEventListener("popstate", cancelPendingFocus);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("focusin", focusElsewhere);
    };
  }, [cancelPendingFocus]);

  useEffect(() => {
    const pending = readIntent.current;
    if (!pending || busy || state === pending.before) {
      return;
    }
    readIntent.current = null;
    feedbackAllowed.current = false;
    if (
      (locked && pending.kind !== "status")
      || (pending.jobId !== null && jobId !== pending.jobId && !state.unavailable)
    ) {
      return;
    }
    const destinations = {
      status: statusTarget.current,
      parts: partsTarget.current,
      issues: issuesTarget.current,
    };
    const target = (locked ? feedback.current : destinations[pending.kind])
      ?? feedback.current;
    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    }
  }, [state, busy, locked, jobId]);

  useEffect(() => {
    if (
      feedbackAllowed.current && !readIntent.current
      && (state.error || state.mutation.error || state.notice)
    ) {
      feedback.current?.focus();
    }
  }, [state.error, state.mutation.error, state.notice]);

  useEffect(() => {
    if (focusCancel.current === jobId && confirmCancel && !disabled) {
      focusCancel.current = null;
      cancelButton.current?.focus();
    } else if (
      restoreCancel.current !== null && restoreCancel.current === jobId
      && !terminal && !disabled
    ) {
      restoreCancel.current = null;
      cancelTrigger.current?.focus();
    }
  }, [confirmCancel, cancelRequest, disabled, jobId, terminal]);

  function invoke(method, ...args) {
    cancelPendingFocus();
    feedbackAllowed.current = true;
    return actions[method](...args);
  }

  function requestRead(kind, method, ...args) {
    cancelPendingFocus();
    feedbackAllowed.current = true;
    readIntent.current = { kind, jobId, before: state };
    return actions[method](...args);
  }

  function beginCancel() {
    if (disabled || !jobId || terminal) {
      return;
    }
    cancelPendingFocus();
    focusCancel.current = jobId;
    setCancelRequest({ exportId: jobId });
  }

  function keepExport() {
    cancelPendingFocus();
    restoreCancel.current = jobId;
    setCancelRequest(null);
  }

  function confirmCancellation() {
    if (!confirmCancel || disabled) {
      return;
    }
    setCancelRequest(null);
    void invoke("cancel");
  }

  return {
    feedback,
    statusTarget,
    partsTarget,
    issuesTarget,
    cancelTrigger,
    cancelButton,
    view: {
      state,
      busy,
      locked,
      actions: {
        ...actions,
        inbox: () => invoke("inbox"),
        create: () => invoke("create"),
        check: refreshSession => requestRead("status", "check", refreshSession),
        prepare: number => invoke("prepare", number),
        retry: () => invoke("retry"),
        page: (kind, next) => requestRead(kind, "page", kind, next),
        download: () => invoke("download"),
        started: () => invoke("started"),
      },
      disabled,
      job,
      terminal,
      canPrepare: canPrepareExportPart(job),
      confirmCancel,
      handlers: {
        beginCancel,
        keepExport,
        confirmCancellation,
      },
    },
  };
}
