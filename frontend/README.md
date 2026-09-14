# Archive frontend

For prerequisites, install/run/check commands, the development proxy, and current API behavior, use the [root README](../README.md#local-development). Feature status and acceptance criteria live in the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database.

## Source map

| File | Responsibility |
|---|---|
| [src/main.jsx](src/main.jsx) | React entry point; imports the global stylesheet and application shell |
| [src/app/App.jsx](src/app/App.jsx) | Top-level application shell |
| [src/features/contribution/](src/features/contribution/) | Guest form, submission state, and contribution API access |
| [src/features/media/](src/features/media/) | Photo selection, constraints, previews, and removal behavior |
| [src/features/archive/](src/features/archive/) | Reserved for the private archive and review experience |
| [src/features/auth/](src/features/auth/) | Reserved for couple authentication |
| [src/shared/](src/shared/) | Reusable API and UI code shared by multiple features |
| [src/styles/](src/styles/) | Global styles and design tokens |
| [e2e/](e2e/) | Reserved for future browser-level tests |
| [vite.config.js](vite.config.js) | React plugin and development API proxy |
| [package.json](package.json) / [package-lock.json](package-lock.json) | Scripts, dependency ranges, and resolved versions |

Keep component tests beside the implementation they exercise. Update this map when boundaries change; keep implementation work in Notion.
