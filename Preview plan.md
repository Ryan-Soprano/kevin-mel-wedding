# Kevin & Melanie's Living Memory Archive — project plan

Last updated: 2026-09-13 · Collaborators: Ryan and Kade · Wedding: **October 24, 2026**

This file describes product scope, accepted architecture, module boundaries, and collaboration conventions. The active Jira-style work queue is the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database. Its parent [project home](https://app.notion.com/p/3dad9739c6bc81ff89cbd713cddf08d1?pvs=204) explains the workflow.

For the project introduction and local setup, run, and test instructions, use [README.md](README.md). Keep architecture here, task progress in Notion, and executable dependency versions in the project manifests. Link between them instead of copying changing details.

## Current baseline and product scope

Reviewed the active repository on September 13 at `F:\Projects\Kevin & Mel's Wedding Site\kevin-mel-wedding`. The shared remote is [Ryan-Soprano/kevin-mel-wedding](https://github.com/Ryan-Soprano/kevin-mel-wedding).

The current implementation remains a prototype: it validates and echoes written contributions and provides local photo selection. It does not persist submissions, upload media, authenticate the couple, or provide production operations. Notion records task status and evidence; documentation changes do not mark application work complete.

The agreed product scope is:

- The wedding release collects **written messages, photos, and audio messages** from approximately **60–100 guests**, without guest accounts. Audio remains required unless Ryan explicitly changes that scope.
- Guest names are optional. Every durable contribution enters a private review inbox as `PENDING` and `COUPLE_ONLY`; nothing is automatically published.
- Kevin and Melanie are the intended private application users. They will discover the project after the wedding. Do not send invitations or notifications before the reveal.
- Preserve original media and useful metadata. Privacy, reliable collection, recovery, export, and long-term ownership are core requirements.
- This is a surprise and a potential lifelong archive. A general event website builder, RSVP system, travel planner, or commercial platform is outside committed scope.
- The learning stack is React with JavaScript and Java with Spring Boot and Maven.

## Working with the Notion tracker

Use [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) to choose and claim work. The database contains 50 implementation tasks and eight decision issues, grouped into MVP 0 through MVP 4 plus the nice-to-have backlog.

- Start with **Issue Board** for daily work and **Wedding MVP** for the release path.
- Use **No Prerequisites** to find Todo items with no prerequisites. A task whose prerequisites are already Done may also be ready, so check its `Blocked by` relation.
- Use **Decisions** for unresolved product or architecture choices and **Backlog** for deferred work.
- Before starting, set Assignee, Reviewer, Status, and Branch or PR. Read the objective, dependencies, and acceptance criteria on the issue page.
- Record the current obstacle in Blocker. Add dated Evidence before moving an issue to Review or Done.
- Keep assignees blank until someone claims the work. Either Ryan or Kade may claim any issue.

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
| `REV` | Reveal, onboarding, and ownership handoff |
| `ARC` | Ongoing private archive and scrapbook |
| `NTH` | Nice-to-have backlog |

## Tech stack and decisions

The accepted baseline separates the intended architecture from what is already implemented. Manifests and the lockfile remain authoritative for executable versions.

| Layer | Accepted baseline | Current implementation / next boundary |
|---|---|---|
| Frontend | React 19, JavaScript, Vite; **Node 24 LTS** team runtime | Guest text form and local photo picker exist. Runtime pin and production build integration remain tracked work. |
| Backend | **Java 25**, Spring Boot 4.1.1, Spring MVC, Maven | Health and validating/normalizing contribution endpoints exist. Maven wrapper and verified local JDK setup remain tracked work. |
| Architecture | Modular monolith. Vite runs separately in development; one Spring application serves the built frontend and `/api` in production. | Production static-asset/API routing is not configured. |
| API | REST/JSON under `/api`, with stable error bodies and durable receipt semantics | Health and text echo endpoints exist. Persistence, idempotency, media, review, and session contracts remain tracked work. |
| Database | PostgreSQL with Spring `JdbcClient` and versioned Flyway SQL migrations | PostgreSQL 17 is declared in Compose but Spring is not connected. Driver, JdbcClient, and Flyway dependencies have not been added. |
| Domain model | Contribution envelope groups individually reviewable Memory records and MediaAsset metadata | Saved items start `PENDING` and `COUPLE_ONLY`. KEEP stays private; ARCHIVED is recoverable; DELETE follows a reversible retention policy. Schema work is pending. |
| Media | Private object storage for original photos and audio; metadata in PostgreSQL | No backend upload or storage implementation exists. Provider, limits, upload route, retention, and backups are open decisions. |
| Authentication | Spring Security with server-side sessions for separate couple accounts | Not implemented. Recovery, CSRF/cookie behavior, pre-reveal operator access, and handoff remain tracked work. |
| Testing | Spring MVC/JUnit backend tests, ESLint/build checks, focused frontend and real-device coverage | A health test and ESLint are configured. Contribution/media automation and browser rehearsal remain tracked work. |
| Delivery | GitHub feature branches and pull requests into `main`; new features use `feature/<description>` | No CI, staging, production host, domain, or deployment workflow exists. |
| Operations | Documented health checks, backups, restore rehearsal, export, monitoring, and ownership handoff | Providers, budget, capacity, backup targets, and runbooks remain open learning tasks. |

No microservices, Kubernetes, Redis, event bus, or second backend is justified by the current requirements. Revisit only for a documented need.

### Accepted decisions

The full rationale and acceptance notes live in the Notion **Decisions** view.

- **D-01 — Adopt technical baseline:** React/JavaScript/Vite, Node 24 LTS, Java 25, Spring Boot/MVC/Maven, PostgreSQL with JdbcClient and Flyway, a modular monolith, server sessions, REST/JSON under `/api`, and feature branches merged by pull request.
- **D-05 — Define pre-reveal access and ownership handoff:** approved test/operator access may exist before reveal; couple credentials and invitations wait until reveal; Kevin and Melanie receive separate accounts and an ownership handoff.
- **D-06 — Adopt contribution, memory, media, and lifecycle model:** preserve submission grouping while reviewing items individually; default durable content to private and pending; keep/archive/delete have separate lifecycle meanings.
- Learning and provisioning guardrail: explain each component and tradeoff, agree on the choice, give Ryan a small hands-on setup task, then review it. Do not create provider accounts, connect services, provision infrastructure, add dependencies, configure CI/CD, or deploy unless Ryan explicitly requests that action.

### Remaining decisions

These remain active Notion issues rather than a second decision register in this file.

| ID | Outcome to decide |
|---|---|
| D-02 | Learn and select application hosting, managed PostgreSQL, object storage, domain, upload route, cost drivers, and account ownership. |
| D-03 | Set text, caption, photo, audio, submission-window, and rate-limit policies after validating real constraints. |
| D-04 | Run the browser audio spike and confirm recording formats and fallback behavior. |
| D-07 | Set budget, capacity assumptions, backup retention, acceptable data-loss window, and recovery-time target. |
| D-08 | Confirm rehearsal and freeze dates plus wedding-day operators. |

Open the [Notion issue database](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) and select the **Decisions** view to update these records.

## Module boundaries and collaboration

Use existing locations for current work. Future locations are directions for the relevant Notion issue, not directories to scaffold preemptively. Backend package paths are relative to `backend/src/main/java/com/kevinandmelanie/memoryarchive/`.

| Module | Responsibility / proposed location | Primary handoff |
|---|---|---|
| Guest experience | Current: `frontend/src/App.jsx` and `PhotoPicker.jsx`; add feature subfolders only when useful | API examples, validation limits, upload-state contract |
| Private archive UI | Login, inbox, review, later albums; future `frontend/src/features/archive/` | Auth/session behavior, paginated inbox, media access |
| Shared UI | Current active styles: `frontend/src/index.css`; shared components are future work | Coordinate shared component changes before parallel edits |
| Submission API | Current `contribution/` controller, request, and service; validation advice in `web/` | Contract, idempotency, and persistence model |
| Media | Future `media/` for upload authorization, storage, finalization, and cleanup | Upload intent/finalize API and failure behavior |
| Identity | Future `security/` for accounts, sessions, and authorization | Login state, CSRF handling, owner-only access |
| Review | Future `review/` for inbox queries and lifecycle changes | Review actions never imply public visibility |
| Data | Schema, migrations, and queries under `backend/src/main/resources/db/` and focused packages | One coordinated migration sequence |
| Platform | Current root `compose.yaml`; future `ops/` runbooks when their issues require them | Environment names, deployment, backup, and restore procedures |
| Contracts/docs | README for setup; this plan for architecture; Notion for issues; dedicated `docs/` contracts or ADRs when needed | One authoritative location for each topic |

A sensible first sequence is to complete the toolchain and local-database learning work, then settle D-02 and D-06 prerequisites before persistence. Another collaborator can improve local photo previews/removal or error handling where dependencies allow. Run the audio feasibility spike early on real phones.

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
