import {
  useCallback,
  useEffect,
  useRef,
} from "react";

/** Read destinations outlive draft resets, but never their feature boundary. */
export function useLibraryReadFocus({ state, busy, locked, context }) {
  const target = useRef(null);
  const intent = useRef(null);
  const feedbackAllowed = useRef(true);
  const cancel = useCallback(() => {
    intent.current = null;
    feedbackAllowed.current = false;
  }, []);

  useEffect(() => {
    // Rearm only this owner's initial setup, including StrictMode's rehearsal.
    feedbackAllowed.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        cancel();
      }
    };
    const focusElsewhere = (event) => {
      const next = event.target;
      if (
        intent.current && next !== target.current
        && (next?.tabIndex >= 0 || next?.isContentEditable)
      ) {
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("popstate", cancel);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("focusin", focusElsewhere);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("popstate", cancel);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("focusin", focusElsewhere);
    };
  }, [cancel]);

  useEffect(() => {
    const pending = intent.current;
    if (!pending || busy || state === pending.before) {
      return;
    }
    intent.current = null;
    const destination = target.current;
    if (
      !locked && context === pending.context
      && destination?.isConnected && destination.getClientRects().length > 0
    ) {
      destination.focus();
    }
  }, [state, busy, locked, context]);

  function activate() {
    cancel();
    feedbackAllowed.current = true;
  }

  function begin(nextContext = context) {
    activate();
    intent.current = { before: state, context: nextContext };
  }

  const canFocusFeedback = useCallback(
    () => feedbackAllowed.current && !intent.current,
    [],
  );
  return {
    target,
    cancel,
    activate,
    begin,
    canFocusFeedback,
  };
}
