# Kevin & Melanie's Living Memory Archive

A private home for preserving the couple's memories, beginning with contributions from their wedding guests.

Kevin and Melanie already know about the project and help shape it. Include them in product decisions and synthetic guest/inbox usability testing before the wedding; the October 31 handoff milestone is not a secrecy constraint. See the [project scope](docs/project-plan.md#current-baseline-and-product-scope) and [account-access procedure](docs/runbooks/account-access.md) for deliberate account activation.

## Start here

- **Choose or claim work:** use the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database for MVPs, status, ownership, dependencies, acceptance criteria, blockers, pull-request links, and evidence.
- **Understand the project:** open the [Notion project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) and read the [project plan](docs/project-plan.md) for scope, accepted architecture, module boundaries, and collaboration conventions.
- **Run the code:** use the local-development instructions below.

This is a learning project. Explain and agree on infrastructure, dependencies, and CI/CD before Ryan performs each hands-on setup step. Do not automatically create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy application changes without Ryan's explicit request.

## Local development

AUD-02/AUD-03 add gated voice recording/file upload, independently verified audio
originals, private playback/download and audio review/export/restore. Guest build
and server admission default off until the deferred phone/browser and real-R2
acceptance passes. Local backend checks now require FFmpeg/ffprobe. See the
[audio runbook](docs/runbooks/voice-memories.md) for controls and verification limits.

OPS-02 adds a console-only private note/photo archive-data export and isolated restore path, including current independent deletion-ledger replay and explicit unfinished/missing-original reporting. See the [operator recovery runbook](docs/runbooks/operator-recovery.md) and [verification boundaries](docs/api/v1/recovery-verification.md). Full database backups, hosted scheduling/location, independent recovery copies, operational RPO/RTO and audio remain acceptance work.

SEC-01 adds durable anonymous note/photo limits, bounded JSON, exact-size upload signing, original/staging reservations and an operator upload pause. The frontend preserves deliberate same-key recovery, and the inbox clears private content on lifecycle changes before rechecking access. See [guest protection verification](docs/api/v1/anonymous-protection-verification.md), [pause/capacity/cleanup](docs/runbooks/guest-protection.md), and [privacy review](docs/api/v1/privacy-verification.md). Actual hosted/provider/device and audio acceptance remain tracked release checks.

The application saves named or anonymous text messages privately in PostgreSQL and returns committed receipts with safe same-key retries. MED-01 adds a single-photo form and an opt-in private R2 upload/finalize path. Photo storage defaults disabled. Ryan's configured test bucket has passed desktop PNG operator comparison/restart/replay and scripted real-R2 JPEG/WebP upload, response recovery and grant restriction/expiry checks; physical-phone, additional operator comparison and bucket-settings acceptance are pending. Follow the [photo storage setup runbook](docs/runbooks/private-photo-storage.md) and [verification record](docs/api/v1/photo-verification.md). Use synthetic content during local development. Production collection still requires the security, operations, and release work tracked in Notion.

### Prerequisites

- **Java 25**, matching `java.version` in [backend/pom.xml](backend/pom.xml), with `JAVA_HOME` pointing to the JDK directory and Java on `PATH`.
- **Maven 3.9.16 through the checked-in wrapper.** A fresh checkout can run `./mvnw` from `backend/` without separately installing the project's Maven version.
- **Node.js 24.21.0 LTS** and npm for the shared frontend runtime, matching the root [.nvmrc](.nvmrc) and the engine declared in [frontend/package.json](frontend/package.json). [frontend/package-lock.json](frontend/package-lock.json) remains authoritative for resolved packages.
- Docker with Compose for the local PostgreSQL database used by Spring.
- FFmpeg and ffprobe on PATH for audio verification/tests, or the explicit paths
  described in the [audio runbook](docs/runbooks/voice-memories.md).

Check the terminal toolchain:

```sh
java -version
./backend/mvnw --version
node --version
npm --version
```

If Maven reports an invalid `JAVA_HOME`, point it at the installed JDK directory, reopen the terminal, and repeat the checks. IDE Java settings alone do not configure Maven's terminal environment.

### Run the application

Run the documented commands in Git Bash. Paths and examples below use Bash syntax.

Install frontend dependencies from the lockfile:

```sh
npm --prefix frontend ci
```

Start PostgreSQL from the repository root:

```sh
docker compose up -d postgres
```

Start Spring in one terminal - cd to backend:

```sh
./mvnw spring-boot:run
```

Start Vite in another - cd to frontend:

```sh
npm run dev
```

Open the Local URL Vite prints, normally [localhost:5173](http://localhost:5173/). The [Vite configuration](frontend/vite.config.js) forwards `/api` requests to Spring at [localhost:8080](http://localhost:8080). This proxy is for development. The combined application package serves built frontend assets and `/api` through Spring on one origin; local packaging/access checks pass, and hosted staging still awaits approval and setup. Stop each local process with Ctrl+C.

### Prepare the full application for staging

Ryan retained Render for Spring/PostgreSQL and Cloudflare R2. `bash scripts/build-app.sh` packages the frontend into the executable Spring JAR. The Docker image and Linux JPEG/PNG/WebP codecs are locally verified. `node scripts/smoke-container.mjs` checks staging access, packaged assets, committed private text, concurrency, discarded-response recovery and restart against its own disposable PostgreSQL 17 database, then removes its resources. R2 is disabled during that smoke. The [staging runbook](docs/runbooks/staging-deployment.md) owns exact commands, private settings, capacity/budget approval, provider setup and phone/redeployment proof. The integrated AUTH baseline passes 98 backend tests; the review/audio follow-up passes 88 frontend tests, lint and build. Five 50 MP/10 MB synthetic photo cases pass locally in a 2 GB container with a 1536 MiB Java heap, peaking at 1.680 GiB. The former 1 GB heap fails on lossy WebP. This measured staging candidate still requires budget approval and hosted HTTPS/R2 memory, session and device checks. The coming-soon domain stays on its static service.

### Current API behavior

The [v1 API contract](docs/api/v1/README.md) is authoritative. The development proxy preserves the browser Host header for same-origin submission checks. The wedding form uses the durable real adapter; synthetic preview scenarios use an isolated mock.

| Request | Current response |
|---|---|
| GET /api/health | HTTP 200 with status ok; not a database readiness check |
| POST /api/contributions | HTTP 201 after commit, HTTP 200 for an equivalent same-key replay; IDs/states only |
| GET /api/contributions/{contributionId}/receipt | HTTP 200 with current states when both ID and retry key match; otherwise safe 404 |
| POST /api/contributions with PHOTO items | HTTP 201 committed intent / 200 equivalent replay; initially PENDING |
| POST /api/contributions/{id}/memories/{memoryId}/upload-grants | HTTP 201 with a five-minute HTTPS PUT permission for a temporary object |
| POST /api/contributions/{id}/memories/{memoryId}/finalize | HTTP 200 receipt after verified original + DB commit; COMPLETE only when all items are saved |
| GET /api/session | HTTP 200 with anonymous/couple session state and a CSRF token |
| POST /api/session | HTTP 200 for an enabled, revealed COUPLE login; rotates session ID and CSRF token |
| DELETE /api/session | HTTP 204 after session invalidation and cookie clearing; requires current CSRF token |
| GET /api/memories/{memoryId}/playback | HTTP 200 with an HTTPS GET link for an eligible verified PHOTO/AUDIO original; requires a current revealed COUPLE session |
| Disabled/unavailable photo storage | HTTP 503 MEDIA_UNAVAILABLE; text remains independent |
| Invalid uploaded media | HTTP 422 INVALID_MEDIA and a committed FAILED item; retry remains bound to the original intent |
| Invalid text or retry key | HTTP 400 VALIDATION_FAILED with safe field errors where applicable |
| Missing/unsupported contract version | HTTP 400 UNSUPPORTED_CONTRACT |
| Same key with changed normalized content | HTTP 409 IDEMPOTENCY_CONFLICT |
| Database/commit failure | HTTP 503 SERVICE_UNAVAILABLE; never a false saved acknowledgment |

Send X-Api-Contract: 1 and a random UUID-v4 Idempotency-Key. The server canonicalizes UUID case. Names are optional (blank becomes null), at most 100 raw UTF-16 units; messages are required/nonblank, at most 5,000 raw units. Outer whitespace follows JavaScript String.trim(), including NBSP; internal whitespace is retained. NUL and unpaired surrogates are rejected. Unknown fields and wrong types are rejected. State/event/IDs belong to the server.

With the backend running, inspect synthetic responses from Git Bash. Generate the key once and retain it for retries of this exact message:

~~~sh
submission_key=$(node -e 'process.stdout.write(crypto.randomUUID())')
curl --fail http://localhost:8080/api/health
curl --fail-with-body --request POST http://localhost:8080/api/contributions \
  --header 'Content-Type: application/json' \
  --header 'X-Api-Contract: 1' \
  --header "Idempotency-Key: $submission_key" \
  --data '{"guestName":"Test Guest","message":"Local test message"}'
~~~

Use the same POST/body/key after a lost response; do not generate another key. If the returned contributionId is known, GET its receipt with the same two headers. Receipts contain no guest content or private retrieval links, and responses use Cache-Control: no-store.

The form now lets guests write, review, edit, send, and finish a note. It shows field errors beside the affected input and confirms saved only after a valid complete receipt. It retains the original draft/key for deliberate retry, locks editing while the outcome is uncertain, bounds a stalled request or response body to 30 seconds, honors Retry-After, and requires **Write another note** before creating a new logical submission. Retry state is in memory: keep the page open until confirmed; refresh/tab closure does not preserve it. Guest payloads and errors are not logged to the browser console. Photo selections are not included in text requests. See the [MSG-02 verification notes](docs/product/msg02-verification.md) for browser checks and device coverage still needed.

The independent **Share photos** form accepts one to five original JPEG/PNG/WebP files, up to 10 MB each, with one optional name and a caption per photo. It preserves the original files, SHA-256 checksums, ordered item IDs and one contribution retry key until confirmed. Each row shows preparation, upload, verification, saved or failed status; the result reports the confirmed count accurately when only part of the batch succeeds. A successful PUT alone never produces saved confirmation. Deliberate retry checks the receipt and retained grant before sending bytes again, skips saved siblings and can target a single unsaved photo. Metadata stays locked while the result is uncertain. A known verification rejection permits retry of the same original bytes or an explicit new batch once every unsaved item is known rejected. Keep the page open until confirmed; refresh/tab closure does not retain files or retry state. HEIC remains unavailable; audio uses its separate admission gate. See [MED-02 verification](docs/product/med02-verification.md) for timeout/recovery behavior and the deferred phone/provider checks.

The guest shell now starts with an invitation and one memory choice at a time. Notes and photos both support review, **Done** and **Share another memory**; audio is hidden unless its build gate is enabled. Back preserves visited forms and drafts, while submission/uncertain recovery locks navigation. A saved result never silently becomes a new submission. The note request has a 30-second deadline and retains its original key after timeout. See [UX-01 verification](docs/product/ux01-verification.md) for the behavior and remaining device/release checks.

### Private account access

AUTH-01 implements the server session API, PostgreSQL accounts with bcrypt password hashes, CSRF/session rotation, login throttling, and account-version checks that revoke sessions after recovery or disablement. Reveal is closed by default (`MEMORY_ARCHIVE_REVEALED=false`), and the default environment is `local`. Only enabled `COUPLE` accounts can sign in when reveal is open; production permits separate `kevin` and `melanie` identities. Operator/developer accounts receive no couple access, and developer accounts are restricted to local/staging.

Use the console-only [account provisioning and recovery runbook](docs/runbooks/account-access.md) for synthetic local accounts and later reveal onboarding. Passwords are read through hidden terminal prompts; there are no public signup/recovery endpoints. Production requires its Secure-cookie profile, an explicit HTTPS public origin, and a private login-throttle secret. See [AUTH-01 verification](docs/api/v1/auth-verification.md) for evidence and remaining limits. INB-01 implements sign-in and a read-only private note/photo inbox at `/?view=inbox`, using the existing current-account and reveal gates. INB-02 adds private Keep/Archive/Restore and confirmed Delete, a 30-day recovery window, revision-conflict recovery and independent-ledger-backed retention maintenance. See [review verification](docs/api/v1/review-verification.md) and the [deletion/recovery runbook](docs/runbooks/deletion-and-recovery.md). Audio playback is implemented with current couple authority; real production onboarding remains later work; no real couple credentials have been created or sent.

AUTH-02 adds `GET /api/memories/{memoryId}/playback` for eligible verified PHOTO originals. Every issuance requires a current enabled couple account and an open reveal gate. The server checks the private original's size and MIME through authenticated HEAD, then signs GET for that single object over the R2 S3 HTTPS endpoint for at most 300 seconds. The response reports the signature's actual expiry. Unfinished/failed uploads, TEXT, unfinished AUDIO, missing or wrong-event memories, and DELETE items return safe 404; an eligible original that is missing or unavailable at storage returns 503 MEDIA_UNAVAILABLE. INB-01 adds authorized `GET /api/memories` pagination and `GET /api/memories/{memoryId}` details for notes/verified photos; INB-02 implements conditional `PATCH /api/memories/{memoryId}/review` and recoverable deleted-item browsing. See [AUTH-02 verification](docs/api/v1/authorization-verification.md) and [inbox verification](docs/api/v1/inbox-verification.md).

A signed playback URL is a reusable bearer permission: anyone who obtains it can download that object until its own expiry. Logout, account recovery/disablement, and closing reveal prevent new issuance; they do not revoke an existing URL or an in-progress download. `no-store` does not erase downloaded bytes. R2 originals and staging remain private, with public custom domains and `r2.dev` disabled. The inbox fetches originals without application credentials or referrers, verifies size/MIME/SHA-256, and creates a temporary Blob URL for preview/original download. It revokes owned URLs on navigation/sign-out/disposal and never persists or logs signed permissions. Existing real-R2 evidence and remaining actual-browser/device/hosted checks are retained in the [home acceptance checklist](docs/runbooks/private-photo-storage.md#authenticated-photo-playback--auth-02-home-acceptance); this implementation adds no new provider pass.

### Checks

The [AUD-01 feasibility probe](docs/product/aud01-verification.md) is available at `/staging/audio` only with the staging profile and its temporary admission gate. It keeps recordings local, checks actual bytes/duration, and exports technical results or an explicitly selected synthetic clip for manual cross-device replay. It performs no audio upload and is absent from the normal Vite guest build. [D-03/D-04](docs/decisions/contribution-and-audio-limits.md) retain their actual-device, final-format/server-validation and shared-network rate-policy gates. Ryan deferred further device/audio checks on October 9 while keeping physical Android acceptance pending.

```sh
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
./backend/mvnw -f backend/pom.xml test
```

These run ESLint, frontend API-contract tests (Node's built-in runner, no new dependency), the production build into `frontend/dist/`, and backend tests. [CI](.github/workflows/ci.yml) runs parallel backend/frontend jobs for every PR and push to `main`: Java 25/Maven backend tests and Node from `.nvmrc` with lockfile install, lint, build, and frontend tests. Backend database tests use Testcontainers to start disposable PostgreSQL 17, apply Flyway migrations, exercise persistence, and discard the test database. Docker Desktop must run locally; GitHub-hosted runners provide CI's Docker environment.

CI caches the three required test images in a Docker archive using GitHub Actions. The exact cache key includes the OS, architecture, preparation script and UTC week; no stale-key fallback is used. A successful `main` run seeds a cache other branches can restore. On a cache miss, preparation pulls PostgreSQL and Alpine from [Docker's official ECR Public distribution](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/) and Ryuk from [Testcontainers' official GHCR package](https://github.com/testcontainers/moby-ryuk/pkgs/container/ryuk), with bounded retries and Docker Hub fallbacks, without registry credentials. PostgreSQL and Alpine retain the local names expected by the unchanged tests. Preparation has a five-minute deadline and must pass before Maven runs, so registry outages fail visibly instead of repeatedly stalling database tests. The image archive is saved before application tests, while Ryuk cleanup and startup checks stay enabled. Recheck the Alpine/Ryuk helper versions when upgrading Testcontainers.

For synthetic failure/retry demonstrations, start Vite and open [the contract preview](http://localhost:5173/contract-preview.html) using Vite's actual port. It needs no backend. The clearly labeled mock is isolated from the wedding form and excluded from the normal production build. Refreshing clears its state; nothing entered there is saved.

**September 13 verification:** Ryan confirmed Java `25.0.3`, Maven `3.9.15`, Node `25.2.1`, npm `11.6.2`, and NVM for Windows `1.2.2` on his machine. The application has started locally, and the frontend lint/build checks passed during MED-02 verification. The repository now pins Maven `3.9.16` through the wrapper and Node `24.21.0` LTS through `.nvmrc`. Ryan switched to Node `24.21.0`; `npm ci`, frontend lint, and the production build completed successfully. The wrapper also ran the backend test suite successfully: one test passed with no failures or errors. Ryan explicitly waived the two-collaborator fresh-checkout criterion on September 13, completing FND-01.

**September 27 CI verification:** PR #5 passed the backend and frontend jobs. A separate disposable pull request introduced an intentional frontend syntax error; the backend job stayed green, ESLint failed with exit code 1, and the frontend build was correctly prevented from running. The disposable pull request was closed without merging.

### Local PostgreSQL

[compose.yaml](compose.yaml) defines the local PostgreSQL service, credentials, published port, named data volume, and health check. Spring reads its datasource settings from [application.properties](backend/src/main/resources/application.properties). Flyway applies the versioned migrations in [backend/src/main/resources/db/migration/](backend/src/main/resources/db/migration/) when the application starts.

Start and inspect PostgreSQL from the repository root:

```sh
docker compose up -d postgres
docker compose ps postgres
docker compose port postgres 5432
docker compose exec postgres pg_isready \
  -U memory_archive \
  -d memory_archive
```

The default JDBC connection is `jdbc:postgresql://127.0.0.1:5433/memory_archive`. The application accepts `MEMORY_ARCHIVE_DB_URL`, `MEMORY_ARCHIVE_DB_USERNAME`, and `MEMORY_ARCHIVE_DB_PASSWORD` environment-variable overrides. The saved Compose credentials are for local development only.

Flyway records every successfully applied migration in `flyway_schema_history`. Inspect that history with:

```sh
docker compose exec postgres psql \
  -U memory_archive \
  -d memory_archive \
  -c 'SELECT installed_rank, version, description, success FROM flyway_schema_history ORDER BY installed_rank;'
```

After a migration has been applied, treat its SQL file as immutable. Make later schema changes in a new migration with the next unused version. This lets collaborators receive the same schema changes through Git without sharing one physical database.

Stop PostgreSQL while preserving its named data volume:

```sh
docker compose down
```

To deliberately delete all local database data and recreate an empty database, run:

```sh
docker compose down --volumes
docker compose up -d postgres
```

The `--volumes` command permanently deletes this project's local PostgreSQL data. The next Spring startup rebuilds the schema by applying the committed Flyway migrations.

V2 adds an immutable SHA-256 creation fingerprint without rewriting V1. It backfills normalized single-text V1 envelopes without changing their stored content or IDs; other legacy keys remain reserved. PostgreSQL unique-key arbitration and one transaction prevent duplicate memories and orphan envelopes. Tests cover fresh schema, populated V1 upgrade, migration rerun, real HTTP concurrency, insert/commit rollback, database outage, and application restart against the same test database. See [MSG-01 verification](docs/api/v1/text-verification.md) for the evidence and remaining boundaries.

V3 adds media client IDs, captions/order, expected integrity claims, and expiring upload grants. Browser PUTs target temporary staging keys; the server verifies and publishes exact bytes to a separate private original before committing UPLOADED. Applied V1/V2 remain unchanged. AWS SDK Java v2 and TwelveMonkeys WebP were explicitly approved for MED-01. See [photo verification](docs/api/v1/photo-verification.md) and the [R2 setup/cleanup runbook](docs/runbooks/private-photo-storage.md) before enabling storage.

V4 adds disabled-by-default private accounts and credential versions; V5 adds durable login-throttle counters. AUTH-01 uses the approved Spring Security runtime and test starters, with versions governed by the POM. Account creation, recovery, and enable/disable operations stay in the [console runbook](docs/runbooks/account-access.md); earlier migrations remain unchanged.

## Repository navigation

| Location | Responsibility |
|---|---|
| [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) | MVPs, decisions, status, ownership, dependencies, acceptance criteria, and evidence |
| [frontend/](frontend/) | React/Vite app; see its [source map](frontend/README.md) |
| [backend/src/main/java/com/kevinmel/archive/](backend/src/main/java/com/kevinmel/archive/) | Spring app and contribution, media/storage, health, and web packages |
| [backend/src/test/](backend/src/test/) | Backend tests |
| [docs/](docs/) | Architecture, API contracts, decision records, and operational runbooks |
| [Dockerfile](Dockerfile), [scripts/build-app.sh](scripts/build-app.sh), [scripts/smoke-packaged-app.mjs](scripts/smoke-packaged-app.mjs), [scripts/smoke-container.mjs](scripts/smoke-container.mjs) | Verified combined image and local JAR/container smoke checks; follow the [staging runbook](docs/runbooks/staging-deployment.md) before provider setup |
| [coming-soon/](coming-soon/) | Standalone temporary landing page, deployed on Render with domain HTTPS on October 4; see the [deployment record](docs/runbooks/coming-soon.md). This service does not host the React/Spring photo app. |
| [compose.yaml](compose.yaml) | Local database configuration |
| [docs/project-plan.md](docs/project-plan.md) | Product scope, accepted architecture, and collaboration conventions |
| [Feature tracker.md](<Feature tracker.md>) | Migration pointer to Notion; do not maintain task status here |

Work in small, explained increments. Claim work in Notion and use `feature/<description>` for new feature branches. The current branch does not assign tasks. Ryan granted standing autonomous project authority on October 9: implement, verify, commit, push, open pull requests and merge after review and passing checks. Keep the earlier device/audio testing and paid-hosting deferrals in force until Ryan changes them.

## Where information belongs

| Information | Authoritative location |
|---|---|
| Introduction and setup, run, and check instructions | This README |
| Scope, accepted architecture, module boundaries, and collaboration conventions | [Project plan](docs/project-plan.md) |
| MVPs, decisions, backlog, status, ownership, dependencies, acceptance criteria, blockers, and evidence | [Notion issue database](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) |
| Dependency versions and executable build/test configuration | [POM](backend/pom.xml), [Maven wrapper properties](backend/.mvn/wrapper/maven-wrapper.properties), [frontend manifest](frontend/package.json), [lockfile](frontend/package-lock.json), and [.nvmrc](.nvmrc) |
| Detailed API contracts, architecture rationale, and operations | The matching folder under [docs/](docs/) and the relevant Notion issue |

Update information in its authoritative location and link to it elsewhere. When a topic moves into a dedicated document, replace its old explanation with a short summary and link instead of maintaining two copies.
