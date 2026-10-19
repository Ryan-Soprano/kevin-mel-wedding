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
