# Archive frontend

For prerequisites, install/run/check commands, the development proxy, and current API behavior, use the [root README](../README.md#local-development). Feature status and acceptance criteria live in the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database.

## Source map

| File | Responsibility |
|---|---|
| [src/main.jsx](src/main.jsx) | React entry point; imports the global stylesheet and application shell |
| [src/app/App.jsx](src/app/App.jsx) | Top-level application shell |
| [src/features/contribution/](src/features/contribution/) | Guest text form and retained draft/key coordinator in api/textSubmission.js |
| [src/features/media/](src/features/media/) | Photo selection, constraints, previews, and removal behavior |
| [src/features/archive/](src/features/archive/) | Reserved for the private archive and review experience |
| [src/features/auth/](src/features/auth/) | Reserved for couple authentication |
| [src/shared/](src/shared/) | Reusable API and UI code shared by multiple features |
| [src/shared/api/archiveApi.js](src/shared/api/archiveApi.js) | Durable v1 adapter/decoders used by the wedding text form |
| [src/shared/api/mockArchiveApi.js](src/shared/api/mockArchiveApi.js) | Isolated synthetic server behind the same transport/adapter |
| [src/shared/api/v1/fixtures.js](src/shared/api/v1/fixtures.js) | Executable versioned request/response examples |
| [src/dev/](src/dev/) / [contract-preview.html](contract-preview.html) | Development-only synthetic UI preview; excluded from the normal build |
| [src/styles/](src/styles/) | Global styles and design tokens |
| [e2e/](e2e/) | Reserved for future browser-level tests |
| [vite.config.js](vite.config.js) | React plugin and development API proxy |
| [package.json](package.json) / [package-lock.json](package-lock.json) | Scripts, dependency ranges, and resolved versions |

Keep component tests beside the implementation they exercise. Update this map when boundaries change; keep implementation work in Notion.

The [v1 contract](../docs/api/v1/README.md) owns API semantics and implementation gaps.
Run `npm test` here for transport, decoder, and mock contract checks; no backend or
Docker is required. They do not replace server integration/browser/device tests.
Start Vite and visit `/contract-preview.html` for synthetic scenarios. The wedding
form saves text through the real v1 adapter. Uncertain requests retain their draft/key for manual retry; state lasts only while this page remains open. Photo choices remain local previews. Richer confirmation/accessibility coverage stays with MSG-02.
