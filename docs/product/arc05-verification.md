# Portable couple archive — local verification

ARC-05 adds temporary self-service export jobs and a separate portable format. The archive captures eligible memories, grouping, useful metadata, ordered albums, timeline events and tags. Original ZIP parts verify persisted size and SHA-256; a final index includes the complete human-readable archive, documented JSON and a static offline reader. See the [export contract](../api/v1/exports.md).

The feature branch is `feature/portable-export`, based on main `05a0878` (ARC-04 PR #35). Final-head CI and merge identities belong in the ARC-05 tracker and pull request. The local verification fixtures contained synthetic data only.

## Automated verification

The final frozen backend passes all 433 tests with zero failures, errors or skips in disposable Linux Java 25/Maven/FFmpeg and PostgreSQL 17. The final frontend passes all 376 tests, ESLint and the production Vite build after the save-link privacy correction. Seven existing rehearsal-helper tests pass. Independent source, API, frontend, lifecycle and documentation review has no remaining blocker.

The 37 added backend cases cover consistent bounded capture, fresh validation across transaction boundaries and original reads, exact-byte ZIP outcomes, metadata and graph limits, organization chronology/order, real session/CSRF HTTP streaming, role/reveal/current-account authority, cancellation/replay, cached-generation leases, expiry/restart, cleanup failure and retry capacity. Linux runs the symlink case that is deliberately skipped on Windows. The 18 added frontend cases cover the actual rendered view, bounded transport/header/size/digest validation, owned Blob lifetime, private-state clearing, shared action fences, exact-identity reconciliation and deliberate retry.

Meaningful checks cover current session/reveal/role authority, request bounds and control identities; capture eligibility and allowlisted fields; exact partial dates, contribution grouping and organization order; part splitting, exact bytes, missing/incorrect originals and truthful completeness; cancellation, inactivity/hard expiry, application restart, bounded admission and temporary-file cleanup; fresh source checks after storage reads and before delivery; deliberate reconciliation of interrupted responses; browser size/hash verification and owned Blob cleanup; and opening extracted artifacts without application cookies or API access.

The portable format deliberately excludes operator capabilities, account identities and deletion authority. It cannot restore the application database. Existing operator recovery v6/V13, independent memory-erasure replay and retention remain unchanged and are checked with the full backend suite. No new migration, dependency or provider/runtime/CI configuration is included.

Private ZIPs use POSIX current-user ownership with directory/file modes 700/600. Windows follows the existing operator-recovery policy: the token's actual creation owner is verified and is the sole allowed ACL principal, which may be the owner group in an elevated process. A lifetime lock prevents reclamation of another live instance's directory. Only a bounded, exact-name, owner/permission/marker/file-validated abandoned directory can be reclaimed; links or unexpected entries are preserved. Unconfirmed cleanup blocks further preparation. Startup cleanup failure remains isolated from guest/app startup. Shutdown stops the worker even when deletion fails and retains ownership while a worker or download still uses the file.

## Packaged browser rehearsal

The final combined production JAR passes 84 rendered states: 25 desktop at 1280 × 900, 25 narrow at 320 × 720, and 34 at actual 200% Chrome zoom. Chrome 155.0.8059.39 and bundled Playwright 1.62.1 use loopback-only application requests. The zoomed app reports 629 CSS px width, DPR 2 and visual viewport scale 1; its separate offline context reports 640 CSS px, DPR 2 and scale 1. Native CDP viewport captures include scrolled recovery, prepare, save and cancellation controls plus the offline memory, album, timeline and tag sections. All checked states have no horizontal overflow or JavaScript page errors. Independent final visual review has no blocker.

The real UI/HTTP rehearsal covers an interrupted pre-send creation response, same-identity read and deliberate retry; captured counts, exclusions and warnings; original/index preparation; browser header, length and checksum verification; actual Playwright-saved ZIP filename, length and independently calculated SHA-256; safe extraction into a fresh snapshot folder; exact text, partial dates, album order, event/tag links and deleted-memory exclusion; active-job discovery after refresh and a new sign-in; visibility clearing, cancellation and stale-source rejection. Separate synthetic accounts per layout respect the existing sign-in throttle without modifying its policy.

The extracted HTML reader opens in a fresh context with no application cookies, all HTTP requests blocked and zero attempted remote requests. Literal markup remains inert text. The complete text archive preserves the full content. Verified-descriptor fixtures deliberately lack provider objects while storage is off, and therefore produce truthful `READ_FAILED` outcomes and an incomplete manifest. Controlled storage tests separately prove byte-for-byte PHOTO/AUDIO preservation and missing/incorrect/read-failed originals; these fixtures exercise the existing verified-storage contract and are not fresh decoder or live-provider acceptance.

A packaged regression immediately follows automatic Save with inbox navigation and ordinary window blur, verifies that private DOM clears, then requires fresh focus/session reconciliation before export content returns. It detects the old save-dialog exception and passes with the corrected save link. No chooser exception is retained for export downloads; existing memory-download privacy behavior applies.

The nonroot, read-only application and tmpfs PostgreSQL use synthetic data only; storage, audio admission and retention remain off. Owned Java/package runners, browser profiles, containers and network are removed and their absence verified. Synthetic visibility/blur and automated browser saves do not establish native dialog, physical-device or real network behavior.

Final compilation image: `sha256:55135aedd859ae75cb0cbf6e25b25d381489fa92bbe0343ac57297cf52118600`. Packaged runtime image: `sha256:201ed8ebd94ae5dbb2b4c913a298c1cdcf871eeedb6e9cba1d9b0829cb306649`. JAR SHA-256: `912234dcab46ffcb69f481682f8194bbb87e376103977c17a15d1047f7c540aa`.

## Retained acceptance

Kevin and Melanie's real onboarding, export usability and feedback remain open. Physical-device save/extraction, actual screen-reader/native-dialog and hidden-tab/BFCache behavior remain separate acceptance checks. Controlled storage proves exact-byte handling locally; it does not prove current provider latency, hosted capacity or reception-network behavior. Both audio release gates remain off.

No paid resources, hosting, deployment, real account activation, invitation or tester message is included. Export jobs expire after 30 minutes without activity and at 24 hours absolutely; restarting the application loses jobs. A recipient's downloaded copies cannot be erased by sign-out, cancellation, expiry or later archive deletion. Download admission is the release boundary; bytes admitted before a deletion or authority change may already be delivered.

## Export presentation refactor — 2026-10-15

The focused refactor starts from main `33103e3`. `ExportArchive` now composes
guide, recovery, status, parts, prepared-download and warning views. A local hook
owns cancellation state and feedback/confirmation focus; display helpers make
labels and conditions explicit. Expanded formatting follows Ryan's album-file
preference. The export coordinator, adapters, byte verification, CSS, inbox
integration and Eastern formatter are unchanged. No migration, dependency or
deployment/configuration change is included.

Verification used an intended-PR-source snapshot, excluding the four unrelated
local LibraryService, ArchiveUserDetailsService, guestFlow and Inbox edits. Their
working-copy hashes remained unchanged. Pinned Node 24.21.0 checks passed all
460 frontend tests, ESLint and the production build. The existing export view
test file now has four cases covering the retained guide/expiry/save wording,
terminal summaries, preparation and busy/lock gates, recovery, feedback
precedence and download progress. No new tracked test file was added.

The five existing backend export test classes reported 32 tests, zero failures
or errors, and one explicit Windows skip for the symlink/outside-bytes case.
They exercise repository capture, owned temporary files, job/original handling
and HTTP authority/delivery against disposable PostgreSQL 17. Final Linux CI
results and commit/PR identities belong in the pull request and Notion task.

Independent comparison found all 7,822 rendered-state cases byte-identical to
the original component, including labels, DOM order and truthy/nullish guards.
A separate actual-component StrictMode supplement passed 338 assertions across
16 cases: the same eight callback/focus flows on both baseline and refactored
components. It checks cancellation lifetime and delayed Keep-focus restoration,
exact callback arguments, both paging families, recovery, feedback dependencies
and the save-link gate. Production-file hashes stayed fixed. This controlled
supplement uses callback spies and intercepts native save; it makes no API,
persistence or actual-download claim. Earlier helper setup interruptions are
excluded from its final passing summary.

The combined JAR, SHA-256
`ed7232dd1acbf283ee5d72e72891d0a3720cc23e3814820095bba918ac30b4f4`,
passed its first native loopback rehearsal: 400 assertions in four scoped flow
groups, three layouts and 20 synthetic screenshots. Six persisted notes and
three synthetic accounts exercised controlled pre-send creation loss, explicit
same-identity reconciliation/retry, duplicate-action fencing, fresh-sign-in job
discovery, index preparation, loading, cancellation, focus, private-state
clearing and Blob revocation. Each layout saved a real notes-only index ZIP,
independently checked its length/SHA-256, extracted its five allowed entries and
opened the reader in a fresh cookie-free file context with zero HTTP attempts.
Full text, inert markup, partial-date precision, UTC attributes and Eastern
labels were retained; complete original memory rows stayed unchanged.

Desktop 1280×900, narrow 320×720 and simulated CSS 200%/32px text checks passed
without horizontal overflow. Representative confirmation, verified-save and
offline-reader screenshots were visually reviewed. Both browser supplements
had zero page errors or external requests; owned Java, PostgreSQL, browser and
Vite resources were cleaned up and their absence/closure verified. This focused
notes-only rehearsal does not repeat the historical original-media or large
part/warning-page matrix, or establish physical-device, screen-reader,
native-save-chooser, provider or hosted acceptance. No hosted data was used.

Ignored local evidence is under `logs/export-refactor.local/`:
`review-differential-summary.json`, `mounted-supplement/summary.json`,
`native-1c40fa5d-5133-4b0b-ae66-232ff9889cc0/summary.json` and the frontend,
backend-focused and package logs. The earlier ARC-05 evidence above remains
separate from this refactor verification.

## Export directory review — 2026-10-19

Reviewed all 16 existing files in `frontend/src/features/export/` with callers,
the portable-export contract and backend behavior. Per-file keep/fix decisions
are in `docs/development/directory-review.md`. The review began at `6de44fa`
with the reviewed library work; merged library PR #72/main `8900222` was then
integrated as `926e423` after verifying its baseline source was identical.

Mounted before checks reproduced four UI defects at all three widths: part and
warning paging lost focus, a late read failure stole focus after blur, an empty
non-first warning page lost its Previous control, and an old cancellation
confirmation appeared on a new job. The existing hook now owns distinct
one-shot status/part/warning destinations and ties cancellation/Keep restoration
to the matching active job. Lifecycle changes or interactive focus movement
cancel delayed focus. Empty warning tails keep their destination, message and
Previous control. Original coordinator, request identities, retries, page
commits and native save anchor remain unchanged.

The exported binary helper now snapshots validated size, checksum and filename
before asynchronous work. Two delayed caller-mutation regressions failed before
the fix and pass afterward. The live inbox already deep-freezes its descriptor;
this hardens direct API callers without changing archive bytes or integrity
rules. Six mock regressions failed against the old source, and a further
read-admission timing case failed before its follow-up. The mock now scopes
cursors to job/route, matches page validation order, clears terminal content,
fails pending attempts, preserves terminal reasons, bounds activity expiry,
enforces preparation order/busy states and prevents late digest completion from
reviving cancelled work. It retains its intentionally tiny ZIP and simplified
worker/provider model.

Final verification passes **37 focused tests** (31 API, five presentation and
one inbox adapter case) and all **551 frontend tests**, with zero skips. ESLint,
production build and diff checks pass on Node 24.16.0. Existing test files were
extended; terminal fixtures now follow the content-free backend contract. No
tracked test files, production modules or dependencies were added. Independent
API/UI/integration reviews found no remaining actionable issues.

Mounted StrictMode Chromium passes **239 assertions** at 1280, 390 and 320 px,
using the actual Inbox controller, JSON adapters and synthetic job/page fixtures.
It covers both paging families and failures, retained page state, empty tails,
status focus, late success/failure, expiry/new-job cancellation, explicit
same-identity recovery, integrity rejection, byte progress, verified native
download links and owned Blob cleanup. All 25 synthetic original note records
stay identical as JSON. Three browser-saved **22-byte empty ZIP fixtures** match
their expected length and SHA-256; they do not contain or verify portable
archive contents. Ordinary save-related blur retains the ready part; leaving or
hiding revokes every owned Blob URL, and resume checks the same job without
restoring its link.

No page errors, external requests or horizontal overflow were reported.
Representative desktop/narrow warning, confirmation and prepared-download
screenshots were inspected. Browser/server resources are closed and the harness
is preserved outside frontend source. All 17 recorded source hashes match the
verified snapshot; guest-flow source remains byte-identical. Ignored evidence
is under `logs/export-directory-review.local/`.

The full 551-test suite, lint and build were also repeated successfully in an
intended-source copy of the committed baseline plus the export patch. Its 17
source hashes match the working-copy verification. A concurrent contribution
hook edit stays outside this delivery and is preserved in the main checkout.

This review supplements the historical real-backend ZIP evidence above; it does
not repeat backend/provider, archive-content, hosted-capacity, physical-device,
screen-reader or native save-dialog acceptance. ARC-05's retained acceptance
remains separate. Final-head CI and configured review are required after Ryan
creates the pull request.
