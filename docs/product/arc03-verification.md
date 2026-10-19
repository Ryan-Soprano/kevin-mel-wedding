# Private life timeline — local verification

ARC-03 adds explicit private events and milestones with exact, partial or unknown dates and many-to-many links to existing memories. Chronological pages and year/precision filters are bounded. Event editing, unlinking and event-only deletion preserve originals, memory dates and saved timestamps. See the [timeline contract](../api/v1/timeline.md).

The original implementation evidence below belongs to `feature/life-timeline`, based on main `be45aac`. Later scoped verification is dated separately; final-head CI and merge identities belong in the tracker and pull request.

## Automated verification

- The clean Linux Java 25.0.4.1/PostgreSQL/FFmpeg run passed **377 tests**, with zero failures, errors or skips. New coverage includes 11 timeline HTTP cases, three date/cursor contract cases and five recovery cases. Lock-blocking account revocation, concurrent identities/revisions, add versus memory Delete, bounded pages, legacy memory UUIDs, tombstones and exact photo/audio preservation are exercised against real PostgreSQL and controlled original storage.
- Frontend verification passed **341 tests**, ESLint and the production build. Coverage includes partial-date labels, exact fractional timestamp ordering, filtered pages, linked-memory selectors, shared write fences, known-identity reconciliation, exact four-field retry after hide, stale/ignored-abort callbacks, acknowledged-write read failures and private clearing. Rendered semantic checks cover date entry, original memory dates versus saved times, tombstones, recovery controls and phone keyboards. Cancel focus and validation announcements are verified further in Chrome.
- Seven existing reception/rollback helper tests passed. Independent backend/recovery/frontend source and contract review found no remaining concrete blocker. Dependencies, provider/runtime configuration, the approved public gallery and V1–V11 migrations are unchanged. The prior ARC-02 evidence's Java label is corrected to 25, matching its pinned compilation image, POM and CI.
- Additive V12/recovery v5 preserves exact v1–v4 table definitions and migration-prefix fingerprints. Recovery's 47 PostgreSQL cases include 14 legacy bundle/compatible-target pairs through V12, mixed note/photo/audio events with full/partial/unknown dates, empty/deleted events, 53 rehashed invalid timeline graphs rejected before writes, older/populated-target refusal and newer authoritative memory erasure. Operations checks the 15 known tables and closes rollback to a V11 artifact.

## Packaged browser rehearsal

The combined production JAR passed **86 rendered browser states**: 28 at desktop 1280×900, 28 at narrow 320×720 and 30 at actual Chrome 200% zoom. Chrome 155.0.8059.39 and bundled Playwright 1.62.1 exercised the real local HTTP API and private UI. The owned zoom profile measured 629 CSS pixels, device-pixel ratio 2 and visual-viewport scale 1; native viewport captures supplement full-page screenshots.

- Each layout exercised chronological year/month/day/unknown ordering, inclusive year and precision filters, 25-event and 25-member pagination, no-op revisions and stale-cursor rejection. Invalid February dates announce validation and receive focus; hyphenated date entry uses the normal keyboard. Event-delete cancellation returns focus to its trigger.
- Creating and editing events, selecting/linking existing notes, sharing a memory between events and returning from original memory details all passed. Partner changes fence writes and navigation until reload; a committed write with a discarded response reconciles without duplication. Controlled blur clears private cards and drafts, and resume reloads current state.
- Original memory Delete removes links from both events; Restore preserves content, memory date and saved timestamp without automatically relinking. Unlink and event-only deletion preserve originals. A deleted event remains a tombstone and rejects delayed identity reuse. Sign-out clears private content; anonymous timeline access returns 401. All recorded states had no horizontal overflow or JavaScript errors.

The packaged runtime image was `sha256:8cc71c79d8e7d08de7ad9e20da9747c10ef1e9cdfdb1bd2dd092d6f5601d8270`; its JAR SHA-256 was `70df535f8812f79acf53b0ac7937835148f1cf6773ac9d699f6064723814b9a2`. The disposable local fixture kept storage, audio admission and retention off and used synthetic private data, loopback HTTP, nonroot/read-only application containers and tmpfs PostgreSQL. Its containers, network and browser profile were verified absent after cleanup. Physical device/provider behavior remains outside this fixture.

## October 15, 2026 — presentation and hook refactor

`feature/timeline-presentation-refactor` starts from main `fe2e348`, preserving the newer shared Archive layout, sharing, navigation, gallery and voice work. `Timeline.jsx` is now a small screen shell with focused fields/list/editor/detail/selector/recovery/pagination/memory views, one local-state/focus/action hook and explicit display helpers. The existing timeline coordinator still owns requests, revisions, write fencing and recovery. The parent remount key still owns draft resets.

Full frontend verification passed **456 tests**, ESLint and the production build on pinned Node 24.21.0. The existing timeline SSR file now also checks stale-page results, unknown-date grouping, date input modes/limits, independent retry drafts, busy versus locked recovery controls, deletion confirmation, nullish display fallbacks and metadata-only summaries. No new tracked test files or dependencies were added.

The **14 timeline contract/HTTP tests** passed against disposable PostgreSQL 17 using Java 25.0.4 and Maven 3.9.16. These exercise dates, chronology, revisions, linking, event-only deletion and original preservation. Independent review found no blocker; the timeline API/coordinator/normalizers/CSS, shared Archive layout, inbox integration/history and Eastern formatter match the starting commit byte for byte.

The current production JAR passed a loopback native-app/browser rehearsal with **740 assertions**, nine scoped flow groups and **16 synthetic screenshots** across desktop 1280×900, narrow 320×720 and simulated CSS 200%/32px text. The full graph/recovery flow ran at desktop; narrow/enlarged-text checks covered representative list/member/selector, validation, focus and privacy states. Chromium was 149.0.7827.55 with Playwright 1.62.1; the enlarged-text check is not native browser zoom or physical-device acceptance.

- The real PostgreSQL/API fixture exercised 24 notes, 24 dated/unknown events and a 24-member event, including list/member/selector pagination, year/precision filters, create/edit/no-op validation, date-precision clearing, review-status selection, linking/unlinking, memory-detail return, delete-cancel focus and event tombstones.
- A real stale revision fenced changes until reload. Controlled local response loss checked committed-write reconciliation without duplication and an unsent change followed by pagehide clearing and deliberate exact-field retry. No automatic retry was introduced. Current privacy behavior retains the archive across blur and clears it on pagehide; sign-out also cleared it.
- All complete original memory rows had identical digests before and after organization changes. Native-app restart preserved the original 24 notes and 24 links plus the scrubbed tombstone. These synthetic note checks supplement the backend original-file tests; they do not establish live-provider media behavior.
- All recorded states had no horizontal overflow, browser application errors or external/provider requests. The owned browser, native Java process and exact labelled PostgreSQL fixture were verified removed.

A separate mounted supplement passed **37 assertions** across nine component cases and four real inbox-controller/mock cases. It checked reload routing, explicit undefined retry payloads, current callbacks, focus, parent-key resets and late read/write completions after suspend/dispose. It reported no page errors or external requests and closed its owned browser and Vite server. This supplement verifies controlled wiring behavior rather than real backend persistence.

The JAR SHA-256 was `998f413937dd03b5e44d733f4fbb8269f16c8e2c9cdc23ce07462b4067da9889`. Ignored local evidence is under `logs/timeline-refactor.local/`, with summaries in `native-888cfaa1-ea7e-4399-a2ce-2c965764cd23/summary.json` and `mounted-supplement/summary.json`. Local storage/audio/retention fixture settings do not describe hosted release settings. No deployment, account/provider/configuration change or invitation was performed.

## October 19, 2026 — timeline directory review

All 18 tracked timeline files were reviewed with their callers and contract.
Local event validation now associates title/date errors with the correct
editor or retry field, keeps filter errors separate and preserves server
feedback on correction. Deliberate paging/filter/reload focus survives partner
revision and applied-filter editor resets, while blur or focus moving to another
interactive control cancels late focus. Existing draft-reset, date precision,
deletion-confirmation and exact four-field retry contracts remain intact.

The production API and action coordinator remain unchanged. The mock now keeps
genuine action times nondecreasing across the timeline and rejects wrong cursor
scope with 400 before checking stale revisions; genuine no-ops preserve tokens
and timestamps. Per-file decisions are in the [directory review](../development/directory-review.md).

The branch starts from main `a3b7f45` and integrates reviewed albums commit
`4ddd361` locally to preserve both feature boundaries in the shared screen
adapter. It includes a small album follow-up for the same within-window focus
defect, reproduced separately. Albums PR #70's head is unchanged; merge it first.

Verification passes **21 focused timeline/adapter tests** and **536 combined
frontend tests**, ESLint and production build on Node 24.16.0. Mounted StrictMode
checks pass **254 timeline** and **194 album assertions** at 1280, 390 and 320 px,
including partial dates, filters, partner reloads, local correction, membership,
no-ops, late responses and pagehide/exact-field recovery. Both fixtures preserve
all 21 original memory records as identical JSON. Screenshots were inspected;
no page errors, external requests or horizontal overflow occurred, and owned
browser/server resources are closed. Independent review found no remaining
actionable issues. No tracked test files or dependencies were added. Ignored
evidence remains under `logs/timeline-directory-review.local/`.

This frontend review supplements the earlier real-backend rehearsal; provider,
device and hosted acceptance remains separate. Final-head CI/configured review
is still required after PR creation.

## Retained acceptance

Local engineering verification precedes Kevin and Melanie's real onboarding and feedback. REV-01/REV-03 acceptance remains open. Physical devices, actual screen readers, native dialogs, hidden-tab/BFCache behavior, live-provider originals and hosted network/capacity/recovery checks remain open. Controlled blur/resume and synthetic storage do not establish those behaviors. Audio was disabled in the original fixture; current audio settings and acceptance are recorded in the [voice memory runbook](../runbooks/voice-memories.md).

No paid resources, deployment, provider configuration, real account activation, invitation or tester message is included. Self-service couple export remains ARC-05. Operator recovery excludes accounts, passwords, sessions and configuration. Event-only deletion has no independent deletion ledger; an older valid package can restore earlier organization while current memory-erasure authority still removes erased members and originals. V12 closes binary rollback to a V11 build under the existing migration guard.
