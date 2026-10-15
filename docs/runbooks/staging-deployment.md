# Full-application HTTPS staging — OPS-01

Prepared and locally verified October 5, 2026 for [OPS-01 — Staging deployment and configuration](https://app.notion.com/p/3dad9739c6bc8162b3fcd36e61269c33). Ryan authorized Docker verification and PR #15 completion/merge. The actual image, Linux codecs, isolated container access/retry/restart checks and local full-limit photo capacity checks pass. Paid provider setup, hosted deployment and memory/load verification, and physical-phone acceptance remain pending.

The October 5 Render inspection found only `kevinandmel-coming-soon`, a deployed static site. Keep that service, its `kevinandmel.com` / `www` domains and current DNS intact. Test the full application on a separate provider HTTPS address first. The [coming-soon deployment record](coming-soon.md) owns the existing public site's configuration.

## Provider and cost checkpoint

Ryan declined purchases on October 5, 2026. Leave the prepared Render forms unsubmitted; no paid provisioning or hosted deployment is authorized. Continue disposable local/emulator checks while retaining hosted HTTPS, memory/proxy/session and physical-phone acceptance as pending. The quoted plan below is a future candidate, not approved spending.

D-02 selects Render for Spring and managed PostgreSQL in Ohio, and private Cloudflare R2 for original media; Ryan confirmed on October 5 to retain this stack. Cloudflare [Containers](https://developers.cloudflare.com/containers/) can run Java, but [D1](https://developers.cloudflare.com/d1/) uses SQLite and [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) connects to a separately hosted database, so an all-Cloudflare move would require additional routing/database work. The retained stack is settled; application capacity and its budget still need approval.

These are candidate monthly costs checked October 5; confirm the dashboard quotation before creating anything. [Render pricing](https://render.com/pricing) is authoritative. Domain, R2 usage, other services, workspace charges and taxes are additional where applicable.

| Candidate | Application | PostgreSQL compute + explicit 1 GB storage | Approximate baseline | Capacity status |
|---|---:|---:|---:|---|
| Starter, 512 MB | $7 | $6 + $0.30 | $13.30/month | Not validated for the full photo contract; do not choose it solely to fit the budget |
| Standard, 2 GB | $25 | $6 + $0.30 | $31.30/month | Local boundary capacity passes with a 1536 MiB heap; hosted memory/load remains unverified. Exceeds D-07's $25 warning and requires Ryan's budget approval |

The prepared October 5 Render database form explicitly quotes **$6 compute + $0.30 for 1 GB storage = $6.30/month**. The prepared 2 GB/one-CPU web-service form quotes **$25/month**, making the current combined candidate **$31.30/month**. Both draft forms use Ohio; database storage autoscaling and web automatic deployment are disabled. Neither create/deploy button has been submitted. Confirm the quotation at creation if it changes. [Compute/storage are prorated by the second](https://render.com/docs/faq); usage/taxes and other services are additional.

The contract still permits 10,000,000 bytes, 50 million pixels and dimensions up to 20,000 per photo. Compressed file size does not bound decoder/JVM memory. Staging admits one finalization at a time before storage read, decode, publish and database commit; a concurrent request gets safe `503 MEDIA_UNAVAILABLE` and can retry the same item without becoming `FAILED`. Local development retains the default unlimited admission setting. This limits overlapping work, not the memory cost of one extreme image.

The [October 5 local full-limit capacity check](#local-full-limit-capacity--2026-10-05) measures successful boundary JPEG, PNG and WebP verification, overlapping finalization, recovery and process restart in a **2 GB container with a 1536 MiB heap**. The measured candidate setting is `JAVA_TOOL_OPTIONS=-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError`. The earlier smoke's 1 GB heap subsequently failed with an actual JVM out-of-memory error on a valid 50 MP lossy WebP; do not use that earlier heap setting for the full photo contract. The successful suite peaked at **1.680 GiB**, leaving about **327.6 MiB / 16%** of container headroom.

Before calling the hosted plan sufficient, repeat actual process/container memory observation with HTTPS R2 on the selected provider runtime and exercise deliberate overlap, recovery and restart there. The local HTTP storage fixture does not measure provider/TLS overhead or wedding load. Record peak memory, failures and safe same-item retry; preserve headroom for native decoding, metaspace and threads. Do not enable heap dumps containing guest data. Any change to contract limits needs a separate reviewed API/product change. Local capacity evidence does not approve the hosted plan or budget.

## What the package contains

- Root `Dockerfile` builds the locked Vite production assets, copies them into Spring's classpath, packages the executable JAR and runs it as an unprivileged user. One application serves `/` and `/api` on the same origin; Vite is not the hosted server.
- `scripts/build-app.sh` produces the same combined JAR using the installed Java/Node toolchain. It cleans `backend/target` before copying assets, then packages without running backend tests. Retain local synthetic acceptance inputs under ignored `logs/med01-acceptance/`, outside the clean target.
- `scripts/smoke-packaged-app.mjs` starts the actual packaged JAR on an ephemeral loopback port with synthetic staging admission and forwarding, disables storage, checks routing/access/API validation and stops its own child process. It requires the operator's local test database variables. It performs no contribution or R2 writes and does not replace the normal local servers.
- Verified image tags are `node:24.21.0-bookworm-slim`, `eclipse-temurin:25.0.4.1_1-jdk-noble` and `eclipse-temurin:25.0.4.1_1-jre-noble`. `.gitattributes` keeps shell entrypoints LF; the builder normalizes stale Windows CRLF. No library was added; existing ESLint transitive `brace-expansion` was patched from 5.0.9 to 5.0.12, with zero frontend audit findings.
- `.dockerignore` permits the application source trees and excludes local environment files, generated output, logs, dependency directories and private source-photo material. Supply runtime secrets through service environment settings, never image layers or build arguments.
- `application-staging.properties` binds `0.0.0.0:${PORT:10000}`, processes forwarded headers only in the staging profile, requires its database settings and sets `archive.media.max-concurrent-finalizations=1`.

Use Git Bash from the repository root for local packaging after the normal checks:

```bash
npm --prefix frontend run lint
npm --prefix frontend test
./backend/mvnw -f backend/pom.xml --batch-mode test
bash scripts/build-app.sh
```

The helper uses existing frontend dependencies. `bash scripts/build-app.sh --install` installs the existing lockfile when a clean build needs it. Tests are a separate gate: a successful packaging command alone is not a passing test run. Ryan authorized these image pulls/builds and local verification on October 5; paid provisioning/deployment still requires approval. On Windows, stop Vite before `npm ci` in its working directory, because its loaded native binaries may be locked.

After building, repeat the packaged smoke check with `java` on `PATH`, Node 24 and the existing local test database. Enter its password silently in a subshell; the current terminal's other settings remain available afterward:

```bash
(
  export MEMORY_ARCHIVE_DB_URL='jdbc:postgresql://127.0.0.1:5433/memory_archive'
  export MEMORY_ARCHIVE_DB_USERNAME='memory_archive'
  read -rsp 'Local test database password: ' MEMORY_ARCHIVE_DB_PASSWORD
  printf '\n'
  export MEMORY_ARCHIVE_DB_PASSWORD
  node scripts/smoke-packaged-app.mjs
)
```

Use the database/user for the intended local test instance if they differ. Start its existing PostgreSQL first. The smoke helper applies normal startup migration checks; use a compatible retained test database, not a production connection. Its synthetic forwarded headers prove local filter behavior, not Render's real forwarding.

## Local Docker verification

With local Docker and the existing `postgres:17` image cached, build the reviewed image and run the smoke:

```bash
docker build --tag kevin-mel-wedding:verify .
node scripts/smoke-container.mjs kevin-mel-wedding:verify
```

If Docker is not on PATH, use its existing executable. On Ryan's Windows installation, in Git Bash:

```bash
export DOCKER_BIN='C:/Users/Ryan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
"$DOCKER_BIN" build --tag kevin-mel-wedding:verify .
node scripts/smoke-container.mjs kevin-mel-wedding:verify
```

The helper rejects remote Docker endpoints and never pulls/builds images. It creates a uniquely named, labeled bridge network, disposable PostgreSQL 17 with tmpfs data/no host port, and a nonroot read-only 2 GB app with writable `/tmp`. Only an ephemeral `127.0.0.1` app port is published. Credentials are synthetic/private, R2 is disabled, and cleanup is limited by ownership labels to its own resources. The existing development DB/volume is not accessed.

Observed October 5: public health; access/HTTPS-host enforcement; HTML/CSS/JS; source/secret/preview/unknown-route exclusions; origin validation; committed private TEXT receipts; named/anonymous normalization; conflict/replay; eight concurrent requests; discarded committed response recovery; and app restart all pass. Exactly three contributions/memories, one named and two anonymous, retain PENDING/COUPLE_ONLY defaults, with no media. All temporary resources were removed. Existing 5173/8080 services still respond.

A separate probe against freshly extracted image classes/libraries passes nine Linux-JRE checks: JPEG, transparent PNG and WebP acceptance; safe rejection of wrong MIME/hash/size, corruption, dimensions and pixel count. Local image ID: `sha256:9f2f927c70fccc84f1366d8274b393cfb57dd3282d7511fd72cf59855200b93e`. These tiny fixtures/boundary rejections and the smoke's 1 GB heap do not establish successful full-limit decoding or sufficient Render capacity.

## Temporary staging access

By default, activating the `staging` Spring profile requires an operator-selected username, a password of **24–256 characters**, and the exact approved HTTPS origin. The username must be nonblank, at most 64 characters, with no colon or control characters; the password must be nonblank and contain no control characters. The origin has the form `https://service-name.onrender.com`, without a trailing slash, path, query, fragment, credentials or explicit port. Missing or malformed settings stop startup. The HTTPS origin remains mandatory when browser admission is explicitly disabled.

With `MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=true` (the default when omitted), all application routes, including built assets and guest mutations, require this temporary HTTP Basic gate except **exactly `GET /api/health`**. Requests through an unexpected forwarded origin or non-HTTPS path get safe 403; missing/wrong admission credentials get safe 401. Gate responses use fixed JSON, `Cache-Control: no-store` and no credential logging. Direct R2 transfer remains a separate short-lived signed PUT and receives no application authorization header.

Set `MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=false` only when deliberately opening the guest test site without the browser password popup. This skips the Basic credential check and challenge; it retains the HTTPS/exact-origin checks, no-store/nosniff headers, Secure session cookies, and all existing guest submission/storage controls. Private archive sign-in, CSRF, account/reveal/role checks and private data authorization remain required. The disposable `/staging/audio` recorder probe and its four companion GET routes are unavailable while admission is disabled; the ordinary guest voice-memory flow is unchanged.

This flag is read at application startup. Deploy the reviewed backend that supports it before changing the setting, then restart through the approved provider procedure. Keep the existing staging username/password configured privately so restoring `true` and restarting can restore the gate. Do not switch Spring profiles or remove the HTTPS origin. A restart clears in-memory archive sessions. This procedure does not itself authorize deployment or change any account, database or storage setting.

### October 15, 2026 — optional browser admission verification

The auth-only change starts from the provider-confirmed live commit `fe2e348`,
excluding later Timeline/Albums work and unrelated local edits. Independent
review confirmed that 57 other security, session, authorization, origin, media,
contribution, retention and profile files remain unchanged. The existing focused
security/HTTP suites passed **54 tests**, including real Spring startup binding,
default-on admission, explicit opt-out, invalid settings and private API refusal.
No new tracked test files or dependencies were added.

The exact auth-only JAR SHA-256
`d14ff4ec85e8c32906b55d6ad0285733868438fa68f748034703fdacb095c89f`
passed **149 assertions** across default-on and explicit-false modes against
disposable PostgreSQL 17. With the flag false and operator credentials absent,
guest/assets/session routes had no Basic challenge, all six tested private API
families still returned 401, and all five recorder-probe routes returned 404.
HTTPS, exact forwarded host and cross-site origin checks continued to reject
requests. Chromium 149.0.7827.55 loaded the guest form and private sign-in without
Authorization requests, Basic challenges, page errors or external requests.
No account or content was created. Exact owned Java, database and browser
cleanup passed. Evidence is ignored under
`logs/staging-access.local/native-3fe12e78-6f3f-4271-963f-b3ee2d3f206c/summary.json`.
One earlier package run is marked preliminary and excluded from final metrics.
This uses simulated trusted HTTPS forwarding on loopback; hosted TLS/proxy and
post-deployment checks remain separate. No hosted deployment or configuration
change was performed for this verification.

Render terminates HTTPS and forwards requests to the internal HTTP port. This profile trusts that approved proxy's forwarding; do not place it behind an arbitrary proxy or expose its internal port directly. Verify Render forwarding and the externally observed gate after deployment. The gate is for Ryan and explicitly approved synthetic testers. AUTH-01 couple sessions are a second, independent boundary: passing the staging gate gives no couple authority. The staging profile emits Secure session cookies. Reveal remains closed until a deliberate synthetic verification exercise; production abuse controls and reveal onboarding remain release work. Login throttling captures the connection peer before forwarded-header processing, so clients behind the approved proxy may share its peer limit. Keep staging credentials in Ryan's password manager, distribute them only to approved testers, and rotate them after testing. Avoid screenshots or copied request commands containing credentials.

The final review image `kevin-mel-wedding:review-acceptance` (`sha256:42987b995031b5425e38d51b7ce1a07da1a32886429e008b82bc77e54dc3cb9b`) passes the expanded isolated smoke, including its existing SQL/session/retry/restart/throttle checks and all five actual staging-only audio GET resources, missing-admission denial, no-store/CSP headers and excluded private/test paths. Its JAR includes the packaged account utility and exactly four private audio HTML/JS/CSS resources. All owned temporary resources are removed; R2 and the existing database are untouched. This confirms packaging and local behavior; hosted acceptance remains pending.

## Synthetic account console and HTTPS sessions

The staging acceptance scope includes disposable synthetic couple accounts and real browser sessions, independently of whether temporary HTTP Basic admission is enabled. Use the paid service's approved interactive dashboard shell or SSH to run the [packaged account utility](account-access.md#packaged-console-on-approved-staging) against its private staging database. The image supplies the named nonroot `archive` user, `/bin/bash`, `/home/archive` and a user-owned `.ssh` directory with mode `0700`, as required by [Render's Docker SSH documentation](https://render.com/docs/ssh#docker-specific-configuration). The utility launches from `/app/app.jar` through `PropertiesLauncher`; it needs no local `backend/target` tree, extracted dependencies, `psql` or public DB access. Hosted terminal support and hidden Java console input remain observed acceptance gates.

After the normal deployment applies migrations, create and separately enable synthetic COUPLE accounts using the utility's exact confirmation and hidden repeated password prompts. Temporarily open reveal only for this approved isolated test; make the application configuration and operator shell agree. Verify real HTTPS cookie acceptance, separate couple authority, session-ID/CSRF rotation, same-origin/CSRF refusal, logout, console password-reset and disable/re-enable revocation, default inactivity expiry and loss of in-memory authentication after restart. The same database and stable throttle secret must preserve login limits across restart. Keep request/cookie/token/password values private and record only outcomes. Use separate fixture usernames or wait for the fixed windows so the five-account/30-connection-peer attempt caps do not mask later checks; Render proxy peers can be shared by testers.

Public HTTP on Render redirects to HTTPS before reaching the app; do not send admission credentials or session cookies over HTTP to test the local simulated `403`. Observe the actual trusted forwarding and caller-supplied header behavior on the hosted service. When admission is enabled, missing/wrong staging credentials must still fail on the HTTPS origin. With admission disabled, public routes must have no Basic challenge, all five recorder-probe routes must return 404, and anonymous private archive requests must still return `401 AUTH_REQUIRED` without a Basic challenge. Passing or disabling the gate without couple authentication must still return an anonymous application session. The eventual exact HTTPS origin also needs its separately approved R2 CORS entry for signed browser playback.

Disable the disposable accounts and close staging reveal after acceptance, with the appropriate configuration restart. Do not provision real couple identities or perform reveal-day onboarding. A reveal-setting restart also discards in-memory sessions, so distinguish closed-reveal new-issuance denial from independent logout/account-version revocation evidence.

October 5 local console verification passes against the rebuilt actual image with separate tmpfs PostgreSQL 17 and no published ports/R2: nonroot user/home/shell/SSH-directory permissions, direct `/app/app.jar` utility loading, noninteractive refusal before mutation, actual TTY exact confirmation and repeated hidden input, disabled synthetic creation, enable/reset/disable credential-version transitions and wrong-environment refusal. Only safe metadata was inspected; every owned verification resource was removed. The [account runbook](account-access.md#local-packaged-console-verification--2026-10-05) records its limits. Actual Render shell access and hosted session acceptance remain open.

## Approval and manual setup

Before provider provisioning/deployment, Ryan approves the application/database plans, recurring cost, separate hosted test resources, temporary tester access and concrete target. Local Docker verification and PR #15 merge were authorized on October 5. Creating files, building the local JAR or committing a PR does not grant approval to provision or deploy. The application stage and budget decision remain open until that approval.

After approval, Ryan performs or explicitly directs these steps:

1. Create a separate managed **PostgreSQL 17** instance in **Ohio**, with Basic compute, an explicitly selected **1 GB** disk and storage autoscaling disabled. Confirm the quote instead of accepting an unspecified storage default. Use a new test database, never the local development database or a future guest collection database. Disable external connections: the database's `ipAllowList` must be `[]`, not omitted or `0.0.0.0/0`. Same-region Render private connections remain available. See [Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting) and [database configuration](https://render.com/docs/blueprint-spec#database-fields).
2. Create a separate **Docker web service**, proposed name `kevinandmel-staging`, in the same Ohio region/account. Repository root is the build context; Dockerfile path is `./Dockerfile`. Select the approved application plan, one instance, no service autoscaling and **automatic deployment disabled**. Use only the explicitly reviewed branch/commit. Docker supplies the build and start commands; do not run Vite or the coming-soon helper here. See [Docker on Render](https://render.com/docs/docker).
3. Record its assigned provider HTTPS URL. Enter all settings below manually in the service environment before a successful deployment, then set `MEMORY_ARCHIVE_STAGING_ORIGIN` to that exact origin. If an initial creation attempt starts before the origin/secrets are supplied, the staging profile must fail closed; configure it and perform a deliberate manual deployment. Do not disable admission to work around an invalid origin or other missing configuration. See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).
4. Set the health-check path to `/api/health`. Confirm the selected commit and perform the approved **manual deployment**. Keep automatic deployment disabled while acceptance, memory sizing and migration/rollback safety are being proved. Do not create deployment hooks or attach the public wedding domain during this stage.
5. Confirm the gate and same-origin UI/API checks below. Then add this exact HTTPS origin to the private **test** R2 bucket CORS allowlist, preserving the approved local origins. Use only `PUT`, `GET`, `HEAD`, `Content-Type` and the approved exact origins; AUTH-02 playback needs browser GET. Use [private photo storage setup](private-photo-storage.md) for bucket privacy, token scope and lifecycle; a wildcard or public bucket is not a fix for CORS.

| Service environment variable | Required value / entry method |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `staging` (also the image default; retain it explicitly in the service settings) |
| `MEMORY_ARCHIVE_ENVIRONMENT` | `staging`; never label this test database as production |
| `MEMORY_ARCHIVE_PUBLIC_ORIGIN` | Same exact HTTPS origin as `MEMORY_ARCHIVE_STAGING_ORIGIN` |
| `MEMORY_ARCHIVE_REVEALED` | `false`; temporarily open only for approved disposable synthetic COUPLE verification |
| `MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET` | Stable random secret of at least 32 bytes, entered privately |
| `PORT` | Render's assigned port, normally `10000`; the profile binds on all interfaces |
| `MEMORY_ARCHIVE_DB_URL` | `jdbc:postgresql://INTERNAL_HOST:5432/TEST_DATABASE?sslmode=require`; construct from individual private connection fields, with no embedded username/password |
| `MEMORY_ARCHIVE_DB_USERNAME` | Separate test-database user, entered privately |
| `MEMORY_ARCHIVE_DB_PASSWORD` | Database password, entered privately |
| `MEMORY_ARCHIVE_STAGING_ORIGIN` | Exact assigned `https://…onrender.com` origin, without a trailing slash |
| `MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED` | `true` by default; set `false` only for explicitly authorized public guest testing, then restart |
| `MEMORY_ARCHIVE_STAGING_USERNAME` | Temporary operator/tester admission name; required while admission is enabled, retain privately for rollback |
| `MEMORY_ARCHIVE_STAGING_PASSWORD` | Unique password-manager-generated 24–256 character password, entered privately; retain for rollback |
| `MEMORY_ARCHIVE_STORAGE_ENABLED` | `true` only after the private test bucket/token/CORS are ready |
| `VITE_AUDIO_ENABLED` | `true` for the October 14 voice-memory enablement; public Docker build argument, requiring a frontend rebuild |
| `MEMORY_ARCHIVE_AUDIO_ENABLED` | `true` to admit new voice memories at runtime; private storage must be enabled and uploads unpaused |
| `MEMORY_ARCHIVE_R2_ENDPOINT` | `https://YOUR_32_HEX_ACCOUNT_ID.r2.cloudflarestorage.com`; no bucket suffix |
| `MEMORY_ARCHIVE_R2_BUCKET` | Approved synthetic-only test bucket name |
| `MEMORY_ARCHIVE_R2_ACCESS_KEY_ID` | Test-bucket-scoped Object Read & Write access key, entered privately |
| `MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY` | Corresponding secret, entered privately |
| `JAVA_TOOL_OPTIONS` | For the separately approved 2 GB plan, the locally measured candidate is `-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError`; verify hosted memory/headroom before accepting capacity |

Render passes `VITE_AUDIO_ENABLED` to the Docker build. Set both audio flags before
rebuilding and deploying; a runtime-only change cannot expose the voice option.
Both default to `false` when omitted. Ryan's October 14 instruction enables audio
on the existing service; see the [voice-memory runbook](voice-memories.md) for
formats, recording/upload behavior and the remaining device/storage checks.

The staging DB settings are mandatory; there is no localhost fallback in that profile. A Render `postgresql://user:password@…` connection string is not a JDBC URL and must not be pasted into `MEMORY_ARCHIVE_DB_URL`. Render's internal TLS supports `sslmode=require`; do not claim certificate verification from that setting. Put no secret in `VITE_*`, Git, Notion, screenshots, commands with literal passwords, build arguments or copied logs. `.env` is not automatically loaded. Flyway applies the reviewed V1–V5 migrations to this separate test database at startup; never rewrite applied migrations or run a database reset against retained evidence.

## Hosted verification and phone acceptance

Record service/database names, region, approved plan, deployed commit, public origin, date and outcomes in OPS-01. Never record passwords, capability keys, signed links or guest content.

1. Before signing in, verify exact `GET /api/health` returns the minimal liveness JSON. With admission enabled, `/`, its built assets, receipt and mutation routes must require the staging credentials. With admission disabled, verify the guest site loads without that popup and private archive routes still require their own account sign-in. HTTP/unapproved-origin attempts must not reach the form/API in either mode. Verify `/` serves the actual guest forms and `/api` remains on the same origin. The synthetic contract preview must not be in the production package.
2. Confirm a synthetic text contribution receives a committed private receipt, then repeat the same retained key/body and observe the same IDs. Confirm changed payload conflicts and uncertain-outcome retry preserves the original draft. Use the [text verification record](../api/v1/text-verification.md) rather than treating health as persistence proof.
3. On an actual iPhone Safari and an assigned Android Chrome device, upload supported synthetic JPEG/PNG/WebP files, test clear HEIC rejection, and check progress/result/error announcements and focus. A normal HTTPS origin is required for the checksum; never bypass certificate warnings. Keep the page open through deliberate retry. Follow the [MED-01 checklist](private-photo-storage.md#real-r2-and-phone-acceptance--partially-verified), including same-item response recovery, grant renewal, private default states and authenticated operator input/download/DB size/hash comparison.
4. Verify DB readiness privately with an approved admin client on Render's private network (`SELECT 1`, Flyway history, then the scoped synthetic record query). This runtime image does not bundle `psql`; do not enable public database access or add runtime tools merely to run the check. Actual successful text/photo transactions and current receipt retrieval also exercise the configured database. For storage readiness, use an actual test upload/finalize and authenticated original download/comparison, separate from DB proof.
5. Keep the same staging DB and bucket while manually restarting/redeploying the reviewed commit. Confirm unchanged receipt IDs/private states, same-key replay and byte-identical operator retrieval after the new process starts. Test unfinished same-item recovery with retained browser identity. Refreshing or choosing another file creates a new intent and is not replay evidence.
6. Observe trusted forwarding, resource memory, logs and safe failures on the deployed runtime. Public `/api/health` reports liveness only; it does not distinguish database/storage outages. Keep database diagnostics, object diagnostics and memory measurements in private operator evidence. Do not add public readiness detail or enable verbose SQL/request/SDK/access logging with bodies, keys, authorization or signed URLs. OPS monitoring/backup/restore and SEC abuse controls remain release work.

Update `docs/api/v1/photo-verification.md` and MED-01 with physical-device/provider results only when observed. OPS-01 stays unfinished until its actual HTTPS, environment separation, repeatable deployment, safe diagnostics and phone restart/redeployment criteria pass. This temporary gated stage is not a public wedding collection release.

## Rollback and recovery

The [local OPS-03 operations/rollback runbook](operations-and-rollback.md) adds a private read-only readiness report and a disposable two-artifact rehearsal. Its exact-migration compatibility gate is intentionally conservative; a local pass is not hosted rollback or backup acceptance.

Keep the reviewed previous commit, service environment and test data associations available before deploying. If the candidate fails, stop new synthetic submissions, keep the gate, and manually redeploy a compatible known-good commit to the same service/database/bucket. Preserve existing pending/complete intents and originals; do not rotate capability keys, delete objects, use `docker compose down --volumes` or repair Flyway history to make a deploy appear healthy. An older binary may not understand a newer schema, so check migration compatibility before rolling back code; fix forward when a rollback is unsafe. Applied migrations remain immutable.

After recovery, recheck admission, health, private receipts, original integrity and deliberate same-item retry before resuming. If secrets leaked, Ryan rotates the corresponding staged credential or bucket-scoped token in the approved provider settings and redeploys as needed; test retained data afterward. Preserve bucket lifecycle rules: the default bucket-wide **seven-day incomplete-multipart abort** rule does not delete completed originals. The separate **one-day completed-object deletion** rule must target **`staging/` only**, never `originals/` or an empty prefix. Cleanup of retained evidence or orphan originals needs a concrete approved candidate list; use the [photo cleanup procedure](private-photo-storage.md#cleanup-recovery-and-retention).

Moving `kevinandmel.com` from the coming-soon service is a later explicitly approved release operation with DNS/TLS checks and its own rollback. This staging procedure performs no domain change.

## Local evidence and remaining gates

October 5 local verification: **40 backend tests** pass with zero failures/errors/skips; **73 frontend tests**, lint, production Vite build and `build-app.sh` executable JAR packaging pass. The earlier MED-01 implementation baseline was 33 backend tests.

The actual JAR smoke check passes: unauthenticated health 200; admitted HTML/CSS/JS assets 200; missing admission 401; unapproved forwarded host and HTTP 403; preview, environment/source, missing-asset and unknown API paths 404 without HTML fallback; same-origin empty-text request 400 `VALIDATION_FAILED`; cross-origin mutation 403 `ORIGIN_INVALID`. The smoke helper's syntax and missing-Java cleanup behavior also pass. Storage was disabled and no submission/R2 writes occurred. The original local backend on 8080 and Vite on 5173 remain running; the smoke child used another port and stopped after its check. These checks do not establish hosted forwarding, real mobile browser admission, Docker runtime capacity or provider durability.

Still required: hosted capacity/budget approval; hosted full-limit/overlapping photo memory measurements; provider provisioning/deployment; private hosted DB/runtime secrets and exact HTTPS R2 CORS; phones, earlier retained-original comparison and hosted restart/redeployment. Current local browser R2 read, private bucket/token settings and Ryan-approved one-day staging-only lifecycle configuration are verified; actual asynchronous expiration has not been observed. Local image build/runtime/codec and full-limit capacity checks pass. No paid resources, hosted deployment or domain changes occurred for the local capacity checks.

## Integrated authentication image — 2026-10-05

The AUTH branch passes **98 backend tests** against disposable PostgreSQL 17 and **73 frontend tests**, lint/build and zero-vulnerability audit. Its actual image `kevin-mel-wedding:auth-home-verify` (`sha256:4ae3d9faac1ef36495be7139c2b9f95dcb8b887767e220554c64f345f977d9d1`) passes the expanded isolated smoke: existing guest receipt/retry/restart checks, separate staging admission, real SQL/bcrypt couple login, Secure/HttpOnly/SameSite cookies, session-ID/CSRF rotation, logout, credential-version and disable revocation, loss of in-memory authentication on restart, and persisted five-attempt login cap. All owned temporary resources were removed. R2 remained disabled.

Historical PR #15 404 checks above preceded AUTH default-deny routing; current helpers expect safe anonymous `401 AUTH_REQUIRED` for unknown/excluded paths. At this integrated-image verification stage, hosted HTTPS/proxy/cookie behavior, real R2 reads, full-limit capacity and physical devices remained unverified. The later local capacity evidence below resolves the local memory measurement only.

## Local full-limit capacity — 2026-10-05

The current integrated image `sha256:9e31e708fda72ed3e8a31da7f11e70e00b76a28acef29fe2aa9bb0d8eb35a363` was measured using its Linux Java **25.0.4.1+1-LTS** runtime and unchanged extracted application classes/libraries. A synthetic Spring configuration supplies the application's actual `R2ObjectStorage` S3 SDK against a separate private-network **HTTP S3 fixture**. Real Spring transactional proxies, disposable PostgreSQL 17 and the Linux image codecs perform read, verification, publish and DB commit. The app runs as UID 10001 with a read-only root, **2 GB memory/no extra swap, one CPU and no published port**. The disposable DB and bucket fixture each have a 256 MiB limit; all resources use a unique labeled internal network. No real bucket, provider credentials or existing DB is used.

All five fixtures contain **50,000,000 pixels and exactly 10,000,000 encoded bytes**. Patterned images are extended to the byte boundary with valid JPEG COM, PNG ancillary or WebP JUNK chunks; this tests the byte/pixel/dimension boundaries but is not exhaustive arbitrary-bitstream coverage. The lossless WebP contains 7,852,644 bytes of native encoded image data before padding.

| Fixture | Dimensions | Verification/publish/original comparison time | Observed stage memory peak |
|---|---|---:|---:|
| JPEG | 20,000 × 2,500 | 976 ms | 230,989,824 bytes |
| RGB PNG | 20,000 × 2,500 | 837 ms | 273,444,864 bytes |
| RGBA PNG | 10,000 × 5,000 | 1,062 ms | 303,591,424 bytes |
| Lossless WebP | 10,000 × 5,000 | 2,480 ms | 534,294,528 bytes |
| Lossy WebP | 10,000 × 5,000 | 14,198 ms | 1,791,242,240 bytes |

The earlier `-Xmx1g` trial accepts JPEG, both PNG cases and lossless WebP, then terminates on the valid lossy WebP with **`OutOfMemoryError: Java heap space`, exit 3**; Docker reports no container OOM kill. A thread-only diagnostic locates the work in the bundled VP8 decoder, which retains a full-frame macroblock/subblock graph despite output raster subsampling. No heap dump was created.

With `-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError`, every case passes. The whole suite's cgroup maximum is **1,803,960,320 bytes / 1.680 GiB**; process peak RSS is **1,766,504 KiB**. The 2 GiB container retains **327.6 MiB / approximately 16%** headroom. Deliberately holding the first storage read causes a concurrent item to receive **503 `MEDIA_UNAVAILABLE` before storage/decode**, retaining `PENDING`; retrying that same item/key/grant succeeds. A missing object returns **409 `UPLOAD_INCOMPLETE`**, then completes under the same IDs after its staged bytes arrive. Original rereads and DB size/SHA-256/detected-format checks match every fixture. Exactly eight contributions, memories and uploaded assets retain memory defaults `PENDING` / `COUPLE_ONLY`.

A separate Java process restart against the same disposable DB/bucket retains IDs, same-key creation/finalization replay, private metadata and byte-identical originals. Initial and restarted app processes exit 0 without a container OOM kill. All owned containers/network/data are removed; the pre-existing development DB remains healthy. Sanitized measurements and fixture/harness files remain under ignored `logs/review-capacity/`; retry capabilities and credentials are excluded from this record.

This establishes a concrete **local staging candidate**, not hosted HTTPS R2 memory sufficiency, real proxy behavior, physical-phone acceptance, wedding-load capacity or paid setup approval. Keep one finalization slot and observe deployed memory and safe retries before accepting the provider plan. The 512 MB plan remains untested/unaccepted for the full contract; no 4 GB trial was needed after the successful 2 GB suite. API limits and dependencies are unchanged.
