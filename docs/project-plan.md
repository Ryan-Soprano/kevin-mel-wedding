# Kevin & Melanie's Living Memory Archive — project plan

Last updated: 2026-10-05 · Collaborators: Ryan and Kade · Wedding: **October 24, 2026**

This file describes product scope, accepted architecture, module boundaries, and collaboration conventions. The active Jira-style work queue is the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database. Its parent [project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) explains the workflow.

For the project introduction and local setup, run, and test instructions, use the [root README](../README.md). Keep architecture here, task progress in Notion, and executable dependency versions in the project manifests. Link between them instead of copying changing details.

## Current baseline and product scope

Reviewed the active repository on September 13 at `F:\Projects\Kevin-Mel-Wedding-Site\kevin-mel-wedding`. The shared remote is [Ryan-Soprano/kevin-mel-wedding](https://github.com/Ryan-Soprano/kevin-mel-wedding).

The application saves private named/anonymous text through the public v1 endpoint and wedding form, with committed receipts and database-backed same-key retries. DAT-01 supplied V1; MSG-01 added V2 fingerprints and HTTP concurrency/rollback/restart checks. MSG-02 adds the compose/review/result flow. MED-01 adds V3 photo intents/grants and verified private original finalization, plus a minimal single-photo form. Local tests pass; storage defaults disabled, and Ryan's configured private R2 test bucket has passed desktop PNG operator comparison/restart/replay and scripted JPEG/WebP upload, recovery and grant checks. A combined Spring/frontend package and temporary staging gate pass local JAR and Docker checks, including Linux codec boundaries and isolated PostgreSQL text recovery/restart; full-limit capacity, hosted setup/deployment and phones still need approval/evidence. Physical-phone and remaining operator/bucket-setting acceptance, MED-02 batch polish, audio, couple authentication/inbox, production operations, and screen-reader/device release verification remain work in Notion. See [photo verification](api/v1/photo-verification.md), [setup/cleanup runbook](runbooks/private-photo-storage.md), and [full-app staging procedure](runbooks/staging-deployment.md).

The agreed product scope is:

- The wedding release collects **written messages, photos, and audio messages** from approximately **60–100 guests**, without guest accounts. Audio remains required unless Ryan explicitly changes that scope.
- Guest names are optional. Every durable contribution enters a private review inbox as `PENDING` and `COUPLE_ONLY`; nothing is automatically published.
- Kevin and Melanie are the intended private application users. They will discover the project after the wedding. Do not send invitations or notifications before the reveal.
- Preserve original media and useful metadata. Privacy, reliable collection, recovery, export, and long-term ownership are core requirements. Ryan permanently owns and operates the infrastructure; Kevin and Melanie alone approve or reject submissions and decide what is published.
- This is a surprise and a potential lifelong archive. A general event website builder, RSVP system, travel planner, or commercial platform is outside committed scope.
- The learning stack is React with JavaScript and Java with Spring Boot and Maven.

## Working with the Notion tracker

Use [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) to choose and claim work. The database contains 50 implementation tasks and eight decision issues, grouped into MVP 0 through MVP 4 plus the nice-to-have backlog.

- Start with **Issue Board** for daily work and **Wedding MVP** for the release path.
- Use **No Prerequisites** to find Todo items with no prerequisites. A task whose prerequisites are already Done may also be ready, so check its `Blocked by` relation.
- Use **Decisions** for unresolved product or architecture choices and **Backlog** for deferred work.
- Before starting, set Assignee, Reviewer, Status, and Branch or PR. Read the objective, dependencies, and acceptance criteria on the issue page.
- Record the current obstacle in Blocker. Add dated Evidence before moving an issue to Review or Done.
- Keep assignees blank until someone claims the work. Ryan may claim any issue. Kade may claim development work but has no production operations, backup, moderation, or publication role.

### Issue key legend

| Code | Area |
|---|---|
| `D` | Decision |
| `FND` | Foundation and developer workflow |
| `API` | API contracts |
| `DAT` | Data model, database, and persistence |
| `MSG` | Written messages |
| `MED` | Photos and media uploads |
| `AUD` | Audio recording and uploads |
| `UX` | Guest experience and accessibility |
| `AUTH` | Couple authentication and account access |
| `INB` | Private review inbox and lifecycle actions |
| `SEC` | Security, privacy, and abuse controls |
| `OPS` | Hosting, storage, backups, monitoring, and operations |
| `QA` | Integrated testing and release verification |
| `REL` | Wedding release and event operations |
| `REV` | Reveal, couple onboarding, and portable archive delivery |
| `ARC` | Ongoing private archive and scrapbook |
| `NTH` | Nice-to-have backlog |

## Tech stack and decisions

The accepted baseline separates the intended architecture from what is already implemented. Manifests and the lockfile remain authoritative for executable versions.

| Layer | Accepted baseline | Current implementation / next boundary |
|---|---|---|
| Frontend | React 19, JavaScript, Vite; **Node 24.21.0 LTS** team runtime | Durable text compose/review/result and single-photo submission use the real v1 adapter. Each retains its own draft/key for safe manual retries. The existing grouped-photo selection prototype remains for MED-02 batch integration. |
| Backend | **Java 25**, Spring Boot 4.1.1, Spring MVC, Maven 3.9.16 wrapper | Health, durable text/photo intent creation, receipt reconciliation, and PHOTO grants/finalization are implemented. MED-01 adds approved AWS SDK v2 and TwelveMonkeys WebP dependencies; versions live in the POM. |
| Architecture | Modular monolith. Vite runs separately in development; one Spring application serves the built frontend and `/api` in production. | Combined JAR and actual Docker image asset/API/gate checks pass locally. The staging profile requires private test DB settings, exact HTTPS origin and temporary tester admission; hosted deployment and full-limit photo capacity remain pending. |
| API | REST/JSON under `/api`, with stable error bodies and durable receipt semantics | Health, TEXT/PHOTO POST, generic capability-bound receipt GET, PHOTO grants and finalize exist. [v1 contract](api/v1/README.md) governs receipts/replay/errors; AUDIO/auth/inbox/review/playback server routes remain pending. |
| Database | PostgreSQL with Spring `JdbcClient` and versioned Flyway SQL migrations | PostgreSQL 17 runs through Compose. V1 defines envelopes/memories/assets; V2 adds immutable text fingerprints; V3 adds PHOTO item IDs, captions/order, expected claims and upload grants. Applied migrations remain unchanged. |
| Domain model | Contribution envelope groups individually reviewable Memory records and MediaAsset metadata | The V1 schema enforces `PENDING` and `COUPLE_ONLY` defaults, relationships, lifecycle values, integrity metadata, and retry uniqueness. KEEP stays private; ARCHIVED is recoverable; DELETE follows a reversible retention policy. |
| Media | Private Cloudflare R2 object storage for original photos and audio; metadata in PostgreSQL | Opt-in PHOTO storage grants only temporary keys, verifies bounded actual bytes/hash/MIME, then publishes exact bytes to a separate private original before UPLOADED commit. Real-R2 desktop PNG operator comparison/restart/replay and scripted JPEG/WebP upload/recovery/grant checks are verified; physical-phone, additional operator retrieval and bucket settings are pending. Photos allow five 10 MB JPEG/PNG/WebP items, at most 50 million pixels/20,000 per dimension; audio/HEIC remain later evidence-gated work. |
| Authentication | Spring Security with server-side sessions and strict role separation | Couple authentication is not implemented in this baseline. A temporary operator Basic gate protects the staging profile only. Kevin and Melanie alone receive moderation/publication authority at reveal; Ryan retains infrastructure operations; Kade remains development-only. |
| Testing | Spring MVC/JUnit backend tests, ESLint/build checks, focused frontend and real-device coverage | Text/photo HTTP/PostgreSQL concurrency, rollback, upgrade, outage and restart coverage; actual image decoders; signed S3 fixture IO; Node contract/coordinator tests; synthetic browser checks. The built Linux image passes nine codec checks and isolated PostgreSQL TEXT concurrency/lost-response/restart checks. Real-R2 desktop PNG operator comparison/restart/replay and scripted JPEG/WebP recovery/grant checks pass; additional operator retrieval, bucket settings, phones and screen readers remain tracked acceptance work. |
| Delivery | GitHub feature branches and pull requests into `main`; new features use `feature/<description>` | GitHub Actions runs parallel backend tests and frontend install/lint/build/test checks for pull requests and pushes to `main`. The temporary coming-soon static page has deployed domain DNS/HTTPS. Full-app packaging is locally verified; approved manual staging deployment, production hosting and deployment automation remain pending. |
| Operations | Render application/PostgreSQL in Ohio, private Cloudflare R2, Namecheap domain registration with planned Cloudflare DNS, and Ryan-owned operations | Ryan reconfirmed retaining this stack on October 5. Domain/temporary-site DNS/HTTPS and a private R2 test bucket exist. The [staging runbook](runbooks/staging-deployment.md) prepares separate test resources and a gated provider URL; application plan/budget, full-contract memory sufficiency, provisioning, hosted verification, monitoring and restore proof remain open. |

No microservices, Kubernetes, Redis, event bus, or second backend is justified by the current requirements. Revisit only for a documented need.

The standalone [temporary landing page](runbooks/coming-soon.md) deployed on Render with domain HTTPS on October 4 and includes the single Grand Central selfie approved by Ryan. It does not deploy the React/Spring application or provide collection features. The separate wedding-day QR gallery may use all supplied image files, rather than the initial shortlist; Ryan will confirm Kevin's preference before that gallery is implemented. Deliberately chosen public gallery photos are separate from private guest contributions.

### Accepted decisions

The full rationale and acceptance notes live in the Notion **Decisions** view.

- **D-01 — Technical baseline:** React/JavaScript/Vite, Node 24 LTS, Java 25, Spring Boot/MVC/Maven, PostgreSQL with JdbcClient and Flyway, a modular monolith, server sessions, REST/JSON under `/api`, and pull-request delivery.
- **D-02 — Providers and domain:** Render for the application and managed PostgreSQL in Ohio, private Cloudflare R2 for media, and planned Cloudflare DNS; Ryan explicitly retained this stack on October 5 after considering an all-Cloudflare alternative. Kevin and Melanie selected `kevinandmel.com`; Ryan confirmed its purchase through Namecheap on October 4, 2026, superseding the Cloudflare Registrar choice. The temporary landing page now uses Namecheap DNS and Render HTTPS. Full-app staging/deployment remains [OPS-01](https://app.notion.com/p/3dad9739c6bc8162b3fcd36e61269c33) work and begins on a separate provider URL using the [staging runbook](runbooks/staging-deployment.md); Cloudflare DNS is still a planned migration. Verify the registrar's contact-email verification, account security, auto-renewal, and actual renewal price before deployment.
- **D-03 — Contribution limits:** name 100 characters, message 5,000, caption 500, five photos at 10 MB each, and one two-minute/25 MB audio item. HEIC/HEIF, audio formats, and shared-network rate limits remain subject to test evidence.
- **D-04 — Audio experience:** browser recording is primary; existing-file upload and text are fallbacks. Ryan has an iPhone; the Android tester remains unassigned.
- **D-05 — Access and ownership:** couple credentials wait until reveal. Ryan permanently owns and solely operates infrastructure; Kevin and Melanie alone moderate submissions and decide publication; Kade is development-only.
- **D-06 — Contribution, memory, media, and lifecycle model:** preserve contribution grouping while reviewing items individually; new items are private and pending; keep/archive/delete and publication are separate states.
- **D-07 — Budget and recovery:** comfortable baseline $15/month plus domain, warning at $25, intervention at $40, conservative original-media ceiling 7.5 GB, wedding database RPO five minutes/RTO one hour, and 30-day contribution-bearing backup retention.
- **D-08 — Schedule and operators:** rehearsal October 17, freeze October 20, wedding October 24, and reveal/collection-close target October 31. Ryan is the sole privileged wedding operator.
- Learning and provisioning guardrail: explain each component and tradeoff, agree on the choice, give Ryan a small hands-on setup task, then review it. Do not provision infrastructure or deploy unless Ryan explicitly requests it.

### Evidence-gated decisions

The product choices are made. These records remain blocked until their required tests produce evidence.

| ID | Remaining evidence |
|---|---|
| D-03 | HEIC/HEIF behavior, actual mobile audio formats, and shared-network rate-limit behavior. |
| D-04 | Browser recording on actual iPhone Safari and Android Chrome over HTTPS, including failure and fallback behavior. |

Open the [Notion issue database](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) and select the **Decisions** view for full rationale and evidence.

## Module boundaries and collaboration

Feature directories are scaffolded so the intended boundaries remain visible as the project grows. Add implementation files only for the relevant Notion issue. Backend package paths are relative to `backend/src/main/java/com/kevinandmelanie/memoryarchive/`.

| Module | Responsibility / proposed location | Primary handoff |
|---|---|---|
| Guest experience | `frontend/src/features/contribution/` and `frontend/src/features/media/` | API examples, validation limits, upload-state contract |
| Private archive UI | Login, inbox, review, and later albums under `frontend/src/features/archive/` | Kevin/Melanie-only moderation and publication, auth/session behavior, paginated inbox, media access |
| Shared UI | Global tokens and styles under `frontend/src/styles/`; reusable code under `frontend/src/shared/` | Coordinate shared component changes before parallel edits |
| Submission API | Current `contribution/` controller, request, and service; validation advice in `web/` | Contract, idempotency, and persistence model |
| Media | `media/` for upload authorization, storage, finalization, and cleanup | Upload intent/finalize API and failure behavior |
| Identity | `security/` for accounts, sessions, and authorization | Login state, CSRF handling, and separation of infrastructure and couple permissions |
| Review | `review/` for inbox queries and lifecycle changes | Review actions never imply public visibility |
| Data | Schema migrations under `backend/src/main/resources/db/migration/` and queries in focused feature packages | One coordinated migration sequence |
| Platform | Root `compose.yaml`, locally verified `Dockerfile`, packaging/smoke helpers under `scripts/`; operational documentation under `docs/runbooks/` | [Gated HTTPS staging](runbooks/staging-deployment.md), Render/R2 environments, deployment, backup and restore procedures owned by Ryan |
| Contracts/docs | README for setup; this plan for architecture; Notion for issues; `docs/api/`, `docs/decisions/`, and `docs/runbooks/` for durable repository documentation | One authoritative location for each topic |

The [v1 API contract](api/v1/README.md) and matching adapters support durable text and the MED-01 photo implementation. Complete real private R2/phone acceptance before closing MED-01; MED-02 then integrates the existing batch picker with selective item retry. Run the audio feasibility spike early on Ryan's iPhone and an identified Android device; final audio formats and device limits remain provisional until evidence is recorded.

**Shared-file etiquette:** discuss changes to build files, lockfiles, shared styles/components, API contracts, migrations, and deployment configuration before editing them simultaneously. New feature branches use `feature/<description>`, for example `feature/photo-previews` or `feature/persist-messages`. Preserve existing branches. Keep a pull request focused on one Notion issue or a small explicitly linked set, and add its URL to the issue.

## Material change log

| Date | Change | Reason / decision |
|---|---|---|
| 2026-09-13 | Created the detailed project plan from the brief and repository review | Established product scope, architecture boundaries, release needs, and collaboration rules. |
| 2026-09-13 | Added README ownership rules and reconciled the active repository | Kept setup instructions separate from planning and recorded the prototype's actual limits. |
| 2026-09-13 | Adopted `feature/<description>` for new feature branches | Ryan selected a tool-independent branch convention. |
| 2026-09-13 | Extracted MVP and feature checklists from this plan | Prepared task-level work for a dedicated tracker. |
| 2026-09-13 | Migrated 50 tasks and eight decisions to Notion | Notion now owns status, assignment, dependencies, acceptance criteria, dates, blockers, pull requests, and evidence. The local feature-tracker file is only a migration pointer. |
| 2026-09-13 | Accepted the technical baseline and recorded unresolved provider choices as learning issues | Keeps architecture clear while preserving Ryan's hands-on path from local setup through production CI/CD. |
| 2026-09-13 | Recorded provider, budget, recovery, schedule, authority, media-limit, and audio-fallback decisions; pinned Maven and Node | Reconciled the plan with the current tracker and clarified permanent ownership and application authority. |
| 2026-09-27 | Recorded the completed DAT-01 persistence baseline and began FND-03 experience flows | Kept architecture documentation aligned with the merged PostgreSQL work and separated target wireframes from wedding-ready capabilities. |
| 2026-09-27 | Added the FND-02 walking-skeleton CI workflow and verified its failure gate | Pull requests and pushes to `main` now run parallel backend and frontend checks; a disposable pull request proved that an intentional syntax error blocks the frontend job. |
| 2026-10-03 | Defined API v1 with matching real/mock adapters, synthetic preview, and frontend contract tests | Supports separate implementation without treating prototype echoes, transferred bytes, or mock results as durable production storage. |
| 2026-10-04 | Hardened archive-response decoding and mock session rotation after API-01 review | Unfinished media stays in receipts rather than the private inbox; repeated mock sign-in/sign-out cannot revive stale CSRF tokens. Regression tests cover both boundaries. |
| 2026-10-04 | Implemented MSG-01 durable text creation/reconciliation and retained form retry identity | New V2 fingerprints preserve applied V1; HTTP/database tests verify concurrency, rollback, upgrade, outage and restart. Media and production release remain pending. |
| 2026-10-04 | Recorded Ryan's confirmed purchase of `kevinandmel.com` through Namecheap | Kevin and Melanie selected the name. Namecheap replaces the planned registrar only; Cloudflare DNS remains planned, and no DNS connection or deployment is implied by registration. |
| 2026-10-04 | Prepared an isolated coming-soon page with Ryan's selected Grand Central selfie and reviewed QR-gallery photos | Local checks and a deployment handoff are documented; publication and DNS connection remain pending. Ryan will confirm whether Kevin wants all supplied photos for the separate wedding-day gallery. |
| 2026-10-05 | Added MSG-02 compose/review/result UI and browser verification | Field-level validation, focus/status behavior, and same-key recovery were checked without changing API or storage semantics. Actual screen-reader and mobile-device checks remain before guest release. |
| 2026-10-05 | Implemented MED-01 private PHOTO intents/grants/finalization and minimal single-photo form | Approved AWS SDK/WebP dependencies; new V3 preserves V1/V2. Local concurrent retries, verification, rollback, restart and UI recovery pass. R2 remains disabled pending Ryan's private-bucket setup and real phone/retrieval/privacy evidence. |
| 2026-10-05 | Recorded Ryan's first real R2 desktop PNG upload and authenticated original retrieval | Input/download/DB size and SHA-256 match, local `cmp` passes, and DB state is UPLOADED with private PENDING/COUPLE_ONLY memory defaults. An unsigned original GET is rejected with HTTP 400. A subsequent Spring restart preserves the same IDs/state and byte-identical original; receipt GET and same-key POST return 200 COMPLETE, changed caption returns 409, and scoped record counts stay one each. Phones and remaining provider checks remain open. |
| 2026-10-05 | Checked the existing Render project for phone-test readiness | The dashboard contains one deployed static service, `kevinandmel-coming-soon`; it does not host the React/Spring photo form or API. Full-app HTTPS staging remains OPS-01 work. |
| 2026-10-05 | Verified actual R2 JPEG/WebP upload, retry, CORS, signing and five-minute expiry/renewal | Six synthetic intents retain one private memory/asset each. Production coordinator response-discard recovery avoids duplicate transfers; staging replacement leaves DB/receipt metadata unchanged. Authenticated JPEG/WebP reread, bucket settings/lifecycle and phone HTTPS acceptance remain pending. |
| 2026-10-05 | Prepared combined application packaging, staging admission and manual deployment handoff | Ryan retained Render/Spring/PostgreSQL + private R2. Forty backend tests, 73 frontend tests, lint, combined production JAR and actual-JAR routing/gate checks pass. Admission bounds overlapping photo finalization without changing contract limits. Plan/budget approval, image build, extreme-image memory measurement, provider setup, hosted forwarding and phones remain pending; no provisioning, deployment or domain change occurred. |
| 2026-10-05 | Verified PR #15 Linux image codecs and isolated full-app Docker recovery | Authorized image 9f2f927c70fc passes nine codec checks and nonroot/read-only container smoke with separate tmpfs PostgreSQL 17, 2 GB app/1 GB heap, gated assets/API, three private TEXT receipts, eight concurrent same-key requests, discarded-201 replay and app restart. Owned resources were cleaned up; no host DB/R2 was used. Fixed Maven-wrapper CRLF handling and patched the existing ESLint transitive lock entry; 73 frontend tests/lint/build/audit pass. Full-limit memory, paid Render deployment, bucket settings and phones remain open. |
