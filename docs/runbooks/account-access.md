# Private account provisioning and recovery

Prepared 2026-10-05 for AUTH-01. Preparing this runbook and console utility has not provisioned real accounts, sent invitations, changed provider settings, or deployed the application. Kevin and Melanie must not receive credentials or notifications before the reveal. Ryan owns infrastructure and recovery; Kevin and Melanie alone moderate and publish. Kade has development access only.

## Account boundaries

| Role | Provisioning boundary | Application authority |
|---|---|---|
| `COUPLE` | Reveal must be explicitly enabled. Production identities are separate `kevin` / `Kevin` and `melanie` / `Melanie` accounts. Synthetic accounts are allowed locally or in staging. | Couple archive access; moderation/publication belong exclusively to the couple. |
| `OPERATOR` | Infrastructure operator identity, kept separate from couple accounts. | No couple login, moderation, or publication authority. Infrastructure credentials are managed separately. |
| `DEVELOPER` | Local/staging only; production creation, recovery, and activation are rejected. | No couple login, moderation, or publication authority. |

There is no public signup, password-reset, account-enablement, or role-management endpoint. The account utility cannot change a role or delete an account. Do not relabel Ryan or Kade as `COUPLE` to bypass authorization. The production usernames enforce separate identities; the utility cannot verify a person's identity on its own.

New accounts are **disabled**. Enabling is a separate confirmed command. Password reset preserves the current enabled flag. Reset, enable, and disable each increment `credentials_version` and update `updated_at` in the same transaction; the web application rejects sessions with stale versions. Disable remains available before reveal and for accounts that violate current access policy.

## Target configuration

The utility reads the built `application.properties` plus process environment/JVM property overrides, using the same datasource settings as the application:

- `MEMORY_ARCHIVE_DB_URL`, `MEMORY_ARCHIVE_DB_USERNAME`, `MEMORY_ARCHIVE_DB_PASSWORD`: target PostgreSQL connection. Existing defaults are for local Compose only.
- `MEMORY_ARCHIVE_ENVIRONMENT`: `local`, `staging`, or `production`; default `local`.
- `MEMORY_ARCHIVE_REVEALED`: exact `true` or `false`; default `false`.
- `MEMORY_ARCHIVE_PUBLIC_ORIGIN`: the production HTTPS browser origin, without a path.
- `MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET`: a stable secret of at least 32 random bytes, required in production. Login bucket keys use HMAC so raw usernames and peer addresses are not stored in the throttle table. Local synthetic exercises use a development-only fallback. Keep this secret out of Git and logs; rotating it resets the identity of throttle buckets.

Every mutation also requires `--expect-environment` to match the configured environment and an exact confirmation typed into the console. Environment labels do not independently identify a database: Ryan must verify the actual target connection using the approved environment configuration before executing a command. Never point a process labeled `local` or `staging` at production. Do not print database URLs or secrets as diagnostics.

The utility does not load Spring profile files. Set its environment and reveal values deliberately even if the web application's `production` profile is used elsewhere. The web production profile enables `Secure` on the session cookie. Production application startup also requires an explicitly configured HTTPS origin in `archive.public-origin`; the origin must match the deployed browser origin and contain no path, query, or credentials. Cookie name is `MEMORY_ARCHIVE_SESSION`, with `HttpOnly` and `SameSite=Lax`. Use the production profile and reviewed origin configuration through the approved deployment process; this runbook does not authorize deployment.

The utility opens no HTTP listener, starts no Spring application/component scan, and initializes no R2 client. It does not apply Flyway migrations. Apply the application's reviewed migrations through the normal startup/release process first; `archive_account` from V4 must exist.

Application and utility processes read their own configuration at startup. Setting the reveal environment variable in the utility terminal does not change an already-running application. Keep reveal closed in production until the agreed reveal and separately authorized onboarding.

## Build and launch locally

Use Java 25 in a native interactive terminal. On Windows, use PowerShell in Windows Terminal. IDE output panes, redirected input/output, background jobs, and terminals where `System.console()` is unavailable are rejected. Passwords are accepted only by `System.console().readPassword()` and are never echoed. The utility accepts no password flag, password environment variable, piped password, or password file.

From `backend/`, prepare the already-approved runtime dependencies and compiled classes:

```powershell
.\mvnw.cmd -DskipTests compile dependency:build-classpath '-Dmdep.outputFile=target/account-admin-classpath.txt'
$accountClasspath = 'target/classes;' + (Get-Content -Raw -LiteralPath '.\target\account-admin-classpath.txt').Trim()
java -cp $accountClasspath com.kevinmel.archive.security.AccountAdministration --help
```

If this machine's wrapper cannot inspect a hidden `.m2` directory, run the same preparation command with an existing Maven **3.9.16** installation (`mvn`) instead. No dependency or wrapper change is needed for the account utility.

On macOS/Linux, use the Maven shell wrapper and `:` between `target/classes` and the dependency classpath. Run Java directly in the interactive terminal so hidden password input is available. Do not invoke this utility through `spring-boot:run`.

For an isolated synthetic local exercise, verify that the connection is the local Compose database, then configure this terminal:

```powershell
$env:MEMORY_ARCHIVE_ENVIRONMENT = 'local'
$env:MEMORY_ARCHIVE_REVEALED = 'true'
```

The following examples describe synthetic accounts only. Each command stops for an exact confirmation; create/reset additionally ask for the new password twice:

```powershell
java -cp $accountClasspath com.kevinmel.archive.security.AccountAdministration --expect-environment local create synthetic-kevin 'Synthetic Kevin' COUPLE
java -cp $accountClasspath com.kevinmel.archive.security.AccountAdministration --expect-environment local enable synthetic-kevin
java -cp $accountClasspath com.kevinmel.archive.security.AccountAdministration --expect-environment local reset-password synthetic-kevin
java -cp $accountClasspath com.kevinmel.archive.security.AccountAdministration --expect-environment local disable synthetic-kevin
```

For example, creation requires typing `create synthetic-kevin in local`. A mismatch or cancelled prompt makes no account change. Use a unique password/passphrase of at least 15 Unicode characters and no more than 72 UTF-8 bytes, matching the existing delegating bcrypt encoder's limit. Password arrays and temporary UTF-8 bytes are cleared after use; hashes remain only in database storage and transient encoder/database memory. Application/JDBC logging is suppressed in the utility, and database exceptions never print their details or stack traces.

Exit code `0` means a command committed successfully (or help was shown); `2` means a rejected command/input/confirmation; `1` means success was not confirmed because configuration, encoding, or database access failed. A transport failure around commit can leave an uncertain outcome: inspect account status/version before retrying. Do not dump account rows with `SELECT *`, since that includes password hashes.

When the synthetic exercise ends, close this isolated terminal. Return local/staging web application reveal settings to their intended state. Do not copy synthetic credentials into production.

## Reveal-day provisioning

Real-account provisioning is a separate hands-on operator action after the reveal has been agreed and explicitly authorized. No real accounts have been provisioned by this implementation.

1. Ryan verifies the production target and its secure access path, confirms the reveal with the couple, and explicitly enables the reveal setting for the approved application/utility configuration. Production must use HTTPS and the production session-cookie configuration before browser login.
2. Use the reviewed utility with `--expect-environment production` to create `kevin` / `Kevin` / `COUPLE` and, separately, `melanie` / `Melanie` / `COUPLE`. Each person receives a distinct password. Keep both accounts disabled until the confidential handoff is ready.
3. Establish the identity of the intended recipient directly. Handoff must use an agreed confidential channel; do not paste credentials into Git, Notion, tickets, logs, screenshots, shell arguments/history, or this chat. Do not send invitations or email as part of the utility.
4. Enable each account with its own confirmed command. Have each person verify their own login through the application's couple login flow. If a temporary password was used, perform an owner-present console reset to their chosen secret before routine use; this version has no public self-service password-change page.
5. Confirm Ryan/operator and Kade/developer identities cannot use couple login or archive actions. Record only dated nonsecret evidence of onboarding in the issue tracker.

## Recovery and suspected compromise

Ryan performs recovery only after verifying the requesting account owner's identity through the agreed direct process. The utility's username/confirmation prompts are operational safeguards, not identity proof.

1. For suspected compromise or lost control, run `disable <username>` immediately against the verified target. Disabling stays possible with reveal closed and invalidates prior sessions on their next request.
2. Review the incident through approved operator diagnostics without logging guest content, passwords/hashes, cookies, CSRF tokens, or session IDs. Infrastructure compromise requires separate infrastructure-secret rotation; an application password reset does not rotate provider credentials.
3. Once identity and target are verified, run `reset-password <username>` with a new unique secret entered twice through hidden console prompts. COUPLE recovery requires reveal enabled; DEVELOPER recovery is refused in production. Resetting a disabled account leaves it disabled.
4. Run `enable <username>` only after the recovery handoff is complete. Confirm the new password works, the old one fails, and any earlier browser session no longer authenticates.

Successful logout invalidates the session and clears the cookie. A browser's old session/CSRF token must not become valid after logout, password reset, disable, or re-enable. The session API contract remains in [API v1](../api/v1/README.md); inbox implementation is tracked separately.

The login throttle permits five credential attempts per normalized username and thirty per direct peer address within fifteen minutes, counting attempts regardless of authentication success. Its database counters survive application restart/session rotation. Old buckets are cleaned up after one day. Respect a throttled response's `Retry-After`; do not keep retrying a password or clear counters during routine recovery. The direct peer address comes from the connection, rather than trusting a caller-supplied forwarding header.

## Verification

Run the backend checks, including `SessionHttpTest`, plus disposable/in-memory operator verification against a synthetic PostgreSQL fixture. The focused session regression file protects authentication boundaries absent from the earlier suite; operator checks below need no additional test files. See [AUTH-01 verification evidence](../api/v1/auth-verification.md). Do not run mutation checks against real accounts or a production database.

- Compile the backend and run the existing test suite. Confirm utility `--help` works and a noninteractive mutation exits `2` before database access.
- With `AccountAdministrationStore` and a disposable migrated database, create a synthetic couple account with reveal enabled. Verify it is disabled, the stored hash matches through the application's `PasswordEncoder`, and an attempt to create the same username makes no change.
- Enable, reset, disable, and re-enable. Verify each operation advances the version once, updates its timestamp, preserves identity/role, and that reset leaves a disabled account disabled. Check a nonexistent account and rejected input make no changes.
- Verify reveal closed rejects COUPLE create/reset/enable but allows disable; production rejects DEVELOPER create/reset/enable and any COUPLE username other than `kevin`/`melanie`; OPERATOR/DEVELOPER never receive couple authority. Production couple display names must be exactly Kevin/Melanie.
- Verify short, mismatched, malformed-Unicode, and over-72-byte passwords are rejected. Inspect only synthetic fixtures; never print the entered password or hash.
- With a synthetic web login, verify password reset and disable/re-enable invalidate the earlier session and CSRF token; check the new password works and the old password fails.

A safe operator status query selects metadata only: `username, display_name, role, enabled, credentials_version, created_at, updated_at` from `archive_account` for the relevant username. Do not select `password_hash` in routine diagnostics.
