# Archive frontend

For prerequisites, install/run/check commands, the development proxy, and current API behavior, use the [root README](../README.md#local-development). Feature status and acceptance criteria live in the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database.

## Source map

| File | Responsibility |
|---|---|
| [src/main.jsx](src/main.jsx) | React entry point; imports the global stylesheet and application shell |
| [src/app/App.jsx](src/app/App.jsx) | Top-level application shell |
| [src/features/contribution/](src/features/contribution/) | Guest text form and retained draft/key coordinator in api/textSubmission.js |
| [src/features/contribution/components/ContributionForm.jsx](src/features/contribution/components/ContributionForm.jsx) | Direct-send note form and result views; the hook owns editable state, validation, focus and coordinator wiring while the retained submission lifecycle stays in api/textSubmission.js |
| [src/features/media/](src/features/media/) | Active batch photo form/coordinator, shared controlled picker, constraints/previews and the retained MED-01 singleton coordinator |
| [src/features/media/components/PhotoBatchForm.jsx](src/features/media/components/PhotoBatchForm.jsx) | Photo batch shell and compose/review/card/action views; the form hook owns editable state, focus and coordinator wiring while the upload lifecycle stays in api/photoBatchSubmission.js |
| [src/features/inbox/components/Inbox.jsx](src/features/inbox/components/Inbox.jsx) | Shared private archive page layout; InboxScreens.jsx selects small screen adapters, each owning its feature props and reset key |
| [src/features/inbox/components/ArchiveLayout.jsx](src/features/inbox/components/ArchiveLayout.jsx) | Shared cards, action rows, empty states and pagination for archive features |
| [src/features/library/components/Library.jsx](src/features/library/components/Library.jsx) | Library shell and focused filters/results/tag chooser/recovery/paging views; its hook owns editable search fields, validation, focus and action wiring while the existing library coordinator owns applied filters, requests and return context |
| [src/features/timeline/components/Timeline.jsx](src/features/timeline/components/Timeline.jsx) | Timeline shell and focused list/editor/detail/selector/recovery views; its hook owns local fields, filters, validation and focus while the existing timeline coordinator owns requests and recovery |
| [src/features/albums/components/Albums.jsx](src/features/albums/components/Albums.jsx) | Album shell and focused list/name/detail/selector/recovery views; its hook owns local drafts, validation, focus and action wiring while the existing album coordinator owns requests, ordering and recovery |
| [src/features/export/components/ExportArchive.jsx](src/features/export/components/ExportArchive.jsx) | Export shell and focused guide/recovery/status/parts/download/warnings views; its hook owns cancellation and feedback focus while the existing export coordinator owns jobs, retries, paging and verified download lifetimes |
| [src/features/inbox/api/inboxHistory.js](src/features/inbox/api/inboxHistory.js) | Browser Back/Forward with fresh private reads, mutation guards and disposable in-memory route metadata; browser history contains opaque keys only |
| [src/app/guestHistory.js](src/app/guestHistory.js) / [useGuestHistory.js](src/app/useGuestHistory.js) | Guest screen history; visited forms retain drafts in memory and pending submissions block traversal |
| [src/shared/components/MemoryChoice.jsx](src/shared/components/MemoryChoice.jsx) | Accessible memory-type cards shared by guest and private creation screens |
| [src/features/guestGallery/](src/features/guestGallery/) | Approved public photos, the welcome collage, single-photo slideshow and batched thumbnail browser; separate from private archive data |
| [src/features/inbox/api/inboxController.js](src/features/inbox/api/inboxController.js) | Private state publication, access checks, cancellation, lifecycle and navigation; composes feature actions |
| [src/features/inbox/api/memoryMutationActions.js](src/features/inbox/api/memoryMutationActions.js) | Memory review, audiences, private links and metadata edits, including revision checks and unconfirmed-action recovery |
| [src/features/inbox/api/inboxMedia.js](src/features/inbox/api/inboxMedia.js) | Original photo/audio loading, integrity checks and owned preview URL cleanup |
| [src/features/inbox/api/inboxState.js](src/features/inbox/api/inboxState.js) | Shared immutable state helpers and safe session copies |
| [src/features/inbox/hooks/](src/features/inbox/hooks/) | Single controller lifetime, privacy clearing, focus/pagination state and stable action adapters |
| [src/features/inbox/inboxDisplay.js](src/features/inbox/inboxDisplay.js) / [memoryDisplay.js](src/features/inbox/memoryDisplay.js) | Private view labels/guards and Eastern display times; API timestamps remain UTC |
| [src/features/archive/](src/features/archive/) | Reserved for the private archive and review experience |
| [src/features/auth/](src/features/auth/) | Reserved for couple authentication |
| [src/shared/](src/shared/) | Reusable API and UI code shared by multiple features |
| [src/shared/api/archiveApi.js](src/shared/api/archiveApi.js) | Stable archive API facade; composes the feature adapters and preserves the shared exports |
| [src/shared/api/archiveContracts.js](src/shared/api/archiveContracts.js) | Shared v1 validation, normalization and response decoders |
| [src/shared/api/contributionApi.js](src/shared/api/contributionApi.js) | Guest and couple contribution, upload and receipt requests |
| [src/shared/api/sessionApi.js](src/shared/api/sessionApi.js) | Session lookup, sign-in and sign-out requests |
| [src/shared/api/memoryApi.js](src/shared/api/memoryApi.js) | Inbox, memory detail, metadata, review and playback requests |
| [src/shared/api/mockArchiveApi.js](src/shared/api/mockArchiveApi.js) | Isolated synthetic server behind the same transport/adapter |
| [src/shared/api/v1/fixtures.js](src/shared/api/v1/fixtures.js) | Executable versioned request/response examples |
| [src/dev/](src/dev/) / [contract-preview.html](contract-preview.html) | Development-only synthetic UI preview; excluded from the normal build |
| [src/styles/](src/styles/) | Global styles and design tokens |
| [e2e/](e2e/) | Reserved for future browser-level tests |
| [vite.config.js](vite.config.js) | React plugin and development API proxy |
| [package.json](package.json) / [package-lock.json](package-lock.json) | Scripts, dependency ranges, and resolved versions |

Keep component tests beside the implementation they exercise. Update this map when boundaries change; keep implementation work in Notion.

## Source readability

Ryan prefers the expanded formatting used in the album files. Put long imports,
JSX props and structured objects on multiple lines, keep statements and test
assertions separate, and use clear blocks for control flow. Favor readable code
over dense one-line expressions so someone learning the project can follow it.
Use this style for new and edited code without reformatting unrelated files.

During each focused file review, look for unnecessary work, unclear boundaries
and departures from established coding practices. Prefer simple changes that
improve maintainability; preserve behavior and avoid speculative optimization.

The [v1 contract](../docs/api/v1/README.md) owns API semantics and implementation gaps.
Run `npm test` here for transport, decoder, and mock contract checks; no backend or
Docker is required. They do not replace server integration/browser/device tests.
Start Vite and visit `/contract-preview.html` for synthetic scenarios. The wedding
form saves text through the real v1 adapter. Its direct-send form uses field-level errors, a focusable result heading, an announced sending state, and a locked same-key retry when the outcome is uncertain. The independent batch photo form uses that adapter for a grouped intent, per-item grants, sequential original transfers and verified finalization. It retains the original files/hash/IDs/key, skips confirmed siblings and permits selective deliberate retry. A partial result reports the saved count; full confirmation requires a COMPLETE receipt. Retry state lasts only while this page remains open. Photo storage is opt-in. Existing MED-01 real-R2 evidence and remaining provider/device acceptance are documented in [photo verification](../docs/api/v1/photo-verification.md); MED-02's added implementation and deferred checks are in [batch verification](../docs/product/med02-verification.md). See [MSG-02 verification](../docs/product/msg02-verification.md), the [R2 setup runbook](../docs/runbooks/private-photo-storage.md), and the [full-app staging runbook](../docs/runbooks/staging-deployment.md). The dev contract preview includes the actual batch form backed by synthetic storage; it does not verify image content/R2 readiness and is excluded from the combined production package.
