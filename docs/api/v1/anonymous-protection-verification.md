# SEC-01 note/photo protection verification

The guest note/photo paths now admit bounded work before JSON parsing or storage IO. This covers the existing wedding collection slice; audio and actual provider/device acceptance remain open. The code is in the primary checkout on `feature/anonymous-protections`.

## Request admission

V8 adds durable PostgreSQL counters without changing V1–V7. Each operation reserves its global bucket, captured servlet connection-peer bucket, then canonical UUID retry-key bucket. Domain-separated HMAC-SHA-256 uses the existing stable login-throttle secret; production requires at least 32 bytes. Neither raw addresses nor retry keys are stored in these counters. Forwarding headers cannot choose the captured peer. Behind a proxy, guests can share the proxy's bucket; this is intentional until actual hosted forwarding evidence exists.

| Operation | Global / 15 minutes | Shared connection / 15 minutes | Retry key / 15 minutes |
|---|---:|---:|---:|
| Note/photo intent creation | 800 | 400 | 12 |
| Upload permission | 1,500 | 1,000 | 40 |
| Photo finalization | 2,000 | 1,500 | 60 |
| Receipt reconciliation | 3,000 | 2,000 | 100 |

The accepted burst is 100 guests, one note and five photos each. Grouped photos mean 200 creation requests, 500 grants and 500 finalizations. The PostgreSQL workload test also admits same-key creation replay, grant/finalize retries and receipt reconciliation. This proves admission headroom, not 100 simultaneous mobile devices or provider throughput. A malicious guest can still exhaust a shared budget; Ryan can pause photo collection and inspect aggregate counters using the runbook.

Reservations use database time and row arbitration, survive application restarts and do not exceed the quota under concurrency. A denied child still consumes admitted parent scopes, bounding changing-key database growth. Maintenance prunes at most 1,000 counters older than a day per request. Database failure closes admission with safe `503 SERVICE_UNAVAILABLE`; exhausted quotas return `429 RATE_LIMITED`, remaining-window `Retry-After`, request ID and `no-store`.

Creation JSON is bounded to 65,536 bytes and finalization to 1,024 bytes, including chunked requests. Receipt/grant requests cannot carry bodies. Existing field validation, exact format/hash/size decoding, dimension bounds and server-generated UUID object keys remain enforced. Request bodies, filenames and literal markup cannot choose storage paths or execute as HTML.

## Media reservations and recovery

New photo intents reserve expected original bytes inside a PostgreSQL advisory transaction lock shared by all application instances. All unpurged assets count, including unfinished and soft-deleted items; confirmed purges release original reservations. Same-key equivalent replay does not reserve twice. The default original budget is 7.5 GB.

New upload permissions separately reserve expected staging bytes under the same database lock. Every retained grant counts against a default 7.5 GB staging budget, including expired grants: asynchronous provider lifecycle cleanup is not evidence of physical deletion. Live grant retries reuse the same ID/key/deadline, so recovery does not create another temporary object. Releasing staging reservations requires confirmed exact-object cleanup before removal of the corresponding expired grant rows. Capacity settings bound admitted reservations; they do not measure pre-existing/out-of-band provider objects or storage overhead.

R2 PUT signatures include the exact expected `Content-Length` and declared `Content-Type`, one server-generated staging key, and at most five minutes. JavaScript sends the original File and the content-type header; the browser supplies Content-Length. Local SDK tests check that size is signed and invalid scopes/sizes are rejected. Actual R2 wrong-size denial and browser compatibility must be repeated before enabling collection; historical R2 tests used the earlier signature.

`MEMORY_ARCHIVE_UPLOADS_PAUSED=true` rejects new photo intents and new permissions while retaining equivalent intent replays, unexpired grant-response recovery, receipts, text and finalization with an already issued grant. Original/staging capacity failures use safe `503 MEDIA_UNAVAILABLE` and `Retry-After: 60`. Decoder/publish concurrency is positive and bounded (default two, staging one); busy admission returns `503 MEDIA_UNAVAILABLE` and `Retry-After: 5` before image buffers or database locks. A permit is held through transactional commit/rollback and always released.

The note, single-photo and batch coordinators honor rate/service retry delays, retain immutable original input and retry identity, pause unsaved siblings when media service admission stops, and recover only on deliberate retry. Saved siblings remain saved. The server never acknowledges a photo as saved until verified original publication and database commit.

## Verification

The final complete local suite passes **223 backend tests** with zero failures/errors/skips, including actual PostgreSQL 17 HTTP/body admission, 100-guest quota headroom, durable/concurrent throttle reservations, V1 upgrade/restart and media capacity tests. Both original-create and different-asset staging-grant races cannot overbook the last bytes; an unexpired grant response can be recovered while paused. Existing image/integrity, account/reveal/revocation, private review and deletion-ledger regressions also pass. **231 frontend tests**, ESLint and production build pass, including real-adapter 429/503 recovery and private lifecycle/interrupted-sign-out regressions. Independent review's recovery/capacity findings are addressed. Provider and physical browser results below remain distinct.

Remaining acceptance: audio protection after AUD-03, actual R2 signed-length and physical-browser uploads, hosted/proxy origin behavior, reviewed provider lifecycle cleanup and operator monitoring, mobile/shared-network throughput, and production capacity/budget approval. Device/audio testing and paid hosting remain deferred at Ryan's request. No dependency, provider, real account or deployment is added by this work.

The combined application packaging command also passes, and the existing frontend dependency audit reports zero vulnerabilities. Packaging uses the final built frontend and compiles the backend; it skips tests, which were run separately above. The SEC change is stacked on the unmerged private-review-actions PR #21 so its review diff contains only the new protection/privacy work.

See the [guest protection runbook](../../runbooks/guest-protection.md) for pause, monitoring and cleanup, and [SEC-02 privacy verification](privacy-verification.md) for access/cache/shared-device evidence.
