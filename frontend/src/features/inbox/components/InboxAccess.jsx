export function InboxLogin({ busy, retryAfter = 0, username, password, setUsername, setPassword, onSubmit }) {
  const waiting = retryAfter > 0;
  const waitMinutes = Math.ceil(retryAfter / 60);
  const waitMessage = "Please wait " + waitMinutes + (waitMinutes === 1 ? " minute" : " minutes") + " before signing in again.";
  let buttonLabel = "Sign in";
  let progressLabel = "";
  if (waiting) buttonLabel = "Please wait…";
  if (busy) {
    buttonLabel = "Signing in…";
    progressLabel = "Signing in to your private archive…";
  }
  return (
    <section className="inbox-login" aria-label="Archive sign in">
      <div className="inbox-login-welcome">
        <span className="inbox-monogram" aria-hidden="true">K <span>&amp;</span> M</span>
        <h2>All the moments,<br />together.</h2>
        <p>Notes from loved ones. Photos of the day. Memories to come back to, again and again.</p>
        <p className="inbox-login-private">A keepsake for Kevin &amp; Melanie</p>
      </div>
      <form className="inbox-login-form" onSubmit={onSubmit} aria-label="Sign in to the private archive">
        <div className="inbox-login-intro">
          <h2>Welcome back</h2>
          <p>This archive is private for Kevin and Melanie. Use the account supplied when your archive is ready.</p>
        </div>
        <div>
          <label htmlFor="archive-username">Username</label>
          <input id="archive-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
            onChange={event => setUsername(event.target.value)} disabled={busy} required />
        </div>
        <div>
          <label htmlFor="archive-password">Password</label>
          <input id="archive-password" type="password" autoComplete="current-password" value={password}
            onChange={event => setPassword(event.target.value)} disabled={busy} required />
        </div>
        {waiting && <p id="archive-login-wait" role="status" aria-live="polite" aria-atomic="true">{waitMessage}</p>}
        <button type="submit" disabled={busy || waiting} aria-describedby={waiting ? "archive-login-wait" : undefined}>{buttonLabel}</button>
        <output className="visually-hidden">{progressLabel}</output>
      </form>
    </section>
  );
}

export function InboxAccessRecovery({ busy, logoutUnconfirmed, onRetry, onLogout }) {
  let message = "The archive may not be ready yet, or access could not be checked. Please try again.";
  let buttonLabel = "Check access again";
  if (logoutUnconfirmed) {
    message = "Private content has been cleared from this page. Please retry signing out to confirm that your server session has ended.";
    buttonLabel = "Retry signing out";
  }
  return (
    <section className="inbox-actions" aria-label="Recover archive access">
      <p>{message}</p>
      <button type="button" disabled={busy} onClick={onRetry}>{buttonLabel}</button>
      {!logoutUnconfirmed && <button type="button" className="button-secondary" disabled={busy} onClick={onLogout}>Sign out of any active session</button>}
    </section>
  );
}
