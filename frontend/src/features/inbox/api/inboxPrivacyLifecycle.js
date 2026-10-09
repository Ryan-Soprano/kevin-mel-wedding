/** Clear private DOM synchronously before background/history capture, then recheck access. */
export function attachInboxPrivacyLifecycle({
  controller, eventTarget = window, documentTarget = document, onHide = () => {}, flush = callback => callback(),
}) {
  const hide = () => flush(() => { onHide(); controller.suspend(); });
  const restore = () => {
    if (documentTarget.visibilityState !== "hidden") void controller.resume();
  };
  const visibility = () => documentTarget.visibilityState === "hidden" ? hide() : restore();
  eventTarget.addEventListener("pagehide", hide);
  eventTarget.addEventListener("blur", hide);
  eventTarget.addEventListener("pageshow", restore);
  eventTarget.addEventListener("focus", restore);
  documentTarget.addEventListener("visibilitychange", visibility);
  return () => {
    eventTarget.removeEventListener("pagehide", hide);
    eventTarget.removeEventListener("blur", hide);
    eventTarget.removeEventListener("pageshow", restore);
    eventTarget.removeEventListener("focus", restore);
    documentTarget.removeEventListener("visibilitychange", visibility);
  };
}
