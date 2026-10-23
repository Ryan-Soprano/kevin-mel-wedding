# Private guest-save operational signals

Guest save outcomes and deliberate retries keep their existing v1 semantics. No operational status is exposed through a public read endpoint, and no new database migration is required.

The application observes unexpected technical failures of guest contribution creation, upload permission and finalization requests. It excludes ordinary validation, permission, conflict, expiry and rate-limit responses, configured upload pauses, disabled audio/storage admission and normal finalization backpressure. Capacity refusals and actual database/storage failures remain actionable. The existing private readiness console supplies read-only database availability, schema and original/staging reservation warnings, including the 80% warning boundary.

## Negative upload signal

`POST /api/contributions/{contributionId}/memories/{memoryId}/upload-failures` accepts only this JSON body:

```json
{"grantId":"00000000-0000-4000-8000-000000000000"}
```

The request uses the existing `X-Api-Contract: 1`, guest `Idempotency-Key`, same-origin and JSON boundary. Bodies are limited to 1,024 bytes, including chunked requests. A separate signal throttle permits at most 600 global, 300 peer and 12 retry-key attempts per 15-minute window; it does not consume save, permission, finalization or receipt allowances. Only a real guest contribution, matching memory, retry capability and issued grant created within the preceding hour can signal. Purging/purged memories and expired deletion deadlines are excluded. Unknown capabilities receive the existing opaque 404 response.

A valid report or duplicate returns `204` with `Cache-Control: no-store`. The report neither writes application records nor changes upload state, receipt, retention, original bytes or retry permissions. Reports for an already uploaded original are ignored. Accepted reports are deduplicated per grant in a bounded in-process table. A client report means **upload unconfirmed**; it does not establish provider failure or data loss.

The photo and audio coordinators send this fixed report after a failed direct storage PUT or PUT deadline. They never send filenames, guest content, URLs, raw provider errors or arbitrary categories. Reporting is best effort with a separate two-second abort deadline, is never awaited by the original save, and cannot replace its error or alter its retained draft/retry state. Preflight expiry, server finalization errors and deliberate disposal do not send a client transport report. A disconnected or closed browser may not deliver a report; there is no background retry or offline reporting guarantee.

## Private publication

`MEMORY_ARCHIVE_OPERATIONAL_SIGNALS_ENABLED` defaults to `false`. Enabling publication requires a valid Render commit identity and the precreated application-owned `/home/archive/.operations` directory with mode `0700`. Every 30 seconds the application atomically replaces the owner-only `guest-signals.json` file with mode `0600` and a maximum size of 4,096 bytes. Links, loose permissions and unexpected owners are refused. Publication never changes `/api/health`, restarts the application, opens a listener or performs provider writes. Missing/stale publication must be treated as unconfirmed observation, including when local publication fails.

The private JSON has exactly `schemaVersion` (1), `bootId` (random UUID), `startedAt`, `observedAt`, `renderCommit` and `categories`. UTC timestamps contain three fractional digits. The fixed category names are `GUEST_API_5XX`, `GUEST_MEDIA_5XX` and `CLIENT_UPLOAD_UNCONFIRMED`. Each contains only a cumulative nonnegative `count` and `lastObservedAt` (UTC timestamp or null). The media category is a subset of the API category. Counts saturate rather than overflow and restart with a new process/boot identity. No guest or grant identifier is persisted in this file.

The independent operator collector must bind its private SSH read to the exact running instance/artifact, verify owner/mode/type/size/schema/freshness and retain incident state across process resets, regressions and gaps. A restart cannot erase an earlier incident or establish recovery. Only a separately accepted collector, publication route and delivered incident/recovery verification complete automatic alert acceptance. Quiet application counters alone do not establish storage-provider health, independent backup acceptance or successful guest preservation.
