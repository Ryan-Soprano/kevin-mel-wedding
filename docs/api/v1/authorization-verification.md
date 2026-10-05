# AUTH-02 authorization and private media verification

Locally verified on 2026-10-05 after Ryan authorized AUTH-02, building on AUTH-01 on `feature/secure-sessions`. Ryan subsequently authorized commit/push; these local checks were completed beforehand. No deployment, new dependency, real account, invitation, provider configuration or real R2 request occurred. Real R2 setup and Docker verification remain deferred until Ryan returns home.

## Implemented behavior

`GET /api/memories/{memoryId}/playback` accepts API contract version 1 and returns exactly `url` and `expiresAt`. The browser supplies a memory UUID; the server selects the original object from PostgreSQL. Query/body options cannot choose a bucket, key, filename, MIME type or link duration.

The existing HTTP security chain revalidates authenticated identity before private routing. `ArchiveAuthorization` additionally enforces the boundary inside `PlaybackService`: authentication must use an `ArchivePrincipal`, the account must still be enabled with matching username/role/credential version, and both the authenticated authorities and reveal policy must permit couple access. Anonymous/stale credentials return 401 AUTH_REQUIRED; wrong authority or closed reveal returns 403 ARCHIVE_UNAVAILABLE. These checks precede media lookup and storage calls, including direct service invocation outside HTTP.

`PlaybackRepository` joins the memory, contribution and media asset and requires:

- The wedding event, `COUPLE_ONLY` visibility, and `PHOTO` type.
- Review status `PENDING`, `KEEP` or `ARCHIVED` and committed `UPLOADED` state.
- Verified JPEG/PNG/WebP MIME, a positive size at most 10 MB, and expected size/checksum/type matching the verified metadata.
- The exact key `originals/<that asset's UUID>`.

Missing, wrong-event, TEXT/AUDIO, unfinished/failed, deleted, unsupported or mismatched records return the same safe 404 without storage access. Audio retrieval remains unavailable until AUD-03 supplies verified audio handling. DELETE playback fails closed; later INB-02 restoration must restore an eligible review state before new issuance. No existing migration was rewritten and no new migration is required for this task.

`R2ObjectStorage.authorizeRead` performs authenticated HEAD on the selected original and checks its reported size and MIME. This is a metadata/existence check, not a new cryptographic verification of the bytes; upload integrity comes from MED-01's checksum and decoder verification before publication. Missing, denied, unavailable or inconsistent originals return safe 503 MEDIA_UNAVAILABLE. Database/transaction failures use safe 503 SERVICE_UNAVAILABLE.

The SDK signs one HTTPS GET for the exact object, with verified content type, a generated safe photo filename, and `Cache-Control: no-store`. New originals also store no-store metadata during publication. Lifetime is bounded to 300 seconds and the request's remaining duration; the response uses the SDK's actual signed expiry. Read and upload grant `toString()` methods redact URLs. API responses/errors carry no-store caching and request correlation; no signed URL is stored in PostgreSQL, receipts, logs or tracker evidence.

## Capability and role boundaries

A signed URL is a reusable bearer capability: anyone who possesses it can access the selected object until its expiry. Logout, password recovery, account disabling or closing reveal prevents new issuance; it does not revoke an already-issued URL or an in-progress download. An authorization already in flight can also complete while a later account/media change occurs. Downloaded bytes cannot be erased by no-store or application logout. [Cloudflare's presigned-URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) describes this model and reuse until expiry.

Production Kevin/Melanie identities alone receive couple access. Operator/developer roles cannot obtain private retrieval or moderation authority. Couple credentials do not expose account administration, provider operations, logs, backups, billing or recovery endpoints; administration remains a console utility. Unknown application object/provider paths remain denied. Tests of application paths are not proof that a real bucket's public access is disabled.

The bucket must remain private, with r2.dev/public custom domains disabled. Signed links use the R2 S3 API endpoint. CORS controls which browser origins may read a response; it does not authenticate possession of a bearer link. The future player must omit application credentials/authorization/CSRF/retry headers, use no-referrer, retain URLs only in memory and refresh them after expiry. No playback UI was added here.

## Local verification results

| Verification | Result and scope |
|---|---|
| Backend package and focused suite | **55 passed:** SessionHttpTest 40, R2ObjectStorageTest 10, photo validation 4 and health 1. All existing test sources compiled. |
| Existing security test expansion | Preserved all 22 AUTH-01 regressions and added 18 AUTH-02 tests: private route/role/reveal/stale-session denial, direct service authorization, exact playback DTO and server key, malformed IDs/contracts/metadata, safe outages, and denial of application object/provider paths. Review denial uses valid CSRF so token failure cannot conceal missing authorization. |
| Existing SDK/storage test expansion | Original staging PUT and bounded server IO checks retained. Added real synthetic GET signing with mocked HEAD, exact scope and HEAD-before-sign ordering, actual expiry bounds, MIME/size/key/time rejection, missing/mismatched/null metadata, storage/signing failures, unsafe signer results, disabled storage, no-store publication and URL redaction. |
| Native PostgreSQL 18.4 | **52 assertions passed:** actual eligibility SQL for valid review states and all ineligible fixture types/keys/claims; actual account/service role, reveal and credential-version gates; no storage call after denied eligibility. Synthetic fixtures only. |
| Actual HTTP and existing frontend adapter | **178 assertions passed:** actual Spring/session/SQL/service/SDK signing with mocked HEAD, exact HTTPS playback decoding and headers, all ineligible records, anonymous/role/object/provider denial, public guest receipt privacy, logout/recovery/disable revocation and disabled-storage 503. No fixture URL was fetched from R2. |
| Independent review | No remaining material AUTH-02 correctness/security issue identified in the implemented code and documentation. |

The native and HTTP harnesses remain under ignored `backend/target/`; no additional committed test files were added for AUTH-02. HTTP fixture HEAD responses were synthetic, while authentication, PostgreSQL queries, HTTP transport, the existing JavaScript adapter and AWS SDK signing were real. These checks do not claim provider enforcement of signature tampering, actual link expiry, bucket privacy or CORS.

Frontend behavior was not changed; its existing adapter was exercised against the real endpoint. The preceding AUTH-01 frontend lint, 73 tests and production build passed. Inbox/list/detail/review controller success and audio playback remain later work; current tests protect their route boundaries without claiming those features exist.

## Remaining acceptance

Keep AUTH-02 in Review until the full existing Docker/Testcontainers PostgreSQL 17 suite and real R2/browser acceptance pass. Docker is unavailable on the work computer; native PostgreSQL 18 checks supplement that suite. The [private storage runbook](../../runbooks/private-photo-storage.md#authenticated-photo-playback--auth-02-home-acceptance) contains the home checklist for authenticated HEAD, signed GET, byte/hash comparison, exact-origin CORS, tampered/wrong-object/method refusal, expiry and unsigned public-access denial. Production HTTPS/proxy verification remains with the authorized deployment process.

Repeat the focused repository checks with Java 25 and Maven 3.9.16:

```text
mvn -Dtest=SessionHttpTest,HealthControllerTest,PhotoValidationTest,R2ObjectStorageTest package
```

With Docker available, run the normal full Maven test suite. Real R2 checks must use synthetic content and record only nonsensitive outcomes; never paste signed URLs, credentials or hashes into Git, Notion, logs or screenshots.
