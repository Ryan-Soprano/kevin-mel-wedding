# MED-02 — Multi-photo contribution flow

Implementation date: October 9, 2026. Device/audio acceptance testing was deferred by Ryan on this date. This feature changes the guest photo flow; it does not close the retained phone, accessibility or hosted-provider gates.

## Guest behavior

- Select one to five original JPEG, PNG or WebP photos, each at most 10,000,000 bytes. An invalid addition is rejected as a whole while earlier selections remain. HEIC/HEIF stays excluded.
- Preview the originals, remove a selected group, enter an optional name (100 raw UTF-16 units) and a caption for each photo (500 units).
- Save one grouped contribution. Each row reports preparation, upload, verification, saved or unsuccessful status. Only a server receipt marking that item UPLOADED establishes a saved photo.
- A partial result reports the exact saved count. Select the unsaved photos to retry; saved siblings retain their original IDs and are skipped.
- Name, captions, files and item order are locked once submission starts. Keep the page open until the outcome is resolved; refresh or closing the tab loses in-memory recovery state.
- A known content-verification rejection can be retried with the same original bytes and a fresh grant. Once all remaining photos are known rejected, an explicit new-batch action may abandon that remainder while keeping confirmed siblings. Uncertain outcomes prevent that action.
- A completed batch offers an explicit new-batch action. No automatic submission or mutation retry occurs.

## How recovery works

`PhotoBatchForm` owns editable selection and display/focus state. The controlled `PhotoPicker` reuses thumbnail URL creation/revocation and all-or-nothing selection validation. `photoBatchSubmission.js` owns the retained submission lifecycle independently of React.

The coordinator validates the whole group before network work, computes each original's SHA-256 sequentially, and freezes one ordered payload and contribution retry key. Each selected photo's UUID is its `clientItemId`. Receipts are matched by that identifier, not response array position. A changed contribution/member ID, missing sibling, unexpected type, inconsistent completion or regression of an already saved item is rejected before adopting the response.

Transfers and verification run one at a time. This avoids multiplying 10 MB file buffers and fits the existing staging finalization limit. The backend already supports one-to-five PHOTO intents, preserves the grouping and verifies original size, checksum, actual format and bounded decoding before committing UPLOADED. No new backend endpoint, migration or dependency is required.

A deliberate retry first reconciles the receipt. For each selected unsaved item with a retained grant, it attempts finalization before transferring again. This recovers a lost PUT/finalize response without assuming that an interrupted response means failure. A known missing/expired grant is renewed for the same original intent. An earlier FAILED receipt cannot resolve a newer uncertain verification attempt or unlock replacement while that attempt may still commit. Known per-item failure allows later siblings to proceed; throttling and identity/authorization errors stop further work.

Each complete API operation, including response decoding, has a 30-second deadline; a storage PUT has a 120-second deadline. These are operational recovery bounds, not accepted shared-network rate thresholds. Timeout aborts the operation, retains identity for deliberate checking and ignores late results. Receipt reconciliation errors preserve confirmed siblings. Both JSON and storage errors preserve valid Retry-After guidance; retry remains disabled until that wait expires. This does not implement SEC-01's anonymous guest limiter.

The coordinator exposes frozen snapshots without signed upload URLs. Unmount aborts active work and releases retained references; late callbacks cannot update a replacement controller. React StrictMode setup/cleanup creates a fresh controller. Preview object URLs are revoked when their thumbnail is removed. Files, grants, keys and guest metadata are not persisted or logged.

## Verification

The focused coordinator suite has 34 passing checks covering grouped identity, duplicate taps, partial success, selective retry, retained originals, lost creation/PUT/finalize responses, expired grants, reordered/mismatched receipts, saved-item regression, verification rejection/recovery, throttle guidance, deadlines, disposal and callback reentrancy.

The adapter integration suite uses the real JSON transport/decoders against the existing isolated in-memory mock. It covers a five-photo contribution, partial transfer failure, uncertain committed creation, same-original rejection recovery, expired links, recovery outage and explicit new-batch identity. The mock is aligned so storage PUT failure leaves the database item PENDING and an owned completed finalization replays after grant expiry. Mock checks do not verify actual image content or R2.

Four selection regressions verify maximum count, valid formats/size, whole-addition rejection, preservation of existing originals/captions/IDs and grouped removal. Storage adapter checks cover Retry-After propagation. The full frontend suite passes 121 tests with zero failures/skips; lint, the production build, diff checks and the package audit pass (zero reported vulnerabilities). Noninteractive React server-render checks cover initial multi-file controls/labels/unique IDs, five controlled selection cards, disabled editing and absence of premature saved confirmation. This does not establish interactive focus, reflow or audibility. Independent source review has no remaining actionable findings. The existing backend CI suite verifies the unchanged server contract; local Docker was not running. Exact final commit/PR and CI results are recorded in Notion.

Ryan explicitly approved the compatible source-map-js 1.2.1 → 1.2.2 transitive build-package patch discovered during verification. Only that lockfile entry changes. The advisory is [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

## Synthetic review and retained acceptance

Run `npm --prefix frontend run dev`, then open its `/contract-preview.html` page. The MED-02 section uses the actual form with synthetic storage. Try success, partialUpload, expiredGrant, invalidMedia, uncertainSubmission and rateLimited; switch to success before deliberate recovery. Only synthetic files should be used. This preview is excluded from the production package.

Still required before MED-02 is Done:

- Actual iPhone/Android mixed-batch selection, touch/zoom, focus and screen-reader checks, including retry after a network interruption and duplicate taps.
- Full-app HTTPS/private R2 batch transfer, verified original comparison, partial recovery and hosted capacity/session/CORS checks under MED-01/OPS-01.
- Production security/guest shared-network limiter and release checks under their own issues.

The browser-control runtime failed to initialize on this computer during this implementation session; no new interactive browser or physical-device pass is claimed. Paid infrastructure, deployment and physical Android acceptance remain deferred/pending as previously agreed.
