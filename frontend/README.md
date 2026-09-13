# Archive frontend

For prerequisites, install/run/check commands, the development proxy, and current API behavior, use the [root README](../README.md#local-development). Feature status and acceptance criteria live in the Notion [Memory Archive — Issues](https://app.notion.com/p/2d5a40baef85426a94bd059f7d0e2ce8) database.

## Source map

| File | Responsibility |
|---|---|
| [src/main.jsx](src/main.jsx) | React entry point; imports the active stylesheet |
| [src/App.jsx](src/App.jsx) | Guest text form, request state, and contribution API call |
| [src/PhotoPicker.jsx](src/PhotoPicker.jsx) | Local photo selection and client validation; exact limits are defined here |
| [src/index.css](src/index.css) | Active page/form styles |
| [vite.config.js](vite.config.js) | React plugin and development API proxy |
| [package.json](package.json) / [package-lock.json](package-lock.json) | Scripts, dependency ranges, and resolved versions |

`src/App.css` and starter artwork remain from the scaffold; they are not the active form styling. Confirm references before using or removing them. Update this map when files move; keep implementation work in Notion.
