/** Keep the current view while switching windows; clear it before leaving the page. */
export function attachInboxPrivacyLifecycle({
  controller, eventTarget = window, documentTarget = document, onHide = () => {}, flush = callback => callback(),
  onPause = () => {}, isIntentionalDialog = () => false, onDialogEnd = () => {},
}) {
  const hide = () => flush(() => { onHide(); controller.suspend(); });
  // A password manager, another app, or another tab must not discard typed
  // credentials or the current memory. Nothing is written to browser storage.
  const blur = () => { if (!isIntentionalDialog()) onPause(); };
  const restore = () => {
    onDialogEnd();
    if (documentTarget.visibilityState !== "hidden") {
      void controller.resume();
      void controller.recheckSession();
    }
  };
  const visibility = () => documentTarget.visibilityState === "hidden" ? onPause() : restore();
  eventTarget.addEventListener("pagehide", hide);
  eventTarget.addEventListener("blur", blur);
  eventTarget.addEventListener("pageshow", restore);
  eventTarget.addEventListener("focus", restore);
  documentTarget.addEventListener("visibilitychange", visibility);
  return () => {
    eventTarget.removeEventListener("pagehide", hide);
    eventTarget.removeEventListener("blur", blur);
    eventTarget.removeEventListener("pageshow", restore);
    eventTarget.removeEventListener("focus", restore);
    documentTarget.removeEventListener("visibilitychange", visibility);
  };
}
