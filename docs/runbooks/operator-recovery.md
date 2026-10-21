# Operator export and isolated recovery — OPS-02

Ryan is the sole operator for backups, privileged exports, restore destinations and provider credentials. Kade may review code and synthetic fixtures; Kevin and Melanie retain moderation and publication authority. This procedure does not create provider resources or enable production collection.

The [October 20, 2026 hosted rehearsal](recovery-rehearsal-2026-10-20.md) records the completed independent-copy archive restoration, timing, cleanup and remaining acceptance limits. It supplements this procedure; it does not establish full database recovery or continuous RPO/RTO coverage.

## Scope and access

`com.kevinmel.archive.recovery.RecoveryAdministration` is an offline console. It starts no HTTP listener, Spring application, scheduler or migration, and exposes no operator role through the web application. Its versioned private directory package preserves note/photo/audio archive data and exact verified originals. It is **sensitive operator recovery material**, not the couple's self-service export (ARC-05).

Reviewed V9 databases export package **version 2**. Audio metadata preserves the guest duration claim separately from the verified original's duration in whole milliseconds, container and codec. Version 2 reports pending/failed **media** counts across photos and audio. The console still exports exact reviewed V8 databases as version 1 and accepts their original strict format into either a V8 target or a reviewed V9 target. A V1-to-V9 import supplies null audio columns; version 1 never permits AUDIO memories or extra audio fields. Version 2 cannot restore into V8. Unsupported versions, changed migration history or unreviewed schema columns fail closed.

Reviewed V10 databases export **version 3**, preserving couple/guest source, historical author UUIDs and optional titles, descriptions and year/month/day memory dates. Exact v1/V8 and v2/V9 packages can also restore into reviewed V10, supplying `GUEST`, null author/details/date and `UNKNOWN` date precision. Version 3 requires V10 and cannot restore into V8/V9. Historical authors are preserved exactly, like review audit actors; they do not create accounts or provide current authority. See the [ARC-01 contract](../api/v1/couple-memories.md).

Reviewed V11 databases export **version 4**, also preserving private albums, UUID organization revisions, content-free deleted album identities and ordered many-to-many memberships. Exact reviewed v1/v2/v3 packages restore into V11 with empty album tables. Version 4 requires V11 and cannot restore into V8–V10; legacy targets are inspected and locked using their own reviewed table lists. The full album/membership graph is validated before destination writes. See the [ARC-02 contract](../api/v1/albums.md).

Reviewed V12 databases export **version 5**, preserving private timeline events, exact/partial/unknown dates, event and list revisions, scrubbed tombstones and many-to-many memory links. Exact reviewed v1–v4 packages restore into V12 with empty timeline tables; version 5 requires V12 and cannot restore into an older target. Timeline state is created lazily, so a freshly migrated V12 archive remains empty. The entire event/state/member graph is validated before destination writes. See the [ARC-03 contract](../api/v1/timeline.md).

Reviewed V13 databases export **version 6**, preserving private tags, tag revisions, scrubbed tombstones and many-to-many memory associations. Exact reviewed v1–v5 packages restore into V13 with empty tag tables; version 6 requires V13 and cannot restore into an older target. No tag singleton is seeded. Full tag graph validation precedes destination writes, and the installed reviewed target determines locks, empty-table checks, import and erasure replay. See the [ARC-04 contract](../api/v1/library.md).

Reviewed V14 databases export **version 7**, preserving memory audiences and the before/after audiences in review audit. Exact reviewed v1–v6 packages can restore into V14; their memories and historical audit audiences remain `COUPLE_ONLY`. Version 7 requires V14 and cannot restore into V8–V13. Private-link token digests in `memory_share_link` are deliberately excluded from every package. That table must also be empty in a V14 destination; issue any needed private links again after recovery. Restored `PUBLIC` and `FRIENDS_FAMILY` audiences preserve the couple's decisions, while current independent erasure still takes precedence. See the [sharing contract](../api/v1/sharing.md).

Reviewed-schema checks compare ordered Flyway history and canonical migration checksums/fingerprints, plus known column names, PostgreSQL type families and nullability. They do not verify type modifiers, indexes, constraints, defaults or unrelated tables. Matching these checks does not establish provider durability or release readiness.

Memory Delete removes album links; Restore does not silently rejoin collections. Current independent memory tombstones also remove restored links, leaving siblings, order and empty albums intact. Album-only deletion preserves memories and has no independent deletion ledger: an older valid package can restore earlier album organization or names. Do not claim that memory erasure evidence permanently erases album-only organization across older backups.

The same memory-erasure authority removes timeline links and refreshes affected event/list revisions. Restore does not relink a memory to events. Event-only deletion preserves originals and has no independent event-deletion ledger; an older valid package can restore earlier event metadata or organization while current memory erasure remains authoritative.

It also removes tag associations and refreshes affected tag revisions while preserving unrelated labels and sibling memories. Restore does not reattach tags. Tag-only deletion preserves originals and has no independent tag-deletion ledger; older valid packages can restore earlier labels or organization without bypassing current memory erasure.

Metadata includes contribution/memory/asset IDs, names, notes, captions, original filenames, grouping/order, creation fingerprints, **raw guest retry capabilities**, review revisions, deletion deadlines/tombstones, upload-grant reservations, review audit and erased-key reservations. Keep packages outside the repository, web roots, shared downloads, sync folders and screenshots. Use an operator-owned private parent on an encrypted volume and a reviewed encrypted independent recovery copy. Never paste package content, credentials, JDBC errors or signed URLs into logs, Git, Notion or this chat.

Accounts/password hashes, sessions, throttle buckets, application settings, provider credentials and temporary staging bytes are excluded. Restore requires separate reviewed account/configuration recovery with reveal closed. Preserve review actor UUIDs as historical references; importing audit data does not create accounts or grant authority. A hosted PostgreSQL backup is still required for full database disaster recovery and the five-minute database RPO; this archive package supplements that backup.

## Consistency and unfinished uploads

Stop source collection and private traffic, scheduled retention and finalization before export. An upload pause alone does not stop notes, existing grants or finalization. Stop the application, wait at least five minutes for every issued PUT permission to expire, and verify no other writer or maintenance process is running. The exporter rejects unexpired grant metadata. Its repeatable-read database snapshot cannot enforce quiescence on a separately running application or object store.

The manifest links each verified original to its memory/asset IDs, exact byte length, MIME and SHA-256. Versions 2–7 also link audio duration, container and codec to the metadata. Files use server-owned asset IDs, never untrusted original filenames. It reports unfinished/failed photo and audio intents explicitly and preserves their metadata and expired grant reservations; staging objects are not durable saved originals and are not exported. These memories remain unfinished after restore. Authors need their original files and matching retry identity to deliberately resume/reupload; recovery cannot recreate bytes never confirmed saved.

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
2. Prepare a separate isolated database and private storage bucket through the approved infrastructure process. Apply the reviewed migrations recorded by the package, or reviewed V9/V10/V11/V12/V13/V14 through the supported upward compatibility paths above. The tool does not migrate or clear a target. Archive content tables, including `memory_share_link` for V14, must be empty; explicit DB settings are required even for `local`. Source and target provider endpoint/bucket must differ.
3. Configure the **destination** using the standard `MEMORY_ARCHIVE_DB_*` and `MEMORY_ARCHIVE_R2_*` settings. Configure separate `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_ENDPOINT`, `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_BUCKET`, `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_ACCESS_KEY_ID` and `MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_SECRET_ACCESS_KEY` for authenticated read access to the current source ledger. Use read-only source credentials where available. The console mechanically rejects source ledger writes/deletes and binds the authority endpoint/bucket digest to the originating package. This version requires that original authoritative source identity to remain available or be reconstructed with complete current evidence. A ledger copy relocated to a different bucket cannot substitute directly; total source-bucket-loss recovery from that relocated authority remains unsupported. The completed independent archive-copy rehearsal still used the original current authority.
4. Verify both real targets and quiescence privately, set `MEMORY_ARCHIVE_RECOVERY_QUIESCED=true`, and invoke the reviewed console:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.recovery.RecoveryAdministration --expect-environment local restore "$archive_private_backup_directory"
```

5. Type `restore quiescent archive in local`. The tool verifies bounded package structure, hashes, schema, row counts, original integrity and authoritative deletion identities before committing archive rows. Current authority must preserve every packaged tombstone. It copies allowed originals to the isolated target, preserves independent deletion evidence there and reuses the reviewed retention replay before commit. Records newer than the package scrub restored content; records for contributions absent from the package still reserve erased retry keys.
6. Verify record counts with expected deletion effects, relationships, revisions, unfinished states and retained reservation accounting. Check every restored original's size/MIME/hash through authenticated provider IO. Confirm erased originals are absent, erased notes/captions/titles/descriptions/dates are scrubbed, erased retry identities cannot create new content and unrelated siblings remain intact. Reconcile export time against the desired recovery point. Prepare reviewed current accounts/settings/session behavior with reveal closed. Reopening traffic is a separate operational readiness decision after every check succeeds.

For current V14 targets, safe SQL reports aggregate counts without dumping content or capabilities. Omit sharing, tag, timeline or album rows when inspecting a reviewed older target:

```sql
SELECT 'contribution' AS entity, COUNT(*) FROM contribution
UNION ALL SELECT 'memory', COUNT(*) FROM memory
UNION ALL SELECT 'media_asset', COUNT(*) FROM media_asset
UNION ALL SELECT 'upload_grant', COUNT(*) FROM upload_grant
UNION ALL SELECT 'review_audit', COUNT(*) FROM review_audit
UNION ALL SELECT 'deletion_ledger', COUNT(*) FROM deletion_ledger
UNION ALL SELECT 'erased_submission_key', COUNT(*) FROM erased_submission_key
UNION ALL SELECT 'album', COUNT(*) FROM album
UNION ALL SELECT 'album_membership', COUNT(*) FROM album_membership
UNION ALL SELECT 'timeline_event', COUNT(*) FROM timeline_event
UNION ALL SELECT 'timeline_event_memory', COUNT(*) FROM timeline_event_memory
UNION ALL SELECT 'timeline_state', COUNT(*) FROM timeline_state
UNION ALL SELECT 'tag', COUNT(*) FROM tag
UNION ALL SELECT 'memory_tag', COUNT(*) FROM memory_tag
UNION ALL SELECT 'memory_share_link', COUNT(*) FROM memory_share_link;

SELECT memory_type, review_status, purged_at IS NOT NULL AS purged, COUNT(*)
FROM memory GROUP BY memory_type, review_status, purged_at IS NOT NULL;

SELECT upload_state, COUNT(*), SUM(COALESCE(expected_byte_size, byte_size)) AS reserved_original_bytes
FROM media_asset GROUP BY upload_state;

SELECT COUNT(*) AS grant_count, COALESCE(SUM(a.expected_byte_size), 0) AS reserved_staging_bytes
FROM upload_grant g JOIN media_asset a ON a.id = g.media_asset_id;
```

Compare these with the private manifest/metadata and exact current-ledger effects; replay can reduce asset/grant counts and increase deletion/key reservations. Aggregate counts alone do not verify original bytes or deletion completeness. Do not use `SELECT *` as routine diagnostics.

Unknown, malformed, future or mismatched ledger evidence blocks restoration. Any storage/database failure keeps success unconfirmed. Database import rolls back on confirmed pre-commit failure; partial isolated object copies or ledger writes may remain and must be verified before retry. Retry uses the same immutable package against the same still-empty isolated database. R2 recovery PUT uses `If-None-Match: *`; a conflict succeeds only after authenticated size/MIME and exact-byte comparison. Never overwrite a different existing original or automatically delete unrecognized target data. A transport failure around commit may have committed: inspect counts privately rather than clearing/retrying a populated target. Do not reopen traffic on a nonzero result.

### Hosted setup and source-authority safeguards

When a separately reviewed setup helper uses `COMMENT ON DATABASE` to mark an owned rehearsal target, read that shared-object comment with `shobj_description(database_oid, 'pg_database')`, not `obj_description`. PostgreSQL databases are shared objects; see the [PostgreSQL 17 comment functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-COMMENT-TABLE). In the October 20 rehearsal, the incorrect reader rejected a target after creation/commenting had already succeeded. Read-only inspection confirmed its exact owner/marker, distinct identity and pristine schema before a separately guarded command applied V1–V14. Never blindly repeat creation, reuse an unverified database or clear an ambiguous target after a setup failure.

Capture and verify source-ledger authority settings separately **before** applying destination process overrides. Shell prefix assignments can expand a value from the existing environment and accidentally alias the source bucket to the destination. Probe the effective source/destination identities privately before the real restore; retain the isolation guard and typed confirmation. A configured environment name or a quiescence flag does not establish either identity or actual stopped writers.

## Location, retention and recovery targets

Before collection, Ryan must record the approved private backup location, encrypted independent copy, restore destination access and test schedule in private operator configuration. This repository deliberately contains no production credentials or backup path. Package format/version and nonsecret verification evidence belong in Notion; guest content and credentials do not.

The console applies owner-only permissions before writing package content and rejects filesystems where private permissions cannot be established. Choose an encrypted private parent first; permissions do not provide encryption. It does not schedule copies or prune exported directories. Ryan must enforce and verify the 30-day expiry of every contribution-bearing package, incomplete export and recovery copy using the approved backup policy.

The dated rehearsal records the separate local expiry helper's 33 controls, synthetic task check and active task's first actual sweep, all passing. Both task runs were started on demand through Windows Task Scheduler with `Start-ScheduledTask`; they establish the installed launch path/result, not automatic hourly/logon firing. The enrolled archive retains its original capture time in an immutable expiry receipt and becomes eligible for removal at 29 days without resetting age; the helper preserves the separate lifetime ledger. This Limited/Interactive task is configured hourly and at operator logon with catch-up/wake, no startup trigger and no stored password. It requires Ryan logged in and the Windows host, private drive and reviewed runtime available. Read its private instructions/status and preserve failure/late/unmanaged-item latches. Its first passing sweep does not establish logout/reboot/offline behavior, continuous availability or expiry of any other backup copy; those requirements remain open.

The [October 21 home verification](home-recovery-verification-2026-10-21.md)
adds fresh ciphertext authentication, trusted plaintext-digest checks and an
observed hourly execution with result 0, unchanged archive/receipt/ledger and
clean incident latches. No manual start was invoked by that observer; disabled
task history prevented a separate trigger-reason event. It also records additive
portable escrow work. These checks do not establish continuous DB backup,
current ledger-copy freshness, offline availability or full RPO/RTO acceptance.

The later [October 21 full-database feasibility test](full-database-recovery-feasibility-2026-10-21.md)
accepted three independent encrypted database copies and verified one isolated
restoration of all 19 tables and reviewed catalog definitions. It uses an online
read-only exported snapshot rather than this quiescent archive console. The
bounded manual freshness observation does not establish an unattended schedule
or continuous RPO. Database restoration alone omits media, current independent
deletion replay, configuration/access reconciliation and running-app readiness;
complete one-hour RTO and recovery on another physical host remain open.

| Requirement | Operator evidence required before launch |
|---|---|
| Wedding database RPO ≤ 5 minutes | Approved hosted PostgreSQL recovery mechanism, actual recovery points and an isolated restoration showing the last recoverable committed fixture lies within five minutes. A manually quiesced archive export does not establish continuous database RPO. |
| Wedding RTO ≤ 1 hour | Timed complete recovery, including DB/media, current ledger, verification, configuration and readiness, at representative archive size. Small local fixtures establish functional behavior only. |
| Normal-operation RPO/RTO ≤ 24 hours | Verified recurring DB/media backup and complete timed recovery. Document interruptions and operator coverage. |
| Contribution-bearing backups expire after 30 days | Enforced expiry on every primary/recovery copy, including provider DB backups and incomplete exports. Verify the policy actually removes expired contribution-bearing copies. Content-free independent tombstones/retry reservations remain for archive lifetime. |
| Independent recovery copy | Verified encrypted operator-only copy in a separate failure domain, restore access and current ledger recovery/merge; never rely on the live bucket as its sole recovery copy. |
| Operator recovery access | Ryan alone, least necessary source/destination permissions, credential recovery and audited private access; no production access delegated to development or couple application roles. |

The dated hosted rehearsal verifies authenticated original reads, isolated recovery writes and cleanup for the actual small staging archive. Guest PUT/CORS/grant-expiry/retry behavior, representative capacity, full database recovery, recurring scheduling, alerts (OPS-03), backup retention and the broader operational targets remain release acceptance. Audio also participates in synthetic original-preserving export, restoration and current-ledger erasure tests. Repeat with accepted physical-device originals before audio collection is enabled; decoder/recovery checks do not establish phone recording behavior or representative hosted recovery capacity.
