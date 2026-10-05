# Memory Archive API — contract v1

This API-01 handoff defines the interface for subsequent backend implementation.
The [executable fixtures](../../../frontend/src/shared/api/v1/fixtures.js) contain
complete synthetic request/response examples. Change the contract, fixtures,
adapters, and tests together.

## Implementation boundary

MSG-01 implements durable text POST and key-bound text receipt GET, and the wedding form uses the [real adapter](../../../frontend/src/shared/api/archiveApi.js). New text returns 201 only after commit; equivalent retries return 200 with original identity and current states. The [mock](../../../frontend/src/shared/api/mockArchiveApi.js) remains an isolated synthetic server behind the real transport/decoders.

MED-01 implements PHOTO intents (one to five), capability-bound grants/finalization, and generic receipt GET, plus a minimal single-photo wedding form. Storage is opt-in and requires a private R2 bucket configured by Ryan; real R2 and phone acceptance remain pending. Audio, authentication, private inbox/review/playback, and production operations remain future server work. Mock success is not production-readiness evidence. See [text verification](text-verification.md), [photo verification](photo-verification.md), and the [R2 runbook](../../runbooks/private-photo-storage.md).

## Shared conventions

- Same-origin REST/JSON under `/api`. Send `Accept: application/json`,
  `X-Api-Contract: 1`, and `Content-Type: application/json` for bodies.
- The v1 server must honor version 1 without silently falling back to echo.
  Missing or unsupported versions return 400 UNSUPPORTED_CONTRACT on creation/receipt/grant/finalize. There is no echo fallback.
- Response caching is `Cache-Control: no-store`. JSON is camelCase, IDs are UUIDs,
  and timestamps are UTC ISO-8601 strings ending in Z.
- Required fields must have the documented type; nullable response fields are
  explicitly null, not omitted. Clients tolerate additional nonsensitive response
  fields; servers reject unknown request fields.
- Lengths count UTF-16 code units, matching Java and JavaScript string length.
  Validate raw length before trimming outer whitespace. Normalize using
  JavaScript String.trim()'s whitespace set, including NBSP; the backend must
  mirror it rather than assume Java trim() is identical. Blank optional name/
  caption becomes null; preserve internal whitespace. Text/name/caption/filename values must be
  valid Unicode scalar sequences without U+0000, which PostgreSQL text cannot store.
- Server assigns eventKey `kevin-mel-wedding`; guests cannot choose events,
  review state, visibility, IDs, or storage keys.
- New memories are PENDING and COUPLE_ONLY. KEEP and ARCHIVED remain private.
  Publication is a separate future operation.
- Fixtures use synthetic content, tokens, and URLs. Their far-future expiries
  support reusable examples, not production TTLs.

## Endpoint index

| Method and route | Success | Responsibility |
|---|---|---|
| GET `/api/health` | 200 | Existing `{"status":"ok"}`; not DB/storage readiness |
| POST `/api/contributions` | 201 new / 200 replay | Atomic text creation or media-batch intent |
| GET `/api/contributions/{contributionId}/receipt` | 200 | Reconcile this submission's states |
| POST `/api/contributions/{contributionId}/memories/{memoryId}/upload-grants` | 201 | Renew upload permission for one incomplete item |
| POST `/api/contributions/{contributionId}/memories/{memoryId}/finalize` | 200 | Verify original and confirm durable item |
| GET `/api/session` | 200 | Current session and CSRF token, including anonymous |
| POST `/api/session` | 200 | Couple login; rotate session/CSRF token |
| DELETE `/api/session` | 204 | Invalidate session and clear cookie; no body |
| GET `/api/memories` | 200 | Couple-only paginated review inbox |
| GET `/api/memories/{memoryId}` | 200 | Couple-only detail, revision, and ETag |
| PATCH `/api/memories/{memoryId}/review` | 200 | Conditional private lifecycle change |
| GET `/api/memories/{memoryId}/playback` | 200 | Short-lived original-media access |

## Text creation and retry identity

Idempotency-Key is required for creation, receipt, upload-grant, and finalize
requests. Generate a cryptographically random UUID v4 once per logical submission.
Retain it with the normalized draft/client item IDs across retries. A timeout is
not a reason to create another key. Submission routes validate UUID-v4 keys and
canonicalize their letter case. Missing/malformed keys return 400 VALIDATION_FAILED.

TEXT_REQUEST keeps the prototype request's shape, without memoryType:

```json
{"guestName":null,"message":"Wishing you a wonderful life together."}
```

guestName is optional/null, raw length at most 100. message is required, nonblank
after normalization, raw length at most 5,000. Creation commits the envelope and
memory atomically; failure leaves neither.

TEXT_RECEIPT:

```json
{
  "contributionId": "11111111-1111-4111-8111-111111111111",
  "eventKey": "kevin-mel-wedding",
  "createdAt": "2026-10-24T18:30:00.000Z",
  "completion": "COMPLETE",
  "memories": [{
    "memoryId": "22222222-2222-4222-8222-222222222222",
    "clientItemId": null,
    "memoryType": "TEXT",
    "uploadState": null,
    "reviewStatus": "PENDING",
    "visibility": "COUPLE_ONLY"
  }]
}
```

Canonicalize normalized content ignoring object-key order, preserving item-array
order. Same key/equivalent payload returns original IDs/time and **current**
receipt states without another insert. Changed content returns 409
IDEMPOTENCY_CONFLICT. Concurrent same-key requests must converge on one committed
result. Retain retry identity for the stored submission's lifetime; never silently
recycle keys. Collection-close work must preserve an explicit reconciliation window.

The key is a secret capability for that submission's guest receipt/upload
operations. IDs alone grant nothing. Wrong key or envelope/item association gets
the same 404. Guest receipts expose only IDs/states: no names, messages, filenames,
playback links, or storage keys. Redact retry keys, session/CSRF tokens, passwords,
signed URLs, and guest content from logs/analytics; never put them in request URLs.

Network failures/cancellations/5xx can occur **after** commit. Preserve draft/key;
replay POST to recover unknown IDs, or GET receipt if its ID is known. Do not show
saved or clear drafts just because fetch resolved. No automatic retries.

The wedding text form retains one normalized draft/key in memory, coalesces repeated taps, and requires a deliberate retry after an uncertain response. It locks text edits until that submission is confirmed, then offers a deliberate new-message action. Known validation rejection permits correction; conflicts never rotate keys automatically. Keep the page open until confirmed: browser refresh/tab closure is not a supported draft-recovery mechanism in this slice.

Submission POST/grant/finalize reject cross-origin Origin values and Sec-Fetch-Site: cross-site with 403 ORIGIN_INVALID. Origin-less nonbrowser clients may submit with valid JSON/version/key headers. Reverse-proxy origin configuration and full production abuse controls remain deployment/security work; this check grants no private archive access.

## Media authorization, transfer, and finalize

PHOTO_REQUEST / AUDIO_REQUEST use guestName, memoryType, items. A contribution
contains one type: one text, one audio, or one to five photos. Every media item
gets a separate memory ID and lifecycle.

Example photo item:

```json
{
  "clientItemId": "55555555-5555-4555-8555-555555555555",
  "originalFilename": "wedding.jpg",
  "declaredContentType": "image/jpeg",
  "byteSize": 1024,
  "checksumSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "caption": "A happy moment"
}
```

| Field / limit | Rule |
|---|---|
| clientItemId | Required UUID unique within batch; retain across retries |
| originalFilename | Required nonblank basename, at most 255 raw UTF-16 units; no slash/backslash or ASCII controls (0–31, 127); never a storage path |
| declaredContentType | Required MIME declaration; client claim, not verified detection |
| byteSize | Required positive safe integer; original byte count |
| checksumSha256 | Required 64 lowercase hex characters; SHA-256 of original bytes |
| caption | Optional/null, raw length at most 500; blank becomes null |
| Photos | At most five JPEG/PNG/WebP; **10,000,000 bytes each**, matching picker; actual decode limited to 50 million pixels and 20,000 per dimension |
| Audio | One; provisional **25,000,000 bytes**, over zero and at most 120 seconds |
| durationSeconds | Required finite AUDIO number; omitted for PHOTO request; verified by server |

HEIC/HEIF remains excluded. The audio/webm example is **not** a final production
allowlist. The adapter permits provisional audio/*, video/webm, video/mp4 metadata
declarations. D-03 and real-device audio tests must settle actual containers/codecs,
sniffing rules, and final limits. No shared-network rate threshold is selected here.

PHOTO_RECEIPT initially gives each item clientItemId, memoryType, and uploadState
PENDING. Obtain UPLOAD_GRANT for each incomplete item:

```json
{
  "grantId": "88888888-8888-4888-8888-888888888888",
  "method": "PUT",
  "uploadUrl": "https://uploads.example.test/synthetic-signed-path",
  "expiresAt": "2026-10-24T18:35:00.000Z",
  "headers": {"Content-Type":"image/jpeg"}
}
```

Grants expire within five minutes, bound to the intended private object and
size/type/checksum as supported by storage. Expose only Content-Type and optional
x-amz-checksum-sha256 upload headers. PUT bytes over HTTPS with cookies omitted
and redirects rejected. Never forward app cookies, retry/CSRF/authorization headers.

MED-01 grant POST has no request body. R2 signs Content-Type, method PUT, and a unique temporary `staging/<grant UUID>` key; size/checksum are enforced during finalize rather than by an R2 checksum header. Presigned PUTs can be reused until expiry, so finalization publishes only the verified candidate bytes to a separate server-only `originals/<asset UUID>` key. Later browser staging overwrites cannot replace the saved original. Neither filename nor guest text enters object keys. No public GET/playback link appears in a guest receipt. Storage is disabled by default; disabled/unavailable IO returns safe 503 MEDIA_UNAVAILABLE, and database/commit failure remains 503 SERVICE_UNAVAILABLE.

Then POST finalize with `{"grantId":"…"}`. Server verifies object existence,
actual size, detected format, checksum, and audio duration before committing
UPLOADED. Repeated successful finalize returns current receipt. Failed verification
returns 422 INVALID_MEDIA and marks that item FAILED.

PHOTO finalization verifies the declared exact byte count and SHA-256, detected MIME and bounded image decoding. Original bytes and metadata are preserved; sampled decoding is only a verification step. Grant association/capability is checked before returning a repeated completion. An unfinished expired grant cannot finalize (410); a correctly associated completed item's finalize replays its current receipt even after grant expiry. A known verification rejection commits FAILED before 422 is emitted. Storage/DB failure never acknowledges success; a private original written before DB commit failure can be recovered by the same-item retry.

The single-photo form retains its original file, normalized name/caption, item ID, hash, key and latest grant in memory. Repeated taps coalesce, retry reconciles the receipt and retained grant before retransfer, and only COMPLETE confirms saved. Uncertain outcomes lock editing and retain identity. An explicit replacement after known INVALID_MEDIA abandons the unfinished intent for documented cleanup; refresh/tab closure is not recovery. The batch backend preserves order and current sibling states; MED-02 owns batch UI polish.

| State | Meaning |
|---|---|
| Item PENDING | Intent exists; transfer/finalize still needed |
| Item UPLOADED | Original verified and metadata durably committed |
| Item FAILED | Transfer/verification failed; retry only this item |
| Completion PENDING | No item durably complete |
| Completion PARTIAL | Some, not all, items complete |
| Completion COMPLETE | Text committed or all originals verified |

PUT progress/200 is not durability. Renew expired grants (storage 401/403 or API
410 UPLOAD_GRANT_EXPIRED) for the same item/key/envelope/IDs. Premature finalize
returns 409 UPLOAD_INCOMPLETE; requesting a completed item's grant returns 409
ALREADY_COMPLETE. Reconcile uncertain finalize before transferring again.
Retain successful siblings in partial batches. Storage errors cannot always update
server state immediately: PENDING remains unfinished after a local failure.
The mock simulates verification; it never inspects real bytes or proves codec support.

## Session and CSRF

ANONYMOUS_SESSION / COUPLE_SESSION examples:

```json
{"authenticated":false,"user":null,"csrfToken":"opaque-anonymous-csrf-token"}
```

```json
{"authenticated":true,"user":{"displayName":"Example Couple","roles":["COUPLE"]},"csrfToken":"opaque-rotated-csrf-token"}
```

Login body: `{"username":"…","password":"…"}`; never persist credentials. Login,
logout, and review require X-CSRF-Token from current session. Missing/invalid token:
403 CSRF_INVALID. Invalid login: 401 INVALID_CREDENTIALS with no enumeration detail.
Login rotates session ID/token; logout invalidates both. GET session after logout/
token expiry. Tokens are unpredictable, at least 16 characters, without header controls.

The isolated preview uses deterministic synthetic tokens, not production secrets.
Every successful mock login/logout issues a fresh token; tokens from earlier sessions
remain invalid, including across repeated sign-in/sign-out cycles.

Production uses HTTPS and Secure, HttpOnly, SameSite=Lax cookies, same-origin
requests, CSRF enforcement, and Origin checks on mutations. Frontend never reads
session IDs or stores bearer tokens. Inbox/detail/review/playback require COUPLE
authorization and reveal gate: 401 AUTH_REQUIRED for no/expired authentication,
403 ARCHIVE_UNAVAILABLE for no authority or before reveal. UUIDs/capabilities do
not grant couple access. Ryan's operations/Kade's development role grant no
moderation. Mock forbidden simulates the gate, not a calendar policy.

## Inbox, review, and playback

List query: `reviewStatus=PENDING&limit=20&cursor=…`. Status is PENDING/KEEP/ARCHIVED/
DELETE; limit 1–100, default 20; cursor optional/opaque. Sort createdAt descending,
then memoryId descending. Production cursor binds filter/last sort tuple; malformed
or mismatched cursor: 400 INVALID_CURSOR. Do not parse the mock's offset cursor.
Paging is not a snapshot; refresh after reviews/filter changes.

Response: `{"items":[<detail>],"nextCursor":null}`; null means last page; empty is
valid. MEMORY_DETAIL / MEDIA_DETAIL / INBOX_PAGE / EMPTY_INBOX define full examples:

- memoryId, contributionId, nullable guestName, memoryType.
- textContent nonblank for TEXT/null for media; nullable caption (null for TEXT).
- reviewStatus, visibility COUPLE_ONLY, integer revision starting at 1.
- createdAt, updatedAt (at least creation), deleteAfter (null except DELETE).
- media null for TEXT; otherwise originalFilename, detectedContentType, byteSize,
  checksumSha256, durationSeconds (null for PHOTO), uploadState. No URL/internal
  storage key. Inbox contains durable items; receipt reconciles unfinished uploads.

GET detail returns ETag `"1"` matching revision. PATCH review sends
`{"reviewStatus":"KEEP"}`, `If-Match: "1"`, X-CSRF-Token. Server atomically
checks authorization/CSRF/revision, increments revision, returns detail/new ETag.
Missing precondition: 428 PRECONDITION_REQUIRED; stale revision: 412 REVIEW_CONFLICT.
Reload and let the couple reconsider; never silently overwrite or auto-retry.

DELETE is soft: deleteAfter = first deletion + 30 days. Repeated DELETE must not
extend it. Before expiry, PATCH PENDING/KEEP/ARCHIVED restores and clears deleteAfter.
After expiry, unavailable items return 404. Cleanup/backup retention owns physical
deletion. No sibling cascade or memory HTTP DELETE route. KEEP is not publication.

PLAYBACK is `{"url":"https://…","expiresAt":"…Z"}`, private signed access for at most
five minutes. Never log/store it; refresh on expiry. TEXT: 404; unavailable original:
503 MEDIA_UNAVAILABLE. Detail/review remain available; playback failure does not
mean the stored memory disappeared.

## Structured errors and recovery

VALIDATION_ERROR:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the highlighted fields.",
    "requestId": "99999999-9999-4999-8999-999999999999",
    "fieldErrors": [{
      "field": "message",
      "code": "NOT_BLANK",
      "message": "Please write a message before submitting."
    }]
  }
}
```

Error envelopes require code, safe user-facing message, UUID requestId (also
X-Request-ID), and fieldErrors (empty if not field-specific). Never expose SQL,
stack traces, credentials, keys, signed URLs, or guest content. Indexed fields
use items[0].byteSize etc. Render text, never HTML.

| Status / example | UI recovery |
|---|---|
| 400 VALIDATION_FAILED / INVALID_CURSOR | Show fields or reload; retain draft |
| 401 AUTH_REQUIRED / INVALID_CREDENTIALS | Preserve nonsensitive state; sign in |
| 403 CSRF_INVALID / ARCHIVE_UNAVAILABLE / ORIGIN_INVALID | Refresh session or explain access |
| 404 NOT_FOUND | Show unavailable without existence leak |
| 409 IDEMPOTENCY_CONFLICT / UPLOAD_INCOMPLETE | Do not auto-replace key; reconcile |
| 410 UPLOAD_GRANT_EXPIRED | Renew incomplete item's grant |
| 412 REVIEW_CONFLICT / 428 PRECONDITION_REQUIRED | Reload; deliberate review |
| 413 PAYLOAD_TOO_LARGE / 422 INVALID_MEDIA | Correct file; retain successful siblings |
| 429 RATE_LIMITED | Honor Retry-After seconds/HTTP-date; preserve work |
| 503 SERVICE_UNAVAILABLE / MEDIA_UNAVAILABLE | Retry later; never imply saved |

ApiError exposes code, status, safe requestId (or null), fieldErrors,
retryAfterSeconds, unknownOutcome. Network/cancelled mutations and mutation 5xx
are uncertain. Unexpected successful JSON/schema/status returns CONTRACT_MISMATCH.

## Checks and handoff

Real and mock methods: createTextContribution, createMediaContribution, getReceipt,
authorizeUpload, uploadMedia, finalizeUpload, getSession, login, logout, listMemories,
getMemory, reviewMemory, getPlayback. Pass explicit keys/current CSRF/revision/
AbortSignal as required. Adapters do not retain secrets, own UI state, or auto-retry.

Run `npm --prefix frontend test`, using Node's built-in runner with no dependency.
Tests exercise the real JSON transport/decoders against mocks and malformed responses.
The dev-only `/contract-preview.html` offers synthetic UI scenarios; the normal
production index.html build excludes preview/mock code.

Scenarios include success, validation, anonymous/forbidden, delay, rate limiting,
service/network failures, lost committed response, partial uploads, expired grants,
invalid media, unavailable playback, and empty inbox.

MSG-01 adds real HTTP/PostgreSQL integration tests and V2 creation fingerprints.
The fingerprint is SHA-256 over a PostgreSQL JSONB object containing eventKey,
memoryType TEXT, normalized guestName and message; it is immutable during replay.
V2 backfills only unambiguous single-text V1 envelopes and preserves their data;
other legacy keys stay reserved. V3 adds PHOTO client item IDs, captions/order, expected integrity claims and five-minute upload grants without rewriting V1/V2. PHOTO fingerprints use SHA-256 over length-prefixed normalized fields and ordered item metadata, including client IDs, filename, MIME, size, original hash and caption. Changed fields/order conflict; Unicode outer whitespace and UUID case normalize before fingerprinting. Legacy non-text keys remain reserved. Audio duration, review revisions and delete deadlines still need later migrations. Never edit applied migrations.
