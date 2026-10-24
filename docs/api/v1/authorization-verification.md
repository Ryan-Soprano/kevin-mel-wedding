# AUTH-02 authorization and private media verification

Locally verified on 2026-10-05 after Ryan authorized AUTH-02, building on AUTH-01 on `feature/secure-sessions`. Ryan subsequently authorized commit/push; these local checks were completed beforehand. No deployment, new dependency, real account, invitation, provider configuration or real R2 request occurred. Historical work-computer results are below; home reconciliation and PostgreSQL 17 evidence are recorded separately.

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

A signed URL is a reusable bearer capability: anyone who possesses it can access the selected object until its expiry. Logout, password recovery or account disabling prevents new issuance for that identity; closing reveal blocks couples, and removing the configured operator name blocks that operator after restart with the new server configuration. These controls do not revoke an already-issued URL or an in-progress download. An authorization already in flight can also complete while a later account/media change occurs. Downloaded bytes cannot be erased by no-store or application logout. [Cloudflare's presigned-URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) describes this model and reuse until expiry.

Production Kevin/Melanie identities retain reveal-gated couple access. The October 24 authorization additionally allows the separate exact enabled OPERATOR named by `MEMORY_ARCHIVE_OPERATOR_ADMIN_USERNAME` full private archive access before reveal; its default empty setting grants none. Other operators and all developers remain denied. Neither archive role exposes account administration, provider operations, logs, backups, billing or recovery endpoints; account administration remains a console utility. Unknown application object/provider paths remain denied. Historical results below cover the original default policy; see the [current account boundary](../../runbooks/account-access.md#account-boundaries). Tests of application paths are not proof that a real bucket's public access is disabled.

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

The native and HTTP harnesses were temporary local verification tools; no additional committed test files were added for AUTH-02. HTTP fixture HEAD responses were synthetic, while authentication, PostgreSQL queries, HTTP transport, the existing JavaScript adapter and AWS SDK signing were real. These checks do not claim provider enforcement of signature tampering, actual link expiry, bucket privacy or CORS.

Frontend behavior was not changed; its existing adapter was exercised against the real endpoint. The preceding AUTH-01 frontend lint, 73 tests and production build passed. Inbox/list/detail/review controller success and audio playback remain later work; current tests protect their route boundaries without claiming those features exist.

## Remaining acceptance

Keep AUTH-02 in Review until its remaining acceptance passes. The home PostgreSQL 17 full suite and subsequent real R2/browser checks now pass as recorded below; native PostgreSQL 18 checks remain supplemental. Bucket privacy, token scope and staging-only lifecycle configuration were inspected. Approved hosted HTTPS/device acceptance and the AUTH-01/MED-01 prerequisites remain open. The [private storage runbook](../../runbooks/private-photo-storage.md#authenticated-photo-playback--auth-02-home-acceptance) contains the complete checklist. Production HTTPS/proxy verification remains with the authorized deployment process.

Repeat the focused repository checks with Java 25 and Maven 3.9.16:

```text
mvn -Dtest=SessionHttpTest,HealthControllerTest,PhotoValidationTest,R2ObjectStorageTest package
```

With Docker available, run the normal full Maven test suite. Real R2 checks must use synthetic content and record only nonsensitive outcomes; never paste signed URLs, credentials or hashes into Git, Notion, logs or screenshots.

## Home reconciliation — 2026-10-05

The integrated branch includes current main `d48a8c8` and preserves its staging gate/finalization admission. **98 backend tests pass** with actual disposable PostgreSQL 17, including the complete 40-session/security suite and 10 SDK/storage tests. Added committed SQL regression coverage verifies eligible review states, deleted/wrong-event/missing items, unfinished upload, expected size/hash/MIME mismatches and wrong object keys. The frontend passes lint, **73 tests**, build and zero-vulnerability audit.

The default-deny security boundary now precedes resource resolution: anonymous requests admitted through the staging gate to unknown API/source/secret paths return safe `401 AUTH_REQUIRED`, with no-store JSON and no HTML fallback. Both packaged/container smoke helpers follow this boundary. Secure staging cookies and separate operator admission/couple sessions are documented. The separate real-provider checks below use Ryan's privately saved, ignored `.env.r2.local`; no synthetic/mock result closes a provider criterion.

The actual integrated Docker image smoke passes the real SQL/bcrypt session path, anonymous private-route denial, authorized missing-item 404, logout/version/disable revocation, independent staging admission and persisted throttling across app restart. No R2 IO occurs in that smoke.

## Real R2 verification — 2026-10-05

The same integrated Linux image was exercised against the existing private test bucket using a separate tmpfs PostgreSQL 17 database and an enabled synthetic couple account. Only this run's tiny synthetic JPEG, PNG and WebP were uploaded; existing application data and earlier acceptance fixtures were untouched. Credentials and grants stayed in process memory, with only nonsensitive outcomes recorded.

- All three formats completed real signed staging PUT, bounded server read/checksum/decode, original publication and committed UPLOADED receipts. Couple-authorized playback returned exactly `url` and `expiresAt`, with no-store headers. Actual authenticated original HEAD matched size/MIME; real signed GET returned byte-identical originals with the verified MIME and no-store.
- The returned expiry matched the provider signature's date and duration, within one second and at most 300 seconds. GET was reusable before expiry, including after logout, and a new GET after the actual five-minute expiry was rejected by R2. Changed object path/query and HEAD/PUT/DELETE reuse of the GET signature were rejected. Unsigned GET and HEAD of each owned staging/original object were denied.
- Anonymous/stale sessions returned safe 401, missing/deleted/unfinished/key-mismatched/claim-mismatched records returned safe 404, and a deliberately removed owned original returned safe 503 MEDIA_UNAVAILABLE. Logout and account disabling prevented new issuance.
- The bucket's existing PUT-only CORS policy omitted GET permission for `http://127.0.0.1:5173`. A real Codex in-app browser on Windows confirmed the signed-photo fetch was blocked; an unapproved origin received no CORS permission. Ryan was given the exact PUT/GET/HEAD policy adjustment. Browser success, token/public-domain/lifecycle configuration confirmation, authorized hosted HTTPS/device checks and final review remain open. This check does not implement the future playback UI.

All six owned synthetic staging/original objects and the temporary app/database/network were removed after the run; the existing database and earlier bucket objects were not touched. The temporary browser page and in-memory bridge were also removed. Provider checks passed; browser acceptance remains blocked by the concrete CORS setting above.

## Browser and bucket-setting follow-up — 2026-10-05

The later Cloudflare dashboard inspection confirms `PUT`, `GET` and `HEAD` for exactly `http://localhost:5173` and `http://127.0.0.1:5173`, with only `Content-Type` allowed and a 300-second CORS max age. The existing active Object Read & Write token applies only to the test bucket. Public development URL is disabled and there is no public custom domain. Ryan approved saving the enabled `expire-temporary-photo-uploads` rule: completed objects under `staging/` expire after one day. The original seven-day incomplete-multipart abort rule remains enabled; originals have no deletion rule. Actual asynchronous lifecycle deletion has not been observed.

The integrated image's isolated real-R2 harness was repeated with tiny synthetic JPEG/PNG/WebP fixtures. All three retained exact bytes through publication, authenticated HEAD and signed GET. Signature scope, unsigned-access denial, current-session gates, missing-object handling and actual five-minute expiry passed again. The controlled Windows Codex in-app browser fetched the signed JPEG with credentials omitted and `no-referrer`, and computed a matching SHA-256 in memory. An unapproved-origin request received no CORS permission. The earlier PUT-only browser failure is resolved.

Only the run-owned synthetic objects, app/database/network, browser probe file and in-memory bridge were removed. Existing database data and retained earlier fixtures were untouched. Hosted proxy/cookies, the eventual exact HTTPS CORS origin, physical devices and prerequisite acceptance remain open; no hosted application or real couple account was created.
