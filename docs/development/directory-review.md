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
