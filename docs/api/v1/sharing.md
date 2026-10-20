# Memory sharing

New contributions are `COUPLE_ONLY`. Sharing is an explicit decision by Kevin or Melanie after archive access opens.

`PATCH /api/memories/{memoryId}/review` accepts `reviewStatus` and optional `visibility`:

```json
{"reviewStatus":"KEEP","visibility":"FRIENDS_FAMILY"}
```

Audiences are `COUPLE_ONLY`, `FRIENDS_FAMILY`, and `PUBLIC`. A shared audience requires `KEEP`. Every other review state is private. Deleting revokes sharing immediately and retains the existing 30-day recovery interval; restoring returns the memory to private. Each mutation requires the current integer `If-Match`, contract version `1`, same-origin request, CSRF token, and current couple authority. A successful change advances the revision and audits the actor, prior/new audience and status.

Friends & Family uses a private link the couple can send. It is accessible to anyone holding the link; it is never listed publicly. After setting `FRIENDS_FAMILY`, authenticated `POST /api/memories/{memoryId}/share-link` (no body, the same mutation headers) returns:

```json
{"memoryId":"<uuid>","revision":3,"url":"/shared/<uuid>#token=<capability>"}
```

Every issuance replaces the previous link and advances the memory revision. Keep the returned revision for the next mutation. The capability contains 256 random bits, stays in the page fragment, and only its SHA-256 digest is stored. Changing audience, archiving, deleting, or keeping private revokes the existing link. A couple account cannot obtain a link for a private, public, deleted, expired, purging or unavailable memory.

Guest read endpoints are:

- `GET /api/shared-memories?limit=20&cursor=...`: public memories only, with `{items, nextCursor}`; maximum page size 100.
- `GET /api/shared-memories/{memoryId}?token=...`: a public memory or a Friends & Family memory with its current capability.
- `GET /api/shared-memories/{memoryId}/playback?token=...`: the same access rule, followed by a verified-original media grant.

Each shared item includes `memoryId`, `memoryType`, `textContent`, `caption`, `title`, `description`, `memoryDate`, `datePrecision`, `createdAt`, and nullable `media` containing `detectedContentType`, `byteSize`, `durationSeconds`. Guest names, filenames, contribution identifiers, upload retry capabilities, storage keys, checksums, private review metadata, and account identifiers are excluded. Notes, captions and metadata must render as text. Media must satisfy the existing committed upload, checksum, type, size, codec, duration and original-key rules.

Read responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; shared pages also discourage indexing. Unavailable, private, revoked, foreign-event, deleted, purging and unsafe media all return the same safe 404. A revoked share cannot receive new media grants; previously issued storage links expire within five minutes. Playback takes a memory lock before a fresh capability check, preventing a queued read from signing an old link after rotation commits.

The couple retains access to all audiences through inbox, library, album, timeline, playback and portable export. Flyway V14 adds sharing without changing earlier migrations. Recovery bundle version 7 preserves memory audiences and review-audit audiences; portable exports preserve memory audience metadata. Secret link capabilities are excluded from both; restored Friends & Family memories require freshly issued links. Exact reviewed recovery packages v1–v6 from V8–V13 databases can restore upward into reviewed V14 with private audiences; v7 requires V14. Follow the [operator recovery compatibility matrix](../../runbooks/operator-recovery.md#scope-and-access) for the installed target's validation, locks, empty-table checks and independent erasure authority.

These routes retain the test environment's existing staging admission protections. They do not send messages, publish to another service, or deploy the application.

## Local verification — October 14, 2026

The 397-test frontend suite passed, followed by focused sharing/view checks after the final layout changes; lint and the production build passed. Synthetic browser checks verified the immediate carousel, retained populated sign-in fields after switching tabs, private-link issuance/viewing, same-tab fragment replacement, public listing, revocation, recoverable deletion and private restoration. The finished memory view places the four audience/delete actions before expandable details and tags.

The focused PostgreSQL run passed all 27 checks, including sharing audience changes, link rotation/revocation, the queued playback capability race, V14 migration/defaults, and recovery without secret links. The runnable backend unit/security suite passed 231 cases with one platform skip. All production and test sources compiled. Full audio fixture coverage still requires FFmpeg/ffprobe, unavailable in this local session; no physical-device, provider, or hosted-deployment acceptance is claimed.

After Docker was available, the broader backend run completed 426 cases: 397 passed, two platform skips, no assertion failures, and 27 existing native audio fixture errors requiring unavailable FFmpeg. `AudioVerifierTest` was excluded from that broader run. Sharing/inbox/migration checks and readiness, portable-export and recovery checks without native audio completed successfully. Temporary test services and preview helpers were removed; the application was not deployed.

## Formal backend directory review — October 20, 2026

All six sharing production files, both existing package tests and their API,
security, frontend, review/playback, deletion, export and recovery consumers are
reviewed. No concrete behavior defect or measured performance problem is found.
The source change expands layout only, preserving exact SQL/wire values,
capability validation, guest privacy, authorization/error order, revision/audit
transactions and lock-before-fresh-capability playback. No migration, dependency,
recovery format or tracked test file is added.

The frozen baseline passes nine existing sharing package cases plus three
selected real HTTP/PostgreSQL sharing consumer cases, zero failures/errors/skips
and both exits 0. Existing frontend sharing, memory-review and archive-facade
compatibility tests pass 14 cases, zero failures/skips and exit 0. Strict AST
comparison passes all eight sources with 18 controls and malformed-input
rejection; exact disassembly comparison passes nine production and two test
classes. These mechanical checks have the limits recorded in
[the directory guide](../../development/directory-review.md#backend-sharing-verification--october-20-2026).

Baseline actual SonarJava reports zero selected findings across 128 MAIN inputs
(62 TEST inputs indexed); separate official Java CPD reports zero duplicated
groups across those production files. Unchanged parameters, tool/input identities,
controls, warnings and scope limits are recorded in that guide. Fresh final
compilation/classpath export exits 0; final actual SonarJava and official CPD
likewise remain at zero under the same settings. Independent final source
review is clear. The fresh full backend package exits 0 with `BUILD SUCCESS`
in 12:12: **474 total, 472 passed, zero failures/errors and two expected Windows
skips**, with no Surefire shutdown timeout. All 212 backend inputs and 367
compiled inputs retain frozen hashes; all 256 packaged production classes match
tested bytes and all 111 test/fixture identities/digests are excluded. This
checks direct classes/manifest, not nested dependencies or non-class resources.
Read-only cleanup confirms all 48 observed created containers and 25 logged
Spring-test JVM PIDs are absent, with no review-path Java process; unlogged/
native resources remain outside that claim. The Windows symlink cases require
Linux CI. Independent final source and documentation reviews are clear.

The October 14 results above remain historical evidence from that separate
snapshot. This local review does not establish live-provider, physical-device,
assistive-technology, hosted-capacity, operational-recovery or release acceptance.
