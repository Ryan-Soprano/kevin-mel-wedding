export function InboxLogin({ busy, username, password, setUsername, setPassword, onSubmit }) {
  let buttonLabel = "Sign in";
  let progressLabel = "";
  if (busy) {
    buttonLabel = "Signing in…";
    progressLabel = "Signing in to your private archive…";
  }
  return (
    <>
      <p>This archive is private for Kevin and Melanie. Use the account supplied when your archive is ready.</p>
      <form onSubmit={onSubmit} aria-label="Sign in to the private archive">
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
        <button type="submit" disabled={busy}>{buttonLabel}</button>
        <output className="visually-hidden">{progressLabel}</output>
      </form>
    </>
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
