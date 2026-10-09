# Private account provisioning and recovery

Prepared 2026-10-05 for AUTH-01; collaboration policy clarified 2026-10-09. Preparing this runbook and console utility has not provisioned real accounts, sent invitations, changed provider settings, or deployed the application. Kevin and Melanie already know about the project and may join product discussions and synthetic usability tests now. Account creation, confidential credential handoff and access activation remain deliberate operator actions. Ryan owns infrastructure and recovery; Kevin and Melanie alone moderate and publish. Kade has development access only.

The existing `MEMORY_ARCHIVE_REVEALED` name denotes the technical couple-access gate. It no longer represents surprise secrecy or a requirement to wait until after the wedding. Agree on the access target and timing separately from the October 31 archive handoff/collection-close milestone.

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

Application and utility processes read their own configuration at startup. Setting the reveal environment variable in the utility terminal does not change an already-running application. Keep the production access gate closed until the agreed access activation and separately authorized onboarding.

## Build and launch locally

Use Java 25 in an interactive Git Bash shell hosted by Windows Terminal or a Windows console window. The default Git Bash mintty window may not provide Java's system console. Configure the Windows Terminal profile to launch Git's `bin/bash.exe --login -i` directly; opening `git-bash.exe` can launch mintty again. IDE output panes, redirected input/output, background jobs, and terminals where `System.console()` is unavailable are rejected. Passwords are accepted only by `System.console().readPassword()` and are never echoed. The utility accepts no password flag, password environment variable, piped password, or password file. Do not bypass this console requirement; if the utility reports no interactive system console, use a supported console before retrying. Successful `--help` output alone does not establish hidden-input support.

With `JAVA_HOME` already pointing to the installed Java 25 JDK, run these Bash commands from this project's `backend/` directory. They use the committed Maven wrapper and existing approved runtime dependencies:

```bash
export JAVA_HOME="$(cygpath -u "$JAVA_HOME")"
export PATH="$JAVA_HOME/bin:$PATH"
./mvnw --batch-mode -DskipTests compile dependency:build-classpath \
  -Dmdep.outputFile=target/account-admin-classpath.txt
archive_dependency_classpath="$(tr -d '\r\n' < target/account-admin-classpath.txt)"
archive_account_classpath="$(cygpath -w "$PWD/target/classes");$archive_dependency_classpath"
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" \
  com.kevinmel.archive.security.AccountAdministration --help
```

The classpath file is under ignored `target/`. These assignments read it without displaying it and retain the semicolon separator required by native Windows Java. `MSYS2_ARG_CONV_EXCL` prevents Git Bash from rewriting that classpath argument. Keep the compiled classes and classpath from the same build; no dependency or wrapper change is needed for the utility.

On macOS/Linux, use the Maven shell wrapper, omit Windows-only `cygpath`/MSYS settings, and use `:` between `target/classes` and the dependency classpath. Run Java directly in the interactive terminal so hidden password input is available. Do not invoke this utility through `spring-boot:run`.

For an isolated synthetic local exercise, verify that the connection is the local Compose database, then configure this terminal:

```bash
export MEMORY_ARCHIVE_ENVIRONMENT=local
export MEMORY_ARCHIVE_REVEALED=true
```

The following examples describe synthetic accounts only. Each command stops for an exact confirmation; create/reset additionally ask for the new password twice:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.security.AccountAdministration --expect-environment local create synthetic-kevin 'Synthetic Kevin' COUPLE
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.security.AccountAdministration --expect-environment local enable synthetic-kevin
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.security.AccountAdministration --expect-environment local reset-password synthetic-kevin
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.security.AccountAdministration --expect-environment local disable synthetic-kevin
```

For example, creation requires typing `create synthetic-kevin in local`. A mismatch or cancelled prompt makes no account change. Use a unique password/passphrase of at least 15 Unicode characters and no more than 72 UTF-8 bytes, matching the existing delegating bcrypt encoder's limit. Password arrays and temporary UTF-8 bytes are cleared after use; hashes remain only in database storage and transient encoder/database memory. Application/JDBC logging is suppressed in the utility, and database exceptions never print their details or stack traces.

Exit code `0` means a command committed successfully (or help was shown); `2` means a rejected command/input/confirmation; `1` means success was not confirmed because configuration, encoding, or database access failed. A transport failure around commit can leave an uncertain outcome: inspect account status/version before retrying. Do not dump account rows with `SELECT *`, since that includes password hashes.

When the synthetic exercise ends, close this isolated terminal. Return local/staging web application reveal settings to their intended state. Do not copy synthetic credentials into production.

## Packaged console on approved staging

The deployed Docker runtime contains `/app/app.jar`, not the local Maven `backend/target` tree. Use its Spring Boot `PropertiesLauncher` to run the same console utility directly from that packaged JAR; no extraction, Maven, `psql`, new dependency or public database connection is needed. The utility still requires a real interactive terminal and performs no web startup or migration. First let the approved application deployment apply its normal migrations to the separate staging database.

Connect through the approved paid Render service's dashboard shell or SSH in an interactive terminal. Render's [Docker SSH requirements](https://render.com/docs/ssh#docker-specific-configuration) require a nonroot user with shell access and a private `.ssh` directory. This image supplies `archive` with UID/GID `10001`, home `/home/archive`, shell `/bin/bash`, and `/home/archive/.ssh` owned by that user with mode `0700`; it runs no SSH server. Actual hosted shell access and Java console behavior must still be confirmed after deployment. Do not redirect input/output or run the command as a background job.

Verify the approved service/test-database target privately using its reviewed configuration. The shell must use `MEMORY_ARCHIVE_ENVIRONMENT=staging` and the service's existing private JDBC/database settings. Never print those settings or change the database allowlist to reach them. Temporarily open reveal only for the approved synthetic exercise in both the application configuration and this operator shell; the already-running application does not read changes made only in the shell. Do not create real couple accounts in this staging procedure.

In that interactive shell, define this invocation. Its small operator-JVM heap is scoped to each console command and does not change the running application's measured heap:

```bash
archive_account_admin() {
  JAVA_TOOL_OPTIONS='-Xms16m -Xmx128m -XX:ActiveProcessorCount=1 -XX:+UseSerialGC' \
    java -Dloader.main=com.kevinmel.archive.security.AccountAdministration \
      -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher "$@"
}
archive_account_admin --help
archive_account_admin --expect-environment staging create synthetic-kevin 'Synthetic Kevin' COUPLE
archive_account_admin --expect-environment staging enable synthetic-kevin
archive_account_admin --expect-environment staging reset-password synthetic-kevin
archive_account_admin --expect-environment staging disable synthetic-kevin
```

Each mutation still requires its exact confirmation; create/reset still ask for a password twice through hidden console input. Help alone does not prove console availability. If a mutation reports that no interactive system console is available, stop and use a supported interactive shell; do not replace hidden input with environment variables, password flags, files, pipes or SQL account inserts. Use distinct disposable usernames when separate acceptance phases would otherwise exceed the five-attempt login cap.

Use the real same-origin session adapter in a controlled HTTPS browser check for synthetic login, cookie/CSRF rotation, logout, reset/disable revocation and renewed login. Staging HTTP Basic admission is independent and grants no couple session. Actual hosted login acceptance and real-account onboarding remain separate tasks. When finished, disable the synthetic accounts, return application and operator reveal settings to their intended closed state, close the private console and remove the helper function with `unset -f archive_account_admin`. Preserve only nonsensitive dated outcomes.

### Local packaged-console verification — 2026-10-05

The rebuilt actual runtime image passes a scoped exercise with a separate labelled bridge network and tmpfs PostgreSQL 17 database, no published host ports and R2 disabled. It runs as UID/GID `10001`; the named user, home, `/bin/bash` and user-owned `.ssh` mode `0700` are present. The packaged `PropertiesLauncher` invocation loads the utility and its nested dependencies from `/app/app.jar` alone. Noninteractive create exits `2` before mutation, leaving the account count zero.

With an actual Docker TTY, create accepted exact confirmation and two hidden password entries without echo; the resulting synthetic COUPLE account was disabled with credential version `0` and a bcrypt hash. Separate confirmed enable, hidden-input reset and disable commands retained its identity/role and produced enabled/version `1`, enabled/version `2` and disabled/version `3`. An incorrect expected environment was refused without mutation. Metadata checks recorded only safe fields and a boolean for the bcrypt format; no password/hash was printed. The small operator-JVM heap above worked alongside the running application. All owned containers/tmpfs data/network were removed. This proves the local packaged console path, not actual Render SSH access, hosted browser authentication or real-account onboarding.

## Couple account provisioning

Real-account provisioning is a separate hands-on operator action after the target and access timing have been agreed and explicitly authorized. No real accounts have been provisioned by this implementation. Couple participation in design or synthetic testing does not itself activate production accounts.

1. Ryan verifies the production target and its secure access path, confirms access timing with the couple, and explicitly enables the reveal/access setting for the approved application/utility configuration. Production must use HTTPS and the production session-cookie configuration before browser login.
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

The login throttle permits five credential attempts per normalized username and thirty per direct peer address within fifteen minutes, counting attempts regardless of authentication success. Its database counters survive application restart/session rotation. Old buckets are cleaned up after one day. Respect a throttled response's `Retry-After`; do not keep retrying a password or clear counters during routine recovery. A registered `ServletRequestListener` captures the connection peer before Spring's forwarding filters run; login hashing uses that request attribute, never a rewritten `getRemoteAddr()` or caller-supplied forwarding header. Missing capture fails closed with safe 503 before any throttle reservation. The transient attribute is removed when the request finishes; only its keyed digest enters PostgreSQL. Clients behind a proxy can share the peer bucket, so changing this conservative boundary requires reviewed deployment policy.

## Verification

Run the backend checks, including `SessionHttpTest` and `RequestPeerCaptureTest`, plus disposable/in-memory operator verification against a synthetic PostgreSQL fixture. The focused session regression file protects authentication boundaries absent from the earlier suite; operator checks below need no additional test files. See [AUTH-01 verification evidence](../api/v1/auth-verification.md). Do not run mutation checks against real accounts or a production database.

- Compile the backend and run the existing test suite. Confirm utility `--help` works and a noninteractive mutation exits `2` before database access.
- With `AccountAdministrationStore` and a disposable migrated database, create a synthetic couple account with reveal enabled. Verify it is disabled, the stored hash matches through the application's `PasswordEncoder`, and an attempt to create the same username makes no change.
- Enable, reset, disable, and re-enable. Verify each operation advances the version once, updates its timestamp, preserves identity/role, and that reset leaves a disabled account disabled. Check a nonexistent account and rejected input make no changes.
- Verify reveal closed rejects COUPLE create/reset/enable but allows disable; production rejects DEVELOPER create/reset/enable and any COUPLE username other than `kevin`/`melanie`; OPERATOR/DEVELOPER never receive couple authority. Production couple display names must be exactly Kevin/Melanie.
- Verify short, mismatched, malformed-Unicode, and over-72-byte passwords are rejected. Inspect only synthetic fixtures; never print the entered password or hash.
- With a synthetic web login, verify password reset and disable/re-enable invalidate the earlier session and CSRF token; check the new password works and the old password fails.

A safe operator status query selects metadata only: `username, display_name, role, enabled, credentials_version, created_at, updated_at` from `archive_account` for the relevant username. Do not select `password_hash` in routine diagnostics.
