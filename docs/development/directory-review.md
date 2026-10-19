# Directory review method

Review production files together with their tests, callers and contracts. Record
task ownership, progress, blockers and PR evidence in the existing Notion issue
database. This guide records the review method and technical decisions.

## Review each file

1. Identify its responsibility, public interface and consumers. Trace the normal
   flow and failure/recovery paths before changing the implementation.
2. Check correctness: input normalization, immutable state, asynchronous ownership,
   cancellation, resource cleanup and error contracts. For UI files, also check
   labels, keyboard focus, disabled controls and retained drafts.
3. Check maintainability: cohesive responsibilities, useful names, readable control
   flow, duplication and compatibility with surrounding modules.
4. Check efficiency against actual work: repeated requests, copies, hashing,
   decoding, timers, renders and retained resources. Measure suspected expensive
   paths before introducing caching or additional abstractions.
5. Assign a decision: **keep**, **simplify**, or **fix**. Record concrete evidence
   for changes and any unresolved acceptance boundary.

Keep increments small enough to review independently. Separate a mechanical
extraction from a behavior fix in the commit history. Reproduce bugs before
patching them, extend existing test files where practical, and test observable
outcomes rather than internal function layout. Preserve unrelated working edits.

## Verification

- Run the focused existing tests for the changed responsibility, then the
  appropriate full suite, lint and build. Record runtime versions and skips.
- Exercise mounted UI behavior for stateful component or hook changes. Compare
  the prior implementation for mechanical refactors; give intentional behavior
  fixes explicit regression assertions.
- Verify the intended source snapshot when concurrent edits are outside the PR.
- Complete independent source review and required checks on the final PR head.
  Keep physical devices, real microphones, provider IO, hosted capacity and
  release acceptance tied to their actual evidence.

## Review order

| Batch | Directories and boundaries |
|---|---|
| Audio | `frontend/src/features/audio/`, including components, hooks, API coordinator and existing tests |
| Guest contributions | `frontend/src/features/media/` and `contribution/`; draft ownership, original bytes, partial results and retries |
| Guest navigation and public content | `frontend/src/app/`, `guestGallery/` and `sharing/`; history, focus, loading and public/private boundaries |
| Private archive | `frontend/src/features/inbox/`, `albums/`, `timeline/`, `library/` and `export/`; sessions, revisions, organization and recovery |
| Shared frontend | `frontend/src/shared/`, `styles/` and `dev/`; consumers, reusable contracts and development-only boundaries |
| Backend | Review corresponding packages under `backend/src/main/java/com/kevinmel/archive/` with their tests; start with request/security boundaries, then domain/media/recovery operations |
| Supporting files | `scripts/`, build/runtime configuration, CI and related documentation |

Inspect scaffolding directories when their surrounding module is reviewed. Tests
belong to each production-code batch rather than a separate final testing pass.

## Audio decisions — October 19, 2026

| File | Decision and reason |
|---|---|
| `AudioForm.jsx` | Keep the small shell and saved result after the presentation/hook extraction. |
| `AudioCompose.jsx` | Fix caption disclosure state so correcting a validation error does not hide the field. |
| `hooks/useAudioForm.js` | Fix array-shaped caption errors and correction focus; preserve controller ownership, retry and completion ordering. |
| `audioConstraints.js` | Keep the shared limits and separate file aliases/recorder MIME policy. No measured efficiency issue was found. |
| `audioConstraints.test.js` | Keep the existing MIME/extension and file-picker coverage. |
| `audioCapture.js` | Fix teardown after callback-triggered cancellation and late permission results. Keep the recorder lifecycle and its small validator together. |
| `audioCapture.test.js` | Extend cancellation, late callback and track-release coverage in the existing file. |
| `api/audioSubmission.js` | Build the immutable upload draft from retained normalized input after hashing; keep the existing receipt/grant recovery state machine. |
| `api/audioSubmission.test.js` | Extend deferred-hash mutation and actual late-result coverage in the existing file. |

The private creation tests under `inbox/components/AddMemory.test.js` also cover
audio presentation and field-error contracts because private and guest creation
share this form.

This batch covers all nine files in `frontend/src/features/audio/`. Audio playback
in the private inbox and server-side audio verification belong to their respective
directory reviews; they have not been marked reviewed by this frontend batch.

## Media decisions — October 19, 2026

The next batch reviewed all 18 tracked files in `frontend/src/features/media/`
and all eight in `contribution/`, including tests and CSS. The active guest,
private archive and development preview entrypoints all use `PhotoBatchForm` for
one to five photos. Repository-wide caller searches found no consumer of the
retired `SinglePhotoForm` chain.

| File in `media/` | Decision and reason |
|---|---|
| `components/SinglePhotoForm.jsx` | Simplify: remove the unused predecessor to the batch form. Avoid maintaining a second, unreachable upload UI. |
| `api/photoSubmission.js` | Simplify: remove the coordinator consumed only by that retired form. The batch coordinator remains the shared live path. |
| `api/photoSubmission.test.js` | Simplify: remove tests for the retired coordinator; move its independent media-normalization case to the existing shared API suite. |
| `api/photoBatchSubmission.js` | Keep: copies input before hashing, validates whole receipts before adoption, retains uncertain attempts and protects saved siblings. Existing deadlines and disposal suppress late results. |
| `api/photoBatchSubmission.test.js` | Keep: covers immutable batch identity, selective retries, partial results, deadlines, cancellation and late responses. |
| `api/photoBatchIntegration.test.js` | Keep: exercises the real JSON adapter with a synthetic server, plus rendering and recovery contracts. |
| `hooks/usePhotoBatchForm.js` | Keep: owns selection, normalized field errors, active-only queued focus, retry selection and controller disposal. |
| `components/PhotoBatchForm.jsx` | Keep: small composition shell for editable, review and finished states. |
| `components/PhotoBatchCompose.jsx` | Keep: guest/private fields, selection and review actions have clear responsibilities. |
| `components/PhotoBatchReview.jsx` | Keep: explicit review/edit/send boundary retains selected originals and captions. |
| `components/PhotoBatchCard.jsx` | Keep: caption disclosure survives correction, and per-item status/retry controls remain associated with each original. |
| `components/PhotoBatchActions.jsx` | Keep: result, selected retry and reset actions use existing state locks. |
| `components/PhotoPicker.jsx` | Keep: controlled/standalone selection, mixed-file feedback, removal focus and dialog callbacks are cohesive. |
| `components/PhotoPreview.jsx` | Keep: creates and revokes only its owned preview URL when the original changes or unmounts. |
| `photoSelection.js` | Keep: validates additions before allocating IDs, preserves original File references and reports skipped picker files. |
| `photoSelection.test.js` | Keep: covers bounds, mixed additions, duplicate filenames, ID collisions and atomic selection updates. |
| `mediaConstraints.js` | Keep: derives picker options and labels from one small format/size policy. |
| `photoBatchDisplay.js` | Keep: pure copy/status/focus helpers have active consumers and useful boundaries. |

The moved test in `shared/api/archiveApi.test.js` retains every original assertion
for NUL/unpaired-surrogate metadata, control characters in filenames and UUID
case-folded duplicates. The now-unreferenced `.photo-original-preview` rule is
removed from `styles/global.css`; active `.photo-submission` styles remain in use.
These boundary edits do not constitute a full shared API or styles review.

## Contribution decisions — October 19, 2026

| File in `contribution/` | Decision and reason |
|---|---|
| `components/ContributionForm.jsx` | Keep: thin shell composing the form and confirmed result. |
| `components/ContributionCompose.jsx` | Keep: direct-send controls, validation labels/ARIA and uncertain-outcome editing locks are explicit. |
| `components/ContributionResult.jsx` | Keep: confirmed result and standalone done states preserve completion callback behavior. |
| `hooks/useContributionForm.js` | Keep: effect-owned controller, array-shaped validation, queued focus and reset-before-callback ordering remain cohesive. |
| `api/textSubmission.js` | Keep: freezes normalized input before transport, retains the original key/body through unknown outcomes and bounds request/body completion. |
| `api/textSubmission.test.js` | Keep: existing transport, retry, deadline and rendering cases verify the live path. |
| `contributionDisplay.js` | Simplify: remove two unused `reviewTitle` properties left after the intermediate note-review step was retired. |
| `contribution.css` | Keep: compact form/result styles are scoped and responsive. |

No active submission correctness defect or measured efficiency issue was found
in this batch. The reduction is in unused code and duplicated maintenance paths;
no upload performance or bundle-size improvement is claimed. The next batch is
guest navigation and public content under `app/`, `guestGallery/` and `sharing/`.

## Media and contribution verification

The initial focused baseline passed 81 existing tests. After cleanup, the
remaining media API/shared contract suites pass 129 tests and the contribution
suite passes 14. The intended source snapshot passes all **509 frontend tests**,
ESLint and the production build on Node 24.16.0, with no skips. The full count
falls from 520 because 11 tests belonged solely to the retired coordinator; its
independent normalization case remains covered in the existing shared API suite.
No new test files were added. Independent cleanup review found no actionable
findings or remaining consumers of the retired chain/style.

Mounted Chromium verification passes **12 cases / 247 assertions** at 1280, 390
and 320 px, across guest/private and active/inactive forms. The real API decoder
and batch coordinator use an injected transport to check native caption-error
arrays, sibling targeting, single-character correction, manual disclosure,
original File retention, deliberate corrected retry, private attribution, reset,
StrictMode disposal and preview URL cleanup. Six screenshots were captured and
desktop/narrow samples inspected. There were no page errors or external
requests, and owned browser/server resources were closed.

Source hashes match the tested snapshot; the separate `guestFlow.js` working
edit is preserved and excluded. Ignored inventory, reports and logs are under
`logs/media-contribution-review.local/`. This review does not establish device,
assistive-technology, real-provider persistence or hosted acceptance.

## Guest navigation and public content decisions — October 19, 2026

This batch reviewed all 21 code, style and test files under `app/`,
`features/guestGallery/` and `features/sharing/`, plus 405 tracked WebP assets.
Its baseline includes the completed media cleanup and Ryan's committed
`guestFlow` refactor. The new review preserves that refactor.

| File in `app/` | Decision and reason |
|---|---|
| `App.jsx` | Keep: composes guest navigation, retained forms/gallery and distinct completion destinations. Focus and history restoration remain cohesive. |
| `Root.jsx` | Keep: shared routes precede inbox/guest routing, tokens come from the fragment, and ID/token keys remount shared-page owners. |
| `guestFlow.js` | Keep Ryan's refactor: extracted helpers preserve navigation gates, started-form identity and active-form-only completion resets. |
| `guestFlow.test.js` | Keep: verifies the reducer's navigation, locks, reporting and completion contract. |
| `guestHistory.js` | Keep: validates owner/key/index entries, retains sanitized home views in memory and rejects stale/foreign traversal before callbacks. |
| `guestHistory.test.js` | Keep: covers retained drafts, locked navigation, browser traversal, home focus and scroll restoration. |
| `useGuestHistory.js` | Keep: current effect callbacks and one disposable history owner avoid stale subscriptions. |
| `weddingJourneyIntegration.test.js` | Keep: exercises real JSON adapters and coordinators through a synthetic journey without claiming DOM/provider acceptance. |

The `done` destination remains part of the tested reducer/history interface even
though current form completion callbacks return home. Removing its view would
require a separate compatibility decision.

| File in `features/guestGallery/` | Decision and reason |
|---|---|
| `CoupleScrapbook.jsx` | Keep: the native modal handles focus containment, Escape, opener restoration and unmount cleanup. |
| `GuestGallery.jsx` | Fix: pause passive loading while its Show-more control has focus, preserving that control until deliberate activation. |
| `GuestGallery.test.js` | Keep: manifest, asset and render contracts verify the approved content and presentation boundaries. |
| `guestGallery.css` | Keep: gallery bounds, thumbnails and controls have active consumers. |
| `coupleScrapbook.css` | Keep: responsive portrait/dialog styles remain scoped. |
| `photos.js` | Keep: all 218 approved photo descriptors, order, original paths and responsive variants are intact. |
| `slideshow.js` | Keep: visibility and cleanup behavior support deliberate playback and reduced-motion controls. |
| `thumbnailLoading.js` | Fix: allow the existing observer to pause loading for focused manual controls while retaining one batch per approach. |
| `thumbnailLoading.test.js` | Extend the existing file with focused-control, reentry and late-observation coverage. |

Automatic scrolling still loads thumbnails in batches of 24. The focus guard
pauses only while Show more has focus; explicit activation uses the existing
focus-to-first-new-thumbnail behavior. Changing focus does not recreate the
observer or load every batch while the footer remains visible.

The asset audit found 218 originals and 183 responsive variants, with exact
manifest coverage, valid dimensions/metadata-free WebP chunks, no missing paths
and no byte-identical duplicate groups. All 401 active asset hashes are unchanged.
Remove the four unreferenced arch/globe welcome variants (338,118 bytes) left by
the retired collage; they have no runtime, build or script consumers. Historical
verification notes and a negative rendering assertion mention their old names.
This is a structural audit, not renewed visual/content or device acceptance.

| File in `features/sharing/` | Decision and reason |
|---|---|
| `SharedMemories.jsx` | Fix: retain the loaded public page during paging/failure, announce request state, keep recovery controls and manage active-only focus after a user request settles. |
| `sharingApi.js` | Fix: canonicalize accepted UUIDs for requests and response/link identity comparisons; retain capability, private-field and wrong-ID rejection. |
| `sharing.test.js` | Extend the existing file with UUID and retained-page/recovery presentation contracts. Mounted checks verify the actual request/focus transitions. |
| `sharing.css` | Keep: public card/media wrapping and layout rules have active consumers. |

Native transport cancellation, per-ID/token route ownership and cached home
content already have defined boundaries; no broader request-lifecycle rewrite
is justified by this review. The next batch is the private inbox, followed by
the remaining private archive directories.

## Public-content verification

The initial focused baseline passed 58 tests. After the fixes, the intended
snapshot passes all **512 frontend tests**, ESLint and the production build on
Node 24.16.0, with no skips or new test files. Existing gallery and sharing suites
pass seven and eight focused tests respectively. Independent source review of
the app/history, gallery/focus and sharing/recovery boundaries found no remaining
actionable issues.

Mounted Chromium at 1280, 390 and 320 px passes **97 gallery assertions** and
**111 sharing assertions**. Gallery checks reproduce the old final-batch focus
loss, then verify retained focus, ordinary passive loading/reentry, deliberate
manual loading, native modal/keyboard return, reduced motion, timers and cleanup.
Sharing checks use actual native JSON fetch with synthetic responses to verify
retained pages, retry/newest recovery, duplicate paging, loading/error status and
active-only focus. Leaving and returning before settlement cancels old focus
intent. Initial loading and reactivation do not steal focus. Desktop/narrow
screenshots were inspected and no runtime errors were observed.

All 401 active image hashes and Ryan's guest-flow refactor match the review
baseline. Browser/server resources are closed; ignored inventories and reports
remain under `logs/public-flow-review.local/`. These frontend checks make no
device, assistive-technology, backend/provider persistence or deployment claim.

PR #68's configured review identified a remaining UUID-case mismatch: link
creation accepted a mixed-case response but returned it unchanged, causing the
inbox's identity check to reject a successful result. The API now returns the
canonical memory ID and URL UUID while preserving the validated capability token
exactly. An existing-suite regression reproduces the failure through the real
API decoder and inbox controller before the fix and passes afterward.

The follow-up passes all **513 frontend tests** with no skips, plus ESLint and
the production build against a clean snapshot of the same frontend source.
Independent review found no actionable issues. No new test files were added.
GitHub CI was queued during the reported Actions incident; local verification
does not establish passing CI or a fresh configured review for the follow-up.

## Timeline decisions — October 19, 2026

This batch reviews all 18 tracked files under `features/timeline/`, their callers
and the private timeline contract. It starts on `feature/timeline-directory-review`
from main `a3b7f45`, separately from the then-unmerged albums PR #70.

| File in `features/timeline/` | Decision and reason |
|---|---|
| `api/timelineActions.js` | Keep: exact four-field fingerprints, same-identity retries, session/write fences, acknowledged-write reconciliation and fresh-revision card clearing match the contract. No extraction is warranted. |
| `api/timelineApi.js` | Keep: canonical event IDs/tokens, case-folded memory identity checks, exact UTC instant ordering, bounded pages and ETag/route validation already cover the relevant contracts. |
| `api/mockTimelineServer.js` | Fix: clamp genuine action timestamps across the timeline when the clock moves backward; reject mismatched cursor scope before stale revisions, matching production error order. |
| `api/timeline.test.js` | Extend the existing real-adapter tests for rollback edits/creation/deletion and correct wrong-scope cursor expectations, retaining genuine stale-cursor and no-op coverage. |
| `timelineFields.js` | Fix local validation metadata to name event fields and identify a missing required title. Keep Unicode/date normalization, exact four-field shapes, chronological ordering and instant comparison algorithms. |
| `timelineDisplay.js` | Fix server-feedback precedence and provide field-specific filter validation messages; keep actively used labels, partial-date controls and memory summaries. |
| `hooks/useTimeline.js` | Fix independently scoped editor/retry/filter validation and correction, and own deliberate paging/filter/reload focus across editor resets with lifecycle cancellation. Keep exact action arguments and recovery locks. |
| `components/Timeline.jsx` | Keep focused view composition; retain paging focus in the feature boundary while the inner editor keeps its existing view/identity/revision/filter reset key. |
| `components/Timeline.test.js` | Extend existing presentation/normalization contracts for associated field errors, separate recovery feedback, honest date help and named page targets. Mounted checks verify stateful transitions. |
| `components/TimelineEventFields.jsx` | Fix field refs and associated errors for editor/retry scopes; changing precision still clears the date atomically and preserves its precision help. |
| `components/TimelineEditor.jsx` | Keep the create/edit form boundary; forward scoped validation and field-change/focus wiring. |
| `components/TimelineDetail.jsx` | Keep membership, tombstone and existing deletion-confirmation behavior; forward editor validation wiring without changing its locks. |
| `components/TimelineList.jsx` | Fix associated filter errors and correction; keep chronological pages, unknown-date grouping and metadata-only cards. |
| `components/TimelineRecovery.jsx` | Fix independent retry-field errors while preserving server recovery feedback and busy-only recovery controls. |
| `components/TimelinePaging.jsx` | Keep bounded previous/next/reload controls, routed through deliberate focus ownership. |
| `components/TimelineSelector.jsx` | Keep candidate summaries, review filters and private linking; route paging/filter focus through the feature hook. |
| `components/TimelineMemorySummary.jsx` | Keep honest memory precision, separate saved timestamps and metadata-only summaries; no original-media loading is introduced. |
| `timeline.css` | Keep: all selectors have active consumers and no measured layout or efficiency issue justifies a style rewrite. |

The production API already rejects case-folded duplicate memory IDs and compares
creation instants through nanosecond precision. The mock defects are distinct:
clock rollback could commit an event response rejected by that decoder or
backdate a new event, and a cursor reused with different filters incorrectly
reported a revision conflict. Genuine action time now matches the server's
timeline-wide maximum; no-op timestamps and event/list tokens remain unchanged.
Wrong scope returns `400 INVALID_CURSOR` even when the cursor is also stale;
valid-scope stale revisions retain `412 TIMELINE_CONFLICT`.

Browser reproductions show lost paging focus, unassociated title/year errors
that persist after correction, and a newer failed member read obscured by an
old local validation message. Editor, retry and coupled filter errors now have
separate scopes. Correcting one scope does not erase server feedback or another
draft's validation. The event-date mapping changes local validation metadata,
not accepted Unicode/date values or the backend response contract.

The narrow inbox adapter passes the existing timeline reset key into a keyed
editor inside an unkeyed feature boundary. This keeps deliberately requested
result focus through partner revision and applied-filter resets, while drafts
still reset to current data and blur/history/hiding cancel pending focus.
Moving focus to another interactive control in the active window also cancels
the pending result focus; expected disabled-control and editor-remount gaps do
not. This behavior was reproduced separately before the fix.
Existing delete-cancel restoration and visible-but-disabled confirmation
behavior remain intact. This integration check is not a second inbox review.

## Timeline verification

The initial 18 timeline tests passed. The mock regression run reproduced both
defects before the fixes; all 17 API cases now pass. The changed timeline and
inbox adapter suites pass **21 focused tests**. Initial standalone verification
passed 534 frontend tests, lint and build on Node 24.16.0.

The branch then integrated reviewed albums commit `4ddd361` locally, preserving
both features' editor-reset assertions in the shared adapter test. Albums PR
#70's head remains unchanged. A narrow album follow-up applies the same
interactive-focus cancellation after a separate browser reproduction confirmed
that defect there too. This branch is intended to follow PR #70's merge.

Final combined verification passes **536 frontend tests**, with zero skips,
ESLint and the production build. Mounted actual components, inbox controller and
JSON mock adapters in StrictMode pass **254 timeline assertions** and **194
album assertions** at 1280, 390 and 320 px. They cover chronology/unknown dates,
partial-date filters, paging, partner revision/filter resets, input correction,
late success/failure after blur or focus movement, linking/no-ops, deletion and
pagehide recovery with deliberate exact four-field retry. Both fixtures retain
all 21 original synthetic memory records unchanged as JSON. Desktop/narrow
validation and recovery screenshots were inspected; no page errors, external
requests or horizontal overflow were observed.

Independent API/mock, UI/focus, integration and documentation reviews found no
remaining actionable issues. Ryan's guest-flow source stays byte-identical.
No tracked test files or dependencies were added. Browser/server resources are
closed; fixtures, reports and source hashes are preserved under ignored
`logs/timeline-directory-review.local/`. Fixture selector/ordering corrections
are excluded from passing metrics. These frontend checks supplement prior
backend evidence and do not establish real provider/device/hosted acceptance.
Final-head CI/configured review remains required after PR creation.

## Private inbox decisions — October 19, 2026

This batch reviews all 38 tracked files under `features/inbox/`, including
their existing tests, styles and consumers. Its baseline is `0d567d8`, the
latest PR #68 follow-up, whose tree is unchanged in merge `b0618f3`.
Inbox work is kept on `feature/private-inbox-review` and targets that merged baseline.

| File in `features/inbox/` | Decision and reason |
|---|---|
| `api/inboxController.js` | Fix: fence synchronous cancellation callbacks, preserve interrupted sign-out intent, and reset shell cursors on explicit first-page reads. |
| `api/inboxController.test.js` | Extend: reproduce cancellation reentry, lifecycle precedence, interrupted sign-out and first-page/cached-page return behavior. |
| `api/inboxControllerCompatibility.test.js` | Keep: verifies public controller compatibility with existing archive consumers. |
| `api/inboxForegroundAccess.test.js` | Keep: foreground access checks preserve valid current work and clear expired private state. |
| `api/memoryMutationActions.js` | Fix: metadata responses must preserve the captured audience at the expected revision; later reconciled revisions remain authoritative. |
| `api/inboxState.js` | Keep: frozen initial values, recursive presentation copies and filtered session fields have cohesive consumers. |
| `api/inboxMedia.js` | Keep: verify policy, HTTPS grants, bounded streamed bytes and checksum before creating an owned Blob URL. |
| `api/coupleSubmissionApi.js` | Keep: authenticated routes, current-session CSRF and stale-facade rejection remain separate from storage-grant recovery. |
| `api/coupleMemories.test.js` | Extend: real-decoder metadata audience regressions complement retained-original, authenticated creation and recovery checks. |
| `api/inboxAudio.test.js` | Clarify the deferred-response test description; its body does not claim a stalled-stream test. Existing controller tests cover stream cancellation. |
| `api/inboxHistory.js` | Fix: retain timeline/tag return context and matching tag-parent navigation metadata; cancel obsolete restoration and pending focus. |
| `api/inboxHistory.test.js` | Extend: nested filter/query/page restoration, matching parent identity, cancelled intermediate reads and navigation notification. |
| `api/inboxPrivacyLifecycle.js` | Keep: pagehide clears presentation; ordinary hidden/blur events pause audio and preserve drafts. Visible return rechecks access. |
| `api/inboxPrivacyLifecycle.test.js` | Keep: verifies those distinct lifecycle paths and listener cleanup. |
| `hooks/useInboxController.js` | Fix: own deliberate paging/filter/retry settlement focus and native audio teardown, including development replay and direct unmount. |
| `hooks/useInboxActions.js` | Simplify ownership: reuse the hook's deliberate inbox-request path for retry while keeping stable current-owner adapters. |
| `components/Inbox.jsx` | Keep: composes the authenticated shell, global feedback and screen adapters. |
| `components/InboxScreens.jsx` | Keep: access precedence and explicit feature-specific reset keys preserve current owners. |
| `components/InboxScreens.test.js` | Keep: meaningful access and editor-reset boundary assertions. |
| `components/InboxAccess.jsx` | Keep: native login fields and explicit unconfirmed-logout recovery remain cohesive. |
| `components/InboxList.jsx` | Keep: bounded page replacement, status filters, safe labels and explicit requested-page retry remain the presentation contract. |
| `components/MemoryDetail.jsx` | Keep: composes immutable originals, revision-keyed metadata, tags, review and recovery context. |
| `components/MemoryMedia.jsx` | Fix: bind the verified URL to a stable audio callback so development replay can restore only the current owner's source; retain original/download availability rules. |
| `components/MemoryReview.jsx` | Keep: deliberate audience choices, link replacement, recovery locks and identity-bound deletion confirmation remain explicit. |
| `components/MemoryReview.test.js` | Keep: checks supported actions and locks across every review state. |
| `components/MemoryMetadataEditor.jsx` | Keep: local editable fields normalize before save and remain locked during uncertain recovery. |
| `components/AddMemory.jsx` | Fix: deliberate type selection and starting another memory move focus to a connected named group; initial mount does not steal focus. |
| `components/AddMemory.test.js` | Keep: existing form and screen contracts; mounted checks verify the changed client focus behavior. |
| `components/ArchiveLayout.jsx` | Keep: small shared presentation components have active archive consumers. |
| `inboxDisplay.js` | Keep: small label, lock and return-context helpers remain used by the inbox and archive modules. |
| `memoryMetadata.js` | Keep: exact fields, raw Unicode/length limits and Gregorian date precision match the API contract. |
| `memoryMetadata.test.js` | Keep: covers precision, leap boundaries and validation before normalization. |
| `memoryDisplay.js` | Keep: one cached formatter consistently applies the documented Eastern display timezone. |
| `memoryDisplay.test.js` | Keep: UTC date changes and both daylight-saving transitions remain covered. |
| `audioPlayback.js` | Keep: native pause/source removal/load cleanup is the shared release operation. |
| `audioPlayback.test.js` | Keep: verifies cleanup order and continuation after pause failure. |
| `inbox.css` | Simplify: remove the unused `.inbox-review .button-danger` selector; active delete-confirmation styling is retained. |
| `archiveLayout.css` | Keep: responsive shared archive styles have active consumers. |

The cancellation defect was reproduced with a synchronous abort callback that
opened a replacement read: its late result could enter controller state after
sign-out. Cancellation now detaches prior operations before external cleanup,
blocks replacement work during cleanup and preserves the reserved generation.
Lifecycle suspension/disposal supersedes older continuations, while normal
publication callbacks still give the newest selection ownership. Interrupted
sign-out remains unconfirmed until restoration completes server invalidation.

The metadata check is malformed-response hardening: editing metadata must not
accept an audience change at that edit's expected revision. No server-side
publication defect was observed. Reloading a legitimately newer revision still
adopts its current audience without attributing another user's change.

History retains only disposable navigation metadata; browser history still
contains opaque ownership keys. Restoring a nested timeline/tag route reloads
its list context only when that context changed, before reading its parent.
Late or cancelled intermediate reads cannot continue navigation.

One separate tag-actions follow-up remains for the library review: opening the
memory tag picker changes `tags.q`; direct **Back to tag → All tags** can then
use the picker query instead of the original tag-list query. The inbox history
fix preserves browser traversal metadata but does not change those feature
actions. Albums, timeline, library and export have not been marked fully
reviewed by this inbox batch.

## Private inbox verification

The initial inbox baseline passes 148 existing tests. The final source passes
all **167 inbox tests** and **532 frontend tests**, with no skips, plus ESLint
and the production build on Node 24.16.0. No test files were added. New cases
live in the existing controller, history and couple-memory suites.

Mounted Chromium in React StrictMode at 1280, 390 and 320 px passes **125
assertions**. Before/after checks reproduce the old page-label mismatch,
keyboard focus loss and detached audio source. The final run verifies cached
detail returns, first-page feature/creation returns, native Back/Forward,
failed-page retry, filters, cancelled focus intent, all three creation choices,
starting another note, native audio teardown and unchanged-source rerenders.
Desktop/narrow screenshots were inspected. Synthetic content and transports
made no provider requests; no page errors or horizontal overflow were observed.
Browser/server resources are closed, and temporary browser fixtures were
preserved under ignored logs outside the frontend source directory.

Independent final reviews found no actionable issues in the controller,
metadata, history, focus or audio changes. Ryan's guest-flow refactor remains
byte-identical. Reports and source hashes remain under
`logs/private-inbox-review.local/`. Device, real-provider and hosted acceptance,
plus final-head CI/configured review, remain separate gates.

## Albums decisions — October 19, 2026

This batch reviews all 17 tracked files under `features/albums/`, their callers
and the private album contract. It starts from merged inbox PR #69 at
`a3b7f45`, on `feature/albums-directory-review`.

| File in `features/albums/` | Decision and reason |
|---|---|
| `api/albumActions.js` | Keep the coordinator's session, revision, write-fence and recovery boundaries. Fix the success notice: album organization preserves each memory's existing audience. |
| `api/albumApi.js` | Fix member-page duplicate detection to compare case-folded memory UUIDs, while preserving a valid single uppercase legacy ID. |
| `api/mockAlbumServer.js` | Fix mutation timestamps to remain nondecreasing when the clock moves backward; document its synthetic list-pagination limitation. |
| `api/albums.test.js` | Extend existing real-adapter tests with mixed-case duplicate IDs and clock rollback, retaining membership, no-op, ordering, stale-write and recovery coverage. |
| `albumName.js` | Keep: required names, raw UTF-16 limits, storable Unicode and trimming match the server contract. |
| `albumDisplay.js` | Keep: every label, nullish summary, count and feedback helper has active consumers. |
| `hooks/useAlbums.js` | Fix field-specific validation/correction focus, deliberate delete-cancel restoration and owned paging/filter/reload focus, including lifecycle cancellation and revision resets. |
| `components/Albums.jsx` | Keep the composition shell; wire the named paging target and field errors, preserving editor reset boundaries. |
| `components/AlbumNameForm.jsx` | Fix invalid-field focus and associated name-error markup. |
| `components/AlbumRecovery.jsx` | Fix separate original-name validation and correction without clearing server recovery feedback or relaxing its busy-only gates. |
| `components/AlbumDetail.jsx` | Keep member/tombstone behavior; attach the delete trigger for deliberate cancellation focus restoration. |
| `components/AlbumPaging.jsx` | Keep bounded previous/next/reload controls, using the hook's deliberate focus ownership. |
| `components/AlbumSelector.jsx` | Keep candidate summaries, review filters and private membership actions; route filter focus through the hook. |
| `components/AlbumList.jsx` | Keep: bounded loading, empty/error states and labelled album controls remain cohesive. |
| `components/AlbumMemorySummary.jsx` | Keep: metadata-only summaries do not fetch or preload originals. |
| `components/Albums.test.js` | Extend existing presentation contracts for field-specific errors, independent recovery feedback and named page focus. Mounted checks verify stateful transitions. |
| `albums.css` | Keep: all selectors have active consumers; no measured layout or efficiency defect justified changing them. |

The API decoder previously accepted two rows for the same memory UUID when
their capitalization differed. Only duplicate-comparison keys are folded;
returned identity spelling, legacy UUID support and wrong-ID, revision and
tombstone checks remain intact.

The mock's clock rollback previously committed a change whose timestamp failed
real response decoding. Its new timestamp clamp matches the server's
nondecreasing `updatedAt` rule, including no-ops and deletion. Its offset list
cursors still do not model production keyset pagination under concurrent list
edits; synthetic paging evidence does not establish that server behavior.

Album organization can include a memory already shared publicly or by private
link. A real-adapter/controller probe confirms its audience stays unchanged.
The corrected notice describes that behavior without implying that adding a
memory to a private album makes the memory private.

Browser reproductions establish lost focus after paging and delete cancellation,
unassociated local name errors that persist after correction, and lost reload
focus when another partner's revision resets the editor. Fixes preserve the
revision-based draft reset while keeping deliberate paging focus outside that
reset boundary. Initial rendering, ordinary typing, reactivation and cancelled
late reads do not replay focus requests. Local input correction clears only its
own validation message; server recovery feedback remains available.

The narrow inbox adapter now passes the same view/identity/revision reset key
into an album editor inside a persistent feature boundary. Its existing test
checks both that reset contract and the boundary's unkeyed ownership; other
feature adapters retain their prior keys. This is integration coverage for the
albums change, rather than a second inbox directory review.

## Albums verification

The 21-test album baseline passed. The two new API regression cases failed
against the original decoder/mock and pass after the fixes. Final verification
passes **24 focused album/adapter tests**, **534 frontend tests** with no skips,
ESLint and the production build on Node 24.16.0. No tracked test files or
dependencies were added.

Mounted Chromium in React StrictMode passes **188 assertions** at 1280, 390 and
320 px. It covers list/member/selector paging, filters, failed reads and reloads,
partner revision resets, late success/failure after blur, name correction,
delete cancellation, shared-memory notices, membership/order changes and
pagehide recovery with a deliberate exact-name retry. Create/delete still work,
and all 21 synthetic original memory records remain identical as JSON. No page
errors, external requests or horizontal overflow were observed. Desktop and
narrow validation/recovery screenshots were inspected.

Independent reviews found no remaining actionable issues in API/mock behavior,
focus ownership, recovery wiring or the per-file decisions. Ryan's guest-flow
refactor remains byte-identical. Browser/server resources are closed and the
temporary harness is preserved outside frontend source under ignored logs.
Reports and source hashes remain in `logs/albums-directory-review.local/`.
These synthetic frontend checks do not repeat real backend/provider or device
acceptance. Final-head CI/configured review remains required after PR creation.

## Library and tags decisions — October 19, 2026

This batch reviews all 27 existing files under `features/library/` and adds one
feature-local read-focus helper. It includes library search, tag management and
memory attachments, their private inbox callers and the server contracts. The
review starts from `feature/library-directory-review` at `68b5ea4`, including
the reviewed timeline work and merged albums baseline.

| File in `features/library/` | Decision and reason |
|---|---|
| `api/libraryApi.js` | Keep: canonical tag IDs, case-folded legacy memory identity, exact fractional timestamp ordering, ETags, tombstones and filter truth checks match the private API contract. |
| `api/libraryActions.js` | Keep: applied search/page return context stays separate from draft tag-picker filters and queries; session/cancellation and privacy clearing remain with the host controller. |
| `api/tagActions.js` | Fix: capture the parent tag-list query before opening a memory and restore it on direct return; clear the private query on hide and navigation. Preserve write identity, reconciliation and name-fingerprint retry rules. |
| `api/mockLibraryServer.js` | Fix: clamp each existing tag's mutation timestamp to its own prior timestamp, matching backend `GREATEST(updated_at, action_time)` behavior after clock rollback. |
| `api/library.test.js` | Extend the existing suite with direct-return query restoration, explicit All-tags reset, hidden-query clearing and per-tag clock/no-op/create/delete regressions. |
| `components/Library.jsx` | Fix: retain deliberate read focus in the feature boundary while preserving the exact existing keyed editor reset contract; name the result or tag-picker page destination. |
| `components/Library.test.js` | Extend existing presentation tests for filter constraints, server feedback precedence, field-specific ARIA, named read destinations and reachable tag recovery. |
| `components/LibraryFilters.jsx` | Fix: associate search, type, review, precision and year errors with their controls and register the first invalid field as the correction focus target. |
| `components/LibraryPaging.jsx` | Keep: bounded result/picker paging uses the correct cursor stack and existing error/busy gates; the hook now owns request focus. |
| `components/LibraryRecovery.jsx` | Keep: reload uses the current applied filters or picker draft through the hook, without changing the recovery contract. |
| `components/LibraryResults.jsx` | Keep: literal metadata summaries, partial dates, Eastern saved times and original excerpts have active consumers and do not preload originals. |
| `components/LibraryTagChooser.jsx` | Fix: associate picker-query errors with its own field; preserve draft filters, explicit selection and cancellation arguments. |
| `components/MemoryTags.jsx` | Fix scoped query validation and owned read focus across picker resets, including closed-disclosure visibility guards. Simplify attachment-only recovery by removing its unreachable name-entry branch; retry still passes `undefined`. |
| `components/TagDetail.jsx` | Keep: member actions, tombstones and delete confirmation preserve memories and files; existing trigger/cancel refs support deliberate cancellation focus. |
| `components/TagList.jsx` | Fix: associate local search errors with the tag-query field; preserve labelled identity controls, counts and bounded results. |
| `components/TagMemorySummary.jsx` | Keep: pure metadata, attribution, date and excerpt rendering has active consumers and fetches no media. |
| `components/TagNameForm.jsx` | Fix: associate create/rename validation with the name input while keeping the existing value and submission contract. |
| `components/TagPaging.jsx` | Keep: list/member/selector paging and tombstone/error gates remain cohesive; deliberate read focus belongs to the hook. |
| `components/Tags.jsx` | Fix: retain read-focus ownership outside the exact existing view/identity/revision/query editor key and expose a named page destination. |
| `components/TagSelector.jsx` | Keep: review-status filters, metadata-only candidates and membership action arguments remain explicit and bounded. |
| `components/TagsRecovery.jsx` | Fix: associate original-name validation with its separate retry input; keep busy-only recovery gates and same-name retry behavior. |
| `hooks/useLibrary.js` | Fix: scope filter/picker validation, clear related local errors on correction and route deliberate reads through the persistent focus owner without changing applied-filter or draft-reset semantics. |
| `hooks/useLibraryReadFocus.js` | Add: one helper shared by Library, Tags and MemoryTags retains a single read destination across editor resets and suppresses late focus after lifecycle or interactive focus changes. |
| `hooks/useTags.js` | Fix: separate name/query/retry validation and correction, preserve delete-cancel restoration, and route paging/filter/reload focus through the persistent owner. |
| `library.css` | Keep: scoped responsive filters, cards, controls and recovery styles have active consumers; no measured layout or efficiency defect warrants a rewrite. |
| `libraryDisplay.js` | Fix: expose local filter/query errors using the existing normalization and date constraints, while giving current server feedback precedence. |
| `libraryFilters.js` | Keep: raw UTF-16/storable-text limits, trimming, required names and filter combinations already match the shared contract. |
| `tagDisplay.js` | Fix: prioritize current server read/mutation feedback over an older local validation message; retain the existing labels, counts and summaries. |

The query regression is a direct-return context bug: opening a memory from a
filtered tag list, searching the attachment picker and returning to that tag
previously left the picker query in the tag detail's catalogue context. Capture
the parent query privately before replacing that presentation, then restore it
when returning. The actual UI's **All tags** action explicitly passes an empty
query and intentionally starts an unfiltered list; that reset remains unchanged.
No browser-history format or persistent private search context is added.

Mock tag timestamps now clamp per existing tag, as the backend does. No-op
renames retain their revision and timestamp, deletion uses the clamped time,
and a newly created independent tag still uses the current clock. Existing
scope-bound keyset anchors, stale-revision checks and cursor error order remain
unchanged.

Library, Tags and MemoryTags keep their previous editor reset identities, with
deliberate read focus owned by their surrounding feature or memory boundary.
Paging, filters and reloads can therefore focus their named destination after
the response settles even when a partner revision replaces the local editor.
Blur, hiding, traversal and an interactive focus move cancel that intent;
ordinary typing and initial rendering do not request result focus. Memory-tag
feedback and destinations also require visible client rectangles so a closed
native details disclosure is not focused by a late response.

Local correction clears the relevant field errors while current server errors,
uncertain mutations and recovery controls remain available. Memory attachment
recovery supports only add/remove intents; full Tags management retains the
name-entry recovery needed for hidden create/rename attempts. No request,
fingerprint, retry-identity, original-memory or audience behavior is broadened.

The narrow `InboxScreens.jsx` and `MemoryDetail.jsx` integration passes the same
reset keys into inner editors while preserving their outer focus owners. The
existing inbox adapter test checks that contract. This wiring does not mark the
whole inbox directory reviewed again. No new tracked test files or dependencies
are added, and no unmeasured performance improvement is claimed.

## Library and tags verification — October 19, 2026

The initial focused baseline passed 24 existing API/presentation tests. Both new
API regressions fail against the original source; the updated API suite passes
**18/18 tests**, and the existing presentation suite passes **11/11 tests**.
The shared inbox adapter case brings the focused run to **30 passing tests**.
All **541 frontend tests** pass with zero skips, as do ESLint, the production
build and diff checks on Node 24.16.0. Independent source review found no
remaining actionable issues in the API, focus ownership, validation or recovery
wiring.

Mounted StrictMode Chromium verification passes **352 assertions** at 1280,
390 and 320 px: 149 Library checks and 203 Tags/MemoryTags checks. The actual
inbox controller and JSON mock adapter exercise bounded catalog/member/picker
pages, parent-query return, literal filters, chooser drafts, partner revision
reload, field correction, safe delete cancellation and terminal tombstones.
Late success/failure respects blur, interactive focus and closed disclosures.
Hidden rename attempts retain exact-name retry; hidden attachment attempts keep
their name-free retry and shared write fence. All 25 original synthetic memory
records remain identical as JSON in each fixture.

Both runs have no page errors, external requests or horizontal overflow.
Representative desktop/narrow validation and recovery screenshots were inspected;
owned browser/server resources are closed. The temporary harness is preserved
outside frontend source under ignored logs. Source hashes were recorded for all
28 current library files and the three integration files; guest-flow source
remains byte-identical. No backend or provider acceptance is claimed.

Ignored reports and logs are under `logs/library-directory-review.local/`.
These synthetic frontend checks do not establish real backend/provider, device
or assistive-technology acceptance. Final-head CI and configured review remain
required after PR creation. Merge timeline PR #71 before this branch.

## Export decisions — October 19, 2026

This batch reviews all 16 tracked files under `features/export/`, their inbox
callers, the portable-export contract and the corresponding backend behavior.
Work starts from `6de44fa` on `feature/export-directory-review`. Merged library
PR #72 is integrated at `926e42337bbddf974f6986a862429cbb4553ed60`, preserving
the reviewed export source. The portable ZIP format, backend jobs, original files
and operator-recovery format are unchanged.

| File in `features/export/` | Decision and reason |
|---|---|
| `api/exportActions.js` | Keep: known job/control identities, uncertain-action reconciliation, shared write fences, Retry-After, bounded downloads, separate successful page commits and owned Blob URL cleanup remain cohesive and tested. |
| `api/exportApi.js` | Keep: canonical job/attempt/generation identities, bodyless conditional controls, bounded owner-checked pages and response validation match the current contract. |
| `api/exportDownload.js` | Fix: retain the validated byte size, filename and checksum before asynchronous fetch/hash work so caller mutation cannot change the verification target. Keep the existing single-part bounds, stream cancellation and integrity checks. |
| `api/mockExportServer.js` | Fix: match scoped cursor/limit errors, content-free terminal cleanup, attempt outcomes, idle/hard expiry and preparation admission; prevent a late digest from resurrecting cancelled work. Keep its explicitly synthetic ZIP/provider limits. |
| `api/export.test.js` | Extend the existing suite with delayed descriptor mutation and mock cursor, lifecycle, admission and digest-race regressions; retain controller retry, cancellation, pagination and URL ownership coverage. |
| `hooks/useExportArchive.js` | Fix: bind cancellation confirmation and Keep-export focus to the current job identity, own separate status/parts/warnings read destinations and suppress late focus after lifecycle or interactive focus changes. |
| `components/ExportArchive.jsx` | Fix: pass hook-owned actions and focus refs through the existing shell; retain warning-page controls when a non-first page becomes empty. |
| `components/ExportArchive.test.js` | Extend the existing presentation suite with distinct focus destinations and empty-tail warning recovery, preserving feedback, busy/lock and native save contracts. |
| `components/ExportGuide.jsx` | Keep: extraction, completeness, missing-original and device-save guidance describe the portable format without claiming a successful browser save. |
| `components/ExportIssues.jsx` | Fix: expose a named warnings-page destination and an explicit empty-page message while keeping Previous available on a valid empty tail. |
| `components/ExportParts.jsx` | Fix: expose a named part-page destination; keep bounded paging and the original-results-before-index preparation gate. |
| `components/ExportPreparedPart.jsx` | Keep: byte progress, verified Blob links and deliberate native save actions retain separate meanings and existing busy gates. |
| `components/ExportRecovery.jsx` | Keep: pending/uncertain/CSRF controls preserve deliberate status reads, exact retained retries and busy-only recovery gates. |
| `components/ExportStatus.jsx` | Fix: expose a named status-read destination; preserve progress/expiry summaries and the hook's deliberate cancellation controls. |
| `exportDisplay.js` | Keep: labels, terminal/preparation guards, feedback precedence and byte summaries have active consumers and useful boundaries. |
| `export.css` | Keep: responsive summaries, prepared filenames, warnings and progress rules have active consumers; no measured efficiency issue warrants a change. |

The binary helper is an exported API boundary. The live inbox controller already
deep-freezes its prepared-part descriptor, but a direct API caller could mutate
the raw descriptor during fetch or hashing. A delayed fetch then rejected valid
original bytes against replacement metadata; a delayed checksum could instead
accept bytes against a newly substituted checksum. Retain the three validated
verification scalars synchronously without freezing or modifying the caller's
object. Both failure modes are reproduced in the existing transport suite.

The mock now uses canonical job/route-scoped page cursors and validates page
limits in the backend's order. Cancellation and expiry discard captured counts,
results and cached parts and fail running attempts; a later cancellation does
not replace an existing terminal reason. Activity extends only the idle deadline,
bounded by the absolute lifetime. A progress read records activity before its
asynchronous digest, so crossing the old idle deadline while that admitted read
finishes does not expire the job prematurely.

Preparation rejects an early index or conflicting work and distinguishes a
recorded running attempt from a resolved attempt. After hashing, the mock checks
that the same preparation still owns the job before publishing a cached part.
These changes repair observable mock contracts; its tiny empty ZIP, single
original batch and synthetic session/scenario model do not simulate provider
verification, the full production worker or hosted capacity.

The existing coordinator still preserves both part and issue pages during a
transient paging request or failure, committing only a successful replacement.
The UI now owns a separate one-shot focus destination for each page family and
status reads. Blur, hiding, traversal or moving focus to another interactive
control cancels late focus. Cancellation confirmation is tied to the current
job, so replacing or retiring that job cannot expose an old confirmation against
a new export. Keep export restores only the matching active job's trigger.

A valid warning-page offset can become an empty tail when another read or part
retry changes the warning list. The non-first page now keeps its destination,
empty-page message and Previous control. Progress reads, retries, original
processing and native save requests remain explicit. No new tracked test files,
production modules or dependencies are added, and no runtime-performance
improvement is claimed.

## Export verification — October 19, 2026

The focused baseline passed 26 existing API/presentation tests. Both new binary
descriptor cases failed before their fix; six mock contract cases failed against
the prior mock, and a further admitted-read timing regression failed before its
touch-order correction. The updated existing suites pass **31 API tests** and
**five presentation tests**, with zero skips. The shared inbox adapter case
brings the focused run to **37 passing tests**. All **551 frontend tests** pass
with zero skips; ESLint, the production build and diff checks pass on Node
24.16.0. Independent source and integration review found no remaining actionable
issues in the UI, mock lifecycle, paging/admission or download verification
changes. Terminal presentation fixtures now reflect content-free backend state;
active warning fixtures retain the separate paging assertions.

The final mounted StrictMode Chromium run passes **239 assertions** across
1280, 390 and 320 px,
preserving all 25 synthetic original memory records as identical JSON. Three
actual browser-saved 22-byte empty-ZIP fixtures pass size and SHA-256 checks;
this verifies the synthetic native-save path, not portable archive contents or
provider originals. The run reports no page errors, external requests or
horizontal overflow. It covers successful/failed next and previous reads for
both page families, retained content/cursors, empty warning tails, progress
checks, late responses, job-bound cancellation, same-identity recovery and
checksum rejection. Verified Blob URLs survive ordinary save-related blur and
are revoked on navigation or private hiding; resume freshly checks the opaque
job and does not restore the download link.

Representative desktop/narrow warning, cancellation and prepared-download
screenshots were inspected. Browser/server resources are closed, and the
temporary harness is preserved outside frontend source. All 17 source hashes
(the 16 export files and unchanged inbox adapter) match the final browser/test
snapshot; guest-flow source remains byte-identical. No new tracked test files,
production modules or dependencies are added.

The full suite, lint and build also pass on a separate copy containing the
export changes over the committed baseline. The final delivery additionally
includes the two existing contribution files from `5741362`: expanded display/
hook formatting and extraction of the existing submit-failure handler. Review
confirms unchanged ownership guards, validation and retry behavior. All 551
tests, lint and build pass again with those changes included in the same branch.
The export/adapter hashes match both verification copies; this small readability
change does not mark the contribution directory reviewed again.

Ignored reports and logs are under `logs/export-directory-review.local/`.
These frontend checks do not repeat real backend/ZIP/provider acceptance or
establish physical-device, assistive-technology, native save-dialog or hosted acceptance.
Final-head CI and configured review remain required after PR creation.

## Shared API decisions — October 19, 2026

This batch starts from merged main `f2fa58e` on
`feature/shared-api-directory-review`. The tracked inventory contains 12 source,
fixture and test files plus one obsolete `.gitkeep`. Every file was reviewed
with its callers and the corresponding server contracts. Backend source was
read as contract evidence; this does not mark its packages reviewed.

| File in `shared/api/` | Decision and reason |
|---|---|
| `apiClient.js` | Fix: reject redirects before fetch can forward explicit API headers or JSON credentials. Keep same-origin cookies, no-store, safe diagnostics, structured field errors, deliberate retries and caller-owned deadlines. |
| `apiClient.test.js` | Extend the existing suite with native GET/POST redirect tests to same-origin and other-origin destinations, bounded deadlines and server cleanup. Keep existing transport/error/uncertainty contracts. |
| `archiveApi.js` | Keep: the small facade composes cohesive adapters, captures binary transports per instance, and preserves named exports and the ordered method surface. No measured cost or responsibility problem warrants extraction. |
| `archiveApiCompatibility.test.js` | Keep facade, transport capture and validation-order coverage. Fix the casing expectation: preserve legacy UUID route/response spelling while accepting the same identity returned in canonical server casing; continue rejecting unrelated IDs. |
| `archiveContracts.js` | Fix: reject null receipt members and case-equivalent duplicate memory/client IDs; validate inbox count, filter, unique identity and usable cursor. Reuse existing exact UTC helpers for valid calendar instants and submillisecond ordering. Keep normalization rules and returned objects unchanged. |
| `archiveApi.test.js` | Extend existing real-transport tests with malformed/duplicate receipts, equivalent UUID identities, bounded/scoped inbox responses and exact timestamp regressions. |
| `contributionApi.js` | Fix receipt/finalize expected-ID comparisons to compare UUID identity independently of case. Keep normalized input snapshots, private CSRF, original upload bodies, permission checks, omitted storage credentials and explicit recovery. |
| `memoryApi.js` | Fix detail/review/metadata expected-ID comparisons and pass the requested inbox limit/status into decoding. Keep conditional revision/ETag checks, normalized metadata snapshots and HTTPS playback permissions. |
| `sessionApi.js` | Keep: its three methods forward current CSRF and cancellation to the shared transport; session owners already manage access recovery, private-state clearing and bounded completion. |
| `mockArchiveApi.js` | Fix monotonic mutation timestamps, review audience/receipt synchronization and active-grant reuse with one injected server clock. Prefer the latest issued unexpired grant after clock rollback. Keep explicit synthetic byte-verification and offset-pagination limitations. |
| `mockArchiveApi.test.js` | Extend the existing suite with timestamp/no-op/deletion-deadline, audience/original-preservation and grant identity/expiry/rollback regressions. |
| `v1/fixtures.js` | Keep: executable synthetic requests, responses and scenarios have active test/preview consumers; mocks clone their records, and far-future example expiries are explicitly synthetic. |
| `.gitkeep` | Simplify: remove the whitespace-only placeholder now that this directory contains tracked implementation files. |

Consumer tracing covers guest text/photo/audio coordinators, private creation,
inbox reads/mutations/media, albums, timeline, library/tags, sharing, export and
the development preview. The feature adapters retain their responsibilities;
no new production module, dependency or tracked test file is introduced.

Native-fetch and browser reproductions show that the prior JSON client followed
a 307 response and forwarded synthetic JSON credentials, CSRF and retry-key
headers to its destination. Same-origin cookie policy does not suppress those
explicit headers or request bodies. The API has no redirect response contract.
The client now uses `redirect: "error"`; a refused redirect retains the existing
network-error semantics, with mutations uncertain and no automatic retry.
The original endpoint may already have acted, so rejection does not imply rollback.

The old receipt decoder accepted two distinct client items mapped to one memory
UUID with different capitalization. The actual photo coordinator could then
report both originals saved. Duplicate-comparison keys now fold UUID case while
the returned receipt and IDs stay intact. A null member previously escaped as a
raw TypeError; it now produces a classified contract mismatch through the real
JSON transport. Route comparisons likewise accept canonical server responses to
valid uppercase legacy IDs without changing the request path or response object.

Inbox pages now respect their requested limit and review filter, reject repeated
UUID identities, and require null or a nonempty continuation cursor of at most
256 characters, matching `InboxCursor`. Existing controller tests returned KEEP
rows for an initial PENDING request; their synthetic transport now filters its
response and asserts that the intended metadata detail was actually opened.
The production controller's audience-preservation checks remain unchanged.

The existing `instantKey` and `compareInstants` helpers already validate actual
Gregorian UTC timestamps through nine fractional digits. Reusing them avoids
Date.parse calendar normalization and millisecond truncation of ordering checks.
Equal instants with different fractional padding remain valid and unchanged.
No global time abstraction or feature reset behavior is introduced.

Mock review and metadata actions clamp updatedAt against its prior value, while
the first deletion deadline still uses the action clock and no-ops retain their
revision/timestamps. Explicit KEEP audience changes update both memory and
receipt; archive/deletion/restoration retain the server's private-state rules.
Repeated authorization retains an unexpired grant and its transfer state; expiry
renews only that item's permission. A follow-up regression prevents an older
grant from becoming preferred when the clock rolls backward. Related existing
private-upload and journey fixtures pin their synthetic client/server clocks,
so fixed calendar dates cannot silently expire every test upload in the future.

These are correctness and contract changes. No runtime performance improvement
is claimed. Existing facade/adapters, owner deadlines, immutable contribution
drafts and same-intent retry fences remain useful boundaries.

## Shared API verification — October 19, 2026

The initial shared API baseline passed **82 tests**. Redirect, receipt/identity,
inbox, mock lifecycle and timestamp defects were reproduced before their fixes
in existing suites. One equal-fraction timestamp case was already valid and is
retained as compatibility coverage. Independent review reproduced and resolved
the older-grant-after-clock-rollback follow-up.

Final verification uses Node **24.21.0** and npm **11.19.0**. The four shared API
suites pass **97 tests**, and the complete frontend passes **566 tests** with no
failures or skips. ESLint, the production build and diff checks pass. The build
retains its existing large-chunk advisory. Existing private-creation and journey
suites verify the corrected injected clocks and query fixtures.

Mounted React StrictMode checks at **1280, 390 and 320 px** exercise the actual
guest note form and private inbox/controller with the real JSON adapters and
synthetic responses. **33 harness checks and 27 DOM assertions** cover native
browser redirect behavior before/after, duplicate-photo receipt rejection,
wrong-filter inbox rejection, retained/locked notes after malformed success,
deliberate retry with the same key/body, confirmed completion, session access,
public audience changes, private archive/restore and unchanged original text.
The duplicate-photo check uses the actual batch coordinator; it is not a file
picker or real-storage acceptance test. No horizontal overflow occurs in the
checked note/private views; desktop and narrow screenshots were inspected.
Preliminary fixture correction and hot-reload warnings are excluded from passing
metrics and retained in the local report.

All browser fixtures, reports and baseline/final source hashes are retained under
ignored `logs/shared-api-directory-review.local/`, outside frontend test discovery.
Owned browser/server resources are closed after verification. Concurrent backend
formatting edits are preserved and excluded from this frontend delivery. These
checks do not repeat backend persistence, provider, physical-device or assistive-
technology acceptance. Final-head CI/configured review remains required after
Ryan creates the PR. The next directory is `frontend/src/shared/components/`.

## Shared components decisions — October 19, 2026

This batch starts from shared API `889033b` on
`feature/shared-components-directory-review`. The baseline inventory contains
exactly two tracked files. Shared API PR 74 has since merged as main `d759119`;
its source tree matches this batch's starting commit. This branch's remaining
diff against main contains only the component cleanup and these review notes.

| File in `shared/components/` | Decision and reason |
|---|---|
| `MemoryChoice.jsx` | Simplify: expand dense icon and button JSX into the surrounding multiline style. Keep the native button, three static icons, visible content, optional prompt, callback and native disabled prop. Rendered markup is unchanged. |
| `.gitkeep` | Simplify: remove the whitespace-only placeholder now that the directory contains a tracked component. |

The two live consumers are guest `App.jsx` and private `AddMemory.jsx`. Both use
the note/photo/audio kinds and own their audio gate and navigation. The guest
consumer supplies prompts and draft/completion titles; `guestHistory.js` uses
the existing kind classes to restore home focus. The private consumer omits
prompts, preserves initial focus, and deliberately focuses the selected compose
group or the memory-type group after sharing another memory. Root/inbox routing,
relevant global/guest/private styles and existing consumer/history tests were
also inspected. The development preview does not consume this component.

No correctness defect or measured efficiency problem was found. The component
has no asynchronous work or resource ownership to extract, and the static icon
map already avoids rebuilding icon definitions per render. Additional state,
memoization, validation or an expanded prop API would add unnecessary machinery.
No consumer or stylesheet change, dependency, production module or tracked test
file is introduced. This batch does not mark the styles directory reviewed.

## Shared components verification — October 19, 2026

On Node **24.21.0** / npm **11.19.0**, the four existing focused consumer,
reducer and history suites pass **54 tests**. All **566 frontend tests** pass
with zero failures or skips; ESLint, production build and diff checks pass. The
build retains its existing large-chunk advisory. Independent before/after
verification compares **18 identical server-rendered outputs** across all three
kinds, prompt presence and omitted/false/true disabled values, with **198 total
assertions** including prop/callback contracts. Independent source review found
no remaining actionable issues.

Mounted StrictMode Chromium checks pass **56 assertions** at **1280, 390 and
320 px**. They cover Enter/Space activation without parent-form submission,
disabled tab skipping, visible keyboard outline, hidden decorative SVGs, audio
gating, guest draft/completion titles and restored focus, and private type,
completion and share-another focus. Both actual consumers are mounted with
synthetic receipts; microphone permission and backend/storage writes are not
part of this check. Final card-width/touch-target and overflow checks pass;
desktop and narrow screenshots were inspected. Misleading preliminary screenshot
captures were replaced without a production or fixture source change. The final
browser console has no warnings or errors.

Ignored evidence, baseline/final source hashes and the ready PR description are
under `logs/shared-components-directory-review.local/`. Owned browser/server
resources are closed after verification. Concurrent backend edits stay excluded.
Physical-device, assistive-technology and provider acceptance remain separate;
final-head CI/configured review is required after Ryan creates the PR. The next
directory is `frontend/src/styles/`.
