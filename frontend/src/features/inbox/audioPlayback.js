/** Revocation alone is insufficient if a native media element already decoded bytes. */
export function stopAudioPlayback(element) {
  if (!element) return;
  try { element.pause(); } catch { /* Still clear the source and its decoded media. */ }
  try { element.removeAttribute("src"); element.load(); } catch { /* Controller cleanup still revokes the owned URL. */ }
}
