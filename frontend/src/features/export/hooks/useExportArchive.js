import {
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
  const cancelTrigger = useRef(null);
  const cancelButton = useRef(null);
  const restoreCancel = useRef(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const disabled = busy || locked;
  const job = state.job;

  useEffect(() => {
    if (state.error || state.mutation.error || state.notice) {
      feedback.current?.focus();
    }
  }, [state.error, state.mutation.error, state.notice]);

  useEffect(() => {
    if (confirmCancel) {
      cancelButton.current?.focus();
    } else if (restoreCancel.current && !disabled) {
      restoreCancel.current = false;
      cancelTrigger.current?.focus();
    }
  }, [confirmCancel, disabled]);

  function beginCancel() {
    setConfirmCancel(true);
  }

  function keepExport() {
    restoreCancel.current = true;
    setConfirmCancel(false);
  }

  function confirmCancellation() {
    setConfirmCancel(false);
    void actions.cancel();
  }

  return {
    feedback,
    cancelTrigger,
    cancelButton,
    view: {
      state,
      busy,
      locked,
      actions,
      disabled,
      job,
      terminal: isTerminalExport(job),
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
