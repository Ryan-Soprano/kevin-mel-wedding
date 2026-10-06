# Private photo storage — MED-01 and AUTH-02

Prepared 2026-10-05. Ryan has configured a test bucket and completed desktop PNG operator comparison/restart/replay and scripted real-R2 JPEG/WebP upload, recovery and grant checks; the [verification record](../api/v1/photo-verification.md) contains the evidence and limits. The setup steps below remain the reusable operator procedure; staging lifecycle/bucket settings, JPEG/WebP operator reread and physical-device checks are not yet verified. Use synthetic photos first. Production collection still needs the security, operations, and release tasks in Notion.

## What the application does

The browser retains one original file, computes SHA-256, and creates a photo intent using one UUID-v4 retry key. PostgreSQL stores the envelope, ordered memories, and expected metadata atomically. A receipt at this stage is `PENDING`, not saved.

The server signs a PUT for a unique `staging/<grant UUID>` key, its declared Content-Type, and at most five minutes. Finalization reads at most 10,000,001 bytes, verifies size, SHA-256, actual JPEG/PNG/WebP decoding and dimension limits, and writes those exact verified bytes to a separate `originals/<asset UUID>` key. It commits `UPLOADED` before returning a complete receipt. No resizing, re-encoding, or metadata stripping occurs; originals can therefore retain EXIF and location metadata.

R2 presigned URLs can be reused until expiry. A browser grant never targets the saved original, so later staging replacements cannot change it. Size and SHA-256 are verified by the server; the signed URL itself does not enforce a byte-size ceiling. See [Cloudflare presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). Shared-network rate limits and abuse controls remain SEC work before public collection.

AUTH-02 adds `GET /api/memories/{memoryId}/playback` for an eligible verified PHOTO original. Each request rechecks the couple account and reveal gate, verifies the original's size/MIME through authenticated storage HEAD, and signs a single-object HTTPS GET over the S3 API for at most 300 seconds. The returned expiry is the signature's actual expiry. Unfinished/failed uploads, TEXT/AUDIO, missing or wrong-event memories and DELETE items return safe 404. Eligible originals missing or unavailable at storage return 503 MEDIA_UNAVAILABLE. Inbox/list/detail/review, audio and the playback UI remain later work; DELETE playback stays blocked until the future INB-02 restore flow restores an item. See [authorization verification](../api/v1/authorization-verification.md).

A playback URL is a reusable bearer permission for anyone who obtains it until its own expiry. Logout, recovery, disablement or closing reveal prevent new issuance, but do not revoke existing URLs or an in-progress download. `no-store` does not erase downloaded bytes. Keep originals and staging private with `r2.dev` and public custom domains disabled. The later playback UI must omit app credentials, use `no-referrer` and never persist/log signed URLs.

## Ryan's setup steps

1. In Cloudflare, choose the intended account and open **R2 object storage**. Create a separate synthetic test bucket with Standard storage and the ordinary global S3 endpoint. The application currently accepts `https://<32-character-account-id>.r2.cloudflarestorage.com`; jurisdiction-specific endpoints need a separately reviewed configuration change. See [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/).
2. In the bucket's Settings, keep its **Public Development URL disabled** and attach **no public custom domain**. Never use a public bucket to resolve a CORS error. Check private access again before collecting any guest photo. See [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
3. Create an R2 API token with **Object Read & Write**, scoped only to this test bucket. Store its Access Key ID and Secret Access Key in your password manager, then supply them only to the backend environment. An application object token does not need bucket-management privileges. See [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).
4. Add the following bucket CORS policy for local Vite. Replace/add origins only for environments you deliberately approve. A phone testing URL needs its own exact HTTPS origin. CORS permits browser PUT/GET and controlled HEAD checks; it does not make objects public or extend a signature's operation. Server-side authenticated HEAD does not depend on browser CORS, and a signed GET cannot be reused as a signed HEAD. See [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "http://127.0.0.1:5173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 300
  }
]
```

5. Under Settings → **Object Lifecycle Rules**, add a separate deletion rule named `expire-temporary-photo-uploads`, prefix **`staging/`**, after **one day**. Preserve the existing default seven-day incomplete-multipart abort rule and all other unrelated rules; aborting an incomplete multipart upload does not delete completed staging objects. Ryan approved this exact rule on October 5; its saved enabled state, prefix and one-day action were inspected in the test bucket. Actual asynchronous lifecycle deletion has not been observed. Do not apply it to `originals/` or to an empty prefix. Deletion is asynchronous; it is not a grant revocation mechanism. See [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Backend configuration

Keep the default `MEMORY_ARCHIVE_STORAGE_ENABLED=false` until the bucket/token/CORS are ready. Disabled storage returns safe `503 MEDIA_UNAVAILABLE` for photo creation/grants and otherwise eligible photo playback; text still works. `/api/health` is not storage readiness. Enabling storage validates configuration at startup; connectivity and permissions are tested by actual IO.

For reusable local setup, run `bash scripts/configure-local-r2.sh` from the repository root. It prompts for the endpoint and private test bucket, reads both keys silently, and saves Bash-escaped exports to ignored `.env.r2.local` without overwriting an existing file. Run `source .env.r2.local` in each backend terminal before starting Spring. Exporting variables alone stores them only in that terminal and its child processes; Spring does not save them. Keep the file local and never copy its contents into evidence.

In **Git Bash**, set only nonsensitive configuration literally. Read credentials silently so they do not enter shell history:

```bash
export MEMORY_ARCHIVE_STORAGE_ENABLED=true
export MEMORY_ARCHIVE_R2_ENDPOINT='https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
export MEMORY_ARCHIVE_R2_BUCKET='YOUR_PRIVATE_TEST_BUCKET'
read -rsp 'R2 Access Key ID: ' MEMORY_ARCHIVE_R2_ACCESS_KEY_ID
printf '\n'
export MEMORY_ARCHIVE_R2_ACCESS_KEY_ID
read -rsp 'R2 Secret Access Key: ' MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY
printf '\n'
export MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY
./backend/mvnw -f backend/pom.xml spring-boot:run
```

Start the existing local PostgreSQL first, as described in the root README. Do not put credentials in `VITE_*`, source files, screenshots, Notion, chat, query URLs, or committed `.env` files. This application does not load a shell `.env` automatically. Stop Spring and unset the two credential variables when finished. A deployed backend should receive them through its approved secret environment settings. Provisioning and deployment still require Ryan's approval.

The backend uses AWS SDK v2 region `auto`, path-style requests, fixed-length PUTs, and checksums only when required by S3. It verifies SHA-256 itself instead of relying on optional R2 checksum headers. [Cloudflare's Java example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-java/) documents disabling chunked encoding for R2.

## Real R2 and phone acceptance — partially verified

Use a trustworthy HTTPS test environment approved by Ryan. The October 5 Render dashboard check found only the deployed `kevinandmel-coming-soon` static service, which does not run the React/Spring photo app; no full-app HTTPS staging URL is verified. The [OPS-01 staging runbook](staging-deployment.md) now supplies locally verified combined packaging, a temporary operator gate and the manual setup/approval handoff; it still requires approved capacity, actual provider setup, backend/test DB and exact-origin R2 CORS before phone acceptance. Plain HTTP on a LAN is insufficient for the [Web Crypto checksum](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest) on a phone. Do not bypass certificate warnings. Keep the physical device test separate from the synthetic contract preview.

1. Retain a known JPEG, PNG, and WebP input with its original size and SHA-256. On iPhone Safari, choose a supported file, enter a synthetic name/caption, and submit through the actual wedding form. Repeat on Android Chrome when a tester is assigned. HEIC selection must explain the supported formats.
2. Observe `PENDING` intent, staging PUT, finalize, then a private saved confirmation. Verify that only a complete receipt triggers success. Record OS/browser, format, date, and outcome without guest data or signed links.
3. Using local `psql` or `docker compose exec postgres psql -U memory_archive -d memory_archive`, inspect this synthetic asset by its memory UUID:

```sql
SELECT c.id, m.id, m.client_item_id, m.review_status, m.visibility,
       a.object_key, a.original_filename, a.detected_format,
       a.byte_size, a.checksum_sha256, a.upload_state
FROM contribution c JOIN memory m ON m.contribution_id=c.id
JOIN media_asset a ON a.memory_id=m.id
WHERE m.id='YOUR_SYNTHETIC_MEMORY_UUID';
```

4. Download the `originals/…` object through Cloudflare's authenticated dashboard, or an already approved authenticated S3 client. Compare it with the input using Git Bash `sha256sum input.png downloaded.png` and `cmp -- input.png downloaded.png`. Verify size/hash match database metadata. Authorized operator retrieval is infrastructure access. AUTH-02 separately implements couple-authorized photo playback issuance; its real R2 acceptance is below, and the inbox/viewer UI remains pending.
5. Restart Spring with the same database and bucket: leave Vite and the photo page open, stop Spring with Ctrl+C in its Git Bash terminal, then run `./backend/mvnw -f backend/pom.xml spring-boot:run` in that same shell so its exported credentials remain available. Repeat the scoped SQL query and download/hash comparison for the same original. This proves existing identity/state and retrieval survive an application restart. Separately, a retained same-key/body API request must replay the same IDs and `COMPLETE`; the saved form has no retry action, and refreshing/reselecting a photo creates a new intent rather than proving replay.
6. Interrupt the response after PUT and after successful finalize. Keep the page open; deliberately retry. It must reconcile the same intent/grant, not create another memory. Wait more than five minutes with an unfinished intent, then retry to renew only the grant. Repeated taps must coalesce.
7. Confirm unsigned S3 GET of the known original is denied and both public bucket mechanisms remain disabled. Confirm the upload grant cannot GET/delete an object, change the key or Content-Type, or target `originals/`. A disallowed browser origin must fail CORS. Never record the signed URL in evidence.
8. Record evidence on MED-01 and in `docs/api/v1/photo-verification.md`. Keep MED-01 unfinished until real R2, retrieval comparison, phone, restart, and privacy evidence is present. Synthetic tests do not prove these checks.

## Authenticated photo playback — AUTH-02 home acceptance

Run these checks after Ryan finishes the private synthetic bucket setup at home. Use a disposable enabled synthetic COUPLE account in local/staging with reveal explicitly open; do not provision real couple accounts or send invitations. Keep downloaded synthetic files separate from the repository and do not paste signed URLs, cookies, CSRF tokens or credentials into chat, Notion, screenshots, shell history or saved evidence. Local fixtures are not proof of these provider checks.

October 5 home progress: Ryan saved the ignored local credentials file. The integrated Docker image passes actual R2 JPEG/PNG/WebP finalization, authenticated HEAD, byte-identical signed GET, signature scope and actual five-minute expiry, unsigned-access denial and session revocation checks with a disposable database. See the [dated authorization evidence](../api/v1/authorization-verification.md#real-r2-verification--2026-10-05). The subsequent dashboard inspection confirms PUT/GET/HEAD for the two exact local origins, a test-bucket-only Object Read & Write token, disabled public development URL and no public custom domain. The controlled Windows browser now reads the exact signed original bytes successfully. The enabled one-day staging-only lifecycle rule is configured as recorded above. The eventual exact hosted HTTPS origin and physical-device acceptance remain open.

1. Verify both bucket public mechanisms remain disabled: no `r2.dev` URL and no public custom domain. Confirm unsigned S3 GET and HEAD of the known original and staging object are denied. The app must use the configured S3 HTTPS endpoint rather than either public mechanism.
2. Finalize a known synthetic JPEG, PNG and WebP using the existing upload path. Use the approved authenticated S3 client to confirm HEAD reports the same byte count and MIME as the database. Confirm the application token has only the intended bucket's read/write permissions. The token stays in the backend environment.
3. Through the real session adapter, sign in to the synthetic couple account and request `GET /api/memories/{memoryId}/playback` with `X-Api-Contract: 1`. Check that its response is `no-store`, that the URL signs GET for this single original, and that `expiresAt` equals the signature's real expiry within 300 seconds. Requesting unfinished/failed, TEXT/AUDIO, wrong-event/missing or DELETE items must return 404 without issuing a URL. For a disposable eligible row whose original is missing, verify safe 503 MEDIA_UNAVAILABLE; restore the fixture before further checks.
4. In a controlled browser check from an approved exact app origin, fetch the signed object with application credentials omitted, `no-referrer`, and no session/CSRF/retry/authorization headers. Verify real GET succeeds under the bucket CORS policy and its downloaded bytes/hash match the original. A disallowed origin must fail CORS. If separately testing browser HEAD, use an authenticated/independently signed HEAD for the synthetic object; the GET URL does not authorize that operation. The private playback UI is not implemented yet, so record this as provider/browser acceptance.
5. In memory only, change the signed path to another synthetic original or staging object, alter a signature parameter, and attempt a different method. Each must fail; the unchanged GET URL must still access only its intended original. Neither the upload PUT grant nor the playback GET link should authorize the other's operation, deletion or another object.
6. Reuse the unchanged GET link before its own expiry, then wait past the returned `expiresAt` and verify a new GET is denied. Obtain a new link through the authenticated app endpoint to confirm renewal requires current account/reveal access. Do not save expired URLs as evidence.
7. Using separate disposable sessions/fixtures, verify logout, password recovery, disabling the account and closing reveal prevent new issuance. A previously issued link may still GET until its own expiry; an in-progress download is not revoked. This is the documented bearer boundary, not a failed session revocation. Clearing app state or `no-store` cannot erase already downloaded bytes.
8. Record only nonsensitive outcomes, browser/OS, date, bounded expiry and synthetic fixture labels on AUTH-02 and in `docs/api/v1/authorization-verification.md`. Keep real R2 acceptance pending until these checks pass. Run the full Docker/PostgreSQL 17 backend suite separately; R2 acceptance does not replace it.

## Cleanup, recovery, and retention

Expired grant rows remain available for safe reconciliation; successful finalize replay still works after expiry. Lifecycle cleanup removes only staging candidates. A removed candidate can be re-uploaded with a fresh grant and the same intent. There is no scheduled cleanup job in MED-01.

An original PUT can succeed before a database commit fails. This leaves a private object with an unfinished database state. Retry the same item before deleting anything: it verifies the same expected hash and republishes identical bytes to the same original key. Failure never yields a saved acknowledgment.

For abandoned intents/orphan originals, prepare an operator candidate report only after a minimum 24-hour quiet period. Reconcile bucket keys with `media_asset.object_key`, grant expiry, and item state. Preserve every `UPLOADED` original and every item with a live grant. Perform any eventual deletion during a controlled maintenance window with uploads paused, recheck associations/states immediately before deletion, and obtain explicit approval for the concrete candidate list. Row timestamps alone are not enough to prove inactivity. Remove expired grant rows before asset/memory/envelope rows if an approved cleanup proceeds; foreign keys intentionally prevent blind cascading deletion. Backup/restore and retention policy remain OPS work.

If credentials are exposed, Ryan should revoke the bucket-scoped token and replace backend secrets. Existing signed URLs can remain effective until provider revocation/expiry; do not log or distribute them. No guest content, retry key, URL, SQL parameters, or storage diagnostics should enter application analytics.
