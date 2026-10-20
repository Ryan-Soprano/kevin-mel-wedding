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

## Styles decisions — October 19, 2026

This batch starts from shared-components `c8c5a4d` on
`feature/styles-directory-review`. All ten tracked files, including font binaries
and provenance documentation, were reviewed with their consumers. Latest fetched
main remains `d759119`; merge the shared-components PR before this styles PR so
the final diff against main contains only this batch.

| File in `styles/` | Decision and reason |
|---|---|
| `global.css` | Simplify: remove unused legacy note-preview, single-photo selection/filename and guest-choice rules, plus unused members of grouped selectors. Keep native controls, hidden content, active preview images, batch/retry states and responsive base layout. |
| `guest.css` | Simplify: remove unused welcome-title/names/introduction and audio-help selectors, including their mobile rules. Remove two note declarations already overridden by later rules of equal specificity. Preserve active guest variants and unscoped shared styles used by private creation. |
| `guestWelcome.css` | Simplify: remove the exact ampersand declaration already supplied by `guest.css`. Keep the actual welcome layout, typography overrides and desktop/mobile breakpoints. |
| `guestFonts.css` | Correct the license-location comment to `public/licenses/fonts/`. Keep the four local faces, regular/italic and variable-weight declarations, and `font-display: swap`. |
| `tokens.css` | Keep: all nine base color tokens have active consumers; guest overrides stay scoped to the guest page. |
| `fonts/README.md` | Keep: local font provenance, static/variable descriptions, system fallbacks and public deployment-license paths match the files and consumers. |
| `fonts/fraunces-latin.woff2` | Keep: metadata declares Fraunces regular 400, matching guest heading use and its local face. |
| `fonts/fraunces-italic-latin.woff2` | Keep: metadata declares Fraunces italic 400, matching the ampersand and prompt treatment. |
| `fonts/manrope-latin.woff2` | Keep: the variable weight axis covers 200–800, matching the declared guest body/control family. |
| `fonts/caveat-latin.woff2` | Keep: metadata declares Caveat regular 400, used by the actual scrapbook caption. |

Consumer tracing covers the production entry/Root, guest App, shared memory
choices, guest gallery/scrapbook, contribution, photo and audio screens, private
Inbox/AddMemory and the separate development PreviewApp. Generated screen/kind
classes remain live. `PhotoPreview` still uses `.photo-card__image`, and
`PhotoPicker` still supports its standalone/default grid. Filename text remains
available through current accessible labels; the removed filename class is
already absent from the actual component markup. Private creation imports
`guest.css` without depending on the welcome overrides, so these layers retain
their current responsibilities.

No live correctness defect or measured runtime-efficiency problem was found.
The change removes obsolete/ineffective declarations without redesigning the
site or claiming a runtime performance gain. New or rewritten code follows the
expanded formatting preference; untouched CSS is not reformatted wholesale.
No component logic, feature stylesheet, dependency, production module or tracked
test file is added or changed.

## Styles verification — October 19, 2026

On Node **24.21.0** / npm **11.19.0**, the focused existing consumer/reducer/
history baseline passes **54 tests**, and all **566 frontend tests** pass with
zero failures or skips. ESLint, production build and diff checks pass. An initial
sandboxed baseline hit a Vite dependency-cache rename permission error; the run
with the required local permissions passed. The build retains its existing
large-chunk advisory. Independent source review confirms every removed selector
is unused, duplicated or already overridden, with no actionable findings.

Before/after mounted StrictMode Chromium checks capture **48 equivalent views**
at **1280, 801, 800, 799, 390 and 320 px**. Across guest home/note/photo/audio,
private creation, populated guest/private presentation specimens and the actual
development preview, all **46 captured computed-style properties** and element
width/height/x-position match for **3,684 compared nodes**. No checked view has
horizontal overflow. This includes the existing 800 px welcome/card breakpoint
boundary; distinct guest and private layouts remain intentional.

A further **25 interaction assertions** cover all four loaded local faces,
keyboard card/summary/file-panel outlines, empty-note validation and completion,
home/private-compose focus, long original filenames/captions, photo previews and
retry checkboxes, disabled/invalid fields, synthetic recording presentation,
tabular timer numerals, audio disclosure and private token/font scope. Final
console warnings/errors are absent; representative narrow screenshots were
inspected. Recording/clip specimens use injected presentation props, not actual
microphone capture or playback acceptance. Synthetic note receipts do not write
to a backend or storage provider. Existing reduced-motion rules remain intact.

Local WOFF2 directory/Brotli/table metadata checks validate lengths, family,
style, weight and representative character coverage for all four unchanged
assets. All four built font files and three deployed OFL license texts match
their source bytes. These checks verify local assets and delivery, not an
independent upstream provenance signature.

All **566 tests**, lint and build also pass in an ignored intended-source copy
created from `c8c5a4d` plus only the four stylesheet changes. Dependencies are
linked locally while Vite caches stay separate. This check excludes concurrently
edited gallery tests and newly added gallery assets; it does not validate that
separate gallery work. All ten styles/typography hashes match the browser/test
snapshot. The delivery source and documentation hashes are retained locally.

Ignored baseline/final captures, font metadata, asset checks, source hashes,
logs and the ready PR description are under `logs/styles-directory-review.local/`.
Owned browser/server resources are closed; concurrent backend and gallery edits/
assets stay excluded. Physical-device, assistive-technology, provider and hosted acceptance
remain separate. Final-head CI/configured review is required after Ryan creates
the PR. The next directory is `frontend/src/dev/`.

## Development preview decisions — October 19, 2026

This batch starts from styles `41bf666` on `feature/dev-directory-review`.
Styles PR 76 has since merged as main `838b5a0`, whose source tree matches that
baseline. All three tracked files were reviewed with their consumers. Entry
HTML, build/packaging configuration and related documentation were read as
boundary evidence; this does not mark those entire areas reviewed.

| File in `dev/` | Decision and reason |
|---|---|
| `PreviewApp.jsx` | Fix: a failed receipt refresh must not replace the original upload action error or downgrade its uncertainty. Retain the last confirmed receipt on a failed read. Expand imports, diagnostics, calls, handlers and JSX into the agreed readable style; keep the single mock instance, independent keys and real photo-form injection. |
| `contractPreview.jsx` | Simplify formatting: expand the DEV guard into a block. Keep the separate root/entry and existing production boundary. |
| `contractPreview.css` | Simplify formatting: expand selectors and declarations without changing their order or values. Keep native control, focus, responsive wrapping and diagnostic-output styles. |

The entry chain is `contract-preview.html` -> `contractPreview.jsx` ->
`PreviewApp.jsx` and its CSS. No production app module imports this preview.
The normal Vite build starts from `index.html`; packaging copies its `dist`
output. Existing packaged/container smoke checks reject development source and
preview routes. The fixture scenarios, shared mock/real JSON adapters, actual
photo form/coordinator, base CSS and current README/verification references were
traced. Historical single-photo evidence remains historical; the current preview
uses `PhotoBatchForm`.

With a retained two-photo receipt, `networkError` or `unavailable` makes both the
upload action and its recovery GET fail. Previously the GET rejection replaced
the original error, changing `unknownOutcome: true` to `false` and the displayed
next step to generic correction/retry. A failed read cannot establish the earlier
mutation's outcome. The nested recovery catch now leaves the confirmed receipt
intact and always rethrows the original error; successful receipt reconciliation
still updates state. Known transfer/validation failures remain known failures.

The mock/API instance and form factory retain stable ownership. Raw and embedded
form demos keep separate retry keys and busy state; no defect justified coupling
their lifecycle. The photo coordinator still owns immutable originals, disposal,
partial recovery and saved-item skipping. Login still reads fresh CSRF and logout
clears its local session after confirmation. No new abstraction, dependency,
production module or tracked test file is introduced; no runtime performance gain
is claimed. Mechanical formatting is isolated in commit `722259d` before the fix.

## Development preview verification — October 19, 2026

On Node **24.21.0** / npm **11.19.0**, the existing mock/photo baseline passes
**79 tests**. The final intended-source copy, created from `41bf666` plus only the
three dev changes, passes all **566 frontend tests** with zero failures or skips,
ESLint, production build and diff checks. Its dependency links use separate Vite
caches. Concurrent backend and gallery edits/assets remain excluded. The build
retains its existing large-chunk advisory.

Independent mechanical verification passes **seven assertions**: normalized
module syntax preserves imports/actions/control flow, ordered CSS declarations
match, and initial server-rendered markup with the real photo form is identical
at **4,703 bytes**. An exact-source function probe with the real mock/adapter
confirms the prior uncertainty downgrade and passes **33 final assertions across
six recovery cases**. It checks original error identity, failed/successful receipt
reads, retained receipt state, known rejection, sequential completion and partial
retry with the same IDs while skipping a confirmed sibling.

The actual development entry passes **50 mounted browser assertions** at
**1280, 390 and 320 px**. Before/after initial views match **21 captured style
properties** and dimensions across **210 nodes**. Both original misleading errors
were reproduced before the fix; final checks preserve their uncertainty and
same-key guidance. Text replay/conflict/new intent, partial raw recovery, expired
grant renewal, synthetic login/inbox/empty/logout, keyboard focus and the real
two-file photo form's deliberate unsaved-item retry all pass. The confirmed
embedded form survives an independent raw batch action. No checked initial,
completed-form or narrow diagnostic view has horizontal overflow; final console
warnings/errors are absent and representative screenshots were inspected.

The final intended build has no preview HTML and no matches for six checked
preview/mock markers in generated HTML/JS/CSS. This confirms normal-build
exclusion; it does not repeat container/hosted route smoke tests. Browser uploads
use two tiny synthetic PNGs and the mock does not verify/persist original bytes.
These checks do not establish real storage, microphone, physical-device,
assistive-technology or release acceptance.

Independent final source review is clear. Ignored evidence, reproduction/proof
scripts, baseline/final source hashes and a ready PR description are under
`logs/dev-directory-review.local/`. Owned browser/server resources are closed.
Final-head CI/configured review remains required after Ryan creates the PR. The
next planned phase is backend package review, starting with request/security
boundaries.

## Backend request/security decisions — October 19, 2026

This batch starts from `7926778` on
`feature/backend-request-security-review`. Its backend tree is identical to
fetched main `2c59d92`, which includes the merged gallery and development-preview
PRs. All **38 tracked files** in the production `security/` and `web/` packages
and their test packages were reviewed with their consumers. The existing
`data/DatabaseMigrationTest.java` is also extended for login-throttle persistence.
Properties, migrations, runtime configuration, private services, frontend API
callers and operator runbooks were read as boundary evidence; this does not mark
those entire directories reviewed.

| File in production `security/` | Decision and reason |
|---|---|
| `.gitkeep` | Keep out of this delivery: obsolete in a populated package, but its working-tree deletion predates this review and belongs to concurrent placeholder cleanup. |
| `AccountAdministration.java` | Keep: console-only commands, hidden credential entry, confirmations and redacted diagnostics preserve the operator boundary. |
| `AccountAdministrationStore.java` | Keep: transactional row locks, disabled creation, credential-version increments, production identity restrictions and cleared credential buffers protect recovery and revocation. |
| `AnonymousProtectionConfiguration.java` | Keep: explicit servlet registration orders guest admission after security/staging and before MVC without duplicate filter execution. |
| `AnonymousSubmissionFilter.java` | Keep: exact guest routes, origin/contract/retry validation, bounded known/unknown-length bodies and safe store failures remain cohesive. |
| `AnonymousThrottle.java` | Keep: keyed operation/global/peer/retry scopes, canonical UUIDs and captured connection peers prevent raw identity storage and forwarding-header quota bypass. |
| `AnonymousThrottleRepository.java` | Keep: database time, row locks, ordered scope consumption, inclusive window rollover and bounded cleanup on admitted/denied requests preserve durable limits. |
| `ArchiveAccessPolicy.java` | Keep: environment/profile, HTTPS/cookie, reveal and couple-identity checks serve distinct startup/request/direct-service boundaries. |
| `ArchiveAccount.java` | Keep: immutable account state and redacted string representation avoid credential disclosure. |
| `ArchiveAccountRepository.java` | Keep: parameterized fresh lookups preserve current account and credential-version decisions; no cache is justified. |
| `ArchiveAuthenticationConfiguration.java` | Keep: the existing DAO authentication provider composes the account mapper and password encoder directly. |
| `ArchiveAuthorization.java` | Keep: fresh account/version/role checks at service entry and after lock waits remain necessary alongside the HTTP filter and background export checks. |
| `ArchivePrincipal.java` | Keep: identity/equality, authority mapping, credential erasure and redacted representation retain Spring Security semantics. |
| `ArchiveUserDetailsService.java` | Keep: a narrow repository-to-principal adapter preserves generic authentication failure behavior. |
| `CoupleRequestBodyFilter.java` | Fix: bound `POST /api/session` to 4,096 bytes before MVC parsing and credential work. Retain existing private-route limits and native request wrapping; expand imports, guards and stream methods. Use a generic oversized-request message suitable for login and private routes. |
| `LoginThrottle.java` | Keep: normalized username and captured direct-peer digests, production secret validation and positive retry headers protect the existing admission boundary. |
| `LoginThrottleRepository.java` | Fix: run the existing bounded expired-bucket cleanup after either denied reservation as well as admission. Preserve peer-first short-circuiting and current counters; expand the touched constructor/JDBC chain. |
| `RequestPeerCapture.java` | Keep: typed connection-peer capture occurs before forwarding, fails closed if unavailable and clears its owned request state. |
| `SecurityConfiguration.java` | Keep: explicit session persistence, CSRF rotation, narrow guest exceptions, deny-by-default routes and single filter construction preserve the authorization chain. |
| `SecurityErrorWriter.java` | Keep and reuse: the shared writer already produces safe correlated error envelopes outside MVC. |
| `SessionController.java` | Keep: the contract/header, current-session, login and logout endpoints delegate to the existing service boundary. |
| `SessionIdentityFilter.java` | Keep: current account/version checks invalidate revoked identities before protected access and fail safely on database errors. |
| `SessionService.java` | Keep: strict credential envelope/encoding checks, throttle-before-authentication, session/CSRF rotation, explicit context persistence and generic failures remain necessary after the new byte guard. |

| File in production `web/` | Decision and reason |
|---|---|
| `ApiException.java` | Keep: immutable field errors, safe authored messages and optional retry delay carry the API failure contract. |
| `ApiExceptionHandler.java` | Keep: consistent correlation/headers and sanitized database, conversion and body failures avoid leaking diagnostics. |
| `ApiResponseHeadersFilter.java` | Keep: early API no-store and generated request IDs cover security rejections without trusting inbound correlation headers. |
| `RequestOrigin.java` | Keep: exact origin and fetch-metadata checks agree with the existing v1 contract; absent Origin remains intentionally supported. |
| `StagingAccessConfiguration.java` | Fix wiring: inject the existing `SecurityErrorWriter` into the staging filter; preserve profile, startup guards and filter order. |
| `StagingAccessFilter.java` | Fix: use the shared writer for HTTPS, origin and Basic-auth rejection instead of partial hand-built JSON. Preserve codes/statuses/messages, the 401-only challenge, exact health bypass, bounded credential header and constant-time digest comparison. Expand touched guards. |
| `StagingAudioSpikeController.java` | Keep: staging-only, operator-gated exact classpath resources and restrictive response headers do not expose arbitrary paths or production routes. |

| File in test `security/` | Decision and reason |
|---|---|
| `AnonymousSubmissionFilterTest.java` | Keep: existing contract, origin, body-bound, wrapper and safe rejection cases exercise guest admission. |
| `AnonymousSubmissionHttpTest.java` | Keep: actual servlet/HTTP known-length and chunked bodies, durable quotas and retained note replay cover the guest chain. |
| `AnonymousThrottlePostgresTest.java` | Keep: real database rollover, concurrency, scope consumption and bounded maintenance cases cover guest persistence. |
| `AnonymousThrottleTest.java` | Keep: keyed scope, direct-peer, UUID, secret and safe-failure cases cover admission policy. |
| `RequestPeerCaptureTest.java` | Keep: listener ownership, forwarding resistance and missing-peer cases cover the connection identity boundary. |
| `SessionHttpTest.java` | Extend: valid exact-limit bodies remain accepted; oversized known/unknown-length and multibyte UTF-8 bodies return 413 without credential/throttle work. Retain existing session, CSRF, revocation and direct-service cases. |

| File in test `web/` | Decision and reason |
|---|---|
| `StagingAccessFilterTest.java` | Extend: assert complete correlated envelopes for all three staging rejections, no credential/body echo and challenge only on 401. Update constructor/context wiring and expand touched test code. |
| `StagingAudioSpikeHttpTest.java` | Keep: existing staging resource/production-boundary checks exercise the unchanged spike controller. |

`data/DatabaseMigrationTest.java` gains two real PostgreSQL regressions: a denied
peer prunes at most 1,000 expired buckets per call (1,000 then five from a
1,005-row fixture) while creating no new username bucket, and a denied account
still prunes expired rows while consuming
the admitted peer counter. Fresh buckets and current account/peer limits remain
intact. No new tracked test file, migration, dependency or abstraction is added.

Consumer tracing includes the guest contribution/media controllers, private
review/authoring, albums, timeline, library/tags, sharing, playback and exports;
background export authority; frontend session/JSON adapters and login ownership;
and staging/proxy/account-access runbooks. Similar authorization checks at HTTP,
service and post-lock boundaries intentionally remain separate. No measured
runtime performance gain is claimed. New and rewritten code follows the expanded
formatting preference without formatting the untouched packages wholesale.

The login guard reuses the existing bounded request wrapper. Its 4,096-byte
budget accommodates the permitted credential envelope, including escaped JSON,
while preventing large padding/fields from reaching JSON materialization and
credential work. CSRF and route authorization still precede this filter.
`GET`/`DELETE` session behavior and all guest quota rules stay unchanged.

Staging errors previously omitted the documented `requestId` and `fieldErrors`
members. The current frontend tolerates those omissions, so this is an API
consistency/correlation fix rather than a reproduced frontend failure. The
shared writer supplies the complete safe envelope for every staging rejection.

## Backend request/security verification — October 19, 2026

On Temurin **25.0.3+9-LTS**, Maven wrapper **3.9.16**, Spring Boot **4.1.1**,
Docker **29.7.2** and disposable PostgreSQL **17**, the existing focused baseline
passes **69 tests**. The new request/web regression run reproduces **five
failures across six tests** on the original behavior; the exact-limit positive
case already passes. Both new database regressions also fail on the original
repository, retaining 1,005 expired rows instead of five and one expired row
instead of zero. A separate recording-JDBC probe confirms the skipped-cleanup
control flow, with admitted cleanup as its positive control.

The final intended-source backend passes the full suite: **466 tests, zero
failures/errors, 464 passed and two skipped**. The skipped existing tests are
explicitly Linux-only symlink protections in `OwnedExportDirectoryTest` and
`OperatorRecoveryPostgresTest`; this Windows run does not establish those
results. The focused request/web suites pass **75 tests** without skips, and
`DatabaseMigrationTest` passes all **13** cases, including both cleanup
regressions. Existing local FFmpeg/ffprobe **9.0.2** executables are supplied
through process-scoped paths for the full audio suite; no binary is added to Git.
Docker initially failed to start its engine; Ryan reopened it before PostgreSQL
verification. Preliminary harness/overlay attempts are excluded from test totals.

A supplemental ignored Java probe passes **six actual HTTP/1.1 requests** against
embedded Tomcat and its own PostgreSQL container. A non-reading servlet observer
confirms `Content-Length` for known bodies and unknown length plus
`Transfer-Encoding: chunked` for genuine chunked bodies. Padded 4,097-byte and
multibyte 4,145-byte envelopes return 413 without creating any login buckets.
Both exact 4,096-byte envelopes reach authentication, returning generic 401 for
the nonexistent synthetic account while advancing only the expected HMAC
username/direct-peer counters. MockMvc separately verifies successful valid
credentials at the exact limit. JSON, no-store, matching canonical request IDs,
empty field errors and credential redaction pass. The probe's JVM, PostgreSQL
and Ryuk containers are confirmed absent after completion.

The ignored intended-source copy contains all **217 baseline backend files**
plus exactly the seven reviewed Java changes. Their SHA-256 hashes match the
visible sources; all **31 unchanged review files** retain their initial hashes.
Concurrent album/contribution/health/library formatting, gallery/supporting work
and placeholder deletions stay excluded. Independent source review is clear;
documentation review verifies all 38 inventory decisions and the API byte-limit
contract. New regression cases extend three existing test files.

Backend JAR packaging passes after the full suite (`-DskipTests package` avoids
repeating that completed run). Nine packaged boundary classes, including the
request wrapper and shared error records, match the tested class bytes; tracked
test classes are absent from the artifact. Diff checks pass. This verifies the
backend artifact and local request behavior; provider, hosted, device and release
acceptance remain separate. The two Linux-only checks require Linux CI.

Ignored inventories, before/after regressions, full-suite/package logs, wire
probe, source/class hashes and ready PR description are under
`logs/backend-request-security-review.local/`. Owned verification services are
closed. Ryan creates/merges the PR; exact-head CI/configured review remains
required. The next planned backend area is the contribution/domain boundary.

## Backend contribution decisions — October 19, 2026

This batch starts from request/security `bb60445` on
`feature/backend-contribution-review`. At review start, fetched main `4585a3e`
did not contain that parent; refreshed main `02ca9ae` now includes it, so this
batch can target main directly. All **eight production files** in
`backend/src/main/java/com/kevinmel/archive/contribution/` and its **one existing
package test file** were reviewed with their consumers. Six production files
already had local readability edits; their entry bytes were saved before the
review, and the final cleanup preserves their behavior. Unrelated working files
remain outside this batch.

| File in production `contribution/` | Decision and reason |
|---|---|
| `ContributionController.java` | Keep: shared contract/key validation, same-origin mutation checks, deliberate text/media dispatch, creation/replay status and capability-protected receipt delegation are cohesive. |
| `ContributionService.java` | Keep: text normalization and repository ownership stay narrow; strict v1/UUID-v4 header validation canonicalizes retry keys consistently with admission and consumers. |
| `ContributionRequest.java` | Simplify formatting: expand guards, loop bodies and constructor arguments. Keep raw UTF-16 bounds before normalization, exact ECMAScript whitespace, NUL/unpaired-surrogate rejection and blank optional-name handling. |
| `ContributionRepository.java` | Simplify formatting: expand JDBC chains, parameters, mapping/constructor arguments, signatures and guards. Keep exact SQL values, transactional insertion/rollback, normalized original fingerprints, separate conflict insertion/fresh lookup, source/author predicates, erased-key reservation and stable receipt ordering. |
| `ContributionReceipt.java` | Simplify formatting: use consistent indentation and one record component per line. Keep the small content-free response projection; current callers do not mutate or share its list in a way that justifies a defensive-copy refactor. |
| `ContributionScope.java` | Simplify formatting: group imports and expand components, scope construction, security-context reads and guards. Keep validated server-created scopes, per-account hashed retry namespaces, guest namespace exclusion, fresh authority checks and redacted string output. |
| `CoupleContributionController.java` | Simplify formatting: replace the wildcard annotation import with seven explicit imports; expand signatures, mappings, calls, response chains and the empty-body guard. Keep all four private routes, same-origin checks, canonical retry keys and no-store behavior. |
| `CoupleContributionService.java` | Simplify formatting: expand constructor/call arguments and guards. Keep account-derived scopes, rejection of non-null guest attribution, text/media dispatch and final authority checks inside the outer create/receipt transactions. |

| File in test `contribution/` | Decision and reason |
|---|---|
| `ContributionHttpTest.java` | Keep unchanged: nine existing real HTTP/PostgreSQL tests cover committed private receipts, normalization and raw Unicode bounds, media-disabled admission, replay/conflict/current state, concurrent convergence, blocked-winner rollback, insertion/commit failures and contract/origin checks. |

Consumer tracing covers guest text and media controllers, private authoring,
media grants/finalization and their scope/revocation checks; review, retention,
recovery and portable export; and shared text validators used by media metadata,
albums, timeline and library/tags. Frontend tracing includes the shared JSON
adapter/receipt decoder, text/photo/audio coordinators and authenticated private
creation adapter through the inbox controller and AddMemory. Existing migration,
upgrade/restart, photo/audio, review/retention and recovery tests were read as
boundary evidence. Those other packages are not marked fully reviewed here.

No concrete correctness, privacy or efficiency defect justified a behavior
change. The separate `ON CONFLICT` statement and subsequent READ COMMITTED lookup
remain necessary for visibility of a concurrent committed winner. HTTP, service
and post-lock/current-account checks protect different revocation windows; final
private-create authorization remains within its transaction so a revoked write
rolls back. These checks are retained.

Equivalent retries retain original identities/timestamps and immutable original
payload fingerprints while receipts expose current review/visibility state.
Purged media still reports `UPLOADED` in the receipt projection, retaining
completion for its retry identity without recreating erased content. Receipt
data omits content, guest names, authors, retry capabilities, filenames, storage
keys and upload grants.
Wrong key/source/author associations retain the same unavailable-receipt result.
No new abstraction, dependency, migration or tracked test is introduced, and no
runtime performance gain is claimed. The six edited files follow the expanded
formatting preference; the readable guest controller/service and existing test
remain intact.

## Backend contribution verification — October 19, 2026

The isolated entry-source baseline passes all **34 tests** in
`ContributionHttpTest`, `CoupleAuthoringHttpTest`, `DatabaseMigrationTest` and
`ContributionUpgradeRestartTest`, with zero failures/errors/skips. These existing
suites exercise actual HTTP, disposable PostgreSQL, concurrent retry/rollback,
actor isolation, revocation and populated legacy upgrade/restart behavior.

An ignored Java **25** parser comparison checks all **eight production files**
across committed `bb60445`, the saved entry snapshot and final visible sources.
Canonical ASTs match for both transitions, retaining exact string/character/SQL
values, annotations, modifiers, member/argument/statement order and meaningful
scopes. It ignores source layout/comments and unwraps only harmless single
terminal/expression statements directly used as control-flow bodies. Imports are
checked separately: only the exact seven named annotation imports replacing the
couple controller's wildcard are permitted, with ordering ignored. All other
import changes fail the comparison.

All **six negative controls** are rejected: a validation-limit change, SQL token
change, SQL text-block whitespace change, authorization statement reorder,
unexpected import and declaration-scope change. The entry snapshot remains
unchanged. This is parse-level structural evidence rather than type attribution
or runtime proof; ordinary compilation, full tests and independent source review
remain necessary. All **24 source hashes** are retained with the comparison.

The prior verified backend's eight contribution sources match the committed
baseline after CRLF normalization. Its **13 contribution classes** (eight
top-level and five nested) and the final compiled classes have identical
`javap -c -p -constants -s` output: instructions, descriptors and printed constants
match. This comparison excludes annotation, bootstrap-method and debug metadata
and does not assert raw class-byte equality. It supplements the AST, compilation
and HTTP/database evidence rather than replacing them.

The final intended-source full backend suite completes **466 tests: 464 passed,
zero failures/errors and two skipped**. The existing skipped cases are Linux-only
symlink checks in `OwnedExportDirectoryTest` and `OperatorRecoveryPostgresTest`;
they require Linux CI. This Windows run uses Temurin **25.0.3+9-LTS**, Maven
**3.9.16**, Spring Boot **4.1.1**, Docker **29.7.2**, disposable PostgreSQL **17**
and the existing local FFmpeg/ffprobe **9.0.2** paths for audio verification.

Maven reports success with exit code zero. After the tests completed, Surefire
reached its **30-second test-fork shutdown limit**. The saved thread dump shows
Spring's shutdown hook waiting in Hikari pool shutdown while cached test contexts
close. This is retained as a test-lifecycle diagnostic rather than described as
a clean shutdown. The test JVM and all **29 containers** identified across the
baseline/full-run logs are confirmed absent afterward. No contribution runtime
change is introduced to address this broader test-harness behavior; exact-head
CI/configured review must still cover the final branch.

Backend JAR packaging passes after the full suite (`-DskipTests package`). All
**13 packaged contribution classes** match the tested class bytes, and the
package test classes are absent. Independent final source/documentation review
and diff checks pass. The isolated backend contains all **217 baseline paths**
plus exactly the six reviewed Java edits, and all **nine visible scope hashes**
match the tested copy. At the preservation checkpoint, all **211 unrelated
dirty/untracked paths** matched their entry hashes/existence. Subsequent
concurrent gallery updates remain outside this delivery. No
tracked test is added or changed.

Ignored inventories, baseline/final logs, AST/negative controls, disassemblies,
class/source hashes, shutdown dump/cleanup evidence and ready PR description are
under `logs/backend-contribution-review.local/`. Local synthetic/storage fixtures
and database checks do not establish provider, hosted, physical-device or release
acceptance. Ryan creates/merges the PR after exact-head CI/configured review;
the next planned backend area is the media package.

## Backend media decisions — October 19, 2026

This batch reviews all **17 production Java files**, **22 existing test/support
files**, and **one placeholder** in the backend `media/` packages: **40 tracked
paths**. The `.gitkeep` deletion predates this task and stays excluded. The branch
starts from contribution head `47ec048`; unrelated album/library/health,
gallery/supporting work and other placeholder deletions stay outside this batch.

All 17 production files receive expanded formatting: explicit control-flow
blocks, readable parameters, records, constructor assignments, calls and builder/
JDBC chains. The controller's wildcard becomes six explicit annotation imports.
The mechanical cleanup and the photo-cache behavior fix are separate commits.

| File in production `media/` | Decision and reason |
|---|---|
| `AudioRequest.java` | Simplify formatting; keep strict single-original metadata, raw UTF-16 bounds, canonical IDs/types, normalized attribution/caption and length-prefixed fingerprints of every claim. |
| `AudioVerifier.java` | Simplify formatting; keep strict container framing, checksum/size, one supported audio stream, channel/sample/duration bounds, bounded full native decoding, private temporary input, process termination and operational 503 versus invalid 422 outcomes. |
| `MediaController.java` | Simplify formatting/imports; keep shared contract/key validation, same-origin checks, empty grant bodies and capability-protected grant/finalization delegation. |
| `MediaService.java` | Simplify formatting; keep normalized guest/private creation, configuration availability, replay/admission policy, current-account checks, live-grant reuse, original/staging budgets and nonblocking finalization permits released after transaction completion. |
| `MediaTypes.java` | Simplify formatting; keep canonical immutable type sets and coherent byte/duration/container/codec predicates used by playback, recovery, sharing and export. No new constant-alias abstraction is justified. |
| `ObjectStorage.java` | Simplify formatting; keep the narrow storage contract and small upload/read grant projections shared by production and test adapters. |
| `PhotoAdmissionPolicy.java` | Simplify formatting; keep positive configuration validation, separate original/staging budgets, deliberate pause behavior and overflow-safe capacity subtraction. |
| `PhotoFinalizer.java` | Simplify formatting; keep grant ownership validation before replay, expiry, bounded candidate verification and publication of those exact bytes to a server-only original key. Invalid media commits FAILED before the outer service emits 422; operational failures remain retryable. |
| `PhotoRepository.java` | Simplify formatting; keep READ COMMITTED retry convergence, advisory admission locking, guest/source/author ownership, memory-then-asset lock order, conservative reservations, retained grant identity and verified metadata transitions. Exact SQL values remain intact. |
| `PhotoRequest.java` | Simplify formatting; keep one-to-five ordered items, raw string/filename/scalar validation, normalized IDs, duplicate detection and fingerprints including every claim and item order. |
| `PhotoVerifier.java` | Fix the reproduced dependency on ImageIO's global disk cache by explicitly using a memory image stream for already bounded bytes; also expand formatting. Keep integrity, actual format, dimensions/pixels, subsampled decode/warning rejection, reader disposal and original-byte ownership. |
| `PlaybackController.java` | Simplify formatting; keep authenticated private playback and no-store response headers. |
| `PlaybackRepository.java` | Simplify formatting; keep the complete verified media tuple and event/review/audience/purge eligibility predicates with a narrow private projection. |
| `PlaybackService.java` | Simplify formatting; keep current access validation, exact original key/type/size/codec checks, verified-object HEAD through storage and a bounded signed link. Sharing reuses the same verified-original validator. |
| `R2ObjectStorage.java` | Simplify formatting; keep exact key/size/MIME signing scope, actual bounded expiry, original HEAD checks, bounded reads with abort/close, verified-byte publication, conditional recovery/tombstone writes and safe errors. |
| `R2StorageConfiguration.java` | Simplify formatting; keep opt-in startup validation of private endpoint, bucket and credentials and close ownership of the SDK clients. |
| `StorageConfiguration.java` | Simplify formatting; keep injectable UTC time and fail-closed disabled storage, including private-read errors. |

| File in test `media/` | Decision and reason |
|---|---|
| `AlbumHttpTest.java` | Keep unchanged: conditional identity/revisions, membership concurrency, revocation, photo/audio eligibility and deletion preserve originals. |
| `AudioFinalizationFailureTest.java` | Keep unchanged: missing/failed native runtime stays retryable while invalid audio records FAILED. |
| `AudioFixtures.java` | Keep unchanged: shared synthetic audio generator supports codec, HTTP, restart and organization tests; this is support code, not a separate test suite. |
| `AudioGateHttpTest.java` | Keep unchanged: default-disabled audio rejects new valid intent without affecting notes. |
| `AudioHttpTest.java` | Keep unchanged: supported containers, exact original bytes, server duration, replay, invalid/transient/commit failures, capacity, concurrency and authenticated playback. |
| `AudioRequestTest.java` | Keep unchanged: strict fields/raw bounds, filenames, scalar limits and complete normalized identity. |
| `AudioRestartTest.java` | Keep unchanged: an issued pending permission remains recoverable after restart with new audio admission/uploads closed. |
| `AudioUnavailableHttpTest.java` | Keep unchanged: missing native tools cannot publish or commit FAILED and retain the retryable intent. |
| `AudioVerifierTest.java` | Keep unchanged: real local codecs, exact two-minute boundaries, timestamps/gaps, framing, tracks/channels, integrity and termination-before-input-cleanup. |
| `CoupleAuthoringHttpTest.java` | Keep unchanged: actor-bound retries, guest isolation, private media publication, metadata/commit revocation, gate/budget rules and erasure. |
| `ExportHttpTest.java` | Keep unchanged: authenticated integrity-bound archives, strict route contracts, account-scoped discovery, metadata/inactivity and revocation during original reads. |
| `LibraryHttpTest.java` | Keep unchanged: bounded search/tags, conditional identity, lock/revision races, mixed verified media and original preservation. |
| `MediaAdmissionPostgresTest.java` | Keep unchanged: database reservation accounting, cross-asset concurrent capacity, pause/replay and retained expired-grant reservations. |
| `MediaServiceAdmissionTest.java` | Keep unchanged: fail-fast overlapping finalizations, malformed grants and permit release after invalid/storage/commit outcomes. |
| `PhotoHttpTest.java` | Keep unchanged: private intent/replay, exact verified publication, failed renewal, grant scope/expiry, partial batches, concurrent retry and rollback. |
| `PhotoRestartTest.java` | Keep unchanged: pending permissions and completed originals survive application restart. |
| `PhotoValidationTest.java` | Extend the existing file with one regression covering valid JPEG, PNG and WebP when a configured ImageIO cache becomes unavailable. Restore global cache settings in finally and assert originals remain unchanged. Keep existing raw metadata, identity, integrity and dimension cases. |
| `R2DeletionStorageTest.java` | Keep unchanged: conditional private ledger writes, exact identity, bounded pages/bodies, aborts, safe failures and precise idempotent deletion scope. |
| `R2ObjectStorageTest.java` | Keep unchanged: exact HEAD/signing metadata and actual expiry, safe filenames, bounded reads, verified bytes and redacted errors. |
| `R2RecoveryStorageTest.java` | Keep unchanged: conditional exact-original restoration accepts only matching bytes/size/MIME and never overwrites a conflicting object. |
| `TimelineHttpTest.java` | Keep unchanged: chronology, conditional identity, pagination, lock/revision races, mixed verified media and original preservation. |
| `WeddingJourneyHttpTest.java` | Keep unchanged: actual mixed guest-to-private HTTP journey, partial recovery, review and unchanged saved siblings. |

Consumer tracing covers guest and private contribution creation, retry receipts,
grants and finalization; review/retention; private playback and sharing;
operator readiness/recovery/deletion; portable export; migrations; and the
frontend photo/audio coordinators, shared JSON/grant/receipt decoders and private
viewer. These consumer packages are boundary evidence, not additional fully
reviewed directories.

Storage-disabled creation/grant failure is explicit policy in
`docs/runbooks/private-photo-storage.md`. Private playback already authorized
and in flight may finish during a later account/media change, as documented in
`docs/api/v1/authorization-verification.md`; sharing deliberately has stronger
locking. Neither policy warrants speculative availability/replay or locking
changes. Scope rechecks around private writes protect different revocation
windows and remain intact.

The photo regression uses synthetic valid originals with correct hashes/sizes.
The unchanged verifier accepts all three formats with a healthy ImageIO cache;
after the owned configured cache directory becomes unavailable it rejects all
three with `422 INVALID_MEDIA`. The exact new test also fails against the
unchanged verifier. Explicit memory streaming removes this unnecessary disk
dependency for bytes already bounded to 10 MB. It retains stream/reader cleanup
and benefits operator recovery's shared verifier too. The old cache was removed
normally on close; this is not evidence of leaked files or a POSIX disclosure.
No measured speed, memory-use or throughput improvement is claimed. No new
production module, test file, dependency, migration or build setting is added.

## Backend media verification — October 19, 2026

The isolated baseline passes **105 tests** in 17 existing media suites, with zero
failures/errors/skips. This includes actual HTTP/PostgreSQL, admission, signing,
restart, supported local codecs, failure/retry and mixed wedding-journey checks.
The final `PhotoValidationTest` passes **five tests**, including the exact added
regression that fails against the unchanged verifier. Standalone before/after
probes confirm all three supported photo formats and restoration of ImageIO's
global settings; verification leaves each original byte array unchanged.

Mechanical commit `7b9afa1` is verified separately from the subsequent intentional
cache fix. Java **25** parse-level comparisons match all **17 production files**
from committed baseline to saved entry to a frozen formatting snapshot. Exact
processed string/SQL values, annotations, modifiers, names and member/argument/
statement order remain checked. Import order is ignored; only the controller's
exact six-import annotation expansion is allowed. Harmless single terminal/
expression control-body wrappers are normalized, along with two explicit
`AudioVerifier` if-body wrappers around already scoped try/catch cleanup. Inner
resource/declaration/body/catch/finally scopes remain checked. The original
stricter rejection of those two wrappers is saved, and no arbitrary declaration
or block scopes are discarded.

All **eight negative controls** are rejected: changed validation limit, SQL token,
SQL whitespace, authorization order, unexpected import, declaration scope,
audio cleanup target and an extra annotation in the wildcard expansion. All
**51 stage/source hashes** and the immutable formatting sources are retained.
This parser comparison does not resolve type bindings or establish runtime
correctness. After compilation, all **33 media top-level/nested classes**
have identical `javap -c -p -constants -s` output before/after formatting, including
printed constants, descriptors and instructions. Annotation/bootstrap/debug
metadata are excluded from that disassembly comparison; raw class-byte equality
is not claimed. Both proofs cover the mechanical snapshot, not the intentional
memory-stream construction/import change.

Verification uses Windows, Temurin **25.0.3+9-LTS**, Maven **3.9.16**, Spring Boot
**4.1.1**, Docker **29.7.2**, disposable PostgreSQL **17**, and the existing local
FFmpeg/ffprobe **9.0.2**. A local CLI override, `-Dsurefire.exitTimeout=120`, extends
only the test-fork shutdown grace from the plugin default of 30 seconds after
the prior contribution batch's cached Spring/Hikari shutdown diagnostic. Tracked
build/runtime configuration remains unchanged. An initial full-suite attempt
inside the sandbox could not access Docker/Java attach pipes and was stopped;
it is retained as an incomplete environment-blocked attempt and is not counted
as validation. The full run uses the required local integration-test access.

The isolated intended backend checks all **217 baseline paths** with exactly
**18 source/test differences**: 17 production files and the existing photo test.
All **39 existing visible scope files** match the tested copy; the other **21
reviewed test/support files** retain their entry hashes. The pre-existing media
placeholder deletion remains excluded. At the preservation checkpoint, **207
of 211 unrelated paths** match entry; four concurrent gallery/tester/release
documentation or JSX updates differ and remain excluded. No unrelated file is
restored, staged or overwritten by this batch. Refreshed main `c9ca28e` includes
contribution PR **83**, and its backend matches this batch's baseline.

The final full backend suite passes **467 tests: 465 passed, zero failures/errors
and two skipped**, with Maven exit zero. The existing Windows skips are the
Linux-only symlink checks in `OwnedExportDirectoryTest` and
`OperatorRecoveryPostgresTest`; they still require Linux CI. The final run exits
without the prior test-fork shutdown timeout using the disclosed local grace.
All **34 containers** identified across the baseline/full-run logs and the final
test JVM are confirmed absent afterward.

Backend packaging passes after the completed suite (`-DskipTests package`). All
**33 packaged media classes** match the tested class bytes; all **41 compiled
media test/fixture classes** are absent, and the Spring Boot launcher/application
manifest is checked. Independent final source/documentation review and diff
checks pass. Local synthetic originals, SDK adapters and HTTP/database tests do
not establish provider, hosted, physical-device, capacity or release acceptance.

Inventories, frozen formatting/AST/negative controls, disassemblies, exact
red/green photo probes, full-suite/package logs, source/class hashes, cleanup
checks and the ready PR description are under
`logs/backend-media-review.local/`. The focused Notion issue records delivery
and review status. Ryan creates/merges the PR after exact-head CI/configured
review; the next suggested backend boundary is review/retention, then operations
and recovery, with inventory/consumer tracing before choosing each batch.

## Backend review decisions — October 19, 2026

This batch covers all **12 production files**, **nine existing package tests**
and **one placeholder** under backend `review/`: **22 tracked paths**. It starts
from completed media head `ec6093d` on `feature/backend-review-directory`. The
`.gitkeep` deletion predates the task and is excluded from the review edits and
isolated validation. Entry-source and
committed backend snapshots preserve the selected files and **212 unrelated
dirty/untracked paths**; concurrent album/library/health, gallery/supporting work
and other placeholder deletions stay outside this review.

No concrete correctness, security or efficiency defect justified a behavior
change. All 12 production files receive expanded formatting: explicit control
blocks, multiline records/signatures/constructor arguments, readable response/
JDBC chains and grouped imports. Only the metadata controller's wildcard import
becomes five explicit annotation imports. Existing test files stay unchanged;
no new helper, abstraction, dependency, migration or tracked test is introduced.
No runtime performance gain is claimed.

| File in production `review/` | Decision and reason |
|---|---|
| `InboxController.java` | Simplify formatting; keep version validation, narrow list/detail delegation, private no-store responses and the persisted revision ETag. |
| `InboxCursor.java` | Simplify formatting; keep bounded unpadded URL-safe canonical encoding, version/filter binding, UTC year/microsecond checks, exact UUID representation and redacted diagnostics. A cursor is a position, not an access capability. |
| `InboxQuery.java` | Simplify formatting; keep the four review states, default PENDING/page size 20, explicit 1–100 bounds and cursor-to-filter validation. |
| `InboxRepository.java` | Simplify signatures, JDBC/call/DTO arguments and guards; keep exact SQL values, complete event/visibility/review/purge/deadline and verified media predicates, limit-plus-one keyset reads and UTC parameters. Preserve caller-owned memory locking, conditional shared revisions, metadata updates, share-link deletion and actor audit. |
| `InboxService.java` | Simplify formatting; keep authority checks before parsing/private queries, bounded immutable result lists, next cursor anchored to the last returned item and safe unavailable detail errors. |
| `MemoryDetail.java` | Simplify multiline records, delegation and diagnostics; keep the wire projection without storage keys/capabilities/URLs, original metadata, backward-compatible GUEST defaults and redacted `toString()` output. |
| `MemoryMetadataController.java` | Simplify formatting and replace the wildcard with five explicit imports; keep contract-before-origin validation, exact PATCH body delegation, no-store and the returned persisted revision ETag. |
| `MemoryMetadataRequest.java` | Simplify record/guards/date branches; keep exact four-field bodies, strict positive bounded strong revision preconditions, raw UTF-16/scalar limits, normalized nullable text and canonical Gregorian unknown/year/month/day dates without inventing precision. Timeline validation reuses this contract. |
| `MemoryMetadataService.java` | Simplify formatting; keep access before parsing, lock/current-authority checks, deleted-item exclusion, stale conflict before no-op, revision overflow protection, monotonic microsecond timestamps and final authority check inside the write transaction. Original content/media/review remain preserved. |
| `ReviewController.java` | Simplify formatting; keep contract/origin checks, service validation, private response headers and exact revision ETag. |
| `ReviewRequest.java` | Simplify record/constructor/guards; keep closed field/status/audience sets and strict strong positive integer conditions. A shared audience requires KEEP. |
| `ReviewService.java` | Simplify imports, overloads, guards and calls; keep memory locking and post-wait authority/deadline checks, stale-state conflicts, current no-op semantics, first-delete 30-day deadline, monotonic action time, forced-private restoration, link revocation, ordered organization detachment, actor audit and final authority check in one transaction. |

| File in test `review/` | Decision and reason |
|---|---|
| `InboxHttpSecurityTest.java` | Keep unchanged: session/role/reveal/contract gates, safe private responses, no-store, malformed IDs and narrow DTO/ETag contracts. |
| `InboxPostgresHttpTest.java` | Keep unchanged: real session/PostgreSQL reads, tied-time pagination/new arrivals, verified eligibility, sharing/rotation, one-winner review/audit races, reversible deletion and purge/erased-retry boundaries. |
| `InboxQueryTest.java` | Keep unchanged: filter/page bounds and strict canonical filter-bound cursor round trips, malformed encodings, timestamps and identities. |
| `InboxServiceTest.java` | Keep unchanged: direct service authorization, immutable pages, exact next anchors, private errors and content-free diagnostics. |
| `MemoryMetadataRequestTest.java` | Keep unchanged: exact fields, raw Unicode/text limits, canonical partial dates/leap years and strict bounded revision conditions. |
| `MemoryMetadataServiceTest.java` | Keep unchanged: authority revoked during a metadata write suppresses the private result. Real rollback/current-state behavior is also covered by the existing couple-authoring HTTP suite. |
| `ReviewHttpSecurityTest.java` | Keep unchanged: current session/role/reveal, CSRF, origin, contract and malformed request/error behavior. |
| `ReviewRequestTest.java` | Keep unchanged: exact strong revision conditions, closed request/status/audience validation and explicit shared-audience rules. |
| `ReviewServiceTest.java` | Keep unchanged: actor/revision audit, stale matching-state conflicts, exact no-op/deadline preservation, private restoration, post-lock expiry/revocation, validation-before-write and wall-clock rollback behavior. |

Consumer tracing covers frontend shared detail/inbox decoding, metadata
normalization, review/metadata coordinators and deleted-item controls; private
album/timeline/library/tag projections; media eligibility/playback and guest
retry receipts; sharing issuance/read/rotation; portable export; retention and
operator recovery; and V6–V14 revision, lifecycle and audience constraints. These
are boundary checks, not additional completed directory reviews.

The current API contracts retain authorization already in flight for private
reads; sharing deliberately applies stronger locking/capability checks. No
speculative duplicate read checks or locks are added. DELETE restoration always
forces COUPLE_ONLY and does not resurrect a secret link or organization
membership. The actual inbox UI restores deleted items to PENDING, so the generic
adapter's explicit shared-audience expectation does not establish a reachable
UI defect or justify changing that deliberate private-restore policy. Metadata
and review share one persisted revision; stale requests conflict even when their
requested values happen to match current state.

## Backend review verification — October 19, 2026

The isolated baseline passes **105 tests** across the nine package suites and
existing couple-authoring, timeline, sharing service/security and retention
service consumers: **14 suites**, zero failures/errors/skips. These include real
HTTP/PostgreSQL and native audio use through couple authoring. All **nine test
files** retain their entry hashes.

Java **25** parser comparisons match all **12 production files** from committed
baseline to saved entry to final formatted sources. Exact processed string/SQL
values, annotations, modifiers, names and member/argument/statement order remain
checked. Layout/comments/import order are excluded; only the metadata
controller's exact five annotation imports may replace its wildcard. Harmless
single terminal/expression control-body wrappers may normalize; declaration,
resource and meaningful block scopes remain checked. No media-specific try-body
normalization is needed or retained for this batch.

All **eight negative controls** are rejected: changed page bound, SQL event, SQL
whitespace, metadata authorization order, unexpected import, declaration scope,
extra wildcard-expansion import and route annotation. All **36 stage/source
hashes** and frozen final sources are saved. This is parse-level evidence, not
type attribution or runtime proof. After compilation, all **14 review
top-level/nested classes** separately have identical
`javap -c -p -constants -s` output before/after formatting, without normalizing
instruction operands or constant-pool indices. This compares printed constants,
descriptors and instructions; annotation/bootstrap/debug metadata and raw
class-byte equality are outside that disassembly comparison.

Verification uses Windows, Temurin **25.0.3+9-LTS**, Maven **3.9.16**, Spring Boot
**4.1.1**, Docker **29.7.2**, disposable PostgreSQL **17** and the existing local
FFmpeg/ffprobe **9.0.2**. Local `-Dsurefire.exitTimeout=120` extends the plugin's
30-second test-fork shutdown grace while cached Spring/Hikari contexts close;
tracked build/runtime configuration remains unchanged. Integration tests run
with the required Docker/Java attach access.

The isolated backend verifies all **217 baseline paths** with exactly **12
production source differences**. All **21 existing visible scope files** match
that copy, and the nine test files match their entry hashes. At the preservation
checkpoint, all **212 unrelated paths** match entry hashes/existence; subsequent
concurrent edits remain excluded rather than being restored or staged. The
pre-existing review placeholder deletion stays outside that isolated snapshot. Refreshed main
`ff3d274` includes media PR **84** and has the same backend as this batch's
baseline, so the review branch can target main directly.

The focused intended-source full suite passes **467 tests: 465 passed, zero
failures/errors and two skipped**, with Maven exit zero and no test-fork shutdown
timeout under the disclosed local grace. The existing skips are Windows-disabled
Linux symlink checks in `OwnedExportDirectoryTest` and
`OperatorRecoveryPostgresTest`. Packaging passes; all **14 packaged review
classes** match tested bytes, all **11 compiled package test/fixture classes**
are absent, and the launcher/application manifest is checked. All **28 observed
containers** and both baseline/final test JVMs are confirmed absent afterward.
Independent source/documentation review is clear for the recorded scope.

### Landing copy follow-up and the combined commit

During validation, Ryan committed and pushed `bddb680` ("Small changes"). That
commit includes the completed review formatting and draft review notes, landing
copy, existing gallery work, other pending formatting and placeholder deletions.
Preserve that commit and its original changes. The 12-file formal production
review remains the scope described above; the additional directories are not
marked fully reviewed here. The focused backend evidence excludes their changes;
the combined branch therefore receives separate full verification.

Ryan's landing text renders `Lot's of love for` and
`Help kickstart their next chapter.`. The existing gallery test still expected
the old eyebrow and invitation. Its focused run reproduced **four passes and one
failure**. Update only those two existing assertions, accounting for React's
escaped apostrophe in static HTML; retain the page text and `App.jsx` byte for
byte. The focused suite then passes **all five tests**.

The complete frontend passes **567 tests**, zero failures/skips, ESLint and the
production build on Node **24.21.0**. The full run needs loopback HTTP for its
existing redirect/privacy tests; the sandbox-restricted attempt is retained
separately and is not the final validation result. No application wording or
runtime behavior changes are made to satisfy the tests.

The separate exact **211-file backend** from preserved commit `bddb680` also
passes the full **467-test** suite: **465 passed, zero failures/errors and the
same two Linux-only Windows skips**. Maven exits zero without a shutdown timeout;
the combined backend packages successfully. All **248 production classes** in
that JAR match the tested bytes, all **111 compiled test/fixture classes** are
excluded, and launcher/application metadata is checked. Its committed source
hashes match the tested copy; the single visible CRLF-only difference is recorded
separately. This broader verification does not extend the formal per-file review
to the other packages.

All **52 containers** observed across the baseline, focused full and combined
runs and all three test JVMs are absent after completion. Source/AST/bytecode
proofs, both backend runs/packages, exact landing red/green diff and App hash
preservation, frontend checks and independent source/documentation reviews are
recorded under `logs/backend-review-directory.local/`, together with the ready PR
description. The original user commit stays intact; the follow-up commit adds
the two existing test assertion changes and these review notes. At that checkpoint,
concurrent gallery/tester/release documentation edits remained unstaged and were
preserved for the subsequent main reconciliation below.

### Main reconciliation after the landing fix

Main advanced to `37beb863` with gallery PR **85** before delivery. A merge
preflight found overlapping edits in the gallery test and three gallery/tester/
release documents. The working versions and a named three-document stash were
saved before merging main without rewriting `bddb680` or the two-file follow-up
`2e3d6e0`.
The three saved documents already contain the exact combined content, matching
main after CRLF normalization while retaining every prior branch line. Those
saved bytes supply their resolution.

An Espree AST comparison confirms the two gallery test versions have identical
declarations, calls, arguments and coverage except for the two deliberate copy
regexes. Keep the expanded branch version with Ryan's invitation/eyebrow checks;
no upstream gallery assertions are discarded. All five saved App/test/document
files retain their exact working hashes. Conflict markers are absent after
resolution, and incoming CI configuration matches main.

After resolution, all **567 frontend tests** pass again with zero skips, along
with lint/build and **14 operational script helper tests** required by main's
workflow. All **211 backend source hashes** remain unchanged from the separately
verified combined backend, so that completed full suite/package remains applicable.
Merge-resolution proofs, backups, stash identity and post-merge check logs are
saved with the batch evidence. The original landing text is unchanged.

Ryan creates/merges the PR after exact-head CI/configured review and Linux-only
checks. Local fixture/HTTP/database evidence does not establish provider,
hosted, physical-device, capacity or release acceptance. The next suggested
backend boundary is retention, followed by operations/recovery, after fresh
inventory and consumer tracing.
