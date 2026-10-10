# Portable couple archive — ARC-05

The private archive offers a portable copy of completed memories, exact original media and current organization. It uses the existing couple session. The delivery format is separate from operator recovery: it is readable without the application and is not a database backup or an import package.

## Capture and delivery

An export freezes a bounded database snapshot of eligible `PENDING`, `KEEP` and `ARCHIVED` memories, their useful metadata, active ordered albums, timeline events and tags. Deleted, purging, purged, unfinished and unavailable records are excluded. Memory date and saved time remain separate; partial and unknown dates retain their precision. Later additions do not join an existing snapshot. A change to captured memories or organization makes delivery stale and requires a new export.

Originals are processed in numbered ZIP parts, each with at most 50 files and 64 MiB of expected original bytes. An original is included only after its actual length and SHA-256 match its persisted verified metadata. Missing, incorrect or unreadable originals produce safe issue codes and an incomplete report. The final index part follows all original-part results and contains documented metadata and an offline reader. Extract every downloaded part into the same private folder before opening the reader. Preparing a part proves server-side processing; it does not prove that a browser saved it.

Jobs are temporary process-local delivery state. They expire after 30 minutes without activity, with an absolute 24-hour limit. Restarting the application loses jobs and requires an explicit new export. Keep files already downloaded and complete a new set before combining them; do not mix snapshots. There is no automatic restart, hidden recreation or automatic mutation retry.

Only one part is cached on the server and one export worker runs at a time. Preparing another part replaces the previous cached file; a processed part can be deliberately prepared again. The final index must be refreshed after retrying an original part. Admission permits at most four active jobs globally, one per account, 256 retained identities and 512 control attempts per job, reserving one attempt for cancellation. A ZIP never exceeds 80 MiB, and delivery does not assemble an entire archive in browser memory. Capture accepts at most 16 MiB of metadata, 100,000 rows, 10,000 originals and 7.5 GB of original bytes; these are correctness bounds, not hosted capacity promises.

## API

All routes require `X-Api-Contract: 1`, a current enabled `COUPLE` account and the open reveal gate. Jobs belong to the requesting account and credential version. Mutations also require current session CSRF and same-origin authority. Routes are bodyless. Job, attempt and generation identities use canonical UUID-v4 values.

| Method and route | Purpose |
|---|---|
| PUT `/api/exports/{exportId}` | Capture a known identity with `If-None-Match: *`; returns 202 |
| GET `/api/exports/current` | Discover the current account's active export after refresh or a new sign-in |
| GET `/api/exports/{exportId}` | Current progress, expiry, counts and cached-part descriptor |
| POST `/api/exports/{exportId}/parts/{partNumber}/prepare` | Explicitly prepare or retry one part, with `Idempotency-Key: <attemptId>` |
| GET `/api/exports/{exportId}/attempts/{attemptId}` | Reconcile that exact control attempt |
| GET `/api/exports/{exportId}/parts?limit=20&cursor=…` | Bounded part-result page |
| GET `/api/exports/{exportId}/issues?limit=20&cursor=…` | Bounded unavailable-original report |
| GET `/api/exports/{exportId}/parts/{partNumber}/download?generation=…` | Authenticated binary download of the exact cached generation |
| DELETE `/api/exports/{exportId}` | Cancel using `Idempotency-Key: <attemptId>` |

Original parts are numbered 1 through N; index part N+1 is available after original results are recorded. With no originals, the index is part 1. List limits default to 20 and accept 1–50. Cursors are opaque and route/job scoped. Reload issue pages after retrying a part.

A used creation identity returns `412 EXPORT_EXISTS`; read the same identity before deciding what happened. Known terminal jobs remain readable as content-free state; unknown, restarted or other-account identities return 404. Current-export discovery returns 404 when there is no active job for the current account and credential version. Opening the export view can discover an existing job without creating one. A prepare request returns 202 while running or 200 for a resolved same attempt. Attempt receipts contain `attemptId`, `kind` (`PREPARE` or `CANCEL`), `partNumber` and `state` (`RUNNING`, `SUCCEEDED` or `FAILED`). Reusing an attempt for a different action or part returns `409 IDEMPOTENCY_CONFLICT`. An unrecorded attempt returns 404 and permits deliberate retry with that same identity.

Progress states are `CAPTURING`, `READY`, `PREPARING`, `READY_WITH_WARNINGS`, `FAILED`, `STALE`, `CANCELLED` and `EXPIRED`. Status includes capture/expiry times, expected counts, processed original parts, available/unavailable counts, `complete`, `indexNeedsRefresh`, the cached `preparedPart`, the last attempt, a safe `errorCode` and `pollAfterSeconds`. `excludedCounts` reports `deletedOrPurgingMemories`, `unfinishedOrUnavailableMemories`, `deletedAlbums`, `deletedTimelineEvents` and `deletedTags`; uncaptured/terminal state has an empty map. `complete` means that all originals verified and a current index was prepared; it never means a recipient saved all parts. Issue codes are `MISSING`, `INTEGRITY_MISMATCH` and `READ_FAILED`; responses never expose provider error text or object keys.

Unavailable terminal jobs reject preparation with 410. Busy worker/download admission returns `409 EXPORT_BUSY` and `Retry-After: 2`. Preparing the index too early returns `409 EXPORT_PARTS_PENDING`; retained-identity/attempt bounds return `429 EXPORT_LIMIT`. Unconfirmed private temporary-file cleanup returns `503 EXPORT_TEMP_UNAVAILABLE` and prevents further allocation until cleanup succeeds. A replaced or mismatched cached generation returns `409 EXPORT_PART_UNAVAILABLE`. Binary success has `application/zip`, generated `Content-Disposition`, exact `Content-Length`, `X-Archive-SHA256`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The browser checks the bounded response length and SHA-256 before offering the download.

## Privacy and consistency

Background work rechecks the initiating account and reveal authority without retaining session credentials. Fresh eligibility and revision checks run around original reads and before publishing a part or admitting its download. No database lock is held over provider reads or download transfer. A deletion or authority change committed after the relevant admission checks can race an admitted transfer; bytes already released or copied cannot be recalled. Transfer checks cancellation and expiry between chunks. Signing out, expiry, cancellation or credential recovery cannot erase a recipient's saved files.

The portable allowlist excludes accounts, passwords, sessions, author account identities, retry capabilities/fingerprints, live revision tokens, grants, provider paths/URLs, review audit and deletion authority. ZIP paths and download names are generated from server identities, never supplied filenames. The reader treats stored text as text and uses local relative original links.

The index ZIP contains `README.txt`, `archive.json`, `manifest.json`, complete `archive.txt` and static `index.html`. `archive.json` declares format `kevin-mel-portable-archive`, version 1 and capture time. Its `memories` preserve contribution identity/item position, source/name, type/review state, text/caption/title/description, provided date/precision, saved/updated time and asset identity. `originals` document generated path, filename, MIME, expected byte size/SHA-256 and verified audio duration/container/codec. Album member positions are decimal strings, preserving PostgreSQL BIGINT values; events and tags contain explicit memory identity lists. Excluded counts expose no excluded record identities or content. `manifest.json` records each expected original's delivery outcome and overall completeness. Each original ZIP contains its files plus `parts/part-N.json` and its own instructions. The HTML reader explicitly limits previews to 1,000 rows per section and 512 characters per text; `archive.txt` and JSON contain the complete captured content.

The interface shares the inbox's authority, cancellation and unresolved-write fence. An acknowledged long-running job permits navigation and logout. Hiding private content aborts requests, clears progress, issues and owned Blob URLs, and retains only opaque job/control identities for fresh-session reconciliation. An uncertain control response must be reconciled before a new identity or conflicting action is offered.

Operator recovery remains the existing offline procedure and recovery v6/V13 contract. Export jobs add no migration or persistent recovery state. Device, live-provider, hosted capacity and couple acceptance remain separate release checks.
