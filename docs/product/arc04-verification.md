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

## Tags presentation refactor — 2026-10-15

This focused refactor was prepared from main `33103e3`, then updated onto
`f26bb00` after Library and ExportArchive merged, on
`feature/tags-presentation-refactor`. Tags composes separate list, name,
detail, selector, recovery and paging views. A local hook owns editable fields,
validation, feedback and deletion focus, and action wiring. Display helpers make
attribution, excerpts and count labels explicit. The change improves readability
and review boundaries; it makes no runtime-speed claim.

The tag coordinator, adapters, normalizers, MemoryTags, styles, inbox integration
and Eastern formatter remain unchanged. Request identity, revision checks,
deliberate retry, hidden-name recovery, shared write fences and original-memory
preservation continue to belong to the existing coordinator and API. No
dependencies, migrations or deployment changes are included.

An isolated checkout was necessary because the existing guest-page README edit
prevented switching the primary checkout to main. Checks use that clean source
so unrelated working-copy edits are excluded from the package and pull request.
The existing combined Library/Tags component test file gains focused Tags cases;
no new tracked test file is added. Final checks, evidence and commit/PR identities
are recorded below and in the focused Notion task and pull request.

Pinned Node 24.21.0 verification passed all 467 frontend tests, ESLint and the
production build. The existing Library contract and HTTP classes passed all 12
backend tests against disposable PostgreSQL 17, with zero failures, errors or
skips, including verified photo/audio preservation. The first local attempt
lacked FFmpeg on its process path; rerunning with the already-installed pinned
audio tools passed without source changes. The ten production files were then
copied into the primary checkout, and only the four new Tags cases were appended
to its existing component test file. All eight combined Library/Tags cases pass
there. All 29 files with pre-existing working-copy changes remain byte-identical.

Independent comparison found identical static markup in all 1,291 valid-state
cases. Twelve protected coordinator, API, integration, formatter and style files
remain unchanged. A separate actual-component StrictMode supplement passed 328
assertions across 13 groups: six matching flows on each baseline/refactored
component and the actual InboxScreen reset-key checks. It covers exact callback
arguments and current actions, normalization and synchronous catches, feedback
precedence and focus dependencies, deletion cancellation and delayed focus
restoration, busy/lock visibility, confirmation persistence and remounts. It made
no API requests or automatic actions. All ten production-file hashes stayed fixed.

The combined JAR, SHA-256
`e84b45b3c1871ce2cfd1a769e20ea276c0bb95cc0d6ae59721c265ec8f56fe01`,
passed six native browser flow groups (632 harness checks, including readiness).
Twenty-eight real
synthetic notes, 24 tags and a 24-member tag exercised catalogue/member/selector
paging, literal search, detail return, separate same-name identities, no-op
revisions, adding/removing members across review states, create/rename/delete,
terminal tombstones, real revision conflict/reload, controlled read failure and
hidden-name same-identity/revision retry with wrong-name suppression. Complete
original-memory row digests and the primary membership graph stayed intact.

Desktop 1280×900, narrow 320×720 and simulated CSS 200%/32px text passed without
horizontal overflow. Nineteen distinct screenshots remain from 22 capture events;
representative recovery, deletion-confirmation and larger-text screenshots were
visually reviewed. Eastern saved times, raw partial memory dates, private-content
clearing and safe keyboard cancellation are retained. Mounted and native runs
had zero page errors or external requests. Their owned browser, Vite, Java and
PostgreSQL resources were stopped or removed and closure/absence verified.

Ignored evidence is under `logs/tags-refactor.local/`: `review/`,
`mounted-supplement/summary.json`,
`native-ba4ec900-891c-496a-b36d-a32c36ce437d/summary.json`, and the frontend,
backend-focused and package logs. These local notes-only browser fixtures do not
repeat provider/original-file or hosted acceptance. Physical devices, screen
readers, native hidden-tab behavior and actual browser zoom remain separate.
Full final-head CI and review status belong in the pull request and Notion task.

## Library directory review — 2026-10-19

This methodical review starts on `feature/library-directory-review` from
`68b5ea4`, which includes merged albums PR #70 and reviewed timeline commit
`3d7dafd`. Timeline PR #71 must merge before this Library change.

Returning from a memory's tag picker now restores the matching parent tag
catalogue query. The explicit **All tags** action still clears the search;
these are separate navigation choices. The mock tag server also clamps each
changed tag's timestamp to its previous value when the clock moves backward,
matching the per-tag backend rule. Genuine no-ops retain timestamps and tokens;
this does not introduce the timeline's global action clock.

Library filters, tag names/search and exact-name recovery now associate local
validation with the relevant controls. Correcting a field clears its local
error without hiding current server feedback. One shared read-focus hook serves
Library, Tags and memory-tag attachment views. Deliberate paging/search/reload
focus survives the existing editor resets; applied filters, chooser cancellation,
cursor stacks and draft reset identities remain intact. Blur, private hiding,
history traversal or moving focus to another interactive control cancels late
focus. A closed memory-details disclosure is not reopened by a late response.
`pagehide` still clears search text, fields, cards and drafts; resuming private
content requires a fresh access check.

Memory-tag writes only attach or remove existing tags. Their unreachable
duplicate name-entry recovery form was removed; attachment recovery keeps its
busy-only controls and explicit undefined retry payload. Real create/rename
recovery remains in Tags, including deliberate exact-name retry after hiding.
Original content, files, memory dates, saved times and sharing choices remain
unchanged. No tracked test files or dependencies were added.

Final focused verification passes **30 tests**: 18 API, 11 presentation and one
shared inbox adapter case. All **541 frontend tests** pass with zero skips;
ESLint, the production build and diff checks pass on Node 24.16.0.

Mounted StrictMode Chromium rehearsals pass **352 assertions** at 1280, 390 and
320 px: 149 Library and 203 Tags/MemoryTags checks, using actual components,
the inbox controller and synthetic JSON mock adapters. Bounded result/member/
picker pages, filter and query reset boundaries, partner revision reload,
associated errors and correction, delete cancellation, tombstones, closed
disclosures and late responses are covered. Hidden rename recovery suppresses
wrong-name writes and accepts the exact original name. Hidden attachment
recovery reloads and deliberately retries without a name, retaining the shared
write fence. Each fixture's 25 original synthetic note records remain identical
as JSON.

Both runs report no page errors, external requests or horizontal overflow.
Representative desktop and narrow validation/recovery screenshots were inspected;
owned browser/server resources are closed. The temporary harness is preserved
outside frontend source. Source hashes for all 28 current library files and the
three integration files are recorded; guest-flow source remains byte-identical.
Independent API/UI/integration reviews found no remaining actionable issues.
Ignored reports, source hashes and check logs are under
`logs/library-directory-review.local/`.

These frontend checks supplement earlier backend evidence; they do not repeat
real backend/provider acceptance or establish physical-device, screen-reader,
BFCache or hosted behavior. Final-head CI and configured review remain separate
after pull-request creation.
