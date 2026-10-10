# QA-02 — Local browser and reception rehearsal

Prepared October 9, 2026 from the production-code baseline merged in PR #29 (`da69a23cf0bdfb78f187228751fd220413042ee6`). This work adds a bounded local rehearsal and release materials. It does not enable hosted collection or close QA-02's physical-device, accessibility and reception-network acceptance criteria.

## Isolated environment

The real backend ran with disposable PostgreSQL 17, synthetic data and credentials, storage/audio/retention disabled, and a generated ownership label. Database data lived only in tmpfs; no existing database, bind mount, volume, provider credentials or real couple account entered the fixture. Only the app was published, on an ephemeral loopback port. Each app used one process, 2 GB memory, one CPU and a 1 GB Java heap. The Docker bridge is not an egress-isolation boundary.

The already-present application image was `sha256:503bf93fa0f63d2a460d38cc2ac6894ba5fd4059e9755c2e049adaddb9401052`; its extracted JAR SHA-256 was `68e274f522f4b347b59197d530a494ade7443a351ed09230b382a08ac896cbca`. PostgreSQL's image ID was `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`. These identify the tested artifact bytes; no embedded Git-provenance label was available. No image was built or pulled for this rehearsal.

The desktop browser fixture served the unchanged frontend source through the existing Vite installation, proxying `/api` to that owned backend. It used installed Chrome **155.0.8059.39**, headless desktop mode, and bundled Playwright **1.62.1**. The app's browser helper failed before initialization with a Windows sandbox error; this fallback required no installation or dependency change. Only loopback app requests and the exact local card file were allowed through the browser context's request routing.

## Rendered guest and private-inbox checks

Eight actual browser stages passed against the owned real backend/database at a 1280 × 900 CSS-pixel desktop viewport:

| Scenario | Observed result |
|---|---|
| Keyboard, empty-note validation and draft navigation | Tab/Enter activated the guest entry; validation focused the message and associated its error. Back preserved the note/name, hidden visited forms stayed out of the tested Tab sequence, and Edit returned focus to the message. Audio was absent in the normal build. |
| Named and unnamed notes | Review/result headings received focus. Repeated Send activation produced exactly one private named note; a blank name produced one private note with unnamed attribution. PostgreSQL confirmed both identities and PENDING / COUPLE_ONLY state. |
| Deliberately discarded committed response | The browser intercepted a real successful POST response and aborted its delivery once. The uncertain result locked editing/navigation; Try again retained the same key and recovered the one committed note without duplication. This is simulated response loss. |
| Five-photo selection and review | Five generated 2 × 2 PNGs decoded in Chrome. A sixth file and HEIC addition were rejected without losing retained selections/captions. Removal/re-addition and review/edit preserved photo-caption associations and returned focus to the picker. |
| Storage-disabled photo retry | Two real CREATE requests returned 503 MEDIA_UNAVAILABLE with the same retained key. Selection, captions and local previews stayed present; deliberate retry required selecting the intended retry checkboxes. Both attempts produced zero photo contributions, memory rows and original assets. The UI reported 0/5 confirmed saved and kept navigation/replacement locked. Storage availability is checked before intent persistence. |
| Private review | Synthetic couple sign-in, note attribution and Keep → Archive → Restore passed. Database state stayed private and changed only the chosen item. |
| Delete/Cancel/recovery | Cancel received initial confirmation focus and returned focus to Delete without changing state. Confirmed Delete showed the actual approximately 30-day deadline; Recently deleted → Restore returned the item to Pending. Other notes stayed unchanged. |
| Sign-out and history | Sign-out cleared private rows/details. Actual Back/Forward navigation and reload showed no private content; the same browser context's protected inbox request returned 401. This is not a BFCache-specific or hidden-window result. |

No rendered JavaScript errors were observed in the main eight-stage flow. The complete browser run exited successfully and verified removal of its owned containers/network, Vite process, Chrome contexts and disposable zoom profile.

**Actual 200% browser zoom and narrow layout also passed 12 states each:** welcome, chooser, invalid note, note compose/review, five-photo compose/review, private login, inbox list, note detail, Delete confirmation and Cancel. The fixtures used 100-character unbroken names, long filenames and 500-character captions. Native scrolling brought the controls into view; measured document/body width and visible-control bounds showed no horizontal overflow or clipping by an ancestor.

The zoom run used a fresh isolated Chrome profile with its ordinary page-zoom preference set to 200%, keeping the outer window at 1280 × 800. Its CSS viewport was 629 × 351 with DPR 2; pinch scale and computed CSS zoom stayed 1. A separate 100% probe kept that outer window and measured a 1258 × 702 CSS viewport with DPR 1. Native CDP viewport captures preserved 1258 × 702 physical pixels and were visually inspected. Playwright's cropped full-page captures at browser zoom were excluded from visual acceptance; no CSS zoom or device-metric override was injected. The narrow run used a separate normal desktop page at 320 × 780 CSS pixels/DPR 1, with its rendered screenshots inspected. These are desktop layout results, not phone or screen-reader acceptance.

The [tester guide](qa02-tester-guide.md) retains the actual-device, screen-reader, provider and network scenarios for later observation. Browser screenshots and intermediate helpers remain under ignored `logs/qa02-local/` with synthetic content only.

## Bounded simultaneous text rehearsal

Run the committed [reception helper](../../scripts/smoke-reception.mjs) against the existing immutable local images:

```sh
node --test scripts/reception-helpers.test.mjs scripts/rollback-helpers.test.mjs
node scripts/smoke-reception.mjs
node scripts/smoke-reception.mjs --probe-failure-cleanup
```

An optional `--image sha256:<64 hexadecimal characters>` accepts a complete existing local app image ID. Mutable tags, remote Docker endpoints, extra arguments and unowned mutations are refused. The helper has an eight-minute deadline, bounded HTTP/Docker operations, at most 100 logical guests and at most 20 concurrent workers. A failed worker stops new work and drains active requests before cleanup. It never resets or changes production limits.

Each logical guest obtains an independent anonymous session, creates one note, deliberately discards the already committed response, replays the same body/key, reconciles its receipt and tries changed content with the same key. The latter must receive 409. This is client HTTP concurrency and synthetic response loss, not a real Wi-Fi interruption or simultaneous first-create race on one shared key.

| Wave | Peak client HTTP concurrency | HTTP calls, including receipts | Request p95 | Maximum | Whole guest-workflow wave |
|---|---:|---:|---:|---:|---:|
| 10 logical guests | 10 | 40 | 304.1 ms | 308.0 ms | 710.1 ms |
| 20 logical guests | 20 | 80 | 294.7 ms | 395.7 ms | 804.7 ms |
| 100 logical guests | 20 | 400 | 300.7 ms | 493.6 ms | 3,101.2 ms |

All 130 workflows passed, with zero unexpected errors or duplicate identities. Timing covers the complete observed call mix, including expected conflicts; it is a local observation, not a hosted latency promise.

The shared-peer fixture consumed exactly **400 admitted CREATE calls**: 390 across the three create/replay/conflict waves, then ten fresh admitted notes. Two additional fresh keys received 429, including a request with valid-origin spoofed forwarding headers. `Retry-After` was 891 seconds, and the separate receipt scope still recovered a saved item. PostgreSQL contained exactly 140 private contributions and 140 items, with no duplicate identities.

A fresh fixture admitted **12 CREATE calls for one retry key**, denied the next call, restarted the same owned app, and denied the key again. `Retry-After` was 900 seconds; a fresh independent key and receipt recovery still worked. It contained exactly two private contributions/items. The unchanged 15-minute policy is 800 global / 400 peer / 12 retry-key CREATE calls, with separate receipt counters. This run proves peer/key boundaries and key persistence, not the global 800-call boundary or multi-process capacity.

Normal cleanup and the deliberate-failure cleanup probe both passed. Independent Docker queries confirmed no reception-labelled containers or networks remained. Content-free output is retained in ignored `logs/qa02-local/concurrency.log` and `failure-cleanup.log`.

## Tester and release preparation

The [Kevin/Melanie tester guide](qa02-tester-guide.md) supplies guest/private-inbox scenarios and a content-free feedback template. The [release checklist](wedding-release-checklist.md) supplies proposed guest copy and records every unresolved launch gate. The [QR-card layout](wedding-qr-card-draft.html) is an inert draft with an empty QR placeholder and no final collection address.

The draft card's desktop screenshot and complete one-page A4 PDF proof were rendered and visually inspected. Print CSS measured the card at **105 × 148 mm**; the blank QR area, private-contribution copy, readable fallback placeholder and draft marking fit without overlap or clipping. The proof is an ignored intermediate at `logs/qa02-local/qr-card-print-preview.pdf`; the editable HTML is the committed layout. This is print-layout preparation, not an actual-size printed scan or approval for guest distribution.

Frontend lint, all **286 tests**, production build, **four reception helper tests** and **three existing rollback helper tests** passed locally. The reception helper's complete normal and deliberate-failure runs both exited successfully. Application code, dependencies, CI and production flags were unchanged.

## Remaining acceptance

- Physical iPhone Safari and Android Chrome: record browser/OS versions, touch/file selection, large phone photos, microphone refusal, record/replay/upload audio, background/lock interruptions and confirmations.
- Actual screen-reader announcements and final contrast/accessibility acceptance. DOM labels, keyboard checks and screenshots cannot prove audible announcements.
- Native hidden-window/tab behavior and observed BFCache restoration. Logout followed by real history navigation is narrower evidence.
- Real weak Wi-Fi/cellular interruptions, intended shared reception network, mixed media traffic, HTTPS forwarding/session/cookies and hosted capacity/restart behavior.
- Real provider uploads, original-byte retrieval and audio acceptance in the intended final environment; storage-disabled photos do not establish any successful original upload.
- Deliberate real-account activation and confidential onboarding; stable collection URL, final QR generation, actual-size print/phone scans and the recorded release decision.

Hosting costs and provisioning remain deferred under Ryan's build-first instruction. No paid resources, new dependencies, production configuration, deployment or external tester messages were added here. Task status and acceptance criteria remain authoritative in Notion.
