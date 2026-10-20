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
   flow, duplication and compatibility with surrounding modules. Backend batches
   also require the explicit SonarQube checks below.
4. Check efficiency against actual work: repeated requests, copies, hashing,
   decoding, timers, renders and retained resources. Measure suspected expensive
   paths before introducing caching or additional abstractions.
5. Assign a decision: **keep**, **simplify**, or **fix**. Record concrete evidence
   for changes and any unresolved acceptance boundary.

Keep increments small enough to review independently. Separate a mechanical
extraction from a behavior fix in the commit history. Reproduce bugs before
patching them, extend existing test files where practical, and test observable
outcomes rather than internal function layout. Preserve unrelated working edits.

## SonarQube complexity and duplication

Run actual SonarJava analysis for backend reviews, including existing findings
in the reviewed files. At minimum, check cognitive complexity (`java:S3776`),
cyclomatic complexity (`java:S1541`) and duplicated string literals
(`java:S1192`). Use the project's configured profile where available. Record the
actual analyzer/runtime versions, active rules and effective parameters, source
and test scope, exclusions, Java version/classpath and exact input hashes. A local
SonarQube for IDE engine can establish those rule results; it does not establish
a server quality gate or checks that engine does not provide.

Analyze the full backend so cross-package findings remain visible, with tests
classified separately. Inspect duplicated-block groups and all their file/range
endpoints when the analysis provides them; record duplication measures and
detector settings. If block detection or another required check is unavailable,
state the limitation and keep that check open. An empty rule-issue list does not
establish the absence of duplicated blocks. Distinguish per-method complexity
thresholds from aggregate project complexity measures.

Give every in-scope finding a disposition: **fix**, **justified retain**, or
**false positive**, with its rule, file/symbol/range, measured value and threshold
where available, concrete reason and verification evidence. Prefer cohesive
helpers and simpler control flow while preserving contracts. Do not merely move
complexity between arbitrary helpers, weaken thresholds, widen exclusions or
add unexplained suppressions. Intentional duplication is a justified retain,
not a false positive. Keep unresolved findings visible.

Reanalyze the final source using the same rules/settings and compare baseline
and final findings. Record changed or retained findings at their final locations,
the source revision/hashes, analysis completion and any analyzer warnings. Keep
server analysis identifiers, profile/gate and new-code results when available;
state unavailable values explicitly. Passing tests, formatting/AST comparisons
and a new-code-only quality gate do not replace this review. Retain the finding
exports and dispositions with the existing test and independent-review evidence.
Later source edits require the affected analysis and verification again.

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

## Backend retention decisions — October 19, 2026

This batch covers all **seven production files**, **four existing test suites**
and **one test fixture** under backend `retention/`: **12 tracked paths**. The
checkout was clean at `de82e529`, and `feature/backend-retention-review` starts
from that completed review head, preserving the landing text and prior commits.
The entry inventory and frozen baseline retain all **211 backend paths**.

All seven production files receive the established expanded formatting:
multiline parameters and records, separate statements, explicit control blocks
and readable JDBC/mapper/digest chains. Mechanical commit `6c468735` is separate
from the reproduced concurrency fix. No dependency, migration, public API,
storage policy or new tracked test file is introduced. No performance gain is
claimed.

| File in production `retention/` | Decision and reason |
|---|---|
| `DeletionRecord.java` | Simplify formatting; keep immutable content-free identities/times, the exact eight-field version/event schema, canonical UUIDs/digest, duplicate/trailing-token rejection, 2048-byte decoding bound and redacted errors/diagnostics. |
| `DeletionStorage.java` | Simplify formatting; keep the server-only exact-object interface, immutable defensive-copy page and count-only page diagnostics. |
| `RetentionAdministration.java` | Simplify formatting; keep console-only lifecycle, exact command/environment/typed confirmation, explicit nonlocal database target, private storage, logging suppression, safe partial-failure results and resource closure. It starts no HTTP server or migration. |
| `RetentionConfiguration.java` | Simplify formatting; keep opt-in scheduling, private-R2 requirement, one-minute/day interval bounds, delayed 20-item batches and content-free failure warnings. Configuration does not prove hosted job health. |
| `RetentionRepository.java` | Simplify formatting and fix concurrent sibling guest-name cleanup with a separate contribution row lock before the conditional scrub. Keep bounded verified expired-private claims, persisted immutable plan precision, ownership/key validation, version-gated recovery capabilities, ordered organization detachment, erased-key reservations, metadata scrubbing and idempotent completion. |
| `RetentionService.java` | Simplify formatting; keep independent durable evidence before erasure, repeated ownership/staging-scope checks, retry-safe partial failures, transactional completion and fail-closed offline replay with bounded/cycle-checked pages. |
| `SubmissionKeyDigest.java` | Simplify formatting; keep SHA-256, case-canonical UUID-v4 capabilities, exact legacy/non-UUID bytes, invalid stored-key rejection and sanitized algorithm errors. |

| File in test `retention/` | Decision and reason |
|---|---|
| `DeletionRecordTest.java` | Keep unchanged: strict record round trips/schema/coercion/identity/time/byte bounds, canonical digest behavior and immutable/redacted pages. |
| `InMemoryDeletionStorage.java` | Keep unchanged: provider-free immutable tombstones, lost-response/storage failure injection, operation ordering and ledger pagination. |
| `RetentionAdministrationTest.java` | Keep unchanged: help/unsupported commands and explicit complete nonlocal database settings; missing/blank/default-only settings fail closed. |
| `RetentionPostgresTest.java` | Extend the existing suite with a deterministic concurrent final-sibling regression. Keep real PostgreSQL migrations, expiry/precision, evidence/object/database retry failures, sibling preservation, replay/absent-envelope reservations, ownership and organization lock/detachment coverage. |
| `RetentionServiceTest.java` | Keep unchanged: evidence/erase/scrub ordering, ownership and grant validation, isolated item failures, immutable retry plans, bounded replay/cycles/future evidence and batch bounds. |

The reproduced defect requires a contribution with at least three memories: an
earlier purge has already committed the shared erased-key reservation, and two
final sibling purges overlap. Each transaction can see the other's uncommitted
memory as unpurged, so both conditional envelope updates skip the guest name.
The new PostgreSQL regression first purges one photo, then holds one sibling's
purge transaction uncommitted after `finish` returns while the other completes
or demonstrably waits on its database PID. Against unchanged production source,
all three memories are purged but the final name assertion fails with
`Synthetic Photo Guest` retained.

The fix locks the contribution in a separate optional SELECT immediately before
the existing conditional guest-name UPDATE. The UPDATE starts a fresh default
READ COMMITTED statement after any wait and observes committed sibling purges.
The lock follows the existing memory/album/timeline/tag/media work; callers do
not acquire the same contribution lock before existing memory locks. A missing
envelope remains valid for authority replay into a backup predating contribution
creation. Operator recovery's exclusive archive-table/serializable transaction
remains compatible. The first erased-key INSERT is not a general sibling fence:
its unique-conflict wait only protects insertion of a previously absent key.

Consumer tracing covers R2 conditional tombstone writes, exact bounded ledger
reads and object deletion; contribution/photo erased-key and receipt guards;
review/metadata/media expiry and purge fences; album/timeline/tag detachment;
sharing/playback/export availability; operations counts; version-gated operator
recovery, frozen authoritative-ledger replay and relevant migrations. The
deletion/recovery and operations runbooks retain their existing policy. These
boundary checks do not mark other directories fully reviewed.

## Backend retention verification — October 19, 2026

The isolated baseline runs **119 tests: 118 passed, one skipped**, across the
four package suites and existing R2 deletion, operator recovery, readiness and
inbox PostgreSQL suites:
**eight suites**, zero failures/errors and one existing Windows-disabled Linux
symlink check. An earlier baseline attempt lacked the existing local FFmpeg
path and is retained separately; the passing rerun uses FFmpeg/ffprobe 9.0.2.
An initial PowerShell Maven-argument error is also retained and excluded from
test results.

The mechanical commit passes **seven** Java 25 canonical AST/import comparisons,
**eight** rejected negative controls and **12** exact compiled disassemblies.
The final mechanical proof binds **21 source hashes** to baseline, frozen and
compiled inputs. It preserves decoded literals/SQL, imports, annotations,
declarations and order, with only narrow single terminal/expression control-body
wrappers normalized. Parsing does not perform type attribution; the disassembly
excludes annotations/bootstrap/debug metadata. The later intentional repository
lock is verified separately and is not claimed behavior-equivalent.

The added PostgreSQL regression fails against unchanged production source with
**one failure, zero errors/skips**; the fixed snapshot passes **47 focused
retention/storage tests**, zero failures/errors/skips. All **211 intended backend
inputs exactly match visible bytes**; only the seven production files and the
existing PostgreSQL test differ from entry. The other three suites and fixture
remain unchanged. The final delta proof accepts the six untouched mechanical
files and rejects exactly the repository containing the reviewed lock addition.

The full intended backend runs **468 tests: 466 passed, two skipped**, with zero
failures/errors and Maven exit 0. The count increases by one for the new
concurrency regression. Packaging succeeds: all **248 production classes** match
the frozen tested class bytes, all **111 compiled test/fixture classes** are
excluded by identity and bytes, all **211 source hashes** remain valid, and the
executable manifest names the expected launcher/application. Independent source
review finds no remaining actionable issue.

Read-only cleanup checks confirm all **38 containers observed across the five
test attempts**, the **three explicitly observed test JVMs**, and the observed
full-run Maven JVM are absent. Red/green fork PIDs were not independently
captured; their Maven processes completed. Detailed evidence and a readback of
the completed package/report/cleanup checks are retained locally.

Runtime is Windows, Temurin 25.0.3+9-LTS, Maven wrapper 3.9.16, Spring Boot 4.1.1,
PostgreSQL 17 and the existing FFmpeg/ffprobe 9.0.2. The local Surefire exit grace
is 120 seconds rather than its default 30; tracked configuration is unchanged
and the full run exits without a fork-shutdown timeout. The two unexecuted
Windows-disabled cases are
`OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched`
and
`OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites`.
Frontend source is unchanged and its suites are not rerun for this backend batch.

The final fetch still has main at `37beb863`, already included in this branch;
the preceding review head `de82e529` is not yet merged into main. Merge that
review first so a main-based retention PR isolates this batch. Ryan creates and
merges after exact-head CI/configured review and Linux-only checks. Provider,
hosted scheduling, independent recovery-copy durability, device, capacity and
release acceptance remain separate.

The per-file decisions, red/green regression, baseline/full-suite/package logs,
source/class hashes, proof limits, cleanup checks and ready PR description are
under `logs/retention-directory-review.local/`. The focused Notion issue records
delivery status. The next suggested boundary is operations/recovery after fresh
inventory and consumer tracing.

## Backend operations decisions — October 19, 2026

This batch reviews all **three production files** and **two existing suites**
under backend `operations/`: **five tracked paths**. It starts from main
`7bf1d0d`, including merged retention PR 87. The original checkout has active
photo-upload work on `feature/photo-upload-confirmation` with ten dirty paths at
entry, so review edits use a separate managed checkout on
`feature/backend-operations-review`. The frozen backend inventory contains
**211 paths**; no photo-upload work is included in this batch.

No concrete correctness, privacy or efficiency defect justifies a runtime
behavior change. All three production files receive expanded formatting:
separate statements, explicit control blocks, multiline records/parameters,
structured inventories and readable report/JDBC calls. Existing imports,
literal/SQL values, operation order and public interfaces remain unchanged.
No abstraction, dependency, migration or tracked test is introduced. No runtime
performance improvement is claimed.

| File in production `operations/` | Decision and reason |
|---|---|
| `OperationsReadiness.java` | Simplify formatting; keep bounded read-only REPEATABLE READ observations, reviewed-schema checks before aggregates, conservative original/staging reservations, unfinished/overdue counts, overflow-safe 80% capacity thresholds and content-free unconfirmed failures. |
| `OperationsSchema.java` | Simplify formatting; keep exact V1–V14 migration/resource inventory, bounded prior-JAR inspection without extraction/class loading, canonical migration CRC/digest equality, ordered successful Flyway history and known-column checks. All streams/JARs retain their existing resource owners. |
| `ReadinessAdministration.java` | Simplify formatting; keep exact command/environment/explicit-database gates, bounded PostgreSQL URL overrides, prior-artifact checks before database access, offline lifecycle, logging suppression, fixed output/exit contracts and configured-versus-verified distinctions. |

| File in test `operations/` | Decision and reason |
|---|---|
| `OperationsReadinessPostgresTest.java` | Keep unchanged: five real PostgreSQL cases cover conservative reservations, privacy/no mutation, capacity boundaries, mechanically enforced read-only/time bounds, consistent concurrent-admission snapshots and history/column drift refusal. |
| `ReadinessAdministrationTest.java` | Keep unchanged: seven cases cover command/target/configuration refusal, sanitized failures, non-weakenable JDBC controls, observed-pass limits, recursive exact migration resources and bounded/exact prior JAR checks before connection. |

Consumer tracing covers the direct classpath and packaged PropertiesLauncher
commands, `scripts/local-review-helpers.mjs` and its tests, the report/schema
guards in `scripts/smoke-rollback.mjs`, current application properties and
migrations, media/grant/retention reservation semantics, and operations,
rollback, staging and wedding-day runbooks. It does not mark those other
directories fully reviewed.

Correct two stale consumer-document counts: the API verification note said ten
known tables and the operations runbook said seventeen. Both now say
**18 known tables**; the current inventory has **119 columns** and **14
migrations**. Clarify that physical checks compare column names, PostgreSQL
`udt_name` values and nullability. They do not check type modifiers such as
VARCHAR length, unrelated tables, indexes, constraints or defaults. The
historical two-artifact rollback rehearsal remains dated to its actual evidence;
matching migration manifests alone does not establish prior-binary behavior.

## Backend operations verification — October 19, 2026

The isolated baseline passes all **12 tests** in the two existing package
suites, zero failures/errors/skips. Both test files retain their entry bytes.
The existing operational helper suites pass **14 tests** on Node **24.21.0**,
including exact packaged schema-check output/command and rollback helper
contracts; no new container rollback rehearsal is claimed.

All **three** canonical Java 25 AST/import comparisons pass, with **15** rejected
negative controls and **11** exact compiled disassemblies. **Twelve source
hashes** bind baseline, managed workspace, frozen and intended compile inputs.
The normalizer ignores layout/comments and only narrow single terminal or
expression control-body wrappers. One additional allowance is pinned to the
`ReadinessAdministration.hasExplicitDatabaseTarget` enhanced-for `name : names`
body: its new braces enclose exactly the existing IF subtree, including its
condition, pattern binding and assignment. The initial strict comparison matched
two files and identified only this wrapper in the third. Added declarations and
changed IF conditions/assignments are separately rejected; no broad IF, loop,
lambda or arbitrary scope flattening is permitted.

Parsing performs no type attribution; `javap -c -p -constants -s` compares exact
printed instructions/descriptors/constants without index normalization, while
annotations/bootstrap/debug metadata remain outside disassembly. The AST and
bytecode evidence complement the execution tests and do not prove provider or
hosted behavior.

All **211 intended backend inputs exactly match the managed checkout**; only
the three reviewed production files differ from the baseline. The verified
snapshot binds the managed Git head. An earlier local snapshot attempt could
not read that checkout's Git metadata through the default sandbox; its file
comparisons are retained separately, the helper now fails on a missing head,
and the approved rerun records the complete identity.

The full intended backend runs **468 tests: 466 passed, two skipped**, zero
failures/errors, with Maven exit 0. Packaging succeeds: all **248 production
classes** match frozen tested bytes, all **111 compiled test/fixture classes**
are excluded by identity and bytes, all **211 source hashes** remain valid and
the executable manifest names the expected launcher/application. The actual
packaged PropertiesLauncher console also exits 0 for `--help` with its expected
read-only command text. Independent source review finds no actionable issue.

Read-only cleanup checks confirm all **26 containers observed across baseline
and full runs** and both explicitly observed full-run JVMs (**one test fork and
one Maven process**) are absent. The baseline fork PID was not separately
captured; its Maven run completed successfully. The original checkout remains
on its photo-upload branch, and all ten entry work-file hashes match at the
preservation checkpoint. Later unrelated gallery/document work remains outside
this batch and its isolated validation.

Runtime is Windows, Temurin 25.0.3+9-LTS, Maven wrapper 3.9.16, Spring Boot 4.1.1,
PostgreSQL 17, existing FFmpeg/ffprobe 9.0.2 and Node 24.21.0. Local Surefire exit
grace is 120 seconds rather than its default 30; tracked configuration is
unchanged and the full run exits without a fork-shutdown timeout. The two
unexecuted Windows-disabled cases are
`OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched`
and
`OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites`.
Frontend code is unchanged on this branch, and its suites are not rerun for this
backend batch. No hosted or provider checks, actual retention job observation,
new two-artifact rollback rehearsal, capacity measurement or release acceptance
is established by these checks.

Source/AST/disassembly proofs, both suites' baseline, full-suite/package/helper
logs, packaged help, hashes, cleanup and independent reviews are under
`logs/operations-directory-review.local/` in the original project checkout,
including the ready PR description. Main remains `7bf1d0d` at the final fetch and
is included in this branch. Ryan creates/merges the PR after exact-head
CI/configured review and Linux-only checks. The focused Notion issue records
delivery status. The next suggested directory is backend `recovery/`, with a
fresh inventory and consumer review.

## Backend recovery decisions — October 20, 2026

This batch covers all **five production files** and **two existing suites** under
backend `recovery/`: **seven tracked paths**. It starts on
`feature/backend-recovery-review` from clean main `1ef3583`, including operations
PR 89 and gallery/handoff PR 90. The work-computer visible checkout is used;
all **211 backend inputs** are frozen before edits. There are no unrelated
working changes at entry.

The entry source has no reproduced runtime correctness, privacy or efficiency
defect. Expand the five production files' formatting while preserving imports,
declarations, literal/SQL values, scopes, operation order and public interfaces.
The separate mechanical commit is `301d4fb`. A later user-supplied console
helper/logging refactor is explicitly included at Ryan's request, with its
reproduced diagnostic regressions corrected in separate commit `3319cf4` below.
Keep the existing recovery boundaries without a new dependency or migration.

| File in production `recovery/` | Decision and reason |
|---|---|
| `OperatorRecovery.java` | Simplify formatting; keep bounded private packages, consistent source snapshot, strict complete preflight before destination mutation, exact original verification, schema-selected exclusive locks, current-authority supersets, frozen deletion replay, retry-safe conditional publication and post-replay validation. |
| `RecoveryAdministration.java` | Simplify formatting and retain the user's four extracted validation helpers; correct the concurrent logging regression with stable sanitized process-stream diagnostics. Keep console-only offline startup, exact syntax/environment/confirmation, explicit restore/nonlocal database settings, validated private-storage configuration and distinct storage identities, mechanically read-only source authority and resource ownership. |
| `RecoveryException.java` | Simplify accessor spacing/layout; keep the safe code-only diagnostic without paths, content, SQL or provider errors. |
| `RecoverySchema.java` | Simplify formatting; keep ordered reviewed V1–V14 history/checksums, canonical migration fingerprints, known-column type/nullability checks, hard-coded versioned table/column identifiers, deterministic bounded rows, strict decoding, explicit legacy defaults and parameterized inserts. |
| `RecoveryMetadata.java` | Simplify formatting; keep complete identity/ownership/lifecycle graph checks, unchanged retry/original identities, media/audio/grant bounds, review/audience rules, historical authors, dates, private organization, scrubbed tombstones and current deletion-plan consistency. |

| File in test `recovery/` | Decision and reason |
|---|---|
| `OperatorRecoveryPostgresTest.java` | Extend existing coverage: all legacy package versions 1–6 now exercise supported destinations through V14 in 27 source/target pairs, with original bytes, organization, historical audit actors/statuses, private defaults and empty links. Add V7-to-V13 refusal and seven rehashed invalid memory/audit audience-state cases, asserting empty persisted targets and no external writes. Preserve the later user formatting and consolidated assertions; correct the audience cardinality and boxed count expectations rather than claiming those assertion edits are layout-only. |
| `RecoveryAdministrationTest.java` | Keep unchanged: syntax/noninteractive refusal, supported environment names, storage-identity separation and explicit database-target checks retain their current coverage. Actual interactive console confirmation and live provider IO remain separate acceptance. |

Consumer tracing includes the direct classpath and packaged offline console,
`ObjectStorage`/R2 conditional writes and original validators, all reviewed
migrations, contribution retry/date/text contracts, review/audience and private
link lifecycle, `DeletionRecord`/submission-key digest, retention ownership and
staging checks, and albums/timeline/tags before and after erasure. Organization,
media, retention, resources, scripts and documentation traced here are not
thereby marked fully reviewed.

Correct stale operator instructions that stopped at V13/package v6. The runbook
and API verification now describe V14/package v7 audience preservation, private
link exclusion, legacy private audit defaults, the V14 empty-link-table gate and
the existing limits of physical schema checks. Historical dated verification
records remain historical; no provider, recovery-timing or release pass is
inferred from a version or documentation update.

### Concurrent console refactor and reproduced diagnostics

The concurrent edit extracts `isHelpRequest`, `isRecoveryRequest`,
`hasRequiredRecoveryContext` and `isValidRestoreTarget`; retain these equivalent
guards and the unused algorithm catch's unnamed parameter. Its replacement of
process-stream diagnostics with SLF4J is incompatible with this offline console's
deliberate root-logging suppression. With inherited logging off, required
refusal/failure guidance disappears. When the class logger is explicitly enabled,
passing the raw caught exception to it exposes private paths and stack traces.

Reproduce before correction using an isolated compiled copy and the unchanged
console test: captured stderr is empty, so its required supported-command
guidance assertion fails. A real interactive ConPTY probe uses only synthetic
settings and an invalid synthetic private path, confirms the normal prompt,
and reaches `Path.of` failure before database connection or storage opening.
The logger version prints that path and exception stack. It creates no package
or provider resource.

Restore the original static stdout/stderr diagnostics, remove the logger and raw
throwable argument, and retain the user's four helpers. An unnamed outer catch
and source comment make the deliberate diagnostic boundary explicit. The same
isolated three-test console run now passes; root-off refusal guidance is visible,
and the same interactive failure returns 1 with the expected safe message, no
private-path text and zero throwable log events. The production refactor/fix is
separate from the mechanical commit; do not describe the final administration
class as AST- or instruction-identical to the entry source.

### Consolidated assertion correction

The later integration-suite edit also groups assertions into `Object[]`; it is
not exclusively formatting. A complete backend run reproduces its one-entry
audience-list expectation against the fixture's two restored private memories.
Grouped organization counts also need `Long` expectations (`0L`/`1L`) because
`count` returns `long`; the former standalone numeric assertions accepted integer
arguments without the grouped object comparison's boxing mismatch. Retain the
grouping, assert both private audience entries, and use the exact count types.

An earlier pair comparison used a snapshot that already contained these edits;
its formatting-only interpretation is withdrawn. The true first-pass test source
is separately preserved with hash `FD24A74E…`. Independent review of the complete
delta identifies the nine grouped assertions only in the compatibility matrix;
the corrected exact audience count strengthens its earlier `containsOnly`
check. Final verification uses executed focused/full suites and the corrected
final source, not an assertion of whole-file AST equality for this test delta.

## Backend recovery verification — October 20, 2026

The frozen entry baseline runs **56 tests: 55 passed, one Linux-only symlink
case skipped**, zero failures/errors. The corrected compatibility matrix and
the three unchanged console cases then pass a separate **four-test focused
run**, zero failures/errors/skips; its single matrix test executes all **27
source/target combinations**. No new tracked test file is added.

All **five canonical Java 25 AST/import comparisons** at mechanical commit
`301d4fb` pass, with **28 rejected negative controls** covering declaration,
package, literal/bound, condition and scope changes. Besides single terminal or
expression control bodies, normalization permits fourteen specifically pinned
enhanced-for wrappers enclosing exactly the existing IF subtree; it does not
flatten arbitrary blocks, declarations or loop/conditional scopes. Parsing does
not perform type attribution. The final administration helper refactor is
separately reviewed and exercised rather than included in that equality claim.

The isolated console red/green tests and actual synthetic interactive failure
probe are recorded above. Independent source, test and documentation reviews
have no remaining actionable findings after the diagnostic and assertion
corrections. The first full snapshot passed **470 tests: 468 passed, two
skipped** and packaged successfully. An intermediate exact-format run was stopped
after the authorized console scope change and is not a pass; the later full run
with incorrect consolidated assertions failed one of 470 tests and is retained
as red evidence. Those historical results do not replace final-source validation.

Runtime is Windows, Microsoft OpenJDK **25.0.4+7**, Maven wrapper **3.9.16**,
Spring Boot **4.1.1**, disposable PostgreSQL **17.11**, Docker **29.8.0** and
checksum-verified portable FFmpeg/ffprobe **9.0.2**. The wrapper uses an ignored
local `MAVEN_USER_HOME` because this machine's hidden `.m2` directory prevents
its ordinary PowerShell `Get-Item` probe; the tracked wrapper/configuration is
unchanged. Surefire's local exit grace remains 120 seconds. Frontend source and
operational scripts are unchanged and their suites are not rerun for this batch.

The **final intended snapshot**, bound to code head `9785ef8`, passes the full
backend suite: **470 total, 468 passed, two skipped**, zero failures/errors,
Maven exit 0 and an explicit successful-build marker. Its recovery suites run
**58 tests: 57 passed, one skipped**; all four existing SDK conditional-copy
tests pass within the full run. All **211 final backend input hashes** match
both the frozen compile inputs and visible checkout. Historical test counts
above are separate snapshots, not additive totals.

There are **16 exact compiled recovery disassemblies** for printed
instructions/descriptors/constants, plus unchanged raw bytes for non-recovery
production classes. The intentionally refactored outer administration class is
excluded from baseline instruction equality. `javap -c -p -constants -s` omits
annotation/bootstrap/debug metadata; its equality complements the mechanical
AST checks, independent review and execution evidence.

Packaging succeeds: all **248 production classes** in the executable JAR match
the final tested bytes; all **111 compiled test/fixture classes** are excluded
by identity and byte digest. The executable launcher/application manifest is
correct. The actual packaged PropertiesLauncher console exits 0 for `--help`
with the expected recovery instructions and exits 2 with its safe diagnostic
for noninteractive export, before recovery is started.

Read-only cleanup confirms all **94 observed containers** across baseline,
historical, interrupted, failed, focused and final runs are absent. The final
review Maven/test JVMs have exited; the two synthetic interactive probe sessions
also completed. No fork-shutdown timeout is present in the successful final run.
Source/proof hashes, original and corrected test snapshots, red/green console
and matrix evidence, full execution/package logs, class checks, cleanup and the
ready PR description remain under `logs/recovery-directory-review.local/`.

The two Windows-disabled scenarios remain
`OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched`
and
`OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites`.
These local checks establish no Linux symlink execution, provider recovery IO,
independent-copy durability, actual hosted jobs, representative recovery timing,
physical-device acceptance or release readiness. The V7 positive fixture still
does not separately round-trip shared-audience audit rows; legacy audit defaults
and malformed V7 audit rejection are covered without claiming that extra case.

Ryan creates/merges the PR after exact-current-head CI/configured review and
Linux-only checks. The focused Notion issue tracks delivery without closing
operational acceptance. The next suggested formal package is backend
`portable/`, after fresh inventory and consumer tracing.

## Backend portable decisions — October 20, 2026

This batch inventories all **ten production files** and **five existing test
suites** under backend `portable/`: **15 tracked paths**, with no placeholder.
It starts on `feature/backend-portable-review` from the clean completed recovery
head `3db0407`. At entry, fetched main remains `1ef3583`; the recovery branch is
not yet merged. The later delivery refresh finds recovery merged as PR 91 on
main `bf08adb`, so the portable PR now isolates this batch.
All **211 tracked backend inputs** are frozen before edits in the work-computer
checkout. There are no unrelated working changes at entry.

The mechanical commit `9d55f95` expands the ten production files while preserving
their interfaces, declarations, imports, literal/SQL values and operation order.
Parser comparison against the frozen entry source passes all ten files, with
**50 rejected negative controls**. It normalizes simple single-statement control
bodies plus **11 exact, individually reviewed compound-body wrappers**; it does
not discard arbitrary blocks/scopes. This parse-only check does not perform type
attribution. No dependency, migration, cache or speculative abstraction is added.

| File in production `portable/` | Decision and reason |
|---|---|
| `ExportAuthority.java` | Simplify layout; keep request-side couple/reveal checks and detached account UUID/credential-version authority, revalidated against current account state without retaining session credentials. |
| `ExportController.java` | Simplify layout; keep contract/query checks, bodyless CSRF/origin boundary, no-store responses and generated ZIP headers, bounded transfer length and cancellation/expiry checks around each read. |
| `ExportJobService.java` | Simplify layout and fix reproduced clock rollback separately. Keep bounded account/global admission and attempts, explicit idempotency/generation identities, one worker/cache/download lease, current authority/source checkpoints, index refresh rules and cleanup quarantine. |
| `ExportRequest.java` | Simplify layout; keep V4/variant identity checks, strict attempt header, exact creation precondition, singleton query allowlists, page bounds and canonical cursor envelopes scoped to job/list/version. |
| `ExportStatus.java` | Simplify record layout; preserve the existing content-free progress/attempt/page shape, component order, counts and opaque identities consumed by the frontend decoder. |
| `OwnedExportDirectory.java` | Simplify layout; keep private permissions, exact owner/UUID marker, exclusive lifetime lock, bounded orphan scan, rejection of unexpected/symlinked artifacts and retained cleanup ownership for explicit retry. |
| `PortableExportException.java` | Simplify constructor layout; keep the safe content-free failure without paths/provider details. |
| `PortableExportRepository.java` | Simplify layout; keep read-only REQUIRES_NEW repeatable capture, fresh read-committed content/organization fingerprints, eligible completed records, filtered graph links, deterministic order and bounded combined metadata/row/original budgets. |
| `PortablePartWriter.java` | Simplify layout; keep bounded STORED ZIP parts, exact original bytes/hash checks, generated relative paths, exact outcome identity, private no-overwrite output and escaped static offline reader with bounded previews and complete text/JSON. |
| `PortableSnapshot.java` | Simplify layout; keep immutable collection copies, explicit portable allowlist, audiences and legacy private default, decimal BIGINT positions, redacted diagnostics and private validation tokens excluded from archiveData. |

| File in test `portable/` | Decision and reason |
|---|---|
| `ExportHttpSecurityTest.java` | Keep unchanged: actual filter chain rejects operator/developer, disabled/rotated accounts and pre-reveal sessions before reaching mocked job work. |
| `ExportJobServiceTest.java` | Keep the eleven existing lifecycle/race cases and extend this existing suite for rollback. Real private ZIP/files with independent synthetic authority/source gates cover exact attempts/generations, credential rotation, warning/retry/index refresh, cleanup fencing, shutdown and reserved cancellation capacity. |
| `OwnedExportDirectoryTest.java` | Keep unchanged: seven cases cover live/orphan locks, private permissions, suspicious paths/markers, explicit cleanup failure/retry and Linux-only symlink refusal. |
| `PortableExportRepositoryPostgresTest.java` | Keep the six existing migrated PostgreSQL capture/currentness/bounds cases; extend audience coverage in this existing suite. No new tracked test file is needed. |
| `PortablePartWriterTest.java` | Keep unchanged: six cases cover exact mixed originals/organization, escaped reader, Eastern/DST presentation with UTC JSON, explicit integrity/read failures, bounds, cancellation/currentness and no-overwrite outcomes. |

Consumer tracing includes the real-session HTTP suite `media/ExportHttpTest`,
security/session/reveal/origin/CSRF/body filters, current account versions,
frontend export decoding/reconciliation and native-save lifecycle, original
storage reads, review/retention eligibility, sharing audiences, private
albums/timeline/tags and the separate recovery contract. These traced consumers
are not thereby marked as new formal directory reviews.

Capture freezes eligible content and all-link validation tokens; later unrelated
rows do not join it. Original reads and publication use fresh checkpoints without
holding database locks across provider IO. Admitted transfer races cannot recall
already released bytes. The single cache/lease, pending worker counter and failed
deletions preserve their existing explicit retry/fail-closed boundaries. The
trusted process-owned temporary root and permissions remain the boundary for
ancestor or same-owner replacement races; this review does not claim arbitrary
hostile-filesystem atomicity.

Two rollback regressions were added only to an ignored frozen baseline copy
first. Both fail for the intended assertions: an existing 12:40 deadline becomes
11:40 after a one-hour rollback, and capture publishes READY with a timestamp
before creation. The actual frontend `decodeExportStatus` rejects both serialized
Java records. The behavioral correction is separate from the mechanical commit:
retain an established expiry when the clock moves backwards, still cap extension
at immutable hard expiry, and fail a capture earlier than admission without
publishing content or inventing timestamps. This does not promise elapsed-time
expiry during wall-clock changes.

The fix and two existing-suite rollback regressions are committed separately in
`7f4b255`; the previous eleven service tests are preserved byte-for-byte outside
the additions. Access through repeated 29-minute activity intervals still reaches
the original hard deadline, remains readable immediately before it and returns
404 at exact hard expiry. Capture rollback ends with content-free
`FAILED`/`EXPORT_FAILED`, skips source planning/publication and permits a deliberate
replacement job.

Coverage commit `ca0530d` adds one existing repository-suite case for `PUBLIC`
and `FRIENDS_FAMILY` serialization, share-link capability exclusion and later
audience-change invalidation, plus one existing real-session `media/ExportHttpTest`
case for normalized uppercase job/generation identities and strict attempt
headers. Both probes pass first against frozen baseline production. All prior
bytes in those suites are preserved outside the additions. The API documentation
now describes normalized URL identities, canonical response/header forms,
preserved visibility, rollback failure and the separate recovery v7/V14 contract;
the portable archive format remains version 1.

## Backend portable verification — October 20, 2026

The frozen baseline focused run passes **38 tests: 37 passed, one skipped**,
including the five formal portable suites and actual HTTP consumer suite. The
isolated rollback red run has **two intended assertion failures**, not a pass.
The corrected service suite passes **13 of 13**, and the actual frontend decoder
accepts both corrected serialized Java DTOs after rejecting both baseline DTOs.
The separate baseline audience/HTTP probes pass **two of two**. These results
describe separate snapshots and are not additive totals.

Runtime is Windows, Microsoft OpenJDK **25.0.4+7**, wrapper Maven **3.9.16**,
Spring Boot **4.1.1**, disposable PostgreSQL **17.11**, Docker **29.8.0** and
previously checksum-verified FFmpeg/ffprobe **9.0.2**. The ignored wrapper
`MAVEN_USER_HOME` workaround for this machine's hidden `.m2` directory is reused;
tracked build configuration is unchanged. The local Surefire exit grace remains
120 seconds. Frontend source and operational scripts are unchanged; their full
suites are not rerun for this backend batch.

Two full runs lose Docker Desktop's local daemon, first during HTTP tests and
then during recovery compatibility tests. Database-connection errors and the
unsuccessful runs are preserved separately under `interrupted-docker-loss/` and
`interrupted-docker-loss-2/`, including original inputs, classes, reports and
logs. Neither is a pass. Each blocked test fork is stopped only after its exact
Maven parent chain is verified. Docker is restarted locally; remaining containers
are removed only after their exact logged identities and Testcontainers labels
are verified. The shutdown cause is not established by the local logs.

The final run uses a fresh output directory, one fresh JVM per top-level test
class and a 1 GiB test heap (`forkCount=1`, `reuseForks=false`, `argLine=-Xmx1024m`) to bound
test-process accumulation. These are ignored local verification settings; the
same source head and all 211 hashes are retained, with no tracked build change.
Unrelated JVMs and application data are not cleanup targets.

The final intended backend snapshot at code head `ca0530d` passes **474 tests:
472 passed, two skipped**, zero failures/errors, Maven exit 0 and explicit
successful-build marker; packaging succeeds. Its formal portable suites contain
**36 tests: 35 passed, one skipped**, and all **six actual HTTP consumer tests**
pass. All **211 unique tracked backend inputs** match the frozen compile inputs
and visible checkout. The full run has no fork-shutdown timeout. This final run
supersedes the unsuccessful infrastructure attempts without relabeling them.

There are **41 exact portable compiled disassemblies** for printed
instructions/descriptors/constants. Only the intentionally changed outer
`ExportJobService` class is excluded from baseline instruction equality; its
nested classes remain compared. Non-portable production classes retain exact
baseline bytes. `javap -c -p -constants -s` excludes annotation/bootstrap/debug
metadata, so these checks complement the AST checks, source review and execution.

All **248 production classes** in the executable JAR match the final tested bytes;
all **111 compiled test/fixture classes** are excluded by direct class identity
and byte digest. This is not a nested dependency-JAR or non-class resource audit.
The executable launcher/application manifest is correct. Packaged console help
exits 0, and noninteractive recovery export exits 2 with its safe diagnostic
before recovery starts. The actual frontend decoder also accepts both status
records emitted by the final full test run.

Read-only cleanup confirms all **89 observed test containers** across retained
baseline, probe, failed/interrupted and final logs are absent. All **31 logged
Spring-test JVM PIDs** are absent from Java processes, and no JVM with the review
path remains. This does not claim discovery of every unlogged process or native
child. Source/proof hashes, exact retained snapshots, red/green decoder evidence,
class/package checks, cleanup and the ready PR description remain under
`logs/portable-directory-review.local/`.

The exact Windows-disabled cases are
`OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched`
and
`OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites`.
Linux execution, live-provider IO, browser/device save and extraction, hosted
capacity, operational durability and release acceptance remain separate checks.
The bounded local fixtures do not establish those outcomes or every possible
worker/download/cleanup interleaving.

Ryan creates/merges the PR after exact-current-head CI/configured review and
Linux-only checks. The focused Notion issue records review delivery without
closing operational acceptance. The next suggested formal package is backend
`album/`, after a fresh inventory and consumer review.

## Backend album decisions — October 20, 2026

This batch covers all **eight production files** and the **one existing contract
suite** under backend `album/`: **nine tracked paths**, with no placeholder.
The nine-case actual HTTP consumer suite in `media/AlbumHttpTest.java` is also
read and executed. It starts on `feature/backend-album-review` from clean main
`f602f47`, after portable PR 92 merges. All **211 tracked backend inputs** are
frozen before edits; there are no unrelated working changes at entry.

No concrete runtime correctness or privacy defect is reproduced in the album
implementation. Keep its behavior and expand its presentation in the separate
mechanical commit `4b913d1`. All eight source files pass parser/import comparison
against the frozen baseline, with **40 rejected negative controls**. Only simple
single-statement control bodies are normalized; there are **no compound-body
exceptions**. Imports, declarations, literal/SQL values, order and other scopes
remain exact. This is parse-only evidence, without type attribution; compilation
and execution complement it. No runtime efficiency improvement is claimed.

| File in production `album/` | Decision and reason |
|---|---|
| `AlbumController.java` | Simplify layout; keep private session/contract/CSRF/origin boundaries, existing request-body limits, route bindings, no-store JSON and response/ETag agreement. Unknown body fields are rejected; do not claim a servlet query-name allowlist that this controller does not implement. |
| `AlbumCursor.java` | Simplify layout; keep canonical unpadded base64url round trips, list/member kind and album scope, V4/variant identities, canonical UTC microsecond timestamps in years 1–9999 and positive signed BIGINT member positions. The browser retains an opaque cursor rather than a lossy numeric position. |
| `AlbumDetail.java` | Simplify record layout; keep the existing immutable album identity/name/private visibility/revision/count/timestamp shape and content-free tombstone representation. |
| `AlbumMemberships.java` | Simplify layout; keep the caller's memory lock/transaction, deterministic album-row lock order, complete link detachment and fresh affected-album revisions with nondecreasing timestamps. Preserve its reviewed offline recovery caller too. |
| `AlbumQuery.java` | Simplify layout; keep default/bounded 1–50 page sizes and route-scoped cursor decoding. No speculative parser or query-policy abstraction is needed. |
| `AlbumRepository.java` | Simplify framing, guards, JDBC chains and records; preserve all literal/SQL values. Keep parameterized keyset queries, one-statement member/token/count visibility, shared completed-memory eligibility, equality-token changes, terminal identity retention, deferred-unique swaps and BIGINT append compaction. |
| `AlbumRequest.java` | Simplify layout; keep the raw UTF-16 name limit, ECMAScript-compatible trimming and storable Unicode rules, exact allowed body fields/directions, strict strong quoted V4 revision tokens and distinct missing/malformed preconditions. Album identities are V4; legacy memory UUIDs remain supported. |
| `AlbumService.java` | Simplify layout; keep transactional changes, current couple/reveal authority before work and after waits/results, memory-before-album lock ordering, equality revision fences, no-op token preservation, microsecond timestamps and server-resolved adjacent-member moves. |

| Existing test file | Decision and reason |
|---|---|
| `album/AlbumContractTest.java` | Keep all three cases unchanged: Unicode/raw length and unknown body fields, list/member cursor and strong revision boundaries, bounded pages and distinct preconditions. No behavior change warrants a new test file. |
| `media/AlbumHttpTest.java` (consumer) | Keep all nine cases unchanged: creation/rename/no-op/tombstone retries, many-to-many paging and cross-page moves, memory Delete/Restore and erasure replay, large pages/MAX_VALUE compaction, concurrent create/edit winners, queued revocation, incomplete/verified originals, private request boundaries, audio/review states and legacy memory identities. |

Consumer tracing includes the frontend album API, strict DTO/ETag decoding,
opaque paging and server-side movement controls, exact retry/privacy/write-fence
lifecycle and synthetic mock; shared text/Unicode/body/session policies; memory
review and retention; portable capture/currentness; and versioned offline
recovery. These traces do not newly mark those other directories as formal
reviews or rerun their historical browser/device acceptance.

Album mutation serializes on its row, while add and memory deletion consistently
lock the memory first. Remove, move and album-only deletion acquire no reverse
memory lock. Detachment locks affected albums in database identity order before
changing their links/revisions. The member page returns its album token, eligible
count, cards and movement flags from one PostgreSQL statement; page-to-page
organization changes are fenced by the album revision. That is not a frozen
multi-request snapshot of independently editable memory metadata.

Ordering remains server-owned. Moves swap positions with the adjacent available
member, including beyond a page; deferred uniqueness permits the swap, and append
compacts existing sparse positions at BIGINT maximum without reordering siblings.
Deleting an album scrubs its name and links, preserving terminal identity and all
original memories/media. Authoritative memory deletion detaches relationships;
restore does not automatically rejoin them. Album-only organization has no
independent deletion ledger, so the existing older-backup limitation remains.

Tests remain byte-identical to the frozen baseline. Additional malformed-cursor
matrices, shared-audience organization, direct rollback across every mutation
and every queued revocation/interleaving remain coverage gaps rather than
invented defects. Existing source, statement-snapshot, lock and boundary evidence
is retained without claiming exhaustive schedules or hosted capacity.

Correct the album API's active recovery guidance: V4 remains the first
album-capable package and V11 its minimum schema, while current V14 export uses
package V7. A V11-only binary is not a compatible rollback target for a V14
database. Keep the historical introduction and recovery limitations intact; no
migration, dependency, application behavior or production setting is changed.

## Backend album verification — October 20, 2026

The frozen baseline passes **12 tests: three contract and nine actual HTTP**,
with zero failures, errors or skips, Maven exit 0 and explicit successful-build
marker. No red regression is claimed because no concrete defect is reproduced.
Independent source, request-boundary and test reviews find no actionable issue.

Runtime is Windows, Microsoft OpenJDK **25.0.4+7**, wrapper Maven **3.9.16**,
Spring Boot **4.1.1**, disposable PostgreSQL **17.11**, Docker **29.8.0** and
previously checksum-verified FFmpeg/ffprobe **9.0.2**. Reuse the ignored
`MAVEN_USER_HOME` workaround for this machine's hidden `.m2` directory. Final
verification uses one fork at a time, with a fresh JVM for each top-level test
class and a 1 GiB heap
(`forkCount=1`, `reuseForks=false`, `argLine=-Xmx1024m`) and a 120-second local
Surefire exit grace. Tracked build configuration is unchanged. Frontend source
and operational scripts are unchanged; their full suites are not rerun here.

The fresh frozen tree at code commit `4b913d1` completes the full backend
`package` run with Maven exit 0 and `BUILD SUCCESS`: **474 total, 472 passed,
zero failures/errors and two expected Windows skips**. The three album contract
and nine album HTTP cases pass within that full run too. All **211 tracked
backend inputs** match their frozen intended hashes after execution and final
verification; only the eight reviewed production files differ from baseline.

All **13 album classes**, including nested records, have identical baseline and
final `javap -c -p -constants -s` output, with **no exclusions**. All other
production class bytes remain identical to baseline. This disassembly comparison
does not include annotation, bootstrap or debug metadata; the parser checks,
compilation and execution provide complementary evidence.

All **248 packaged production classes** match the tested bytes. The JAR's direct
class entries exclude the identities and byte digests of all **111 compiled
test/fixture classes**, and its launcher/application manifest is correct. This
does not audit nested dependency JAR contents or non-class resources. Packaged
recovery console help exits 0; noninteractive export exits 2 with the expected
safe diagnostic before recovery starts.

Read-only cleanup confirms all **48 observed test containers** in retained album
logs are absent. All **28 logged Spring-test JVM PIDs** are absent from Java
processes, and no JVM with the review path remains. This does not claim discovery
of every unlogged process or native child. Frozen inputs, proof/source hashes,
test and package results, cleanup and the ready PR description remain under
`logs/album-directory-review.local/`.

The exact Windows-disabled cases are
`OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched`
and
`OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites`.
Linux execution, live-provider IO, browser/device save and extraction, hosted
capacity, operational durability and release acceptance remain separate checks.
The local evidence does not establish those outcomes or every possible
authorization, mutation, download or cleanup interleaving.

Ryan creates/merges the PR after exact-current-head CI/configured review and
Linux-only checks. The focused Notion issue records review delivery without
closing operational acceptance. The next suggested formal package is backend
`timeline/`, after a fresh inventory and consumer review.

## Backend Sonar follow-up decisions — October 20, 2026

Ryan requested explicit complexity/duplication checks in this process and a
retrospective of all ten formally reviewed backend packages. The baseline at
`6cac548` preserves his authorized OperatorRecovery edit; a later IDE save is
separately preserved at `7c1fa94` and included in the final refactor. Neither is
discarded to recreate an older working copy. The frozen baseline has 211 backend
inputs, 127 production Java files and 62 test Java files. The formal package
scope contains 99 production files plus 53 test suites and two fixtures, with
the existing migration test traced as an additional consumer.

The actual installed SonarJava engine reports 241 selected MAIN-source findings
over the full baseline: **227 in the formal scope** and 14 in library/timeline.
Those 227 findings all receive explicit fix dispositions; none is suppressed,
excluded, marked false positive or retained by changing a threshold. The
follow-up preserves exact contracts through cohesive helper extraction and
owner-scoped constants; no additional backend behavior defect is claimed.

| Reviewed package | Baseline cognitive / cyclomatic / literal findings |
|---|---|
| `security/` | 2 / 6 / 6 |
| `web/` | 0 / 1 / 0 |
| `contribution/` | 0 / 3 / 7 |
| `media/` | 6 / 12 / 16 |
| `review/` | 2 / 4 / 6 |
| `retention/` | 2 / 3 / 4 |
| `operations/` | 4 / 6 / 4 |
| `recovery/` | 11 / 13 / 75 |
| `portable/` | 4 / 11 / 12 |
| `album/` | 0 / 1 / 6 |
| **Reviewed total** | **31 / 60 / 136 = 227** |

The installed official VS Code extension is **6.1.1**, analysis engine
**12.1.1.87771** and SonarJava **8.44.0.48651**, on Java 25 with the exact fresh
compiled production/test classes and 158 dependency JAR inputs. Actual defaults
are S3776 `Threshold=15`, S1541 `Threshold=10`, and S1192 `threshold=3`,
`minimalLength=5`, empty `excludePatterns`. All three rules are MAIN scoped;
TEST indexing does not evaluate those rules on tests. Positive score/secondary
location controls, exact parameter boundaries, TEST classification and malformed
source failure are exercised. The exact known `No workDir in SonarLint` warning
is retained. This is local selected-rule evidence, not the full hosted quality
profile, coverage, new-code measures or a server quality gate.

The IDE engine's no-op CPD hooks cannot establish block duplication. A separate
adapter uses all 61 unmodified duplication-module sources from official
SonarQube **26.4.0.121862**, pinned commit
`ab253503cc54df4bdfefd11eb783997d402b5147`, with seven pinned official Maven
dependencies. It uses the official Java tokenizer, statement builder,
ten-statement block chunker and suffix-tree algorithm. Five actual controls
check nine/ten statements, literal normalization, identifier changes and
whitespace/comments. Baseline detection yields **three raw per-origin groups,
two unique complete endpoint sets**: AudioRequest/PhotoRequest fingerprint
framing and overlapping CoupleRequestBodyFilter organization routing. Only
identical complete endpoint sets are deduplicated; overlapping fragments are
not merged. No block threshold or source exclusion is weakened.

All unchanged reviewed production files retain their existing **keep** decisions
and exact baseline bytes. The following per-file **simplify** decisions cover
the 42 modified files and one new production helper:

| Production file, relative to `com/kevinmel/archive/` | Decision and preserved boundary |
|---|---|
| `security/AccountAdministration.java` | Name the repeated create command and separate confirmed dispatch; retain validation, console confirmation and safe exit behavior. |
| `security/AccountAdministrationStore.java` | Name the repeated username column; retain SQL and row mapping. |
| `security/ArchiveAccessPolicy.java` | Name the production profile and extract public-origin validation; retain exact policy/error order. |
| `security/ArchiveAccountRepository.java` | Name the repeated username column without changing queries or account identity. |
| `security/ArchiveAuthorization.java` | Extract fresh-account validation; retain authentication → account → policy ordering. |
| `security/CoupleRequestBodyFilter.java` | Separate route families and shared organization collection limits; retain exact method/path precedence, status and byte limits. |
| `security/SessionIdentityFilter.java` | Separate current/foreign identity and invalidation; clear/save context before rejection and retain catch boundaries. |
| `security/SessionService.java` | Extract raw credential validation/normalization before throttle and authentication work. |
| `web/StagingAccessFilter.java` | Separate credential/origin predicates; retain digest comparison and complete correlated safe errors. |
| `contribution/ContributionRepository.java` | Name row-field literals without changing SQL values or mapping. |
| `contribution/ContributionRequest.java` | Separate raw field predicates and express exact ECMAScript whitespace ranges; retain all UTF-16 trimming/length and ordered errors. |
| `contribution/ContributionScope.java` | Separate guest/couple authority predicates with the same short-circuit checks. |
| `media/AudioRequest.java` | Separate raw/item/file/duration validation; retain first error, duration and audio fingerprint field order. |
| `media/AudioVerifier.java` | Extract byte bounds, probe/decode and MP4/WebM/Ogg/VINT phases; retain arguments, limits, CRC/paging and temporary cleanup. |
| `media/MediaRequestFingerprint.java` | Add one shared length-prefixed UTF-8 framing helper; callers retain media markers, field order and distinct validation. |
| `media/MediaService.java` | Separate admission/metadata predicates; retain lifecycle, authority and ownership behavior. |
| `media/PhotoRepository.java` | Name repeated row/column literals; all eleven SQL text blocks remain identical. |
| `media/PhotoRequest.java` | Separate raw bounds/type predicates; preserve ordered errors and exact photo fingerprint framing. |
| `media/PhotoVerifier.java` | Separate image checks with unchanged bounded decoding and stream ownership. |
| `media/PlaybackService.java` | Separate request/grant predicates and repeated identities; retain authority and safe response boundaries. |
| `media/R2ObjectStorage.java` | Separate ledger, presign scope and grant metadata checks; preserve provider error translation and exact storage conditions. |
| `review/InboxCursor.java` | Separate cursor decoding/field validation; preserve opaque encoding, identities and safe invalid-cursor failure. |
| `review/InboxRepository.java` | Name repeated row literals without changing SQL, paging or snapshot behavior. |
| `review/MemoryMetadataRequest.java` | Separate body/text/partial-date validation; retain bounds, field order and date semantics. |
| `review/ReviewRequest.java` | Extract validation phases and constants with unchanged accepted body/error order. |
| `review/ReviewService.java` | Separate state predicates; retain authority, locks and mutation/replay behavior. |
| `retention/DeletionRecord.java` | Separate durable record validation while retaining exact identity/outcome requirements. |
| `retention/RetentionAdministration.java` | Separate console dispatch/validation and repeated commands; retain confirmed actions and safe diagnostics. |
| `retention/RetentionRepository.java` | Name repeated mapping literals; retain scrub serialization, SQL and deletion evidence. |
| `operations/OperationsReadiness.java` | Separate readiness evidence phases and repeated values; retain capability/compatibility requirements. |
| `operations/OperationsSchema.java` | Separate schema validation and constants without changing the physical schema contract. |
| `operations/ReadinessAdministration.java` | Separate console/prior-JAR phases with the same no-op/confirmation/error behavior. |
| `recovery/OperatorRecovery.java` | Extract preflight/export/restore phases and repeated literals; retain latest accepted catches, SERIALIZABLE transaction, lock/empty checks, all-plan validation, re-read/publish confirmation, deletion ledger, frozen replay, constraints and commit ordering. |
| `recovery/RecoveryAdministration.java` | Separate console validation/dispatch with exact confirmation, safe error codes and private diagnostic boundaries. |
| `recovery/RecoveryMetadata.java` | Extract per-row contribution/memory/asset/grant/audit/deletion/organization phases sharing the same validation sets; retain cross-row graph constraints and first-error order. |
| `recovery/RecoverySchema.java` | Separate version/schema checks and constants; retain compatibility and table/column requirements. |
| `portable/ExportJobService.java` | Extract admission, part/cache projection, lease opening and untransferred cleanup; retain monitor regions, fresh authority, replay-before-admission, cleanup-before-attempt, one pending-count decrement and transfer ownership only on success. |
| `portable/OwnedExportDirectory.java` | Separate private marker/inventory/permission checks and deletion phases; hold the reaper claim through ZIP deletion and retain retryable failed cleanup. |
| `portable/PortableExportRepository.java` | Separate organization capture/membership phases; retain connection, budget, SQL/order and all-links versus eligible-links distinctions. |
| `portable/PortablePartWriter.java` | Extract original read/write, metadata/outcome and destination checks; retain ZIP bytes, callback/catch boundaries, provider cancellation and created/complete cleanup flags. |
| `album/AlbumController.java` | Use named response-header identities/policy with unchanged private caching and API behavior. |
| `album/AlbumCursor.java` | Separate cursor validation and safe failure without changing tokens/identity/order. |
| `album/AlbumRepository.java` | Name repeated mapping literals; retain exact SQL, locking and member order. |

Independent cross-reviews cover the final security/domain, media, recovery and
portable changes. The original 227 finding records retain primary/secondary
locations, dispositions and final source hashes. Additional helper findings
introduced during refactoring are resolved before final analysis too. No new
tracked test file is added. All resources, migrations, dependency/build settings
and existing tests remain unchanged.

The new tracked local launchers/adapters and pinned CPD bootstrap manifest make
the process reproducible on another machine. See
[the analyzer setup and evidence instructions](backend-sonar.md). Explicit
bootstrap downloads only pinned official artifacts; analysis commands use local
inputs and do not upload private code or start a server. The existing
[home handoff](../../HANDOFF-2026-10-19.md) now records current progress and
remaining packages. Raw ignored evidence stays under
`logs/backend-sonar-review.local/` and is not transferred by Git.

## Backend Sonar follow-up verification — October 20, 2026

The frozen baseline completes full backend `package` with exit 0 and explicit
`BUILD SUCCESS`: **474 total, 472 passed, zero failures/errors and two expected
Windows skips**. The final fresh frozen source at code commit
`673e37da35bc140654e9033394e428208719b603` completes the same full `package`
run with the same counts, exit 0 and successful-build marker. Runtime is
Microsoft Java **25.0.4+7**, Maven **3.9.16**, Spring Boot **4.1.1**, Docker
**29.8.0**, disposable PostgreSQL **17.11**, and checksum-verified local
FFmpeg/ffprobe **9.0.2**. Both runs use the existing tests and local CLI settings
`surefire.exitTimeout=120`, `forkCount=1`, `reuseForks=false`,
`argLine=-Xmx1024m`. The final run exits normally without the earlier historical
shutdown-timeout diagnostic; tracked build configuration remains unchanged.

All **212 tracked final backend inputs** retain their frozen hashes in both the
visible and tested trees. Exactly 42 existing production files differ from the
211-input baseline and one production helper is new. All existing tests and
fixtures remain unchanged. The packaged JAR contains all **256 tested production
classes** with identical bytes; direct class entries exclude identities and
digests of all **111 compiled test/fixture classes**. The executable manifest
names the correct Boot launcher/application. This check does not audit nested
dependency JARs or non-class resources. Packaged recovery help exits 0;
noninteractive export exits 2 with the expected refusal before recovery starts.

All **81 decoded Java text-block values and multiplicities** match baseline,
including SQL. This parser proof does not establish statement execution order
or equivalence of ordinary string expressions. A separate ignored differential
probe uses one JVM and isolated baseline/current class loaders with the same
158 dependency JARs, shared JDK collection salt, synthetic fixed identities,
bytes and timestamps. It passes **69,417 assertions**: 3,360 route/method
comparisons, 65,546 Unicode trimming comparisons, 156 contribution-scope cases,
and 19 complete byte-identical original/index ZIP pairs spanning 79 entries.
Archive cases include more than 1,000 memories, escaped/large text, partial dates,
BIGINT maximum album position, mixed media outcomes and Eastern DST boundaries.
An altered-ZIP negative control is rejected. The compared partial classes precede
only the separately reviewed final layout normalization; the final Maven run
provides fresh final-source compilation/execution. No baseline/final whole-class
bytecode equality is claimed after helper extraction.

The media owner's additional **2,597 comparisons** cover request normalization,
fingerprint bytes, complete ordered errors and synthetic container/VINT bounds.
Independent source review complements these probes, including transaction/lock
ordering, validation-set sharing, provider error boundaries and private-file
claims. These checks do not exhaust all concurrency schedules or real-provider,
hosted, microphone/device or operational acceptance.

At Ryan's explicit request, this delivery also includes the existing frontend
edits in `spikes/audio/recorder.js` and `src/app/App.jsx`. The recorder's expanded
layout initially mislabeled non-Safari `Version/` user agents; two synthetic red
cases reproduce it, and restoring the Safari-token requirement fixes both.
Green evidence covers seven user-agent cases, 44 rendered-field comparisons,
twelve event registrations and the complete 32,044-byte generated WAV. The app
notice changes from a paragraph with status role to an output element, preserving
its condition, copy, class and status semantics. Paragraph-specific appearance
rules no longer target it; no identical-appearance claim is made.

The exact final frontend files pass **571 tests**, lint and production build;
all **14 existing operational helper tests** pass too, on installed Node
**24.16.0** (the package permits 24.x; `.nvmrc` names 24.21.0 for CI/home).
Four initial loopback redirect tests fail under sandbox network denial; a native
fetch probe reports `connect EACCES 127.0.0.1`, and the same full suite passes
with authorized local network access. Initial failures remain retained rather
than counted as passes. No API test/runtime source was changed for this limit.
Synthetic recorder evidence does not establish physical microphone, browser,
screen-reader or visual acceptance. The audio-spike directory remains a future
formal supporting pass.

Final actual selected-rule analysis recognizes all **190 Java inputs: 128 MAIN
and 62 TEST**, with zero failed inputs and no unexpected analyzer warnings or
errors. **All 227 original reviewed-scope findings are resolved**, with zero
selected findings in those ten packages. The full backend retains exactly the
same **14 findings outside that scope**: library six (one cognitive, two
cyclomatic, three literals) and timeline eight (one cyclomatic, seven literals).
Those files remain unchanged and their findings stay open for the next formal
reviews. The installed result API exposes recognized identities and failed
files, not a separate completed-file rule count; sensor diagnostics/progress
and actual rule controls are retained with that limitation. The three rules
remain MAIN scoped, so this is not a test-complexity clean claim.

Final actual CPD analyzes all **128 production files**, runs its five controls,
and reports **zero raw groups and zero unique complete endpoint groups**. The
raw report and each analyzed source hash are bound to the tested frozen inputs.
This establishes the selected standalone official Java detector result, without
claiming hosted duplication density, new-code metrics or a server quality gate.
The tracked bootstrap/checker also receive refusal and integrity controls for
path/host/commit/hash mismatches, linked paths, preserved existing files and
fresh output. The actual bootstrap cache run reuses all 68 verified official
inputs, with no additional download required on this machine. The documented
Maven compile/classpath recipe is executed successfully and resolves the same
158 canonical library inputs as the analysis.

Read-only cleanup inspects the retained task text logs and confirms all **92
observed container IDs** and **53 observed Spring-test JVM PIDs** are absent;
no Java process with the review path remains. This covers observed logs and
review-path JVMs, not every unlogged process or native child. All final source,
compiled-class, analyzer/runtime, finding/disposition and raw CPD manifests are
checked for exact inventories, uniqueness and unchanged hashes. The checkers'
negative controls reject incomplete/changed input inventories and stale reports.
The Java launcher's junction-creation control is host-limited by `EPERM`; that
fixture is not represented as executed. Existing Linux-only symlink tests remain
the two expected Windows skips named above.

Ryan specifically authorizes creating and merging **this all-files PR** after
exact-current-head CI and configured review clear. That delivery-specific request
supersedes the normal user-created-PR boundary for this follow-up. The focused
Notion issue records the published head, actual checks and merge result after
this documentation commit. Backend timeline is next after the merge; broader
operational/release acceptance remains separate.

## Backend timeline decisions — October 20, 2026

This formal batch starts from merged main `c998298` (PR 94) and reviews all
**eight production files** in `backend/src/main/java/com/kevinmel/archive/timeline/`
plus the existing `TimelineContractTest.java`. The eleven existing real
HTTP/session/PostgreSQL cases in `media/TimelineHttpTest.java` are traced as
consumers alongside the three contract cases. No tracked test file is added.

| File in `timeline/` | Decision and preserved boundary |
|---|---|
| `TimelineController.java` | Simplify: expand route signatures/control flow and name the repeated private cache header/policy. Keep contract/origin checks, status codes, response bodies and agreeing ETags. |
| `TimelineCursor.java` | Simplify: expand the record and separate listing/member decode validation into two cohesive helpers. Preserve canonical opaque bytes, filter/event scope, legacy member identities, first-error behavior and redacted diagnostics. |
| `TimelineEvent.java` | Keep behavior; expand the record layout and redacted diagnostic method. Event dates and organization remain distinct from original memory metadata and content. |
| `TimelineMemberships.java` | Simplify: expand control blocks and name the repeated memory parameter. Keep the noninitializing fast path, state lock, sorted event locks, defensive edge deletion and affected event/catalogue token changes. |
| `TimelineQuery.java` | Keep behavior; expand validation and parameter layout. Preserve bounds, filter normalization, duplicate/unknown parameter refusal and query-versus-cursor validation order. |
| `TimelineRepository.java` | Simplify: expand SQL call/mapping layout and name repeated parameter keys. Preserve SQL/text-block values, one-statement revision/anchor/count/page snapshots, chronological/member ordering, conditional writes and lazy state initialization. |
| `TimelineRequest.java` | Simplify: expand validation/record layout and name the repeated event-date field. Preserve raw UTF-16 bounds, storable Unicode, canonical partial dates, strong conditions and ordered validation errors. |
| `TimelineService.java` | Keep behavior; expand statements and transaction flow. Preserve fresh authority around lock waits/returns, memory-before-state/event locking, revision checks, real no-op tokens, monotonic timestamps and terminal identities. |
| Existing `TimelineContractTest.java` | Keep all three tests and assertions; expand their compressed layout and existing control bodies only. |

Consumer tracing covers the private frontend timeline decoder/coordinator and
existing tests, HTTP controller/security/body-limit routes, the shared inbox
eligibility/mapping/locking contract, review deletion, retention and authoritative
erasure replay, album-before-timeline and timeline-before-tag lock order, portable
organization capture/fingerprints, recovery graph/version validation and import
replay, operations schema checks and additive V12. Consumer inspection does not
complete a formal library/sharing/resources review.

No concrete behavior defect is found or claimed, and no runtime performance
improvement is claimed. State and event locks remain distinct: timeline add
locks the memory before state/event; other event writes lock state then event
without subsequently taking a memory lock. Review/retention detach preserve the
shared memory → albums → timeline state → sorted events → tags order. Listing
and member pages retain their one-statement snapshots, with stale organization
revisions checked before current-anchor validity. Genuine no-ops retain tokens.
Event-only deletion still has no independent deletion ledger.

The API recovery note is clarified separately: v5 introduced timeline-capable
packages, while reviewed V14 exports v7 and requires a currently compatible
build. Supported v5/v6 upward imports preserve timelines; the historical v1–v4
empty-timeline import and current independent memory-erasure requirements remain.
No migration, recovery format or rollback guard is changed.

The mechanical phase is committed separately at
`03eaa20eceae62b0e5434e865aa1c83c69080cce`. It expands all nine reviewed sources
without changing their expressions or meaningful scopes. Strict AST comparison
passes all **nine sources**, **18 controls (six positive/twelve negative)** and
malformed-source refusal. It compares public JDK 25 parse trees without type
resolution; this is not a general semantic-equivalence proof.
The separate exact `javap -c -p -constants -s` comparison passes **15 classes:
14 production and one test**. It compares unmodified output bytes, including
private members, descriptors, instructions and constant-pool references; it does
not compare every classfile attribute/debug field or establish raw class-byte
identity. The later intentional extraction is outside that mechanical proof.

The second code phase is
`2ed2f78a34d5d81338a4e1de3b3609e226c684b6`: five production files receive
named constants or the two cursor helpers. The actual baseline has
**14 selected findings over the whole backend: eight timeline and six library**.
Every timeline finding has a **fix** disposition:

| Baseline location/symbol | Rule and measured baseline | Disposition and verification |
|---|---|---|
| `TimelineController.java:25`, private response policy | S1192: `"no-store"` occurs three times; threshold three | Fix with one private policy constant, retaining all three response values. |
| `TimelineController.java:25`, response header identity | S1192: `"Cache-Control"` occurs three times; threshold three | Fix with the existing framework `HttpHeaders.CACHE_CONTROL` identity, retaining the header spelling and response order. |
| `TimelineCursor.java:20`, `decode` | S1541: cyclomatic complexity 17; threshold 10 | Fix by separating listing/member shape and scope validation. The outer bounds/decode/canonical-round-trip/catch boundary remains. Final actual analysis reports no finding in this file. |
| `TimelineMemberships.java:17`, `detach` parameter binding | S1192: `"memory"` occurs three times; threshold three | Fix with an owner-scoped parameter constant; SQL and statement/lock order remain unchanged. |
| `TimelineRepository.java:117`, membership operations | S1192: `"event"` occurs three times; threshold three | Fix with an owner-scoped parameter constant, retaining all three bindings. |
| `TimelineRepository.java:55`, list/create/edit | S1192: `"precision"` occurs three times; threshold three | Fix with an owner-scoped parameter constant, retaining query/write values. |
| `TimelineRepository.java:117`, membership operations | S1192: `"memory"` occurs three times; threshold three | Fix with an owner-scoped parameter constant, retaining all three bindings. |
| `TimelineRequest.java:12`, accepted/read event-date field | S1192: `"eventDate"` occurs three times; threshold three | Fix with an owner-scoped field constant; wire spelling, accepted keys and errors remain unchanged. |

Baseline primary/secondary locations, exact tool/source/classpath identities and
final reports remain under `logs/timeline-directory-review.local/`. No finding
is suppressed, marked false positive or retained through weaker settings.

## Backend timeline verification — October 20, 2026

The baseline focused run passes **14 existing tests**, zero failures/errors/skips,
after Docker is restarted. Its initial Docker-engine HTTP 500 failure remains
in the retained log and is not counted as a pass. The existing frontend timeline
API/component suites pass **20 tests**, zero failures/skips, with no frontend
source changes; these do not rerun the historical mounted browser matrix.

An ignored differential probe compares the baseline and final compiled timeline
API classes in isolated class loaders with the same **158 dependency JARs**.
It passes **27,008 comparisons and three negative controls**, checking request/
query validation, mixed-invalid precedence, Unicode/date boundaries, identities,
conditions, record shape, cursor scope and exact wire bytes. Its before/after
input hashes remain unchanged during execution. This is selected API evidence,
not equivalence proof for SQL, transaction execution, HTTP behavior, every input
or concurrency schedule.

Fresh frozen compilation records **212 backend source inputs**, **256 production
classes** and **111 compiled test/fixture classes**. Analyzer inputs are bound to
the exact frozen source, class and dependency manifests. The runtime uses Java
**25.0.3+9-LTS**. The official SonarSource Marketplace extension bundle **6.1.1**
is downloaded and extracted inside ignored task output, with engine
**12.1.1.87771** and SonarJava **8.44.0.48651**; it is not installed into the IDE
and no global settings are changed. Recorded package/runtime hashes bind the
local artifacts to their official Marketplace source.

Baseline and final use the same actual MAIN rules/settings: S3776
`Threshold=15`, S1541 `Threshold=10`, S1192 `threshold=3`, `minimalLength=5`,
empty `excludePatterns`. Final analysis completes with **190 recognized inputs:
128 MAIN and 62 TEST**, zero failed inputs and **zero selected timeline findings**.
The whole backend retains **six library findings**: one cognitive, two
cyclomatic and three literal findings. The MAIN-only rules do not analyze test
methods. Actual rule-score/boundary, TEST-classification and malformed-source
controls pass; the known `No workDir in SonarLint` warning and result API's
recognized-versus-completed-file limitation remain explicit.

Both actual duplicated-block runs use official SonarQube **26.4.0.121862**,
pinned commit `ab253503cc54df4bdfefd11eb783997d402b5147`, with all **68 verified
runtime inputs** and **five controls**. Final CPD scans all **128 production
files**, reporting **zero raw per-origin groups and zero unique complete
endpoint groups**. Its ten-statement detector/settings and production scope are
unchanged; the baseline also reports zero groups. These selected-rule and
standalone CPD outcomes do not establish a hosted quality gate, full profile,
coverage, duplication density or new-code metrics. Reproduction instructions
remain in [the analyzer guide](backend-sonar.md).

The fresh frozen-source full Maven `package` run exits **0** with an explicit
`BUILD SUCCESS`: **474 total tests, 472 passed, zero failures/errors and two
expected Windows skips**. It finishes in 14:24 without a Surefire shutdown-timeout
diagnostic. Local options are `surefire.exitTimeout=120`, `forkCount=1`,
`reuseForks=false` and `argLine=-Xmx1024m`; tracked build settings are unchanged.
Runtime is Temurin 25.0.3+9-LTS, Maven 3.9.16, Spring Boot 4.1.1, Docker 29.7.2,
PostgreSQL 17.11 and existing FFmpeg/ffprobe 9.0.2. Frontend consumer checks use
Node 24.21.0 / npm 11.19.0. Unchanged frontend lint/build and unrelated suites
are not rerun for this backend batch.

Post-run integrity checks bind all **212 tracked backend inputs** to both the
visible and frozen source. All **367 compiled inputs** retain their frozen
hashes; the executable JAR contains all **256 production classes** with identical
bytes and excludes all **111 compiled test/fixture identities and digests**.
Its manifest names the expected Boot launcher/application. This checks direct
class entries and manifest, not nested dependency JARs or non-class resources.
The JAR SHA-256 is
`c9850f7f5ad48340b50bc5bd99820273edff058d231732721751c42d257fb02d`.

Read-only cleanup confirms all **48 exact created-container IDs** and **25 logged
Spring-test JVM PIDs** observed across the successful baseline and full run are
absent, with no Java command line containing the review path. This covers the
observed identities/path, not every unlogged JVM or native child. Unrelated
resources are untouched. The two Windows-disabled symlink cases remain explicit
Linux CI checks:

```text
OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched
OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites
```

Independent final source and documentation reviews find no actionable issue.
The branch is `feature/backend-timeline-review`; the ready PR description and
source/analyzer/probe/package/cleanup evidence remain under ignored
`logs/timeline-directory-review.local/`. The focused Notion issue records the
published delivery and actual checks. Normal delivery is commit/push and a ready
PR description; Ryan creates and merges the PR unless he explicitly authorizes
another exception.
Exact-current-head CI/configured review remains required before merging.
The next formal package is **`library/`**, then `sharing/` and `health/`.
Provider IO, physical devices, assistive technology, hosted operations and
release acceptance remain separate.

## Backend library decisions — October 20, 2026

This formal batch reviews all **twelve production files** in
`backend/src/main/java/com/kevinmel/archive/library/` and the existing
`LibraryContractTest.java`. It starts from timeline delivery `0678eaf`, initially
stacked on that unmerged branch above merged main `c998298` (PR 94). Before
library delivery, [PR 95](https://github.com/Ryan-Soprano/kevin-mel-wedding/pull/95)
merges timeline at `8fb3fa088aca3a28b09c74c0180f89575d3a684b`. The merged tracked
tree matches timeline delivery `0678eaf`, so the library PR now targets **main**
without a history rewrite or source change. No tracked test file is added.

| File in `library/` | Decision and preserved boundary |
|---|---|
| `LibraryController.java` | Keep behavior; expand route signatures and call layout. Preserve contract-before-parameter validation, the private no-store response and delegation to current-authority services. |
| `LibraryCursor.java` | Simplify: expand the record and separate listing/member decode phases. Preserve raw bounds before decoding, canonical opaque bytes, filter/memory/tag/revision scope, legacy memory identities, final round-trip validation and the existing `IllegalArgumentException` mapping. |
| `LibraryQuery.java` | Simplify: separate filter validation and canonical tag parsing. Preserve query → years → combined filter validation → tag → fingerprint → limit → cursor evaluation order, including mixed-invalid precedence and redacted diagnostics. |
| `LibraryRepository.java` | Keep behavior; expand signatures, mappings and call chains. Preserve exact SQL/text-block values, the shared eligible-memory predicate, one-statement tag/anchor/row snapshot, null sentinel rows, saved-time/identity keyset order and limit-plus-one paging. |
| `LibraryRequest.java` | Keep behavior; expand control blocks and parameter layout. Preserve raw UTF-16 bounds, storable Unicode and trimming, exact accepted keys, UUID-v4 tag identities, strong conditional syntax and existing status/error precedence. |
| `LibraryService.java` | Keep behavior; expand authorization and immutable page projection. Preserve authorization before parsing and before success, selected-tag 404 before anchor 412, current availability and opaque continuation state. |
| `TagController.java` | Simplify: expand route layout and name repeated response header/policy values. Preserve contract and origin checks, query/body boundaries, response statuses, private no-store policy and revision/ETag agreement. |
| `TagDetail.java` | Keep behavior; expand record layout. Preserve every wire field and diagnostics that omit the private name. |
| `TagMemberships.java` | Keep behavior; expand calls and the inert loop-body block. Preserve callers' memory/album/timeline-first locks, sorted live-tag locks, unconditional defensive edge removal and refresh of affected live-tag revisions only. |
| `TagQuery.java` | Keep behavior; expand normalization and record layout. Preserve query-before-limit/cursor validation, attached-memory fingerprint binding, distinct TAGS/ATTACHED/MEMBERS scopes and exclusion of search text from diagnostics. |
| `TagRepository.java` | Simplify: expand signatures/mappings/calls and name the repeated memory parameter. Preserve exact SQL, binding/evaluation order, one-statement page snapshots, eligible-member counts, immutable ordering, terminal name scrubbing and monotonic timestamps. |
| `TagService.java` | Keep behavior; expand transaction/control flow. Preserve fresh authority around lock waits and returns, memory-before-tag add locking, revision fences, real no-op tokens, duplicate-name allowance and permanently used terminal UUID identities. |
| Existing `LibraryContractTest.java` | Keep all three existing tests and assertions; expand compressed layout and inert control bodies only. |

Consumer tracing covers the existing nine real HTTP/session/PostgreSQL cases in
`media/LibraryHttpTest.java`, frontend library/tag API decoders, coordinators and
Library/Tags/MemoryTags views, shared request/security/body-limit gates, the inbox
eligibility/metadata contract, review deletion, retention and authoritative
erasure replay, portable organization capture/fingerprints, recovery graph and
version validation/import replay, operations schema checks and additive V13.
Incidental consumer inspection does not complete the formal sharing, health or
resources reviews.

No concrete runtime behavior defect or performance improvement is claimed.
Duplicate label names remain intentional: UUID-v4 identities distinguish them,
and neither name uniqueness nor Unicode casefold deduplication is introduced.
Search remains a parameter-bound literal PostgreSQL substring over existing
metadata/content fields, with no wildcard interpretation or provider reads for
each listing result. Original-memory deletion retains the memory → albums →
timeline state/events → sorted tags lock order. Tag add owns the memory before
the tag; tag-only mutations do not subsequently take a memory lock. Tag deletion
and original-memory erasure retain their different terminal/restore semantics.
Genuine no-ops keep their revision token.

The API recovery clarification distinguishes the first tag-capable package,
v6/V13, from current V14/v7 exports and supported v6 upward imports. Historical
v1–v5 empty-tag imports, complete graph validation before writes, independent
memory-erasure evidence and the requirement for a build compatible with the
installed schema remain explicit. No migration or recovery format is changed.

Mechanical layout changes are committed separately at `0d5d2a1`. They expand all
thirteen reviewed sources without changing expressions or meaningful scopes.
Strict AST comparison passes **13 sources**, **18 controls (six positive/twelve
negative)** and malformed-source rejection. Imports retain exact identities and
order. The only body normalization removes singleton return/throw/continue/
break/expression-statement wrappers directly at if/loop body properties; there
is no package-specific allowance. This compares public JDK 25 parse trees
without type resolution and is not a general semantic-equivalence proof.

Exact `javap -c -p -constants -s` comparison passes **21 classes: 20 production
and one test**. Baseline and mechanical outputs match without normalization,
including instructions, private members, descriptors and constant-pool
references. Source/class inputs remain unchanged during comparison. This does
not compare every classfile attribute/debug field or raw class bytes. The later
intentional helper/constant extraction is outside that mechanical proof.

The intentional phase is committed separately at
`a6883defb2976d340bc40e8b22b0300070ef4192`: four production files receive the
cohesive cursor/query validation helpers or repeated tag-literal constants.
No tests, resources, migrations, dependencies or tracked build settings change
in this second phase.

The actual baseline has **six selected findings across the whole backend**,
all in library: one cognitive, two cyclomatic and three repeated-literal
findings. Each receives a **fix** disposition, resolved in final actual analysis:

| Baseline primary location/symbol | Rule, measured baseline and secondary locations | Disposition and preserved boundary |
|---|---|---|
| `LibraryCursor.java:39`, `decode` | S1541: cyclomatic 14, threshold 10; fourteen score locations at lines 39–60 | Separate listing/member shape and scope validation while retaining bounds, decode/catch and canonical round-trip order. Final actual analysis reports no finding in this file. |
| `LibraryQuery.java:8`, `from` | S3776: cognitive 18, threshold 15; sixteen contributing locations at lines 10–32 | Extract cohesive filter-validation and tag-parsing phases without reordering validation. Final actual analysis reports no cognitive finding in this file. |
| `LibraryQuery.java:8`, `from` | S1541: cyclomatic 19, threshold 10; nineteen score locations at lines 8–32 | The same cohesive extraction retains normalized filters, fingerprint fields and complete errors. Final actual analysis reports no cyclomatic finding in this file. |
| `TagController.java:30`, response header identity | S1192: `"Cache-Control"` occurs three times, threshold three; secondary lines 48 and 100 | Use framework `HttpHeaders.CACHE_CONTROL`, retaining the exact header spelling and response order. Final actual analysis reports no finding in this file. |
| `TagController.java:30`, private response policy | S1192: `"no-store"` occurs three times, threshold three; secondary lines 48 and 100 | Use an owner-scoped private policy constant, retaining all three response values. Final actual analysis reports no finding in this file. |
| `TagRepository.java:48`, memory parameter binding | S1192: `"memory"` occurs four times, threshold three; secondary lines 102, 107 and 112 | Use an owner-scoped parameter constant, retaining all four binding sites and SQL. Final actual analysis reports no finding in this file. |

Exact primary/secondary ranges and score messages, source/runtime hashes and
raw findings are retained in
`logs/library-directory-review.local/baseline-rules/run-wj3dEE/analysis.json`.
No suppression, threshold weakening or false-positive disposition is used.

## Backend library verification — October 20, 2026

The fresh frozen baseline passes **12 existing focused tests**: three library
contract cases and nine real HTTP/PostgreSQL cases, zero failures/errors/skips,
exit 0 with `BUILD SUCCESS`. Existing cases cover literal filters and dates,
duplicate tag names, no-op/stale revisions, terminal identities, live cursor
contexts, revocation after a queued tag lock, add versus memory deletion,
concurrent creation/rename, privacy/body gates and bounded 10,000-memory pages.
The recorded local plan uses the saved-time index; this is fixture evidence,
not a hosted latency/capacity claim or proof of every concurrency interleaving.

Existing frontend library/tag API and component suites pass **29 tests**, zero
failures/skips and exit 0. Frontend source is unchanged. These consumer checks
do not rerun the historical mounted-browser matrix or unrelated lint/build.

Before reuse, all seven retained extension/provenance artifact hashes match;
the extracted analyzer and identity entries also match the retained official
VSIX. The existing official Marketplace bundle is **6.1.1**, analysis engine
**12.1.1.87771**, SonarJava **8.44.0.48651**, on Java **25.0.3+9-LTS**. All **61
pinned CPD sources and seven dependencies** match the tracked manifest. Reuse is
offline with zero downloads, no IDE installation/global-setting change and no
application-source upload. This binds the retained official HTTPS acquisition;
no independent vendor checksum or IDE signature validation is claimed.

Fresh frozen `test-compile` and classpath export exit 0 with `BUILD SUCCESS`,
compiling all **190 Java inputs: 128 production and 62 test sources**. The frozen
manifest records **367 classes: 256 production and 111 test/fixture classes**.
This is fresh compilation evidence; final post-package integrity is recorded
separately below.

Baseline and final actual analysis recognize **190 Java inputs: 128 MAIN and
62 TEST**, with zero failed inputs. Both use unchanged defaults: S3776 `Threshold=15`,
S1541 `Threshold=10`, S1192 `threshold=3`, `minimalLength=5`, empty
`excludePatterns`. Actual score/boundary, TEST-classification and malformed-source
controls pass. These three rules are MAIN scoped; indexed TEST identities do
not establish test-complexity cleanliness. The result API exposes recognition
and failed inputs, not a separate completed-file rule count. The known exact
`No workDir in SonarLint` warning is retained with that limitation. Final actual
analysis exits 0 with **zero selected findings across the entire backend**, zero
for each of these three rules; all six library baseline findings are resolved.

Baseline and final actual CPD scan **128 production files**, run **five controls** and
report **zero raw per-origin and zero unique complete endpoint groups**. The checker
uses official SonarQube **26.4.0.121862**, pinned commit
`ab253503cc54df4bdfefd11eb783997d402b5147`, and its unchanged ten-statement Java
detector. These selected rules and the separate standalone CPD module do not
establish a full profile, coverage, duplication density, new-code metrics or a
hosted SonarQube quality gate. Reproduction remains in
[the analyzer guide](backend-sonar.md). Final reports are retained in
`logs/library-directory-review.local/final-rules/run-wZjnnp/` and
`final-cpd/run-tAm4rw/`, bound to the exact frozen source/class/dependency inputs.

An ignored differential probe compares baseline and final compiled library/tag
API classes in isolated class loaders sharing the same **158 dependency JARs**.
It passes **72,502 comparisons**, **64 positive controls** and **five comparator
negative controls**; the baseline self-comparison passes the same checks.
Coverage includes query/filter/name/conditional validation, Unicode/raw UTF-16
bounds, canonical tag identities, cursor scope/revision/filter binding, exact
wire/framing bytes, safe diagnostics and observable complete errors/precedence.
All bound input hashes remain unchanged during execution. Negative controls
reject deliberately different normalized values, error payloads, wire/framing
bytes and order; they do not mutate application binaries. Identical safe errors
cannot expose internal ordering among two invalid filters. This selected API
evidence does not establish equivalence for SQL, HTTP/transaction execution,
every input or concurrency schedule; existing runtime tests cover those actual
paths separately.

Independent final source review finds no actionable issue across the thirteen
sources and traced consumers. Reviewed candidate/visible/frozen source hashes
agree; the report is `independent-final-source-review.json` under the ignored
library evidence directory. This source review is separate from execution and
the independent final documentation review.

The fresh frozen-source full Maven `package` run exits **0** with explicit
`BUILD SUCCESS`: **474 total tests, 472 passed, zero failures/errors and two
expected Windows skips**. It finishes in **14:14** without a Surefire shutdown
timeout diagnostic. Local options are `surefire.exitTimeout=120`, `forkCount=1`,
`reuseForks=false` and `argLine=-Xmx1024m`; tracked build settings are unchanged.
Runtime is Temurin 25.0.3+9-LTS, Maven 3.9.16, Spring Boot 4.1.1, Docker 29.7.2,
PostgreSQL 17.11 and verified existing FFmpeg/ffprobe 9.0.2. Frontend consumers
use Node 24.21.0/npm 11.19.0. Unchanged frontend lint/build and unrelated suites
are not rerun for this backend batch.

Post-run integrity verifies all **212 tracked backend inputs** against both the
visible and frozen source and all **367 compiled inputs** against their frozen
hashes. All **256 production classes** are packaged as identical tested bytes;
all **111 test/fixture identities and digests** are excluded. Duplicate JAR
entries are refused and the executable manifest names the expected Boot
launcher/application. This audits direct class entries and the manifest, not
nested dependency JARs or non-class resources. The JAR SHA-256 is
`fd7725c8f9a08d86ce2544c6f9d2538c53aa850a41432291340b9520e43b25f6`.
The ignored integrity/cleanup helpers pass independent review and **26 isolated
controls** covering bad exits/counts, source/class drift, JAR omissions/test
leaks and inventory failures. These are verifier controls, not application tests.

Read-only cleanup confirms all **48 exact created-container IDs** and **25
logged Spring-test JVM PIDs** from the successful baseline/full run are absent,
with no Java command line containing the review path. This covers observed
identities/path only, not unlogged JVMs, native children or every system
resource; unrelated resources are untouched. The two existing symlink cases
remain explicit Linux CI checks:

```text
OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched
OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites
```

Integrity and cleanup reports are `final-delivery-verification.json` and
`final-resource-audit.json` in the ignored library evidence directory.
Independent final documentation review finds no actionable issue; current
relative file links resolve. The focused Notion issue tracks delivery and the
actual evidence, with readback after updates. The ready PR description is
`logs/library-directory-review.local/pr-description.md`.

The branch is `feature/backend-library-review`; ignored source/analyzer/proof/
package/resource evidence remains under `logs/library-directory-review.local/`.
Timeline's initial dependency is resolved by merged PR 95; the library PR base
is **main**. Normal delivery is commit/push with a ready PR description; Ryan
creates/merges the PR unless he authorizes another specific exception.
Exact-current-head CI/configured review remains required before merge. The next formal package is
**`sharing/`**, followed by `health/`; resources/build/configuration and broader
provider/device/assistive-technology/hosted/release acceptance remain separate.

## Backend sharing decisions — October 20, 2026

This formal batch reviews all **six production files** in
`backend/src/main/java/com/kevinmel/archive/sharing/` and both existing package
tests. It starts from library delivery `2fcd546`, initially stacked on that
unmerged branch above main `8fb3fa0` (PR 95). The final remote refresh still
finds library unmerged at `2fcd546`, with no PR found. The sharing review base
is `feature/backend-library-review` while that dependency is unmerged; merge
library first and retarget sharing to main before its merge. No tracked test
file is added, and neither history nor the tested library source is rewritten.

| File in `sharing/` | Decision and preserved boundary |
|---|---|
| `SharedMemory.java` | Keep behavior; expand projection and nested media records. Preserve the exact guest wire fields and null media mapping, excluding guest/account identity, private workflow metadata, filenames, checksums and storage/retry capabilities. Diagnostics retain only the memory identity. |
| `SharedPageController.java` | Keep behavior; expand the response chain. Preserve UUID route conversion, the static application resource, exact HTML MIME value and no-store/no-referrer/noindex headers. Serving the shell performs no memory or account lookup. |
| `ShareTokens.java` | Keep behavior; expand generation and validation control flow. Preserve 32 cryptographically random bytes, unpadded URL-safe encoding, exact 43-character/canonical bounds, SHA-256 over the token's UTF-8 bytes, null rejection and the existing impossible-algorithm failure mapping. |
| `SharingController.java` | Keep behavior; expand route signatures and response chains. Preserve guest reads, contract-before-origin checks for issuance, existing no-body/security gates, exact response policy and the advanced integer ETag. |
| `SharingRepository.java` | Keep behavior; expand signatures, JDBC chains and inert control blocks. Preserve exact SQL/text blocks, event/availability/KEEP/audience predicates, bound parameters, created-time/identity keyset order, limit-plus-one paging and digest-only rotation. Playback acquires the memory lock before opening a fresh capability statement. |
| `SharingService.java` | Keep behavior; expand transaction/control flow and records. Preserve immutable pages, canonical digest-only reads, READ_COMMITTED playback and verified-original five-minute grants, current authority before parsing/after the memory lock/before return, conflict and audience precedence, monotonic microsecond timestamps and atomic rotation/revision/audit. Diagnostics omit content and capabilities. |
| Existing `SharingHttpSecurityTest.java` | Keep all four cases/assertions; expand annotation, member and request/assertion layout. Preserve guest independence from the account store and rejection of missing CSRF, cross-origin/body-bearing, anonymous, operator and revoked issuance requests, plus success headers/revision. |
| Existing `SharingServiceTest.java` | Keep all five cases/assertions; expand fixture and control/call layout. Preserve canonical capability validation, unavailable-read isolation, verified-original grant bounds, current-authority/revision/audit checks and disallowed-audience coverage. |

Consumer tracing covers the public shared-memory page and listing, frontend
sharing decoders, inbox mutation/revision state and memory-review controls,
security routes and request-body gates, shared inbox eligibility and locking,
review revocation/private restoration, playback verification/storage signing,
retention erasure, portable export, recovery metadata/version validation and
additive V14. Existing real HTTP/PostgreSQL tests verify audience durability,
rotation/revocation, private projection, public discovery, stale revisions,
archive/delete/private restoration and unsafe-media exclusion. The queued
playback test establishes that its exact reader PID waits behind the owned
memory writer, then rejects the old capability after rotation commits.
Incidental tracing does not complete the formal health or resources reviews.

No concrete runtime behavior defect or measured performance issue is found.
The batch retains the existing implementation and expands its presentation;
no cache, helper/constant extraction, route, migration, recovery format,
dependency or tracked build-setting change is introduced. Public reads remain
independent of couple accounts. A genuine review no-op retains an existing
link; actual audience/status changes revoke it. Restoring a memory does not
republish its prior audience or capability. Recovery/portable metadata retains
audiences while secret-link capabilities remain excluded.

The API document now distinguishes recovery package versions from database
schema versions and corrects an inherited export claim: recovery v7 preserves
review-audit audiences, while portable exports preserve memory audiences and
do not include review audit. The operator runbook remains the compatibility
authority; no recovery or export format is changed.

The mechanical source commit is
`b36746d2bf422710f7cb0e38988bc5a224cfe345`. Strict AST comparison passes **eight
sources**, **18 controls (six positive/twelve negative)** and malformed-source
rejection. Ordered import identities, expressions, meaningful scopes, literals
and SQL values are retained. The only body normalization removes singleton
return/throw/continue/break/expression-statement wrappers directly at if/loop
body properties; there is no package-specific allowance. This compares public
JDK 25 parse trees without type resolution and is not a general semantic proof.

Exact `javap -c -p -constants -s` comparison passes **11 classes: nine production
and two test**. Baseline and mechanical outputs match without normalization,
including instructions, private members, descriptors and constant-pool
references; bound source/class inputs remain unchanged during comparison.
This does not compare every classfile attribute/debug field or raw class bytes.

## Backend sharing verification — October 20, 2026

The fresh frozen baseline passes **nine existing package tests** and a separate
selection of **three existing real HTTP/PostgreSQL sharing consumer tests**:
12 total across those two runs, zero failures/errors/skips and both exits 0
with `BUILD SUCCESS`. These counts are separate from the final full-suite run.
The existing frontend sharing, memory-review and archive-facade compatibility
suites pass **14 tests**, zero failures/skips and exit 0. Frontend source is
unchanged; these checks do not rerun historical mounted-browser evidence or
unrelated lint/build.

Retained analyzer artifacts are checked before offline reuse: all seven
extension/provenance artifact hashes match, the extracted analyzer/identity
entries match the retained official VSIX, and all **61 pinned CPD sources and
seven dependencies** match their manifest. The official Marketplace bundle is
**6.1.1**, analysis engine **12.1.1.87771**, SonarJava **8.44.0.48651**, on Java
**25.0.3+9-LTS**. There are zero downloads, no IDE installation/global-setting
change and no application-source upload. This binds the prior official HTTPS
acquisition; no independent vendor checksum or IDE signature check is claimed.

Baseline actual analysis recognizes **190 Java inputs: 128 MAIN and 62 TEST**,
with zero failed inputs and **zero selected findings across the entire
backend**, zero for each selected rule. Parameters remain S3776 `Threshold=15`,
S1541 `Threshold=10`, S1192 `threshold=3`, `minimalLength=5` and empty
`excludePatterns`; actual score/boundary, TEST-classification and malformed-input
controls pass. There are no baseline findings requiring a fix/retain/false-
positive disposition. These rules have MAIN scope; indexing TEST inputs does
not establish test-complexity cleanliness. The result API exposes recognition
and failed inputs, not a separate completed-file rule count. The known exact
`No workDir in SonarLint` warning is retained with that limitation. Raw baseline
evidence is `logs/sharing-directory-review.local/baseline-rules/run-tzgjaS/`.

Baseline official Java CPD scans **128 production files**, passes **five
controls** and reports **zero raw per-origin and zero unique complete endpoint
groups**. It uses unchanged ten-statement detection from official SonarQube
**26.4.0.121862**, pinned commit
`ab253503cc54df4bdfefd11eb783997d402b5147`, without production-source exclusions.
Evidence is `logs/sharing-directory-review.local/baseline-cpd/run-rFHsI1/`.
These three rules and the standalone CPD module do not establish a full
profile, coverage, duplication density, new-code metrics or a hosted quality
gate; reproduction remains in [the analyzer guide](backend-sonar.md).

Fresh frozen compilation/classpath export exits 0 with `BUILD SUCCESS` and
compiles all **190 Java inputs**. The exact source manifest contains **212
tracked backend inputs**; the pre-test compiled manifest contains **367
classes: 256 production and 111 test/fixture classes**. These are frozen
inventories; post-package byte integrity is verified separately below.

Final actual SonarJava exits 0 with **zero selected findings**, recognizing the
same **128 MAIN/62 TEST** inputs with zero failed inputs and passing controls.
Final official CPD exits 0 with **zero raw and unique complete endpoint groups**
over **128 production inputs**, with five passing controls and unchanged
settings. Results are retained at
`logs/sharing-directory-review.local/final-rules/run-K3W2xL/` and
`final-cpd/run-v27xQI/`; the source/class/dependency fences bind the actual
inputs. Baseline and final both remain clear within the stated rule/CPD scope.

Independent final source review finds no actionable issue across all eight
sources and their consumers. Candidate, visible, mechanically compiled and
final frozen source hashes match. The report is `final-source-review.json` in
the ignored sharing evidence directory. This review is separate from execution.

The fresh frozen-source full Maven `package` run exits **0** with explicit
`BUILD SUCCESS`: **474 total tests, 472 passed, zero failures/errors and two
expected Windows skips**. It finishes in **12:12** without a Surefire shutdown
timeout diagnostic. Local options are `surefire.exitTimeout=120`, `forkCount=1`,
`reuseForks=false` and `argLine=-Xmx1024m`; tracked settings are unchanged.
Runtime is Temurin 25.0.3+9-LTS, Maven 3.9.16, Spring Boot 4.1.1, Docker 29.7.2,
PostgreSQL 17.11 and retained FFmpeg/ffprobe 9.0.2 binaries whose hashes are
rechecked before this run. Frontend consumers use Node 24.21.0/npm 11.19.0.
Unchanged frontend lint/build and historical mounted-browser matrices are not
rerun for this backend-only batch.

Post-run integrity checks all **212 tracked backend inputs** against the
visible and frozen source, and all **367 compiled inputs** against their
pre-test hashes. The executable JAR packages all **256 production classes** as
identical tested bytes and excludes all **111 compiled test/fixture identities
and digests**. Duplicate JAR entries are refused; its manifest names the
expected Boot launcher and application. This audits direct classes and the
manifest, not nested dependency JARs or non-class resources. The JAR SHA-256 is
`bace5d55847c24579cf2c277480c17453955a287531716e14911a78aa15e3c11`.

The independent helper audit confirms that the resource auditor is
byte-identical to the earlier controlled library helper and the delivery
verifier has the same executable Python AST, differing only in its module
docstring. Syntax checks pass. The earlier **26 isolated helper controls** are
bound to the exact original hashes and are not rerun or counted as new
application tests. Inventories remain read-only and fail closed on errors;
resource and direct-JAR coverage limits remain explicit in the final reports.

Read-only cleanup confirms all **48 exact created-container IDs** and **25
logged Spring-test JVM PIDs** observed across the successful baseline package,
PostgreSQL consumer and full-package runs are absent, with no Java command line
containing the review path. This covers those observed identities/path, not
unlogged JVMs, native children or every system resource. Unrelated resources
are untouched. The actual reports are `final-delivery-verification.json` and
`final-resource-audit.json` in the ignored sharing evidence directory.
Independent final source and documentation reviews find no actionable issue;
relative file links and explicit anchors resolve. The focused Notion issue
tracks the delivery/evidence with readback after updates. A ready-to-copy PR
title and description are included in the final response and retained under
`logs/sharing-directory-review.local/pr-description.md`.

The two existing Windows-disabled symlink cases remain explicit Linux CI
checks:

```text
OwnedExportDirectoryTest.symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched
OperatorRecoveryPostgresTest.symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites
```

The branch is `feature/backend-sharing-review`; ignored source/analyzer/proof/
package/resource evidence belongs under `logs/sharing-directory-review.local/`.
Normal delivery is commit/push with a ready PR description; Ryan creates and
merges the PR unless he authorizes another specific exception. Exact-current-
head CI/configured review remains required before merging. The next formal
backend package is **`health/`**; resources/build/configuration and broader
provider/device/assistive-technology/hosted/release acceptance remain separate.
