# Full-application HTTPS staging — OPS-01

Prepared and locally verified October 5, 2026 for [OPS-01 — Staging deployment and configuration](https://app.notion.com/p/3dad9739c6bc8162b3fcd36e61269c33). Ryan authorized Docker verification and PR #15 completion/merge. The actual image, Linux codecs and isolated container access/retry/restart checks pass. Paid provider setup, hosted deployment, full-limit memory and physical-phone acceptance remain pending.

The October 5 Render inspection found only `kevinandmel-coming-soon`, a deployed static site. Keep that service, its `kevinandmel.com` / `www` domains and current DNS intact. Test the full application on a separate provider HTTPS address first. The [coming-soon deployment record](coming-soon.md) owns the existing public site's configuration.

## Provider and cost checkpoint

D-02 selects Render for Spring and managed PostgreSQL in Ohio, and private Cloudflare R2 for original media; Ryan confirmed on October 5 to retain this stack. Cloudflare [Containers](https://developers.cloudflare.com/containers/) can run Java, but [D1](https://developers.cloudflare.com/d1/) uses SQLite and [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) connects to a separately hosted database, so an all-Cloudflare move would require additional routing/database work. The retained stack is settled; application capacity and its budget still need approval.

These are candidate monthly costs checked October 5; confirm the dashboard quotation before creating anything. [Render pricing](https://render.com/pricing) is authoritative. Domain, R2 usage, other services, workspace charges and taxes are additional where applicable.

| Candidate | Application | PostgreSQL compute + explicit 1 GB storage | Approximate baseline | Capacity status |
|---|---:|---:|---:|---|
| Starter, 512 MB | $7 | $6 + $0.30 | $13.30/month | Not validated for the full photo contract; do not choose it solely to fit the budget |
| Standard, 2 GB | $25 | $6 + $0.30 | $31.30/month | Safer measurement candidate, still unproven; exceeds D-07's $25 warning and requires Ryan's budget approval |

The totals conservatively budget $0.30 for 1 GB of DB storage. Render's pricing page advertises an included first GB while its [flexible-plan documentation](https://render.com/docs/postgresql-legacy-instance-types) describes separately billed storage; confirm the final quote. If included, the bases become $13 and $31. [Compute/storage are prorated by the second](https://render.com/docs/faq); usage/taxes are additional.

The contract still permits 10,000,000 bytes, 50 million pixels and dimensions up to 20,000 per photo. Compressed file size does not bound decoder/JVM memory. Staging admits one finalization at a time before storage read, decode, publish and database commit; a concurrent request gets safe `503 MEDIA_UNAVAILABLE` and can retry the same item without becoming `FAILED`. Local development retains the default unlimited admission setting. This limits overlapping work, not the memory cost of one extreme image.

Before calling a plan sufficient, measure actual process/container memory on the selected runtime using synthetic JPEG, PNG and WebP near the permitted dimensions/pixel/byte boundaries, plus deliberate overlapping finalization, restart and recovery. Record peak memory, failures and safe same-item retry. A proposed **2 GB runtime only** setting is `JAVA_TOOL_OPTIONS=-Xms64m -Xmx1g -XX:+ExitOnOutOfMemoryError`; it was used in the local smoke, but is not validated or approved for hosted full-limit photo processing. Leave headroom for native decoding, metaspace and threads. Do not enable heap dumps containing guest data. Any change to contract limits needs a separate reviewed API/product change.

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

Activating the `staging` Spring profile requires an operator-selected username, a password of **24–256 characters**, and the exact approved HTTPS origin. The username must be nonblank, at most 64 characters, with no colon or control characters; the password must be nonblank and contain no control characters. The origin has the form `https://service-name.onrender.com`, without a trailing slash, path, query, fragment, credentials or explicit port. Missing or malformed settings stop startup.

All application routes, including built assets and guest mutations, require this temporary HTTP Basic gate except **exactly `GET /api/health`**. Requests through an unexpected forwarded origin or non-HTTPS path get safe 403; missing/wrong admission credentials get safe 401. Gate responses use fixed JSON, `Cache-Control: no-store` and no credential logging. Direct R2 transfer remains a separate short-lived signed PUT and receives no application authorization header.

Render terminates HTTPS and forwards requests to the internal HTTP port. This profile trusts that approved proxy's forwarding; do not place it behind an arbitrary proxy or expose its internal port directly. Verify Render forwarding and the externally observed gate after deployment. The gate is for Ryan and explicitly approved synthetic testers. AUTH-01 couple sessions are a second, independent boundary: passing the staging gate gives no couple authority. The staging profile emits Secure session cookies. Reveal remains closed until a deliberate synthetic verification exercise; production abuse controls and reveal onboarding remain release work. Login throttling captures the connection peer before forwarded-header processing, so clients behind the approved proxy may share its peer limit. Keep staging credentials in Ryan's password manager, distribute them only to approved testers, and rotate them after testing. Avoid screenshots or copied request commands containing credentials.

## Approval and manual setup

Before provider provisioning/deployment, Ryan approves the application/database plans, recurring cost, separate hosted test resources, temporary tester access and concrete target. Local Docker verification and PR #15 merge were authorized on October 5. Creating files, building the local JAR or committing a PR does not grant approval to provision or deploy. The application stage and budget decision remain open until that approval.

After approval, Ryan performs or explicitly directs these steps:

1. Create a separate managed **PostgreSQL 17** instance in **Ohio**, with Basic compute, an explicitly selected **1 GB** disk and storage autoscaling disabled. Confirm the quote instead of accepting an unspecified storage default. Use a new test database, never the local development database or a future guest collection database. Disable external connections: the database's `ipAllowList` must be `[]`, not omitted or `0.0.0.0/0`. Same-region Render private connections remain available. See [Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting) and [database configuration](https://render.com/docs/blueprint-spec#database-fields).
2. Create a separate **Docker web service**, proposed name `kevinandmel-staging`, in the same Ohio region/account. Repository root is the build context; Dockerfile path is `./Dockerfile`. Select the approved application plan, one instance, no service autoscaling and **automatic deployment disabled**. Use only the explicitly reviewed branch/commit. Docker supplies the build and start commands; do not run Vite or the coming-soon helper here. See [Docker on Render](https://render.com/docs/docker).
3. Record its assigned provider HTTPS URL. Enter all settings below manually in the service environment before a successful deployment, then set `MEMORY_ARCHIVE_STAGING_ORIGIN` to that exact origin. If an initial creation attempt starts before the origin/secrets are supplied, the staging profile must fail closed; configure it and perform a deliberate manual deployment. Never remove the gate to make startup pass. See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).
4. Set the health-check path to `/api/health`. Confirm the selected commit and perform the approved **manual deployment**. Keep automatic deployment disabled while acceptance, memory sizing and migration/rollback safety are being proved. Do not create deployment hooks or attach the public wedding domain during this stage.
5. Confirm the gate and same-origin UI/API checks below. Then add this exact HTTPS origin to the private **test** R2 bucket CORS allowlist, preserving the approved local origins. Use only `PUT`, `GET`, `HEAD`, `Content-Type` and the approved exact origins; AUTH-02 playback needs browser GET. Use [private photo storage setup](private-photo-storage.md) for bucket privacy, token scope and lifecycle; a wildcard or public bucket is not a fix for CORS.

| Server environment variable | Required value / entry method |
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
| `MEMORY_ARCHIVE_STAGING_USERNAME` | Temporary operator/tester admission name |
| `MEMORY_ARCHIVE_STAGING_PASSWORD` | Unique password-manager-generated 24–256 character password, entered privately |
| `MEMORY_ARCHIVE_STORAGE_ENABLED` | `true` only after the private test bucket/token/CORS are ready |
| `MEMORY_ARCHIVE_R2_ENDPOINT` | `https://YOUR_32_HEX_ACCOUNT_ID.r2.cloudflarestorage.com`; no bucket suffix |
| `MEMORY_ARCHIVE_R2_BUCKET` | Approved synthetic-only test bucket name |
| `MEMORY_ARCHIVE_R2_ACCESS_KEY_ID` | Test-bucket-scoped Object Read & Write access key, entered privately |
| `MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY` | Corresponding secret, entered privately |
| `JAVA_TOOL_OPTIONS` | Only the separately approved and measured heap/exit configuration for the selected plan |

The staging DB settings are mandatory; there is no localhost fallback in that profile. A Render `postgresql://user:password@…` connection string is not a JDBC URL and must not be pasted into `MEMORY_ARCHIVE_DB_URL`. Render's internal TLS supports `sslmode=require`; do not claim certificate verification from that setting. Put no secret in `VITE_*`, Git, Notion, screenshots, commands with literal passwords, build arguments or copied logs. `.env` is not automatically loaded. Flyway applies the reviewed V1–V5 migrations to this separate test database at startup; never rewrite applied migrations or run a database reset against retained evidence.

## Hosted verification and phone acceptance

Record service/database names, region, approved plan, deployed commit, public origin, date and outcomes in OPS-01. Never record passwords, capability keys, signed links or guest content.

1. Before signing in, verify exact `GET /api/health` returns the minimal liveness JSON. `/`, its built assets, receipt and mutation routes must require admission; incorrect credentials and HTTP/unapproved-origin attempts must not reach the form/API. Sign in through HTTPS with the approved staging credentials and verify `/` serves the actual text/photo forms and `/api` remains on the same origin. The synthetic contract preview must not be in the production package.
2. Confirm a synthetic text contribution receives a committed private receipt, then repeat the same retained key/body and observe the same IDs. Confirm changed payload conflicts and uncertain-outcome retry preserves the original draft. Use the [text verification record](../api/v1/text-verification.md) rather than treating health as persistence proof.
3. On an actual iPhone Safari and an assigned Android Chrome device, upload supported synthetic JPEG/PNG/WebP files, test clear HEIC rejection, and check progress/result/error announcements and focus. A normal HTTPS origin is required for the checksum; never bypass certificate warnings. Keep the page open through deliberate retry. Follow the [MED-01 checklist](private-photo-storage.md#real-r2-and-phone-acceptance--partially-verified), including same-item response recovery, grant renewal, private default states and authenticated operator input/download/DB size/hash comparison.
4. Verify DB readiness privately with an approved admin client on Render's private network (`SELECT 1`, Flyway history, then the scoped synthetic record query). This runtime image does not bundle `psql`; do not enable public database access or add runtime tools merely to run the check. Actual successful text/photo transactions and current receipt retrieval also exercise the configured database. For storage readiness, use an actual test upload/finalize and authenticated original download/comparison, separate from DB proof.
5. Keep the same staging DB and bucket while manually restarting/redeploying the reviewed commit. Confirm unchanged receipt IDs/private states, same-key replay and byte-identical operator retrieval after the new process starts. Test unfinished same-item recovery with retained browser identity. Refreshing or choosing another file creates a new intent and is not replay evidence.
6. Observe trusted forwarding, resource memory, logs and safe failures on the deployed runtime. Public `/api/health` reports liveness only; it does not distinguish database/storage outages. Keep database diagnostics, object diagnostics and memory measurements in private operator evidence. Do not add public readiness detail or enable verbose SQL/request/SDK/access logging with bodies, keys, authorization or signed URLs. OPS monitoring/backup/restore and SEC abuse controls remain release work.

Update `docs/api/v1/photo-verification.md` and MED-01 with physical-device/provider results only when observed. OPS-01 stays unfinished until its actual HTTPS, environment separation, repeatable deployment, safe diagnostics and phone restart/redeployment criteria pass. This temporary gated stage is not a public wedding collection release.

## Rollback and recovery

Keep the reviewed previous commit, service environment and test data associations available before deploying. If the candidate fails, stop new synthetic submissions, keep the gate, and manually redeploy a compatible known-good commit to the same service/database/bucket. Preserve existing pending/complete intents and originals; do not rotate capability keys, delete objects, use `docker compose down --volumes` or repair Flyway history to make a deploy appear healthy. An older binary may not understand a newer schema, so check migration compatibility before rolling back code; fix forward when a rollback is unsafe. Applied migrations remain immutable.

After recovery, recheck admission, health, private receipts, original integrity and deliberate same-item retry before resuming. If secrets leaked, Ryan rotates the corresponding staged credential or bucket-scoped token in the approved provider settings and redeploys as needed; test retained data afterward. Preserve bucket lifecycle rules: the default bucket-wide **seven-day incomplete-multipart abort** rule does not delete completed originals. The separate **one-day completed-object deletion** rule must target **`staging/` only**, never `originals/` or an empty prefix. Cleanup of retained evidence or orphan originals needs a concrete approved candidate list; use the [photo cleanup procedure](private-photo-storage.md#cleanup-recovery-and-retention).

Moving `kevinandmel.com` from the coming-soon service is a later explicitly approved release operation with DNS/TLS checks and its own rollback. This staging procedure performs no domain change.

## Local evidence and remaining gates

October 5 local verification: **40 backend tests** pass with zero failures/errors/skips; **73 frontend tests**, lint, production Vite build and `build-app.sh` executable JAR packaging pass. The earlier MED-01 implementation baseline was 33 backend tests.

The actual JAR smoke check passes: unauthenticated health 200; admitted HTML/CSS/JS assets 200; missing admission 401; unapproved forwarded host and HTTP 403; preview, environment/source, missing-asset and unknown API paths 404 without HTML fallback; same-origin empty-text request 400 `VALIDATION_FAILED`; cross-origin mutation 403 `ORIGIN_INVALID`. The smoke helper's syntax and missing-Java cleanup behavior also pass. Storage was disabled and no submission/R2 writes occurred. The original local backend on 8080 and Vite on 5173 remain running; the smoke child used another port and stopped after its check. These checks do not establish hosted forwarding, real mobile browser admission, Docker runtime capacity or provider durability.

Still required: hosted capacity/budget approval; full-limit/overlapping photo memory measurements; provider provisioning/deployment; hosted DB and R2 settings; exact staging CORS and staging-only lifecycle; phones, authenticated original comparison and hosted restart/redeployment. Local image build/runtime/codec checks pass. No paid resources, provider changes, hosted deployment or domain changes occurred.

## Integrated authentication image — 2026-10-05

The AUTH branch passes **98 backend tests** against disposable PostgreSQL 17 and **73 frontend tests**, lint/build and zero-vulnerability audit. Its actual image `kevin-mel-wedding:auth-home-verify` (`sha256:4ae3d9faac1ef36495be7139c2b9f95dcb8b887767e220554c64f345f977d9d1`) passes the expanded isolated smoke: existing guest receipt/retry/restart checks, separate staging admission, real SQL/bcrypt couple login, Secure/HttpOnly/SameSite cookies, session-ID/CSRF rotation, logout, credential-version and disable revocation, loss of in-memory authentication on restart, and persisted five-attempt login cap. All owned temporary resources were removed. R2 remained disabled.

Historical PR #15 404 checks above preceded AUTH default-deny routing; current helpers expect safe anonymous `401 AUTH_REQUIRED` for unknown/excluded paths. Hosted HTTPS/proxy/cookie behavior, real R2 reads, full-limit capacity and physical devices remain unverified.
