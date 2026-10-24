# INB-01 note and photo inbox verification

Implemented on 2026-10-09 for the private inbox's note/photo slice. This work adds no dependency, deployment, paid resource, storage configuration or real account. Audio verification and playback, review mutations, deletion/restoration and device acceptance remain separate work.

## Implemented contract

Both routes require `X-Api-Contract: 1` and current authorized private archive access: a revealed couple identity, or the separately configured exact named operator admin under the [October 24 account boundary](../../runbooks/account-access.md#account-boundaries):

- `GET /api/memories?reviewStatus=PENDING&limit=20&cursor=…` returns `{"items":[<detail>],"nextCursor":null}`. The default filter is PENDING; KEEP and ARCHIVED are also supported. Limit defaults to 20 and accepts 1–100.
- `GET /api/memories/{memoryId}` returns the same full detail shape, with an ETag such as `"1"` matching its persisted revision.

List and detail are private, no-store responses. Detail includes memory/contribution UUIDs, nullable guest name, TEXT or PHOTO type, note text or photo caption, review status, COUPLE_ONLY visibility, positive revision, UTC creation/update timestamps, `deleteAfter: null`, and nullable photo metadata. Photo metadata includes original filename, detected MIME, verified byte count/SHA-256, `durationSeconds: null` and UPLOADED state. It contains no storage key, guest retry capability or retrieval URL.

DELETE is not a supported filter in this slice and returns safe 400 VALIDATION_FAILED. Deleted, wrong-event, audio, missing, unfinished or unverified-photo details return the same safe 404. No mutation or physical deletion endpoint is added. Future INB-02 contracts in the API reference remain unimplemented.

## Eligibility, access and pagination

Every service invocation reloads account authorization before querying private data, in addition to the HTTP security filters. Missing/stale/disabled credentials return 401 AUTH_REQUIRED. The operator setting defaults empty; only its exact enabled OPERATOR may access the private archive independently of reveal. Other operators, developers, foreign principals and unrevealed couples return 403 ARCHIVE_UNAVAILABLE. UUID knowledge and guest receipt/upload capabilities confer no private access. Production's existing Kevin/Melanie identity restriction is preserved. Historical verification below predates the opt-in operator amendment.

The SQL query selects only the current wedding event's COUPLE_ONLY notes or photos in PENDING, KEEP or ARCHIVED. Photos require committed UPLOADED state, JPEG/PNG/WebP detection, 1–10,000,000 bytes, matching expected size/hash/MIME, and the server's exact original-object key. These checks match existing AUTH-02 playback eligibility.

Order is `created_at DESC, id DESC`. The query fetches at most limit + 1 rows; the next cursor uses the last returned row rather than the extra row. The opaque, bounded, canonical cursor carries version, review filter and the last sort tuple. Malformed, oversized or filter-mismatched cursors return 400 INVALID_CURSOR. It is a paging position, not an access capability: every page is freshly authorized and event-scoped. Paging is not a snapshot; newly arriving rows appear after refresh rather than shifting later pages.

Metadata reads do not call R2 or issue signed URLs. A missing or unavailable original therefore leaves durable note/photo metadata readable. Photo preview/download must deliberately request the existing authenticated playback endpoint and handle its safe 503 MEDIA_UNAVAILABLE separately. A signed URL remains a short-lived bearer permission under the existing AUTH-02 rules; do not persist or log it.

## Persistence and verification

V6 adds a positive integer revision defaulting to 1 for existing and new memories, plus the review-status/creation/UUID ordering index. Applied V1–V5 migrations are unchanged. This slice does not change review state or increment revisions; future review mutations must do that atomically.

Local Docker-free results:

| Check | Result |
|---|---|
| New parser/service/HTTP suite | 21 passed: 5 query/cursor, 7 direct-service authorization/paging and 9 HTTP security/contract cases |
| Existing session/security regression suite | 40 passed; 61 total with the new inbox tests |
| All backend test sources | Compile successfully with Java 25 and the Maven wrapper |
| Private response checks | Literal markup stays JSON text; no storage keys, retry/CSRF credentials, signed URLs or database diagnostics appear in inbox/error responses |

The PostgreSQL 17 HTTP suite compiles locally; local execution is unavailable because Docker is stopped. Its five cases cover actual session login/SQL/DTOs, tied-timestamp pagination with a new arrival, event/type/upload/integrity exclusions, account-version/disable/role revocation, and the positive-revision constraint. The populated-V1 upgrade/restart test additionally checks that V6 assigns revision 1 while preserving the existing memory. These database cases pass in CI as recorded below. Synthetic fixtures are isolated and removed by their owned IDs; no provider request is required.

Run the local focused suite:

```text
./backend/mvnw.cmd -f backend/pom.xml --batch-mode -Dtest=InboxQueryTest,InboxServiceTest,InboxHttpSecurityTest test
```

With Docker available, run the normal full backend suite, which includes the new PostgreSQL and migration coverage. Do not mark all INB-01 acceptance complete from these note/photo checks: verified audio, physical devices and hosted acceptance remain pending.

## Private frontend and original downloads

The private screen is lazy-loaded at `/?view=inbox` on the same application origin. It is not advertised in the guest invitation. It starts by checking the existing session API, then displays sign-in or the authorized inbox. The reveal gate remains closed by default and no real accounts were created. Use only the existing synthetic local-account runbook for local demonstrations.

Pending, Kept and Archived filters show individual notes/verified photos in bounded pages. Each card identifies the optional guest name, type and time in `America/New_York`, including daylight-saving changes. Saved times and recovery deadlines throughout the private archive are labeled Eastern. API and stored timestamps remain UTC; provided dates retain their precision. Detail Back retains the loaded page and filter. Failed pages must be retried before further pagination; recovery through a fresh access check resets to the first Pending page.

Guest names, text, filenames and captions are ordinary React text children; submitted markup does not become HTML. Loading, empty, unavailable, missing original and expired-session states give explicit recovery controls. Read-only status filters do not expose keep/archive/delete actions or publication.

The controller gets a fresh CSRF token before each login/logout and retains no password in presentation state. Private APIs have 30-second full-request deadlines and generation guards, including stalled response bodies and transports that ignore abort. A 401 or 403 clears private rows, details and owned image URLs. Sign-out hides private data immediately and aborts outstanding reads; a lost response stays explicitly unconfirmed until retry proves server invalidation.

Photo detail deliberately obtains the existing short-lived permission, then fetches the original with `credentials: omit`, `redirect: error`, `referrerPolicy: no-referrer` and `cache: no-store`. The stream is bounded by the stored size and 10 MB ceiling, and its MIME/size/SHA-256 must match before display. The same verified, unchanged Blob supplies preview and the original-file download. Photo reads have a 60-second deadline; owned object URLs are revoked on Back, selection, retry, sign-out and disposal. Signed links never enter the presentation snapshot, persistence or application logs. Missing R2 content leaves the durable metadata visible with an explicit retry.

Frontend evidence: **165 tests pass**, including 32 controller cases (three real-adapter integration scenarios) and the Chicago timestamp boundary case. ESLint, production build and noninteractive initial-screen rendering pass. Independent review corrected pagination failure/recovery history. Browser/physical-device focus, screen-reader behavior, actual file download and new hosted/R2 acceptance remain unverified/deferred.

Ryan requested direct VS Code editing: this implementation is in the primary checkout on `feature/couple-inbox`, based on merged UX-01 PR #19 (`3caa88d`). No new dependency or infrastructure is introduced.

## CI verification

[CI run 37939842152](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/37939842152) at implementation commit `b5e03c5` passes both jobs: **124 backend tests**, including actual PostgreSQL HTTP/pagination/authorization and migration/upgrade coverage, and **165 frontend tests**, with zero failures/errors/skips. Frontend lockfile installation, lint and production build also pass. Independent review findings are resolved. Actual browser/physical-device/hosted acceptance and complete audio remain open.

## October 14, 2026 — Eastern time adjustment

Ryan requested Eastern time for Kevin and Melanie in NYC. Current private views and the readable portable archive use `America/New_York`, with EDT or EST appropriate to each instant. UTC API/storage and JSON timestamps, provided partial dates and elapsed recovery/expiry windows remain unchanged. Regression coverage includes a UTC date crossing and the spring/fall daylight-saving transitions. The Chicago boundary result and test counts above describe the earlier implementation and remain historical evidence; they are not results for this adjustment.
