# Private life timeline — local verification

ARC-03 adds explicit private events and milestones with exact, partial or unknown dates and many-to-many links to existing memories. Chronological pages and year/precision filters are bounded. Event editing, unlinking and event-only deletion preserve originals, memory dates and saved timestamps. See the [timeline contract](../api/v1/timeline.md).

The feature branch is `feature/life-timeline`, based on main `be45aac`. Final-head CI and merge identities belong in the ARC-03 tracker and pull request.

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

## Retained acceptance

Local engineering verification precedes Kevin and Melanie's real onboarding and feedback. REV-01/REV-03 acceptance remains open. Physical devices, actual screen readers, native dialogs, hidden-tab/BFCache behavior, live-provider originals and hosted network/capacity/recovery checks remain open. Controlled blur/resume and synthetic storage do not establish those behaviors. Audio gates remain off for release.

No paid resources, deployment, provider configuration, real account activation, invitation or tester message is included. Self-service couple export remains ARC-05. Operator recovery excludes accounts, passwords, sessions and configuration. Event-only deletion has no independent deletion ledger; an older valid package can restore earlier organization while current memory-erasure authority still removes erased members and originals. V12 closes binary rollback to a V11 build under the existing migration guard.
