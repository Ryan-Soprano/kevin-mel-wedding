# Memory Archive API — contract v1

This API-01 contract defines implemented v1 endpoints and interfaces for later server work.
The [executable fixtures](../../../frontend/src/shared/api/v1/fixtures.js) contain
complete synthetic request/response examples. Change the contract, fixtures,
adapters, and tests together.

## Implementation boundary

MSG-01 implements durable text POST and key-bound text receipt GET, and the wedding form uses the [real adapter](../../../frontend/src/shared/api/archiveApi.js). New text returns 201 only after commit; equivalent retries return 200 with original identity and current states. The [mock](../../../frontend/src/shared/api/mockArchiveApi.js) remains an isolated synthetic server behind the real transport/decoders.

MED-01 implements PHOTO intents (one to five), capability-bound grants/finalization, and generic receipt GET. The active guest/private forms use the MED-02 batch coordinator; the retired single-photo form and its unused coordinator have been removed. Storage is opt-in and requires a private R2 bucket configured by Ryan. Desktop PNG operator comparison/restart/replay and scripted real-R2 JPEG/WebP upload, recovery and grant checks are verified; physical-phone, additional operator comparison and bucket-settings acceptance are pending. See [text verification](text-verification.md), [photo verification](photo-verification.md), and the [R2 runbook](../../runbooks/private-photo-storage.md).

AUTH-01 implements GET/POST/DELETE `/api/session` and authenticated POST `/api/session/password` with Spring Security server-side sessions, PostgreSQL accounts, bcrypt password hashes, CSRF/session rotation, durable credential throttling, credential-version revocation, and reveal/role gates. Temporary couple accounts must choose a new password before using the archive. Provisioning and forgotten-password recovery use a separate console utility. See [AUTH-01 verification](auth-verification.md) and the [account-access runbook](../../runbooks/account-access.md).

AUTH-02 implements couple-authorized playback issuance, now extended to verified AUDIO by AUD-03. Every couple issuance rechecks current couple/reveal authority, authenticated private-object size/MIME and a single-object GET expiry of at most 300 seconds. The inbox supports notes, verified photos and verified audio, with conditional review and independent-ledger-backed retention. The [sharing contract](sharing.md) defines explicit audience choices and separate guest reads. Production onboarding and hosted acceptance remain release work. See [authorization verification](authorization-verification.md) and the [audio runbook](../../runbooks/voice-memories.md).

ARC-01 adds [private couple creation and editable details](couple-memories.md), including account-bound upload recovery, Kept defaults for couple-authored memories, optional precise/partial dates and conditional metadata updates. Original guest content and files remain preserved. Recovery package v3 carries these additive V10 fields.

ARC-02 adds [private albums and event collections](albums.md): named many-to-many collections, independent order, bounded member pages and conditional UUID revision tokens. Album deletion preserves original memories/files; memory deletion removes relationships. Recovery package v4 carries additive V11 organization data.

The [staging package](../../runbooks/staging-deployment.md) serves production frontend assets and `/api` through one Spring process. Its staging-only operator access gate is separate from the couple session API. Staging limits overlapping photo finalization to one: a busy request returns `503 MEDIA_UNAVAILABLE` before reading storage or changing item state; deliberate retry retains the same intent, item and capability key. File, dimension and batch limits are unchanged. Local package checks pass; hosted deployment and physical-phone acceptance remain pending.

## Shared conventions

The [memory sharing contract](sharing.md) adds couple-controlled audiences: Keep Private, Friends & Family through a revocable private link, and Public on the guest site. Guest reads expose only explicitly shared content; couple routes continue to include every audience. Flyway V14 and recovery version 7 preserve these choices, with secret links excluded from recovery and portable exports. New contributions remain private by default.

ARC-05 adds [portable couple exports](exports.md): temporary session-authorized jobs, bounded ZIP parts, exact original verification, unavailable-original reports and a separate offline reader. All export control routes use the shared contract, CSRF and privacy boundary; the authenticated binary route also requires contract version 1. This delivery format contains no operator recovery capabilities or database import state.

SEC-01 protects note/photo creation, receipt, grant and finalize before body parsing with durable global/shared-connection/retry-key limits. Quota failures return `429 RATE_LIMITED` with a remaining-window `Retry-After`; database admission failures return safe `503 SERVICE_UNAVAILABLE`. Creation accepts at most 65,536 JSON bytes, finalize 1,024 bytes, and receipt/grant routes reject bodies. Oversized JSON returns `413 PAYLOAD_TOO_LARGE`; retain the intent and report the boundary instead of silently resending the same oversized request. See [quota and verification details](anonymous-protection-verification.md).

New photo intents and temporary permissions have separate serialized 7.5 GB reservation budgets. Pausing/capacity failures return `503 MEDIA_UNAVAILABLE` with `Retry-After: 60`; busy finalization returns the same code with `Retry-After: 5`. Honor valid 429/503 delays, retain original input/key and saved siblings, and retry deliberately. A pause preserves equivalent intent replay, existing unexpired permission recovery and finalization. Expired staging reservations require confirmed cleanup before release. See the [operator runbook](../../runbooks/guest-protection.md).

- Same-origin REST/JSON under `/api`. The JSON adapter rejects redirects before forwarding API headers or bodies. Send `Accept: application/json`,
  `X-Api-Contract: 1`, and `Content-Type: application/json` for bodies.
- The v1 server must honor version 1 without silently falling back to echo.
  Missing or unsupported versions return 400 UNSUPPORTED_CONTRACT on creation/receipt/grant/finalize/session/inbox/detail/playback. There is no echo fallback.
- Response caching is `Cache-Control: no-store`. JSON is camelCase, IDs are UUIDs,
  and timestamps are actual UTC calendar instants ending in Z, with up to nine fractional digits. Shared decoders preserve the original strings and compare timestamp ordering without truncating fractions. The shared contribution and memory adapters compare UUID identities independently of case while preserving response spelling.
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
- New guest memories are PENDING and COUPLE_ONLY. Authenticated couple creation starts in KEEP and COUPLE_ONLY. Shared audiences require an explicit KEEP audience choice; all other review states remain private.
  Publication is a separate future operation.
- Fixtures use synthetic content, tokens, and URLs. Their far-future expiries
  support reusable examples, not production TTLs.

## Endpoint index

AUTH-01 implements session routes. AUTH-02/AUD-03 provide verified PHOTO/AUDIO playback; the inbox supports note/photo/audio list, detail, conditional private review and deleted-item recovery.

| Method and route | Success | Responsibility |
|---|---|---|
| GET `/api/health` | 200 | Existing `{"status":"ok"}`; not DB/storage readiness |
| POST `/api/contributions` | 201 new / 200 replay | Atomic text creation or media-batch intent |
| GET `/api/contributions/{contributionId}/receipt` | 200 | Reconcile this submission's states |
| POST `/api/contributions/{contributionId}/memories/{memoryId}/upload-grants` | 201 | Renew upload permission for one incomplete item |
| POST `/api/contributions/{contributionId}/memories/{memoryId}/finalize` | 200 | Verify original and confirm durable item |
| GET `/api/session` | 200 | Current session and CSRF token, including anonymous |
| POST `/api/session` | 200 | Couple login; rotate session/CSRF token |
| POST `/api/session/password` | 200 | Change the signed-in account's password and rotate session/CSRF token |
| DELETE `/api/session` | 204 | Invalidate session and clear cookie; no body |
| GET `/api/memories` | 200 | Couple-only paginated note/photo/audio inbox, including recoverable DELETE filter |
| GET `/api/memories/{memoryId}` | 200 | Couple-only note/photo/audio detail, revision, and ETag |
| PATCH `/api/memories/{memoryId}/review` | 200 | Implemented: conditional private Keep/Archive/Restore/Delete |
| PATCH `/api/memories/{memoryId}/metadata` | 200 | Conditional title/description/date editing; original content preserved |
| POST `/api/memories/contributions` | 201 new / 200 replay | Authenticated couple creation; account-bound receipt/grant/finalize routes in [ARC-01](couple-memories.md) |
| GET `/api/memories/{memoryId}/playback` | 200 | Current couple/reveal authorization and short-lived GET for an eligible PHOTO/AUDIO original |
| GET/PUT/PATCH/DELETE `/api/albums…` | 200 / 201 first creation | Private collection browsing and conditional organization; see [ARC-02 routes](albums.md) |

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
| Audio | One; **25,000,000 bytes**, over zero and at most 120 decoded seconds; gated pending device acceptance |
| durationSeconds | Required finite AUDIO number; omitted for PHOTO request; verified by server |

HEIC/HEIF remains excluded. AUD-02/AUD-03 implement a gated audio path with canonical
`audio/webm` (WebM/Opus), `audio/ogg` (Ogg/Opus), and `audio/mp4` (MP4/AAC). Video and
additional streams are rejected. Each original is limited to 25,000,000 bytes,
one or two audio channels, 8–96 kHz, and 120 seconds of decoded playback. Browser
codec parameters are normalized before intent creation and PUT, without changing
the original bytes. `durationSeconds` is a client claim rounded to milliseconds
for retry identity; stored duration comes from independent server decoding.
Physical phone/browser format acceptance remains deferred, so both guest build
and server admission gates default off. See the [audio runbook](../../runbooks/voice-memories.md).

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

MED-01 grant POST has no request body. SEC-01 R2 signatures bind Content-Type, expected Content-Length, method PUT and a unique temporary `staging/<grant UUID>` key. The browser derives Content-Length from the original File; it is not an application-set grant header. Size/checksum/format remain independently enforced during finalize rather than by an R2 checksum header. Retrying an unexpired grant reuses its identity/key/deadline; obtaining a fresh grant still returns 201. Presigned PUTs can be reused until expiry, so finalization publishes only the verified candidate bytes to a separate server-only `originals/<asset UUID>` key. Later browser staging overwrites cannot replace the saved original. Neither filename nor guest text enters object keys. No public GET/playback link appears in a guest receipt. Storage is disabled by default; disabled/unavailable IO returns safe 503 MEDIA_UNAVAILABLE, and database/commit failure remains 503 SERVICE_UNAVAILABLE. Actual provider/browser acceptance of the changed size signature remains open.

Then POST finalize with `{"grantId":"…"}`. Server verifies object existence,
actual size, detected format, checksum, and audio duration before committing
UPLOADED. Repeated successful finalize returns current receipt. Failed verification
returns 422 INVALID_MEDIA and marks that item FAILED.

PHOTO finalization verifies the declared exact byte count and SHA-256, detected MIME and bounded image decoding. Original bytes and metadata are preserved; sampled decoding is only a verification step. Grant association/capability is checked before returning a repeated completion. An unfinished expired grant cannot finalize (410); a correctly associated completed item's finalize replays its current receipt even after grant expiry. A known verification rejection commits FAILED before 422 is emitted. Storage/DB failure never acknowledges success; a private original written before DB commit failure can be recovered by the same-item retry.

AUDIO uses the same intent, grant, finalize and receipt routes. The server checks
exact size and SHA-256, strict container framing, one supported audio stream, and
full bounded FFmpeg decoding. It stores the canonical MIME, container, codec and
actual decoded duration while preserving the original bytes. Temporary original
files have owner-only permissions and are removed after verification; decoded PCM
is counted and discarded. Missing tools, disk/decoder timeouts and storage failures
return retryable `503 MEDIA_UNAVAILABLE`, retaining the same intent. Invalid bytes
return `422 INVALID_MEDIA` and commit FAILED. Audio admission disabled after an
intent was issued preserves equivalent replay, existing unexpired grants and
finalization; new intents and new audio grants remain gated.

The guest batch photo form retains its original files, normalized name/captions, item IDs, hashes, one contribution key and per-item grants in memory. Repeated taps coalesce. Retry reconciles the receipt and each retained grant before retransfer, skips UPLOADED siblings and preserves item mapping by clientItemId. Only verified UPLOADED items count as saved; only COMPLETE confirms the whole batch. Uncertain outcomes lock editing and retain identity. A known INVALID_MEDIA rejection can recover the same original bytes through a fresh grant; explicit replacement starts a new batch only after all remaining items are known rejected. Already saved siblings remain durable. Refresh/tab closure is not recovery. See [MED-02 verification](../../product/med02-verification.md) for operational timeouts, selective retry and remaining acceptance.

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

The private inbox implements this session contract and routes accounts with a temporary password to the required password-change screen before loading archive content.

ANONYMOUS_SESSION / COUPLE_SESSION examples:

```json
{"authenticated":false,"user":null,"csrfToken":"opaque-anonymous-csrf-token","passwordChangeRequired":false}
```

```json
{"authenticated":true,"user":{"displayName":"Example Couple","roles":["COUPLE"]},"csrfToken":"opaque-rotated-csrf-token","passwordChangeRequired":false}
```

Login body: `{"username":"…","password":"…"}`; never persist credentials. Login,
logout, and review require X-CSRF-Token from current session. Missing/invalid token:
403 CSRF_INVALID. Invalid login: 401 INVALID_CREDENTIALS with no enumeration detail.
Login rotates session ID/token; logout invalidates both. GET session after logout/
token expiry. Tokens are unpredictable, at least 16 characters, without header controls.

`POST /api/session` accepts at most **4,096 UTF-8 bytes**, including JSON syntax
and whitespace. After CSRF and route authorization pass, known-length and
streamed bodies exceeding this limit return `413 PAYLOAD_TOO_LARGE` before JSON
parsing, throttle reservation or credential verification. The exact limit remains
accepted for a valid login envelope.

The session cookie is `MEMORY_ARCHIVE_SESSION`, `HttpOnly`, `SameSite=Lax`, and limited to cookie-based tracking with a 30-minute idle timeout. The production profile adds `Secure`. Production startup requires the production environment/profile to agree, an explicit HTTPS `archive.public-origin`, and an operator-supplied login-throttle secret of at least 32 UTF-8 bytes. Same-origin checks apply to login/logout, and the guest contribution routes retain their independent JSON/origin/retry-capability protections.

Login accepts exactly string `username` and `password` fields. Unknown/disabled accounts and wrong passwords return the same 401 INVALID_CREDENTIALS; valid credentials without archive authority return 403 ARCHIVE_UNAVAILABLE. Enabled COUPLE identities require reveal, and production restricts them to `kevin-admin` and `melanie-admin`. The server-only `MEMORY_ARCHIVE_OPERATOR_ADMIN_USERNAME` setting defaults empty. When explicitly set, only that exact enabled OPERATOR account also receives full private archive access, independently of couple reveal; all other operators and all developers remain denied. Session `user.roles` contains the account's actual single `COUPLE` or `OPERATOR` role. This does not introduce a new role, public account-management API or anonymous authority. See the [account boundary and private provisioning procedure](../../runbooks/account-access.md#account-boundaries).

Credential attempts, whether successful or unsuccessful, are capped at five per normalized username and thirty per direct peer address in fifteen minutes. PostgreSQL stores keyed digests and counters, which survive process restart and session rotation; old buckets are cleaned up after one day. A rejected reservation returns 429 RATE_LIMITED with `Retry-After: 900`. Malformed login bodies/credentials are rejected before credential verification. Caller-supplied forwarding headers do not determine the peer identity.

An authenticated temporary-password session reports `passwordChangeRequired: true`. It can read its session, change its own password, or sign out; archive reads, playback, writes and background export authority remain denied until the password changes. This restriction is enforced by the server and survives refreshing the page. The couple reveal gate and enabled-account policy still apply to sign-in.

`POST /api/session/password` accepts exactly `{"currentPassword":"…","newPassword":"…"}` with contract version 1, the current CSRF token and same-origin authority. The new password must contain at least 8 Unicode characters, fit within 72 UTF-8 bytes, be valid Unicode, and differ from the current password. Never trim or persist either value. A successful transaction replaces the hash, clears the required-change flag, increments the credential version and rotates the current session and CSRF token; older sessions and the old password stop working. Credential attempts share the durable throttle. After an uncertain network result, reconcile the session before another attempt; if it has expired, sign in deliberately with the new password. Do not automatically replay a password change.

Account recovery and every enable/disable command also increment the stored credential version. An existing session with a stale version, a disabled/missing account, or changed identity/role is invalidated before private access. Signup, forgotten-password reset, account enablement, and role changes have no public endpoints; use the [console-only runbook](../../runbooks/account-access.md). Application sessions are held by the server process and require a new login after process restart. Flyway V15 adds the required-change flag with a false default, preserving existing accounts.

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

Implemented list query: `reviewStatus=PENDING&limit=20&cursor=…`. Status is PENDING/KEEP/ARCHIVED/DELETE; limit 1–100, default 20; cursor optional/opaque. DELETE includes only items still inside their server recovery window and not claimed/purged. Sort createdAt descending,
then memoryId descending. Production cursor binds filter/last sort tuple; malformed
or mismatched cursor: 400 INVALID_CURSOR. Do not parse the mock's offset cursor.
Paging is not a snapshot; refresh after reviews/filter changes.

Response: `{"items":[<detail>],"nextCursor":null}`; null means last page; empty is
valid. MEMORY_DETAIL / MEDIA_DETAIL / INBOX_PAGE / EMPTY_INBOX define full examples:

- memoryId, contributionId, nullable guestName, memoryType.
- textContent nonblank for TEXT/null for media; nullable caption (null for TEXT).
- reviewStatus, visibility COUPLE_ONLY/FRIENDS_FAMILY/PUBLIC, integer revision starting at 1. Shared audiences require KEEP.
- createdAt, updatedAt (at least creation), deleteAfter (null except DELETE).
- media null for TEXT; otherwise originalFilename, detectedContentType, byteSize,
  checksumSha256, durationSeconds (null for PHOTO), uploadState. No URL/internal
  storage key. Inbox contains durable items; receipt reconciles unfinished uploads.

GET detail returns ETag `"1"` matching persisted revision. The inbox includes TEXT and verified PHOTO/AUDIO, excluding unfinished/unverified and expired/claimed/purged items. Audio detail reports server-decoded `durationSeconds`. Recoverable DELETE returns its first deleteAfter; other states return null. See [INB-01 verification](inbox-verification.md) and [INB-02 verification](review-verification.md). PATCH review sends
`{"reviewStatus":"KEEP","visibility":"COUPLE_ONLY"}`, `If-Match: "1"`, X-CSRF-Token. Visibility is optional for existing callers; the inbox sends an explicit audience. Server atomically
checks authorization/CSRF/revision, increments revision for an actual status or audience change and returns detail/new ETag. A same-status, same-audience request at the current revision is a no-op; stale requests still conflict. State and content-free audit commit atomically.
Missing precondition: 428 PRECONDITION_REQUIRED; stale revision: 412 REVIEW_CONFLICT.
Reload and let the couple reconsider; never silently overwrite or auto-retry.

The implemented DELETE review state is soft: deleteAfter = first deletion + 30 days. Repeated DELETE must not
extend it. Before expiry, PATCH PENDING/KEEP/ARCHIVED restores and clears deleteAfter.
After expiry, unavailable items return 404. Bounded maintenance writes an independent private deletion ledger before physical object deletion and metadata scrubbing. Retained opaque IDs/retry reservations prevent guest replay from recreating purged content; offline ledger replay reserves erased-key digests even when the backup predates submission creation. The [deletion/recovery runbook](../../runbooks/deletion-and-recovery.md) defines maintenance readiness and rolling-backup implications. No sibling cascade or memory HTTP DELETE route. KEEP stays private unless the couple explicitly chooses a shared audience. Deletion revokes sharing, and restoring forces COUPLE_ONLY.

PLAYBACK is `{"url":"https://…","expiresAt":"…Z"}`. AUTH-02/AUD-03 issue it through the private archive route for verified PHOTO/AUDIO items of every supported audience with `UPLOADED` assets. Each request revalidates the enabled reveal-authorized COUPLE account or the separately configured exact named OPERATOR; guest capabilities, IDs, other operators and developers grant no authority on that route. The separate [guest sharing playback route](sharing.md) checks the current public audience or private-link capability. Authenticated HEAD must match the private original's size and detected MIME before signing one S3 HTTPS GET for at most 300 seconds. `expiresAt` reports the actual signature expiry. Public custom domains and `r2.dev` stay disabled for originals and staging.

Unfinished/failed/unverified items, TEXT, missing or wrong-event memories, and DELETE items return safe 404. Restoring an eligible deleted item permits playback again. A missing eligible original, metadata mismatch or unavailable storage returns 503 MEDIA_UNAVAILABLE; database failure remains 503 SERVICE_UNAVAILABLE. Playback failure does not erase the memory, and inbox/detail reads remain independent of storage. Accepted AUDIO playback remains available when new audio admission is disabled.

The signed URL is a reusable bearer permission: anyone possessing it can GET the object until its own expiry. Logout, reset, disablement, and closing reveal block new issuance; they do not revoke an already-issued link or an in-progress download. `Cache-Control: no-store` does not erase downloaded bytes. Never persist/log the URL, and refresh issuance only after expiry through the authenticated app route. The later playback UI must omit application credentials when fetching the object, use `no-referrer`, and never forward session/CSRF/retry headers. A GET signature does not grant PUT, DELETE or HEAD. Real provider HEAD/GET, expiry, CORS, tampering and unsigned/public denial remain in the [home acceptance checklist](../../runbooks/private-photo-storage.md#authenticated-photo-playback--auth-02-home-acceptance).

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
| 413 PAYLOAD_TOO_LARGE / 422 INVALID_MEDIA | Respect JSON/file limits; retain input and successful siblings |
| 429 RATE_LIMITED | Honor Retry-After seconds/HTTP-date; preserve work |
| 503 SERVICE_UNAVAILABLE / MEDIA_UNAVAILABLE | Honor valid Retry-After, retry deliberately with retained identity; never imply saved |

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
The shared decoder rejects malformed or case-equivalent duplicate receipt members and inbox pages exceeding their requested limit or review filter. Inbox continuation cursors are null or nonempty strings of at most 256 characters. The mock preserves review audiences, nondecreasing mutation times and active-grant identity/expiry; its byte verification and offset pagination remain synthetic. Per-file review and verification are recorded in the [directory review guide](../../development/directory-review.md#shared-api-decisions--october-19-2026).

The dev-only `/contract-preview.html` offers synthetic UI scenarios; the normal
production index.html build excludes preview/mock code.

Scenarios include success, validation, anonymous/forbidden, delay, rate limiting,
service/network failures, lost committed response, partial uploads, expired grants,
invalid media, unavailable playback, and empty inbox.

MSG-01 adds real HTTP/PostgreSQL integration tests and V2 creation fingerprints.
The fingerprint is SHA-256 over a PostgreSQL JSONB object containing eventKey,
memoryType TEXT, normalized guestName and message; it is immutable during replay.
V2 backfills only unambiguous single-text V1 envelopes and preserves their data;
other legacy keys stay reserved. V3 adds PHOTO client item IDs, captions/order, expected integrity claims and five-minute upload grants without rewriting V1/V2. PHOTO fingerprints use SHA-256 over length-prefixed normalized fields and ordered item metadata, including client IDs, filename, MIME, size, original hash and caption. Changed fields/order conflict; Unicode outer whitespace and UUID case normalize before fingerprinting. Legacy non-text keys remain reserved. V6 adds persisted positive review revisions and the inbox ordering index without rewriting existing migrations. V7 adds delete deadlines, purge claims/content-free tombstones, review audit and independent-ledger replay reservations; audio duration remains later work. Never edit applied migrations.

AUTH-01 adds V4 private accounts and V5 login-throttle counters without changing V1–V3. Runtime/session, recovery, and role-gate evidence belongs in [AUTH-01 verification](auth-verification.md); operation instructions belong in the [account-access runbook](../../runbooks/account-access.md). The approved Spring Security runtime/test starters are recorded in the backend POM.

AUTH-02 uses the existing dependencies and schema for guarded PHOTO playback issuance. Its original scope did not implement inbox/list/detail/review, audio, or new UI; INB-01 now supplies note/photo list and detail separately. Authorization/storage evidence and remaining Docker/R2 acceptance belong in [AUTH-02 verification](authorization-verification.md).
