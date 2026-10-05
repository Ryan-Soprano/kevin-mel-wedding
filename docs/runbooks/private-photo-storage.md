# Private photo storage — MED-01

Prepared 2026-10-05. Ryan reported that no private R2 test bucket exists yet. These are operator setup instructions, **not evidence of provisioning or deployment**. Use synthetic photos first. Production collection still needs the security, operations, and release tasks in Notion.

## What the application does

The browser retains one original file, computes SHA-256, and creates a photo intent using one UUID-v4 retry key. PostgreSQL stores the envelope, ordered memories, and expected metadata atomically. A receipt at this stage is `PENDING`, not saved.

The server signs a PUT for a unique `staging/<grant UUID>` key, its declared Content-Type, and at most five minutes. Finalization reads at most 10,000,001 bytes, verifies size, SHA-256, actual JPEG/PNG/WebP decoding and dimension limits, and writes those exact verified bytes to a separate `originals/<asset UUID>` key. It commits `UPLOADED` before returning a complete receipt. No resizing, re-encoding, or metadata stripping occurs; originals can therefore retain EXIF and location metadata.

R2 presigned URLs can be reused until expiry. A browser grant never targets the saved original, so later staging replacements cannot change it. Size and SHA-256 are verified by the server; the signed URL itself does not enforce a byte-size ceiling. See [Cloudflare presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). Shared-network rate limits and abuse controls remain SEC work before public collection.

## Ryan's setup steps

1. In Cloudflare, choose the intended account and open **R2 object storage**. Create a separate synthetic test bucket with Standard storage and the ordinary global S3 endpoint. The application currently accepts `https://<32-character-account-id>.r2.cloudflarestorage.com`; jurisdiction-specific endpoints need a separately reviewed configuration change. See [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/).
2. In the bucket's Settings, keep its **Public Development URL disabled** and attach **no public custom domain**. Never use a public bucket to resolve a CORS error. Check private access again before collecting any guest photo. See [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
3. Create an R2 API token with **Object Read & Write**, scoped only to this test bucket. Store its Access Key ID and Secret Access Key in your password manager, then supply them only to the backend environment. An application object token does not need bucket-management privileges. See [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).
4. Add the following bucket CORS policy for local Vite. Replace/add origins only for environments you deliberately approve. A phone testing URL needs its own exact HTTPS origin. CORS permits the browser PUT; it does not make objects public. See [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "http://127.0.0.1:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 300
  }
]
```

5. Under Settings → **Object Lifecycle Rules**, add a deletion rule named `expire-temporary-photo-uploads`, prefix **`staging/`**, after **one day**. Preserve other existing rules. Do not apply this rule to `originals/` or to an empty prefix. Deletion is asynchronous; it is not a grant revocation mechanism. See [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Backend configuration

Keep the default `MEMORY_ARCHIVE_STORAGE_ENABLED=false` until the bucket/token/CORS are ready. Disabled storage returns safe `503 MEDIA_UNAVAILABLE` for photo creation/grants; text still works. `/api/health` is not storage readiness. Enabling storage validates configuration at startup; connectivity and permissions are tested by actual IO.

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

## Real R2 and phone acceptance — still outstanding

Use a trustworthy HTTPS test environment approved by Ryan. Plain HTTP on a LAN is insufficient for the Web Crypto checksum on a phone. OPS-01 owns the deployment/HTTPS path; do not bypass certificate warnings. Keep the physical device test separate from the synthetic contract preview.

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

4. Download the `originals/…` object through Cloudflare's authenticated dashboard, or an already approved authenticated S3 client. Compare it with the input using Git Bash `sha256sum input.png downloaded.png` and `cmp -- input.png downloaded.png`. Verify size/hash match database metadata. Authorized operator retrieval is infrastructure access; a couple inbox/playback endpoint is not implemented yet.
5. Restart Spring with the same database and bucket. The same key/body must replay the same IDs and `COMPLETE`; the downloaded original must remain byte-identical.
6. Interrupt the response after PUT and after successful finalize. Keep the page open; deliberately retry. It must reconcile the same intent/grant, not create another memory. Wait more than five minutes with an unfinished intent, then retry to renew only the grant. Repeated taps must coalesce.
7. Confirm unsigned S3 GET of the known original is denied and both public bucket mechanisms remain disabled. Confirm the upload grant cannot GET/delete an object, change the key or Content-Type, or target `originals/`. A disallowed browser origin must fail CORS. Never record the signed URL in evidence.
8. Record evidence on MED-01 and in `docs/api/v1/photo-verification.md`. Keep MED-01 unfinished until real R2, retrieval comparison, phone, restart, and privacy evidence is present. Synthetic tests do not prove these checks.

## Cleanup, recovery, and retention

Expired grant rows remain available for safe reconciliation; successful finalize replay still works after expiry. Lifecycle cleanup removes only staging candidates. A removed candidate can be re-uploaded with a fresh grant and the same intent. There is no scheduled cleanup job in MED-01.

An original PUT can succeed before a database commit fails. This leaves a private object with an unfinished database state. Retry the same item before deleting anything: it verifies the same expected hash and republishes identical bytes to the same original key. Failure never yields a saved acknowledgment.

For abandoned intents/orphan originals, prepare an operator candidate report only after a minimum 24-hour quiet period. Reconcile bucket keys with `media_asset.object_key`, grant expiry, and item state. Preserve every `UPLOADED` original and every item with a live grant. Perform any eventual deletion during a controlled maintenance window with uploads paused, recheck associations/states immediately before deletion, and obtain explicit approval for the concrete candidate list. Row timestamps alone are not enough to prove inactivity. Remove expired grant rows before asset/memory/envelope rows if an approved cleanup proceeds; foreign keys intentionally prevent blind cascading deletion. Backup/restore and retention policy remain OPS work.

If credentials are exposed, Ryan should revoke the bucket-scoped token and replace backend secrets. Existing signed URLs can remain effective until provider revocation/expiry; do not log or distribute them. No guest content, retry key, URL, SQL parameters, or storage diagnostics should enter application analytics.
