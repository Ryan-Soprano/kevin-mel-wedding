# Private library search and tags — local verification

ARC-04 adds database-backed private library browsing and tag organization. Search uses literal text metadata, inclusive known memory-date years, date precision, type, review status and one selected tag. Results sort by saved time and identity; tags reference originals and support bounded catalogue, member and attachment pages. See the [library contract](../api/v1/library.md).

The feature branch is `feature/private-library`, based on main `b0c4458`. Final-head CI and merge identities belong in the ARC-04 tracker and pull request.

## Automated verification

The final frozen source passes 396 backend tests with zero failures, errors or skips in the disposable Linux Java 25.0.4.1/Maven/FFmpeg and PostgreSQL 17 rehearsal. All 358 frontend tests, full ESLint and the production Vite build pass; seven existing rehearsal-helper tests also pass. Independent backend, frontend, recovery and documentation reviews have no remaining blocker.

Coverage includes literal punctuation across all six searched fields, combined partial-date/type/review/tag filters, saved-time order, 53-item catalogue/member/attachment pagination, supported legacy memory IDs, deleted/unfinished/purging exclusions, bounded/malformed requests, reveal/role/session/CSRF authority, no-op tokens, terminal tag deletion, revocation after lock waits and competing original Delete/tag attachment. A separate verified PHOTO/AUDIO scenario preserves original bytes and metadata. The mock/real API and actual rendered React tests check decoding, escaping, state clearing, shared write fences and deliberate retry after uncertain outcomes.

The 10,000-memory synthetic TEXT fixture mixes review states, purge state and date precision. It verifies exact filtered IDs, bounded nonoverlapping pages and saved order. The final local run observed 515 ms across its first/next/filter reads. Its separate saved-order `EXPLAIN (ANALYZE, BUFFERS)` used `memory_library_order_idx`, returned 51 rows with four shared-buffer hits, and reported 0.104 ms execution. These are observations of a disposable local fixture, not latency guarantees; literal substring filters can scan eligible rows. They do not measure hosted traffic, media/provider latency or reception capacity.

All 52 operator-recovery and 12 retention PostgreSQL cases pass. New coverage includes 20 exact legacy version/target compatibility pairs and 28 rehashed malformed tag graphs rejected before writes. v6/V13 restores tags and scrubbed tombstones, preserves sibling originals and enforces current independent memory erasure. Purge/repeated replay detach tags and refresh only affected revisions. The concurrency proof observes the known worker's current blocking graph and uses a savepoint plus memory-row `NOWAIT`/SQLSTATE `55P03` to prove memory is locked before waiting on the owned tag lock. V13 readiness and V12 rollback refusal are covered. Applied V1–V12 files are unchanged.

## Packaged browser rehearsal

The combined production JAR passes 143 final rendered states: 46 desktop at 1280 × 900, 46 narrow at 320 × 720 and 51 at actual 200% Chrome zoom. Chrome 155.0.8059.39 and bundled Playwright 1.62.1 use loopback-only requests. Actual zoom reports 629 CSS px width, DPR 2 and visual viewport scale 1; five supplemental native viewport captures show scrolled search/date/apply/reset/pagination/deletion controls. Independent visual review has no blocker, and all states have no horizontal overflow or JavaScript page errors.

The rehearsal covers literal text and date/type/review filters, empty/reset states, result paging and exact detail-return context; tag catalogue, selector, member and attached-tag pages; creating/renaming/multiple attachment/removal; Delete cancellation and focus return; optimistic conflict reload; dropped pre-send response, current-state read and deliberate same-change retry; stale member/library anchor recovery; original Delete/Restore detachment; tag-only deletion/original preservation; synthetic visibility clearing/unfiltered resume; and sign-out. Literal markup remains text. The final matrix reuses one frozen package; the additional zoom run changes only the ignored test helper, not production source.

The disposable fixture uses synthetic private data, nonroot/read-only application containers and tmpfs PostgreSQL. Storage, audio admission and retention remain off. Controlled visibility events and synthetic fixtures do not establish physical-device, native hidden-tab or provider behavior. The package runner and both browser rehearsals verify removal of owned containers, network and browser profile; the Java runners verify their owned-container cleanup.

Packaged runtime image: `sha256:0c9451d295937885783a5a1d3b8ee7ab59b59ded0bf4ec965f20c9733132b4bf`. JAR SHA-256: `28f81e78fffdd6f118bb9ea25acda51f6e8e066dcd014cf38d8175b6cc9b01fa`. Final full-suite compilation image: `sha256:abae7d32dd0e27c81ca652413c041901884343cfc390753d70756d29df1a73af`.

## Retained acceptance

Kevin and Melanie's real onboarding and product feedback remain open under REV-01/REV-03. Physical-device, actual screen-reader/native-dialog, hidden-tab/BFCache, live-provider originals and hosted network/capacity/recovery acceptance remain open. Local synthetic archive-size observations do not establish reception traffic or hosted capacity. Audio gates remain off for release.

No paid resources, deployment, provider/runtime configuration, dependencies, real account activation, invitation or tester message is included. Self-service couple export remains ARC-05. Operator recovery excludes accounts, passwords, sessions and configuration. Tag-only deletion has no independent deletion ledger; an older valid package can restore earlier labels or organization while current memory-erasure authority still removes erased members and originals. V13 closes binary rollback to a V12 artifact under the existing migration guard.

## Library presentation refactor — 2026-10-15

The focused refactor starts from main `33103e3` on
`feature/library-presentation-refactor`. `Library` now composes readable filter,
result, tag-chooser, recovery and paging views. A local hook owns editable fields,
validation, feedback focus and action wiring; display helpers make attribution
and excerpt fallbacks explicit. This removes nested rendering and dense inline
handlers while retaining the existing mount/reset boundaries. It adds no
automatic searches, caching or request effects and makes no runtime-speed claim.
The coordinator, adapters, normalizers, Tags/MemoryTags, styles, inbox integration
and Eastern formatter are unchanged. No dependencies, migrations or deployment
changes are included.

An intended-PR-source snapshot excluded the four unrelated LibraryService,
ArchiveUserDetailsService, guestFlow and Inbox working-copy edits. Their hashes
stayed unchanged. Pinned Node 24.21.0 verification passed 460 frontend tests,
ESLint and the production build. The existing component test file retains every
Tags/MemoryTags assertion and now has four cases covering Library loading,
retained error results, busy/lock gates, separate chooser paging, applied fields,
nullish attribution and excerpts. No new tracked test file was added. The two
existing Library contract/HTTP classes passed all 12 backend tests against
disposable PostgreSQL 17, with zero failures, errors or skips. Final full CI and
commit/PR identities belong in the pull request and Notion task.

Independent SSR comparison found literal markup matches in all 586 valid-state
and display-boundary cases. Thirteen protected source files, including the four
user-edited files, remained byte-identical. A separate actual-component StrictMode
supplement passed 394 assertions across 15 cases: seven matching flows on each
baseline/refactored component plus the actual InboxScreen reset-key case. It
checks exact callback arguments/identity and current callbacks, validation and
synchronous catches, draft/applied chooser queries, reset/error lifetime,
feedback focus dependencies and busy/lock visibility. All eight production-file
hashes stayed fixed. These callback-spy and static-render checks are distinct
from real persistence and browser verification.

The combined JAR, SHA-256
`f6d2b8022cc9a56bc7dd120586d4c4b31e3e28fe4bf5889ccb6ed660e0167e53`,
passed its first native loopback rehearsal: 648 assertions, six scoped flow
groups, three layouts and 22 synthetic screenshots. Twenty-four persisted notes,
24 tags and five relationships exercised real result/chooser pagination, detail
and browser-Back return, unapplied drafts and chooser cancellation, literal text
and inert markup, combined type/review/date/year/tag filters, selection/clearing,
keyboard validation focus, controlled read loss and deliberate first-page reload.
Blur retention, pagehide clearing and fresh unfiltered resume, opaque history,
Eastern labels/UTC time attributes and absence of original preload requests were
checked. Complete memory, tag and relationship row digests stayed unchanged.

Desktop 1280×900, narrow 320×720 and simulated CSS 200%/32px text passed without
horizontal overflow. Representative validation, combined-filter and chooser screenshots
were visually reviewed. Both mounted and native runs had zero page errors or
external requests; mounted checks made no API requests. Owned Java, PostgreSQL,
browser and Vite resources were cleaned up and their absence/closure verified.
This notes-only refactor rehearsal does not repeat historical original-media,
tag-write, recovery or archive-size acceptance. Physical devices, actual browser
zoom, screen readers, native lifecycle behavior, providers and hosted acceptance
remain separate; no hosted data was used.

Ignored local evidence is under `logs/library-refactor.local/`:
`review/differential-summary.json`, `mounted-supplement/summary.json`,
`native-9e3b16e8-1a83-4ff9-9bee-3fa95e028477/summary.json` and the frontend,
backend-focused and package logs. The earlier ARC-04 evidence above remains
separate from this refactor verification.
