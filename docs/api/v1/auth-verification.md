# AUTH-01 verification and implementation notes

Verified locally on 2026-10-05, on branch `feature/secure-sessions`. Ryan authorized completion after the guided implementation and subsequently authorized commit/push. These local checks were completed before that commit/push. No real accounts, invitations, provider changes or deployment occurred. The work-computer results below are historical; home integration evidence is recorded separately.

## Implemented boundary

`GET /api/session` returns anonymous/authenticated state and a masked CSRF token. `POST /api/session` checks the API contract, JSON credentials, CSRF and origin, reserves database-backed login attempts, authenticates through Spring Security's DAO provider, enforces couple/reveal policy, changes the session ID, refreshes CSRF and explicitly saves the authenticated security context. `DELETE /api/session` checks CSRF/origin, invalidates the session, clears the context and expires its cookie. The existing frontend session adapter was exercised against these real endpoints.

The cookie is `MEMORY_ARCHIVE_SESSION`, with `Path=/`, `HttpOnly` and `SameSite=Lax`; production and HTTPS staging add `Secure`. Sessions use cookies only, expire after 30 minutes of inactivity, and reside in the application instance's memory. Restarting the instance requires signing in again. There is no persistent session store or multi-instance session sharing in this task.

The production Spring profile and archive environment must agree. Startup requires secure cookies, an explicit HTTPS browser origin without a path, and a stable login-throttle secret of at least 32 bytes. Browser session mutations must match the configured origin. This project uses a same-origin frontend/API and adds no cross-origin CORS grant.

Only explicitly provisioned, enabled accounts can authenticate. Archive session access requires `COUPLE`, an open reveal gate and, in production, the separate usernames `kevin` or `melanie`. `OPERATOR` and `DEVELOPER` do not receive couple session/reviewer authority. Foreign principal types cannot pass the private archive boundary. Account status, role, username and credential version are rechecked against PostgreSQL on session/private requests; disable, recovery, deletion or role/version changes revoke existing access on its next protected request.

V4 adds account identity, encoded passwords, role/status/version and timestamps. V5 adds persistent login buckets. Login limits are five credential attempts per username and 30 per direct peer address in a fixed 15-minute window; successful attempts count too. Username-denied attempts still count against the peer bucket. Keys are HMAC-SHA256 values, not raw usernames or addresses. A servlet request listener captures the connection peer before forwarded-header filters; forwarding headers cannot change the throttle bucket. Missing capture fails with safe 503 before any reservation. A deployment proxy can make clients share a peer bucket, so trusted proxy handling requires a separate reviewed deployment decision. Errors are safe JSON with request correlation, no-store caching and a conservative `Retry-After: 900` when throttled.

The console administration utility creates disabled accounts, enables/disables them, or resets passwords; each command requires an explicit environment and interactive confirmation. Password entry is hidden and repeated. Recovery and enable/disable advance the credential version transactionally. Passwords use Spring Security's delegating bcrypt encoder, with a provisioning minimum of 15 Unicode characters and a maximum of 72 UTF-8 bytes. See [account provisioning and recovery](../../runbooks/account-access.md).

## Results

| Check | Result |
|---|---|
| Backend package build and focused suite | **29 passed:** 22 session/security regressions, health, photo validation and mocked storage checks. All existing test sources compiled. |
| Session/security regression coverage | Anonymous state, real manager/encoder, correct/unknown/wrong/disabled credentials, exact contract/body handling, Unicode/password limits, CSRF rotation and retention, stale token refusal, logout, role/reveal gates, account revocation, foreign-principal refusal, throttling and safe database/transaction failures. |
| Native PostgreSQL 18.4 assertions | **71 passed:** account defaults/hash/recovery/status/version/policy, configuration guards, username/peer limits, expiry reset, concurrent caps and expired-peer cleanup, fresh Flyway V1–V5, populated V3→V5 upgrade and idempotent rerun. |
| Actual HTTP and existing frontend adapter | **84 passed:** cookie flags, session-ID/CSRF rotation, logout, reset/disable revocation, recovered login, role exclusion, generic failures, public text contribution/capability receipt, production origin/cookie handling, actual servlet idle expiry and 429/retry hint. |
| Application restart | **3 passed:** anonymous new session, persisted throttle refusal, and preserved guest capability receipt. |
| Operator console | Help exits 0; redirected mutation refuses with exit 2 before database access; interactive synthetic creation accepted exact confirmation and hidden repeated password input. |
| Frontend | Lint, **73 tests**, and production build passed. |
| Independent code review | Reported database error and concurrency issues were corrected; final review found no remaining material AUTH-01 issue. |

Temporary assertions and synthetic credentials stayed under ignored `backend/target/`. Actual expiry used a deliberately shortened test setting: Tomcat rounded it to its one-minute minimum; the session became anonymous after 62 seconds of inactivity. The committed setting remains 30 minutes. Production cookie checks inspected a disposable production-profile instance over local HTTP; they verify emitted flags and origin handling, not a deployed HTTPS browser/proxy path.

## Remaining environment checks and later tasks

The work computer could not run Docker; that gap is now closed by the home PostgreSQL 17 full-suite result below. Native PostgreSQL 18 results remain supplemental historical evidence. PR review/CI, real Docker-image verification and authorized hosted checks are tracked separately. Production HTTPS/proxy/browser verification belongs to the authorized deployment process.

AUTH-01 establishes server authentication and guards for private archive routes. The subsequent AUTH-02 implementation adds verified-photo playback issuance; see [authorization verification](authorization-verification.md). The couple login UI, inbox/list/detail APIs and screens, moderation/publication actions, and real reveal-day onboarding remain their respective later tasks. No real Kevin/Melanie/Ryan/Kade account was created here, and no credentials were distributed. Guest contribution behavior remains public with its existing independent JSON/origin/capability safeguards and scoped CSRF exceptions.

## Repeatable repository checks

With Java 25 and the project's Maven wrapper (or matching installed Maven 3.9.16):

```text
mvn -Dtest=SessionHttpTest,HealthControllerTest,PhotoValidationTest,R2ObjectStorageTest package
```

With Docker/PostgreSQL 17 support available, run the full backend suite using the normal Maven test command. In `frontend`, run the existing lint, test and build scripts. Operator verification steps are documented in the runbook; all mutation exercises must use a disposable synthetic database.

Spring's [session-management reference](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html) explains why this custom controller invokes the session strategy and explicitly saves authentication. Its [CSRF authentication strategy reference](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/csrf/CsrfAuthenticationStrategy.html) documents replacement of the token after login.

## Home reconciliation — 2026-10-05

Merged current main `d48a8c8` into the authentication branch, resolving staging classes/tests under the approved `com.kevinmel.archive` package and preserving both features. The full backend suite passes **98 tests**, zero failures/errors/skips, with disposable PostgreSQL 17 containers. Frontend lint, **73 tests**, production build and audit pass (zero audit findings). Applied V1–V3 are unchanged.

The committed database suite now directly verifies account bcrypt hashes/defaults/recovery/version revocation, closed-reveal refusal, 24 concurrent login reservations capped at five per account, peer-cap row admission and expiry reset, and verified-private-original eligibility. Five new forwarding tests prove spoofed `Forwarded`/`X-Forwarded-For` values cannot change the captured peer HMAC. MockMvc reproduces servlet listener initialization; the actual image smoke separately verifies container registration.

Windows required the existing Mockito 5.23.0 JAR as an explicit Java agent; reduced sequential test JVMs avoided unrelated host resource pressure. Docker data was moved intact to F: after C: filled; both virtual disks were SHA-256 verified and the existing PostgreSQL volume restarted successfully. These machine maintenance steps made no database reset or provider change.

The actual integrated Linux image passes the expanded disposable PostgreSQL 17 smoke: staging admission does not grant couple authority; real SQL/bcrypt login rotates Secure cookies and CSRF; logout/version/disable revoke sessions; app restart removes in-memory authentication while retaining database login caps and guest receipts. All temporary resources were removed. This checks emitted forwarding/cookie behavior locally, not a hosted HTTPS browser.

For the Windows Mockito attachment workaround used at home (already resolved Mockito 5.23.0, no dependency added):

```bash
export JAVA_HOME="$(cygpath -u "$JAVA_HOME")"
export PATH="$JAVA_HOME/bin:$PATH"
export MAVEN_OPTS="-Xms32m -Xmx256m -XX:ActiveProcessorCount=2 -XX:+UseSerialGC"
archive_mockito_agent="$(cygpath -m "$HOME/.m2/repository/org/mockito/mockito-core/5.23.0/mockito-core-5.23.0.jar")"
./backend/mvnw -f backend/pom.xml --batch-mode -DreuseForks=false \
  "-DargLine=-Xms32m -Xmx384m -XX:ActiveProcessorCount=2 -XX:+UseSerialGC -javaagent:$archive_mockito_agent" test
```
