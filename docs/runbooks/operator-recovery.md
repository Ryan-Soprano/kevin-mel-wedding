# Operator export and isolated recovery — OPS-02

Ryan is the sole operator for backups, privileged exports, restore destinations and provider credentials. Kade may review code and synthetic fixtures; Kevin and Melanie retain moderation and publication authority. This procedure does not create provider resources or enable production collection.

## Scope and access

`com.kevinmel.archive.recovery.RecoveryAdministration` is an offline console. It starts no HTTP listener, Spring application, scheduler or migration, and exposes no operator role through the web application. Its versioned private directory package preserves note/photo/audio archive data and exact verified originals. It is **sensitive operator recovery material**, not the couple's self-service export (ARC-05).

Reviewed V9 databases export package **version 2**. Audio metadata preserves the guest duration claim separately from the verified original's duration in whole milliseconds, container and codec. Version 2 reports pending/failed **media** counts across photos and audio. The console still exports exact reviewed V8 databases as version 1 and accepts their original strict format into either a V8 target or a reviewed V9 target. A V1-to-V9 import supplies null audio columns; version 1 never permits AUDIO memories or extra audio fields. Version 2 cannot restore into V8. Unsupported versions, changed migration history or unreviewed schema columns fail closed.

Metadata includes contribution/memory/asset IDs, names, notes, captions, original filenames, grouping/order, creation fingerprints, **raw guest retry capabilities**, review revisions, deletion deadlines/tombstones, upload-grant reservations, review audit and erased-key reservations. Keep packages outside the repository, web roots, shared downloads, sync folders and screenshots. Use an operator-owned private parent on an encrypted volume and a reviewed encrypted independent recovery copy. Never paste package content, credentials, JDBC errors or signed URLs into logs, Git, Notion or this chat.

Accounts/password hashes, sessions, throttle buckets, application settings, provider credentials and temporary staging bytes are excluded. Restore requires separate reviewed account/configuration recovery with reveal closed. Preserve review actor UUIDs as historical references; importing audit data does not create accounts or grant authority. A hosted PostgreSQL backup is still required for full database disaster recovery and the five-minute database RPO; this archive package supplements that backup.

## Consistency and unfinished uploads

Stop source collection and private traffic, scheduled retention and finalization before export. An upload pause alone does not stop notes, existing grants or finalization. Stop the application, wait at least five minutes for every issued PUT permission to expire, and verify no other writer or maintenance process is running. The exporter rejects unexpired grant metadata. Its repeatable-read database snapshot cannot enforce quiescence on a separately running application or object store.

The manifest links each verified original to its memory/asset IDs, exact byte length, MIME and SHA-256. Version 2 also links audio duration, container and codec to the metadata. Files use server-owned asset IDs, never untrusted original filenames. It reports unfinished/failed photo and audio intents explicitly and preserves their metadata and expired grant reservations; staging objects are not durable saved originals and are not exported. These memories remain unfinished after restore. Guests need their original files to deliberately resume/reupload; recovery cannot recreate bytes never confirmed saved.

A missing, wrong-size, wrong-checksum, invalid or unavailable verified original makes the export unready. Audio bytes are decoded again and must match the stored verified duration, container and codec. Inspect the private manifest and fix the source, then create a **new** export directory. Never interpret a successful metadata copy or pending intent as a saved memory. A current, validated independent deletion record may exempt that erased original during restoration; unrelated missing originals still block recovery.

## Build and export

Use the existing Java 25/Maven classpath instructions in [account access](account-access.md#build-and-launch-locally), keeping compiled classes and dependencies from the same reviewed build. Substitute `com.kevinmel.archive.recovery.RecoveryAdministration` for the account console class:

Original verification reuses the actual image decoder and pixel/dimension limits. Use the established 2 GB process budget / 1536 MiB Java heap when testing maximum-size originals; the earlier 1 GB heap failed on the extreme lossy WebP fixture. Do not infer whole-archive timing or hosted capacity from small recovery fixtures. The examples below leave Java sizing to the reviewed runtime; add `-Xmx1536m` when running the bounded maximum-image acceptance exercise.

Audio verification requires the reviewed FFmpeg and FFprobe runtime. Set `MEMORY_ARCHIVE_FFMPEG` and `MEMORY_ARCHIVE_FFPROBE` to its executables when they are not on PATH. Missing or unconfirmed decoder execution cannot establish a ready export containing audio. Restoration verifies the bundle's exact audio bytes and metadata before any target mutation, then verifies the published target original again. Original WebM/Opus, Ogg/Opus and MP4/AAC bytes remain unchanged; recovery never transcodes or substitutes the client duration claim for decoded duration.

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.recovery.RecoveryAdministration --help
```

The console reads `application.properties` plus private process environment/JVM overrides; profile files are not loaded. Configure the verified source with the existing `MEMORY_ARCHIVE_DB_*`, `MEMORY_ARCHIVE_ENVIRONMENT`, `MEMORY_ARCHIVE_STORAGE_ENABLED=true` and `MEMORY_ARCHIVE_R2_*` settings. Nonlocal export requires explicit database URL, username and password. Verify the real database/bucket privately; an environment label is not a target identity.

Only after source quiescence is established, set `MEMORY_ARCHIVE_RECOVERY_QUIESCED=true` in this isolated console process. Choose a new directory in the approved private backup location:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.recovery.RecoveryAdministration --expect-environment local export "$archive_private_backup_directory"
```

Type `export quiescent archive in local` when prompted. Substitute the configured environment for nonlocal operation. Never redirect command input or bypass `System.console()`; use an interactive Windows Terminal/Git Bash console as documented for account administration. Console output contains counts and readiness only. The tool refuses an existing output directory. Failed work may leave a private incomplete directory; never publish it or claim it as verified. Keep its source unchanged until verification succeeds.

## Restore with current deletion evidence

1. Keep source and destination traffic/maintenance stopped. Preserve the **current independent** `deletions/v1/` authority and recovery copy. Never replace that ledger with an older package. If it is lost or its freshness cannot be established, keep recovery closed and resolve the authority first.
2. Prepare a separate isolated database and private storage bucket through the approved infrastructure process. Apply the reviewed migrations recorded by the package, or reviewed V9 when importing an exact V1/V8 package through the supported compatibility path. The tool does not migrate or clear a target. Archive content tables must be empty; explicit DB settings are required even for `local`. Source and target provider endpoint/bucket must differ.
3. Configure the **destination** using the standard `MEMORY_ARCHIVE_DB_*` and `MEMORY_ARCHIVE_R2_*` settings. Configure separate `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_ENDPOINT`, `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_BUCKET`, `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_ACCESS_KEY_ID` and `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_SECRET_ACCESS_KEY` for authenticated read access to the current source ledger. Use read-only source credentials where available. The console mechanically rejects source ledger writes/deletes and binds the authority endpoint/bucket digest to the originating package. This version requires that original authoritative source identity to remain available or be reconstructed with complete current evidence. A ledger copy relocated to a different bucket cannot substitute directly; total source-bucket loss and independent-copy recovery still need reviewed operational acceptance.
4. Verify both real targets and quiescence privately, set `MEMORY_ARCHIVE_RECOVERY_QUIESCED=true`, and invoke the reviewed console:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.recovery.RecoveryAdministration --expect-environment local restore "$archive_private_backup_directory"
```

5. Type `restore quiescent archive in local`. The tool verifies bounded package structure, hashes, schema, row counts, original integrity and authoritative deletion identities before committing archive rows. Current authority must preserve every packaged tombstone. It copies allowed originals to the isolated target, preserves independent deletion evidence there and reuses the reviewed retention replay before commit. Records newer than the package scrub restored content; records for contributions absent from the package still reserve erased retry keys.
6. Verify record counts with expected deletion effects, relationships, revisions, unfinished states and retained reservation accounting. Check every restored original's size/MIME/hash through authenticated provider IO. Confirm erased originals are absent, erased notes/captions are scrubbed, erased guest retries cannot create new content and unrelated siblings remain intact. Reconcile export time against the desired recovery point. Prepare reviewed current accounts/settings/session behavior with reveal closed. Reopening traffic is a separate operational readiness decision after every check succeeds.

Safe target SQL reports aggregate counts without dumping content or capabilities:

```sql
SELECT 'contribution' AS entity, COUNT(*) FROM contribution
UNION ALL SELECT 'memory', COUNT(*) FROM memory
UNION ALL SELECT 'media_asset', COUNT(*) FROM media_asset
UNION ALL SELECT 'upload_grant', COUNT(*) FROM upload_grant
UNION ALL SELECT 'review_audit', COUNT(*) FROM review_audit
UNION ALL SELECT 'deletion_ledger', COUNT(*) FROM deletion_ledger
UNION ALL SELECT 'erased_submission_key', COUNT(*) FROM erased_submission_key;

SELECT memory_type, review_status, purged_at IS NOT NULL AS purged, COUNT(*)
FROM memory GROUP BY memory_type, review_status, purged_at IS NOT NULL;

SELECT upload_state, COUNT(*), SUM(COALESCE(expected_byte_size, byte_size)) AS reserved_original_bytes
FROM media_asset GROUP BY upload_state;

SELECT COUNT(*) AS grant_count, COALESCE(SUM(a.expected_byte_size), 0) AS reserved_staging_bytes
FROM upload_grant g JOIN media_asset a ON a.id = g.media_asset_id;
```

Compare these with the private manifest/metadata and exact current-ledger effects; replay can reduce asset/grant counts and increase deletion/key reservations. Aggregate counts alone do not verify original bytes or deletion completeness. Do not use `SELECT *` as routine diagnostics.

Unknown, malformed, future or mismatched ledger evidence blocks restoration. Any storage/database failure keeps success unconfirmed. Database import rolls back on confirmed pre-commit failure; partial isolated object copies or ledger writes may remain and must be verified before retry. Retry uses the same immutable package against the same still-empty isolated database. R2 recovery PUT uses `If-None-Match: *`; a conflict succeeds only after authenticated size/MIME and exact-byte comparison. Never overwrite a different existing original or automatically delete unrecognized target data. A transport failure around commit may have committed: inspect counts privately rather than clearing/retrying a populated target. Do not reopen traffic on a nonzero result.

## Location, retention and recovery targets

Before collection, Ryan must record the approved private backup location, encrypted independent copy, restore destination access and test schedule in private operator configuration. This repository deliberately contains no production credentials or backup path. Package format/version and nonsecret verification evidence belong in Notion; guest content and credentials do not.

The console applies owner-only permissions before writing package content and rejects filesystems where private permissions cannot be established. Choose an encrypted private parent first; permissions do not provide encryption. It does not schedule copies or prune exported directories. Ryan must enforce and verify the 30-day expiry of every contribution-bearing package, incomplete export and recovery copy using the approved backup policy.

| Requirement | Operator evidence required before launch |
|---|---|
| Wedding database RPO ≤ 5 minutes | Approved hosted PostgreSQL recovery mechanism, actual recovery points and an isolated restoration showing the last recoverable committed fixture lies within five minutes. A manually quiesced archive export does not establish continuous database RPO. |
| Wedding RTO ≤ 1 hour | Timed complete recovery, including DB/media, current ledger, verification, configuration and readiness, at representative archive size. Small local fixtures establish functional behavior only. |
| Normal-operation RPO/RTO ≤ 24 hours | Verified recurring DB/media backup and complete timed recovery. Document interruptions and operator coverage. |
| Contribution-bearing backups expire after 30 days | Enforced expiry on every primary/recovery copy, including provider DB backups and incomplete exports. Verify the policy actually removes expired contribution-bearing copies. Content-free independent tombstones/retry reservations remain for archive lifetime. |
| Independent recovery copy | Verified encrypted operator-only copy in a separate failure domain, restore access and current ledger recovery/merge; never rely on the live bucket as its sole recovery copy. |
| Operator recovery access | Ryan alone, least necessary source/destination permissions, credential recovery and audited private access; no production access delegated to development or couple application roles. |

Actual provider restore/delete behavior, hosted scheduling, alerts (OPS-03), backup retention and these operational targets remain release acceptance. Audio now participates in synthetic original-preserving export, restoration and current-ledger erasure tests. Repeat the procedure with accepted physical-device originals before audio collection is enabled; synthetic decoder/recovery tests do not establish phone recording behavior or hosted recovery capacity.
