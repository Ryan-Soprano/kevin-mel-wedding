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
