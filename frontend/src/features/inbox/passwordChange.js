/** Passwords stay in the form and the current request, never presentation state. */
export function passwordChangeValidation({ currentPassword, newPassword, repeatedPassword }) {
  if (typeof currentPassword !== "string" || !currentPassword) return "Enter your current temporary password.";
  if (typeof newPassword !== "string" || newPassword.includes("\0")
    || [...newPassword].some(char => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff)) {
    return "Choose a password using valid text characters.";
  }
  if ([...newPassword].length < 8) return "Use at least 8 characters for your new password.";
  if (new TextEncoder().encode(newPassword).byteLength > 72) {
    return "Your new password is too long. Use no more than 72 UTF-8 bytes; some characters use more than one byte.";
  }
  if (newPassword === currentPassword) return "Choose a new password that is different from your temporary password.";
  if (newPassword !== repeatedPassword) return "Your new passwords do not match. Enter them again.";
  return null;
}

export function readAndClearPasswordForm(form) {
  try {
    return Object.fromEntries(["currentPassword", "newPassword", "repeatedPassword"]
      .map(name => [name, form.elements.namedItem(name)?.value ?? ""]));
  } finally { form.reset(); }
}

export function attachPasswordFormPrivacy(form, { eventTarget = window, documentTarget = document } = {}) {
  const clear = () => form.reset();
  const visibility = () => { if (documentTarget.visibilityState === "hidden") clear(); };
  eventTarget.addEventListener("pagehide", clear);
  documentTarget.addEventListener("visibilitychange", visibility);
  return () => {
    eventTarget.removeEventListener("pagehide", clear);
    documentTarget.removeEventListener("visibilitychange", visibility);
    clear();
  };
}
