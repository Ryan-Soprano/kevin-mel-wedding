/** Clear private DOM synchronously before background/history capture, then recheck access. */
export function attachInboxPrivacyLifecycle({
  controller, eventTarget = window, documentTarget = document, onHide = () => {}, flush = callback => callback(),
  isIntentionalDialog = () => false, onDialogEnd = () => {},
}) {
  const hide = () => flush(() => { onHide(); controller.suspend(); });
  // Native chooser/permission blur is scoped to an explicit action. Backgrounding
  // and pagehide always clear private content, including while a dialog is open.
  const blur = () => { if (!isIntentionalDialog()) hide(); };
  const restore = () => {
    onDialogEnd();
    if (documentTarget.visibilityState !== "hidden") void controller.resume();
  };
  const visibility = () => documentTarget.visibilityState === "hidden" ? hide() : restore();
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
