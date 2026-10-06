# MED-01 verification

Date: 2026-10-05. Implementation: `b546510` on `feature/private-photo-storage`, based on main `d692019` (merged MSG-02); PR #14 subsequently merged as `4b658a8`. Ryan approved AWS SDK for Java v2 and TwelveMonkeys WebP dependencies. Status: local implementation, real R2 desktop PNG retrieval/restart/replay, scripted JPEG/WebP upload/recovery/grant checks, and local Docker codec/runtime checks verified; **physical-phone, additional operator retrieval, bucket-settings, hosted deployment and full-limit capacity acceptance pending**.

## Automated evidence

- MED-01 implementation baseline Maven suite: **33 tests, zero failures/errors/skips** on Java 25, using disposable PostgreSQL 17 Testcontainers. Applied V1 and V2 are unchanged; fresh schema and populated-V1 upgrade now reach V3 without losing legacy text. Disabled photo storage creates no intent and leaves text submission operational.
- Frontend Node suite: **73 tests passed**; ESLint and production build passed. No frontend dependencies were added.
- `PhotoHttpTest`: actual HTTP and PostgreSQL cover committed private intents/receipts, normalized name, equivalent replay and changed-payload/type conflict, five ordered items with partial completion, concurrent creation/finalization, capability/grant ownership, premature/expired finalize and renewal, known invalid-byte `FAILED` commit, storage outage, and deferred database commit failures. A published object after a failed DB commit is recovered by same-item retry.
- `PhotoValidationTest`: raw UTF-16 boundaries, strict metadata types/limits, unsupported fields/formats, paths/controls, NUL/unpaired surrogates, case-insensitive duplicate IDs, fingerprint claims/order, actual JPEG/PNG/WebP decode, corrupt images, dimension bounds, size and SHA-256 mismatch.
- `R2ObjectStorageTest`: AWS-generated SigV4 PUT grants bind a staging key and Content-Type for no more than five minutes. An in-process HTTP S3 fixture checks signed server IO, exact original bytes, bounded reads, missing objects, and safe access failures. **This fixture is not Cloudflare R2.**
- `PhotoRestartTest`: pending intent/grant survives application shutdown; finalization after restart succeeds; a further restart retains complete receipt and byte-identical original in the external fixture. **This proves application/DB recovery against fixture storage, not provider durability.**
- Photo coordinator tests: one hash/key/item through repeated taps and deliberate retries; lost create/PUT/finalize responses; reconcile before retransfer; expiry renewal; invalid-byte replacement; incomplete receipts cannot confirm; 429 wait; local validation before network; uncertain failures retain original draft.

## Browser evidence

The isolated `/contract-preview.html` uses the actual single-photo form/coordinator with the synthetic adapter. It does not contact R2. Checked missing-file validation/focus, disabled metadata during send/uncertain result, announced progress/error, retained file and explicit retry, complete-result focus, and explicit share-another reset/focus. Browser verification caught and fixed an accidental reset-triggered submit. The wedding form was also checked at 320 px: controls fit, no horizontal overflow, and missing-file validation focuses the picker. Production uses the real adapter; the mock remains outside the normal build.

The independent photo form remains mounted when the text form is reviewed, submitted, or finished, preserving its own pending retry state. Preview URLs are revoked when the file changes/unmounts. Retry state is memory-only: refresh or tab closure is not supported recovery. Choosing another after a known invalid-photo rejection abandons the old intent for operator cleanup.

## Real R2 desktop evidence — 2026-10-05

Ryan configured the private test bucket and local browser CORS, supplied credentials through his backend shell, and submitted a synthetic PNG through the actual single-photo form. The form displayed the private saved confirmation. Ryan downloaded the corresponding original through the authenticated Cloudflare dashboard.

- Asset: `6c2e7b7b-d6c1-48bf-b0d4-df66a8bd5b3a`; key: `originals/6c2e7b7b-d6c1-48bf-b0d4-df66a8bd5b3a`.
- Input and operator download both contain **5,872,164 bytes**. Ryan's `sha256sum` screenshot and an independent local `sha256sum`/`cmp` check confirm identical bytes; SHA-256: `b493b71463d49fef2f5103ad13ade2d14834c88042f41982018170e029042ad9`.
- A scoped, read-only PostgreSQL query confirms the same size/hash, detected `image/png`, asset `UPLOADED`, and memory `PENDING` / `COUPLE_ONLY`.
- An unsigned S3 GET for that exact original returned HTTP **400**, without returning the photo. This records rejection of that unsigned request; it does not establish all grant restrictions or public-domain/CORS settings.

After Ryan's requested Spring restart, the backend health endpoint is OK and the running process differs from the earlier check. A scoped DB query still returns the same contribution, memory and asset IDs, verified size/hash and private state. The newly downloaded original again matches the input with `sha256sum` and `cmp` (5,872,164 bytes).

A process-memory-only check reconstructed the normalized PHOTO body from stored expected claims and verified its exact immutable fingerprint before HTTP. Receipt GET and same-key creation replay both returned HTTP **200**, `COMPLETE`, and the original IDs/private states; a changed valid caption returned **409 `IDEMPOTENCY_CONFLICT`**. Scoped envelope/memory/asset counts remain one each, and stored metadata/fingerprint are unchanged. The original capability key was neither printed nor saved.

The PNG operator evidence above covers input/download integrity and application restart. The scripted checks below cover additional formats and recovery; authenticated JPEG/WebP reread and physical-device acceptance remain pending. An October 5 read-only Render dashboard check found one deployed static service, `kevinandmel-coming-soon`, and no service hosting the React/Spring photo app. OPS-01 owns the required HTTPS staging path. No credentials, retry keys or signed URLs are recorded here.

## Real R2 scripted upload, recovery and grant evidence — 2026-10-05

Focused Node HTTP checks used the running backend and actual R2, with tiny synthetic JPEG (631 bytes) and WebP (42 bytes) inputs. They created six synthetic PHOTO intents, all now `UPLOADED` / `PENDING` / `COUPLE_ONLY`, with one memory and asset each. Seven grants include one renewal. Test data remains intact for operator review; no existing original was targeted or deleted.

- JPEG/WebP upload and finalization pass. Concurrent same-key creation retries return HTTP 200 with the same IDs before/after completion; changed captions conflict with 409. Scoped DB counts/metadata remain unchanged.
- Own staging grants reject GET, DELETE, a changed staging key and a changed Content-Type with HTTP 403. Valid local-origin preflight returns 204 with the expected CORS headers; an unapproved origin returns 403.
- Replacing only each completed test's staging bytes succeeds with 200; repeated finalize/receipt and DB metadata remain identical. **Authenticated original reread is still pending** for these JPEG/WebP cases.
- After the actual five-minute lifetime, the old R2 PUT returns 403 and unfinished server finalize returns 410 `UPLOAD_GRANT_EXPIRED`; the receipt stays PENDING. A new grant completes the same contribution/item, with one memory/asset and two grants.
- The production photo coordinator and real adapter recover after deliberately discarding real successful create, PUT and finalize responses. The first attempt reports an uncertain outcome and retains its draft; manual retry reaches COMPLETE with the same key/item. Repeated taps coalesce. Lost-create uses 201→200 replay; lost-PUT/finalize each use one grant/transfer/finalize and one receipt reconciliation, avoiding retransfer. **This is response-discard injection in Node transport, not a physical-browser network interruption.**

Operator originals for the staging-replacement checks:

| Format | Original object key | Input bytes | SHA-256 |
|---|---|---:|---|
| JPEG | `originals/87683907-e60a-4f87-a2b0-97eca3b02268` | 631 | `b862f9aee77a1755382c85adf973b4e042f4da5b95ddccf65700ed8a44901037` |
| WebP | `originals/63991363-083a-4ad4-96ad-9e6d1a3e3d4b` | 42 | `c90cff659645a312a28804965f3dbc34061338f7234ff5d6ddb2c57e9eadec15` |

Local synthetic inputs are under ignored `logs/med01-acceptance/` as `med01-synthetic-jpeg.jpg` and `med01-synthetic-webp.webp`. They were regenerated with their recorded hashes unchanged, outside the Maven clean target so packaging cannot erase the remaining operator comparison inputs. These generated files contain no capabilities and are not committed artifacts. No bucket configuration, service, dependency, provisioning or deployment change was made by these checks.

## Full-app staging preparation — 2026-10-05

Ryan confirmed retaining Render/Spring/PostgreSQL + Cloudflare R2. The [OPS-01 staging runbook](../../runbooks/staging-deployment.md) prepares a separate HTTPS provider address, test database/bucket, temporary operator admission, manual secrets/deployment and phone/restart checks. Forty backend tests and 73 frontend tests pass with lint/build and combined production JAR packaging. The actual-JAR smoke check verifies minimal public health, admitted HTML/assets, gate/HTTPS/origin rejection, excluded preview/source routes and same-origin API validation with storage disabled and no submission/R2 writes. One staging finalization admission slot bounds overlapping read/decode/publish/commit work; busy requests receive safe 503 and retain same-item retry. Contract photo limits are unchanged.

Ryan subsequently authorized the image verification and PR #15 merge. Local Docker evidence is recorded below; it does not establish hosted forwarding, full-limit memory sufficiency or a physical-phone upload. Paid Render provisioning/deployment still requires approval; bucket configuration and phone checks remain unverified. The 512 MB plan is unvalidated for the full contract, and the 2 GB measurement candidate still needs capacity evidence and budget approval. The one-day `staging/` deletion rule and remaining bucket settings/operator comparisons are pending.

## Local Docker codec and application evidence — 2026-10-05

PR #15 image: `sha256:9f2f927c70fccc84f1366d8274b393cfb57dd3282d7511fd72cf59855200b93e`. The authorized image build exposed Windows-checkout CRLF in the Maven wrapper; `.gitattributes` and Dockerfile newline normalization address that build boundary.

- Nine Linux codec checks used classes/libraries freshly extracted from the built image. Synthetic JPEG, transparent PNG and WebP pass; wrong MIME, SHA-256, size, corrupt bytes, a dimension over 20,000 and pixel count over 50 million return safe 422 rejection. These checks establish supported codecs and rejection boundaries, not successful maximum-size decoding or provider storage behavior.
- `scripts/smoke-container.mjs` passes against a separate disposable PostgreSQL 17 database backed by tmpfs. The application runs nonroot with a read-only root filesystem, a 2 GB container limit, a 1 GB Java heap and an IPv4 loopback-only host port. Host database and R2 are not used.
- The actual container serves admitted HTML/CSS/JS and minimal public health. HTTPS/host/admission checks, same-origin API validation and excluded preview/source/unknown routes pass.
- Three synthetic TEXT receipts commit with private `PENDING` / `COUPLE_ONLY` defaults: one named and two anonymous. Eight concurrent same-key requests create exactly one contribution; changed payload conflicts. Deliberately discarding a committed 201 receipt body recovers through same-key replay. Application restart retains receipt IDs/states and row counts. The owned temporary containers/network and disposable data were cleaned up.
- Existing development-only ESLint transitive `brace-expansion` was patched from 5.0.9 to 5.0.12 in the lockfile. No direct dependency was added. All 73 frontend tests, lint, production build and npm audit pass; audit reports zero findings. The 40-test backend staging baseline passed before the final image/lockfile edits; final-head CI revalidation remains required.

This is local Docker evidence with synthetic inputs and a disposable database. It is not a Render deployment, real R2 in-container finalization, full-limit photo capacity measurement or wedding-load test. No paid provider provisioning, bucket-setting change, physical-phone acceptance or domain change was performed. MED-01 and OPS-01 remain unfinished.

## Remaining acceptance

AUTH-02's October 5 home check now exercises the integrated image against real R2 with a disposable PostgreSQL 17 database: new tiny synthetic JPEG/PNG/WebP intents finalize, authenticated original HEAD matches metadata, and signed original GET preserves exact bytes. Signature scope/expiry and unsigned GET/HEAD denial pass; all owned objects/resources were removed. See [authorization evidence](authorization-verification.md#real-r2-verification--2026-10-05). These new fixtures do not claim operator reread of the earlier six retained intents. The actual browser playback probe found that the current PUT-only CORS policy needs GET/HEAD added; phone/hosted, token scope, public settings and lifecycle acceptance remain open.

- Complete the [private R2 runbook](../../runbooks/private-photo-storage.md) with Ryan: verify token scope, staging-only lifecycle and private bucket settings; approve/setup the [full-app HTTPS staging environment](../../runbooks/staging-deployment.md) and its exact-origin CORS. Local-origin CORS and unapproved-origin rejection are verified above.
- Actual iPhone Safari and Android Chrome selection/upload/retry; HEIC rejection; VoiceOver/TalkBack announcement and focus checks.
- Retrieve/compare the two JPEG/WebP originals above after staging replacement; repeat input/download/DB size/hash comparisons for physical-device tests. Desktop PNG retrieval/restart/replay/conflict and scripted provider recovery/grant checks are complete.
- Confirm current private bucket settings, scoped token and staging-only lifecycle. Real provider expiry/action/key/type restrictions and unapproved-origin CORS rejection are verified; the unsigned PNG original GET was rejected.
- Public-release abuse controls, hosted deployment/routing, backups/restore, monitoring, and infrastructure readiness remain separate SEC/OPS/QA/REL tasks. Combined package routing is locally verified only. Batch UI and selective item retry belong to MED-02; audio verification and couple-only archive/playback remain later work.

MED-01 must not be marked Done on the strength of local, mock or desktop/container checks alone. Ryan performed the test-bucket setup and PR #14 is merged. PR #15 image verification is recorded above; its merge and final-head CI are not claimed here. No paid provisioning, hosted deployment or additional bucket configuration was performed for this verification.
