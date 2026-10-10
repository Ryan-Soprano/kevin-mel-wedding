# Couple authoring and editable metadata — local verification

ARC-01 implements private couple creation and optional title, description and memory-date editing, ahead of the later REV-03 feedback milestone at Ryan's request. The [v1 contract](../api/v1/couple-memories.md) specifies fields, date precision, review bypass, authenticated retries and preservation behavior.

Verified locally on October 9, 2026, from `feature/couple-memories` based on main `bfe5e24`. Final-head CI and the merge identity are recorded in the ARC-01 tracker issue and pull request. Local fixture logs, screenshots, packages and caches stay under ignored `logs/arc01-local/`; they contain synthetic data only.

## Automated verification

- The full Linux Java 25/PostgreSQL 17/FFmpeg suite passed **340 tests**, with zero failures, errors or skips. After a final recovery Unicode/normalization correction, all **37 affected PostgreSQL recovery tests** passed on the final source, including a new exact-limit roundtrip test and a 16-case rehashed invalid-metadata matrix. The final source contains 341 backend tests; the pull request's CI is the full final-head gate.
- The final frontend passed **302 tests**, ESLint and the production Vite build. Coverage includes authenticated note/photo/audio adapters, partial/selective retry, account/access loss, media permission expiry, metadata conflicts, uncertain mutations, immutable original context, partial Gregorian dates and private lifecycle cleanup. Seven existing reception/rollback helper tests passed.
- Real local HTTP/database tests cover private creation/replay, account-bound receipts/grants/finalization, guest isolation, current review state on replay, shared-revision edits, no-op updates, authority rechecks during waits/IO, body/field limits and erasure. Photo/audio tests use controlled synthetic storage; these are not live-provider acceptance.
- V10 migration/default/constraint tests, reviewed V8/V9 upward recovery, v3 identity/metadata preservation, current deletion-ledger replay, missing/unfinished media reporting and strict operations schema checks pass. Recovery accepts exactly 200/2,000 UTF-16 units of supplementary metadata and rejects longer or unnormalized values before import. V9 artifact compatibility remains closed after V10.
- Independent backend/recovery/frontend review found no remaining concrete blocker. The repaired rollback-contention test observes the fixture's exact PostgreSQL blocker, rather than matching an obsolete INSERT column list.

## Packaged browser rehearsal

The final combined production JAR was served from an isolated nonroot, read-only Linux container with disposable tmpfs PostgreSQL. Storage, audio admission and retention were off. No host project database, provider credentials or real account was used.

| Artifact | Verified identity |
|---|---|
| Local runtime image | `sha256:24b2c251575146e03a71c0cc08f16fd7c3a9f0178054cd39c02ca2260a05bd85` |
| Combined JAR SHA-256 | `50f0666b2a7cdd22cb66bc42e5098840361806c03e01cb56424c13465eab909c` |
| Browser | Installed Chrome 155.0.8059.39 with existing bundled Playwright 1.62.1 |

All **37 rendered states** passed across desktop 1280 × 900, narrow 320 × 720 and actual Chrome 200% zoom: 11 desktop, 11 narrow and 15 zoomed states. The latter measured 629 CSS pixels wide, device-pixel ratio 2 and visual viewport scale 1; it was browser zoom, not an enlarged screenshot. Every captured state checked horizontal overflow.

Each layout exercised private note choice/composition/review/save, immediate kept/private attribution, inaccessible anonymous/private receipts and public guest receipt isolation, original text/creation-time preservation, invalid leap-date rejection, year/month/day metadata, a stale revision from another authenticated request, a committed save whose response was deliberately discarded, explicit current-state reconciliation, controlled blur/resume cleanup, five-photo selection/review/discard, metadata editing of a still-pending guest note and sign-out clearing. There were no rendered JavaScript errors and each private note existed exactly once in SQL. The audio choice stayed hidden under the existing default-off frontend gate.

Screenshots record choice, composition, review, saved state, edited details, conflict, uncertain outcome, resumed inbox, five-photo review, edited guest details and sign-out for each layout. Four additional native 200% viewport captures show title/description, date precision, metadata-save and photo-review actions after scrolling those controls into view. All five synthetic one-pixel preview images explicitly decoded at every layout; their blank appearance is fixture content. The browser/API interactions ran against the packaged frontend and backend on loopback. Owned application/database containers, network and disposable browser profile were verified absent afterward; owned Java/package runners were also removed.

## Retained acceptance

This completes local ARC-01 implementation and synthetic verification ahead of REV-03. Real account onboarding and Kevin/Melanie's feedback remain later REV-01/REV-03 acceptance. No spending, deployment, hosting change, real account activation, invitation or tester message occurred.

Physical phones/tablets, native file chooser/microphone dialogs, actual hidden-tab/BFCache behavior, assistive technology, live R2 private authoring/audio and hosted capacity/network acceptance remain open. The controlled blur exercise and programmatic five-file selection do not establish those device behaviors. Both existing audio gates remain off. Five-photo browser verification covered selection/review/discard; full authenticated media upload/finalization/retry was verified through controlled backend and coordinator tests, not a live-provider browser transfer.

Hosted operations, independent backup/recovery targets, final collection URL and printed QR/launch acceptance remain deferred. Recovery packages exclude accounts/passwords/sessions/configuration; unfinished private upload recovery still requires the original author's account UUID, external retry key and original files.
