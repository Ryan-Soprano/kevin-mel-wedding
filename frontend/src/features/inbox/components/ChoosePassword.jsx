import { useEffect, useRef, useState } from "react";
import { attachPasswordFormPrivacy, passwordChangeValidation, readAndClearPasswordForm } from "../passwordChange.js";

export default function ChoosePassword({ busy, retryAfter = 0, recovery, onChangePassword, onCheckSession, onLogout }) {
  const form = useRef(null);
  const [validation, setValidation] = useState(null);
  const waiting = retryAfter > 0;
  const disabled = busy || waiting;
  useEffect(() => {
    if (form.current) return attachPasswordFormPrivacy(form.current);
  }, [recovery]);

  function submit(event) {
    event.preventDefault();
    const credentials = readAndClearPasswordForm(form.current);
    if (disabled || recovery) return;
    const error = passwordChangeValidation(credentials);
    setValidation(error);
    if (error) return;
    delete credentials.repeatedPassword;
    void onChangePassword(credentials);
  }

  return (
    <section className="inbox-password-change" aria-label="Choose your password">
      <p>Your account is signed in. Choose your own password before opening your private archive.</p>
      {recovery ? (
        <div className="inbox-actions">
          <p role="status">We could not confirm whether your password changed. Check your session first. If you need to sign in again, use your new password. Your password change will not be sent again automatically.</p>
          <button type="button" disabled={busy} onClick={onCheckSession}>Check my session</button>
        </div>
      ) : (
        <form ref={form} className="inbox-password-form" onSubmit={submit} aria-label="Set your private password">
          <p id="password-policy">Use at least 15 characters and no more than 72 UTF-8 bytes. A few memorable words work well. Your password must differ from your temporary password.</p>
          <div>
            <label htmlFor="current-temporary-password">Current temporary password</label>
            <input id="current-temporary-password" name="currentPassword" type="password" autoComplete="current-password" required disabled={disabled} aria-describedby="password-policy" />
          </div>
          <div>
            <label htmlFor="new-private-password">New password</label>
            <input id="new-private-password" name="newPassword" type="password" autoComplete="new-password" required disabled={disabled} aria-describedby="password-policy" />
          </div>
          <div>
            <label htmlFor="repeat-private-password">Repeat new password</label>
            <input id="repeat-private-password" name="repeatedPassword" type="password" autoComplete="new-password" required disabled={disabled} aria-describedby="password-policy" />
          </div>
          {validation && <p className="form-error" role="alert">{validation}</p>}
          {waiting && <p role="status" aria-live="polite">Please wait {retryAfter} {retryAfter === 1 ? "second" : "seconds"} before trying again.</p>}
          <button type="submit" disabled={disabled}>{busy ? "Saving your password…" : waiting ? "Please wait…" : "Save password and open archive"}</button>
          <output className="visually-hidden">{busy ? "Saving your private password…" : ""}</output>
        </form>
      )}
      <button type="button" className="button-secondary" disabled={busy} onClick={() => { form.current?.reset(); onLogout(); }}>Sign out</button>
    </section>
  );
}
