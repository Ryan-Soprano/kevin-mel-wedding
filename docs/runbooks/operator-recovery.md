# Operator export and isolated recovery — OPS-02

Ryan is the sole operator for backups, privileged exports, restore destinations and provider credentials. Kade may review code and synthetic fixtures; Kevin and Melanie retain moderation and publication authority. This procedure does not create provider resources or enable production collection.

For the current deployment, maintenance state and ordered home-resume steps, start with the [primary handoff](../../HANDOFF-2026-10-19.md#1-resume-here). Keep the real home producer and live watchdog disabled until the activation evidence below is accepted.

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

Accounts/password hashes, sessions, throttle buckets, application settings, provider credentials and temporary staging bytes are excluded. Restore requires separate reviewed account/configuration recovery with reveal closed. Preserve review actor UUIDs as historical references; importing audit data does not create accounts or grant authority. A full PostgreSQL backup remains required for database disaster recovery and the measured wedding freshness target; this archive package supplements that backup.

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

**October 22 wedding policy update:** Ryan accepted unattended encrypted backups with Gmail alerts to his phone. Five-minute database recovery-point freshness is a measured operating target, not a guaranteed maximum data-loss window. Incident response and restoration are best effort when Ryan is available; the former one-hour wedding recovery requirement is superseded. The same home Windows laptop and existing recovery drive will travel to the wedding and remain available in a private room. No new paid resources are authorized. Durable verified backup receipts, independent original-media/current-deletion-ledger copies, 30-day contribution-bearing expiry, secret privacy and isolated local/CI verification remain required. Authorization does not establish that the automation is installed or working.

The console applies owner-only permissions before writing package content and rejects filesystems where private permissions cannot be established. Choose an encrypted private parent first; permissions do not provide encryption. It does not schedule copies or prune exported directories. Ryan must enforce and verify the 30-day expiry of every contribution-bearing package, incomplete export and recovery copy using the approved backup policy.

The dated rehearsal records the separate local expiry helper's 33 controls, synthetic task check and active task's first actual sweep, all passing. Both task runs were started on demand through Windows Task Scheduler with `Start-ScheduledTask`; they establish the installed launch path/result, not automatic hourly/logon firing. The enrolled archive retains its original capture time in an immutable expiry receipt and becomes eligible for removal at 29 days without resetting age; the helper preserves the separate lifetime ledger. This Limited/Interactive task is configured hourly and at operator logon with catch-up/wake, no startup trigger and no stored password. It requires Ryan logged in and the Windows host, private drive and reviewed runtime available. Read its private instructions/status and preserve failure/late/unmanaged-item latches. Its first passing sweep does not establish logout/reboot/offline behavior, continuous availability or expiry of any other backup copy; those requirements remain open.

The [October 21 home verification](home-recovery-verification-2026-10-21.md)
adds fresh ciphertext authentication, trusted plaintext-digest checks and an
observed hourly execution with result 0, unchanged archive/receipt/ledger and
clean incident latches. No manual start was invoked by that observer; disabled
task history prevented a separate trigger-reason event. It also records additive
portable escrow work. These checks do not establish continuous DB backup,
current ledger-copy freshness, offline availability or the current operating policy's unattended backup/alert acceptance.

The later [October 21 full-database feasibility test](full-database-recovery-feasibility-2026-10-21.md)
accepted three independent encrypted database copies and verified one isolated
restoration of all 19 tables and reviewed catalog definitions. It uses an online
read-only exported snapshot rather than this quiescent archive console. The
bounded manual freshness observation does not establish an unattended schedule
or continuing coverage of the five-minute freshness target. Database restoration alone omits media, current independent
deletion replay, configuration/access reconciliation and running-app readiness;
complete restoration and recovery on another physical host remain unproved, without a one-hour wedding guarantee.

| Requirement | Operator evidence required before launch |
|---|---|
| Wedding database freshness target: five minutes | Install and observe unattended encrypted captures, accepted durable receipts and independent-copy publication; measure actual recovery-point age and alert when stale, failed or missing. This is an operating target, not a hard data-loss guarantee. A timer or manually quiesced archive export alone does not establish coverage. |
| Wedding restoration: best effort when Ryan is available | Verify operator/portable-key access and a functional isolated restore, including DB/media, current ledger, configuration and readiness. Record measured recovery work and availability honestly; no one-hour wedding restoration promise remains. Privacy, deletion authority and reopening checks still apply. |
| Normal-operation RPO/RTO ≤ 24 hours | Verified recurring DB/media backup and complete timed recovery. Document interruptions and operator coverage. |
| Contribution-bearing backups expire after 30 days | Enforced expiry on every primary/recovery copy, including provider DB backups and incomplete exports. Verify the policy actually removes expired contribution-bearing copies. Content-free independent tombstones/retry reservations remain for archive lifetime. |
| Independent recovery copy | Verified encrypted operator-only copy in a separate failure domain, restore access and current ledger recovery/merge; never rely on the live bucket as its sole recovery copy. |
| Operator recovery access | Ryan alone, least necessary source/destination permissions, credential recovery and audited private access; no production access delegated to development or couple application roles. |

### Wedding automation activation — October 22

The status publisher (`scripts/backup-status.mjs`), independent watchdog (`scripts/backup-watchdog.mjs`) and scheduled workflow (`.github/workflows/backup-watchdog.yml`) are prepared with activation disabled until configured. They do not create a database/media backup. Private machine-local capture/crypto helper copies are present on this wedding laptop but excluded from Git. The former temporary SSH/client context is retired; a newly approved dedicated SSH route is registered and laptop source preflight passed. Actual producer integration, client/proof lifecycle and scheduled captures remain unaccepted. Git transfer alone cannot install or prove the producer. The local [issue 118](https://github.com/Ryan-Soprano/kevin-mel-wedding/issues/118) correction passed 20 Windows regressions and independent review. Delivery must pass current-head CI/configured review before installation; updated runner pin and remaining producer/copy/expiry gates still apply. See the [October 22 readiness review](../product/cutover-readiness-review-2026-10-22.md).

Before resuming captures at home, update every private backup, recovery and manual client that uses the replaced database credentials, then verify its required operations privately. Preserve the existing R2/encryption credentials and current deletion authority. Revoke the old database credentials only after affected clients and the current application have passed their checks. A local credential check or clean application startup does not prove complete backup or original-media coverage. Keep credential values and private endpoints outside this record.

Ryan intentionally removed test-only originals on October 22. Reconcile the affected database references, remaining objects and current deletion evidence through the approved procedures before accepting a new complete checkpoint or backup baseline. Report missing originals accurately; do not invent deletion evidence, reset the archive or silently treat missing objects as a complete copy. Preserve earlier dated restore results within their original scope.

1. On that laptop, verify the existing capture, encryption and expiry helpers, private runtime/drive access, least-privilege internal database route and recovery key. Keep database internet access closed. Preserve single-flight capture and expiry locking, original capture age, authenticated readback and durable receipts. A file's existence or process success alone is insufficient.
2. Connect scheduled capture to the status publisher only after the real encrypted copy is verified, durably published and expiry-enrolled. Measure DB freshness separately from independent original-media/current-ledger copy coverage; do not turn an unverified or DB-only result into a complete-backup success. Publish content-free status only to the private `feature/backup-status` branch at `ops/backup-status.json`, using the laptop's private Git authentication without checking out, resetting or force-pushing that branch. Record failures and gaps without refreshing the last accepted recovery point.
3. Configure the independent GitHub watchdog with read-only contents access and issue-write access to its dedicated private operations issue. The October 22 synthetic warning and recovery both reached Gmail and Ryan confirmed both iPhone notifications; their separate synthetic incident is cleared. Preserve that delivery evidence without repeating the pair solely for installation. The recipient-confirmed gate is recorded; live enable and host proof remain off, and the temporary test-budget gate was returned to false. After real home-producer receipts/copies/expiry pass and the actual included-usage/authorized-cap operating window is verified, live checks require `ARCHIVE_BACKUP_WATCHDOG_ENABLED`, `ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED`, `ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED` and `ARCHIVE_BACKUP_WATCHDOG_HOST_PROOF_CONFIRMED` all exactly `true`. Configure 300-second DB/media/ledger freshness thresholds and a 7200-second expiry-sweep threshold. The ten-minute schedule makes 144 checks/day; sub-minute private-repository Linux jobs can consume about 144 included minutes/day, with the three-minute job limit allowing about 432 runner minutes/day. There is no automatic end to an operating window: Ryan must return live enable to false at its recorded end. Scheduling and delivery are best effort; thresholds and explicit failures are assessed on the next executed check, not within a guaranteed five minutes. Test real stale/missing status, producer failure and recovery within that accepted window. A laptop-local alert cannot alone detect laptop loss. No guest data, backup paths, secrets, digests, capabilities or raw logs belong in published status or email; no R2/Gmail credentials belong in CI.
4. Use synthetic fixtures in isolated local/CI environments for implementation checks. Then observe bounded read-only live captures and real scheduled runs on the laptop, verify independent copies/expiry and a functional isolated restore, and record actual freshness and live alert evidence. Do not use the retained live archive for fixture writes, load tests or reset rehearsals. Until this evidence passes, the producer, recurring copies and live backup-condition monitoring remain unaccepted; the completed synthetic phone-delivery check is a separate result.
5. Before travel, record a verified checkpoint and any expected interruption. At the private-home venue, plug the laptop into power, prevent automatic sleep while plugged in, keep Windows signed in (the screen may be locked), attach the same recovery drive and verify the venue network. An open lid alone does not establish background availability. Verify a new scheduled accepted copy plus phone-alert delivery; this document changes no power settings. Record transit, sleep, restart, network and drive gaps honestly. Exceeding five minutes prompts an alert and best-effort operator assessment; this policy does not install an automatic all-writer stop. Stop collection when an incident requires it, using the existing maintenance/quiescence procedure rather than claiming upload pause stops every writer.

The opted-in private issue is prepared and must remain titled `Backup watchdog operations` with `<!-- kevin-mel-backup-watchdog:allow -->` in its body. Set its numeric issue number in `ARCHIVE_BACKUP_WATCHDOG_ISSUE`. The workflow names the four `ARCHIVE_BACKUP_WATCHDOG_*_MAX_AGE_SECONDS` variables explicitly; use `300` for `DATABASE`, `MEDIA` and `LEDGER`, and `7200` for `EXPIRY`. No recipient email address is stored in these variables. The confirmed synthetic issue-mention route does not establish delivery of failed-Actions notifications or other operational alert types; verify those separately. If notification routing changes, reverify affected delivery rather than inferring it from a successful API response.

Ryan completed the GitHub Pro upgrade on October 22. The later authenticated
readback showed 1,840/3,000 included Actions minutes used, 1,160 remaining at
inspection and $0 billable usage. His authorized Actions wedding-monitoring cap
is saved as $20 with stop-at-limit and budget alerts enabled. Account usage is
shared: record the actual monitoring end and recheck the allowance/cap. Keep
activation off until the operating window and producer/copy/host-proof gates
pass; this exception authorizes no other new resources or plan increases.

### Private coordinator contract

The runner configuration has exactly these 16 top-level keys. All paths and SHA-256 values below are placeholders, not a usable configuration; inspect the actual home helper interfaces and reviewed files before supplying private values. The five pins each contain exactly `path` and a 64-character lowercase hexadecimal `sha256`.

```json
{
  "schemaVersion": 1,
  "operatorSid": "S-1-5-21-<operator-SID>",
  "driveRoot": "X:\\",
  "privateWorkDirectory": "X:\\PRIVATE_WORK",
  "repositoryDirectory": "X:\\REVIEWED_REPOSITORY",
  "receiptPath": "X:\\PRIVATE_WORK\\producer-receipt.json",
  "statePath": "X:\\PRIVATE_WORK\\last-accepted-receipt.json",
  "lockPath": "X:\\PRIVATE_WORK\\capture.lock",
  "runtime": { "path": "C:\\REVIEWED_RUNTIME\\pwsh.exe", "sha256": "<reviewed-sha256>" },
  "node": { "path": "C:\\REVIEWED_RUNTIME\\node.exe", "sha256": "<reviewed-sha256>" },
  "producerAdapter": { "path": "X:\\PRIVATE_WORK\\producer-adapter.ps1", "sha256": "<reviewed-sha256>" },
  "publisher": { "path": "X:\\REVIEWED_REPOSITORY\\scripts\\backup-status.mjs", "sha256": "<reviewed-sha256>" },
  "runner": { "path": "X:\\REVIEWED_REPOSITORY\\scripts\\run-backup-job.ps1", "sha256": "<reviewed-sha256>" },
  "producerConfigurationPath": "X:\\PRIVATE_WORK\\producer-config.json",
  "timeoutSeconds": 120,
  "taskName": "KevinMelBackupCapture"
}
```

`operatorSid` must match the current Windows operator. `driveRoot` is an existing uppercase drive-letter root, and the private work directory must be on that drive. Receipt/state/lock paths must use exactly the three filenames above within that directory. Paths must be absolute local paths with no symlink, junction or other reparse ancestor. Private configuration, adapter, producer configuration and work/receipt files require operator ownership and restricted ACLs allowing only the operator, SYSTEM or local Administrators; the registrar also requires a protected configuration DACL. Preserve the laptop's existing private Git authentication and operator-owned work directory; put no tokens or storage/Gmail credentials in this JSON or CI.

Use a dedicated coordinator work directory, separate from all managed ciphertext/expiry inventory roots and the existing expiry lock. It also holds `failure-receipt.json` and temporary Git-index directories. The unavailable home expiry configuration cannot be inferred from this schema; inspect it and confirm separation before creating coordinator files or registering the task. The adapter must still use the existing expiry publication lock for actual backup enrollment.

The private adapter receives exactly one positional argument: the absolute `producerConfigurationPath`, launched by the pinned PowerShell runtime. It must call the inspected real helpers and write the strict `kevin-mel-backup-receipt` schema validated by `scripts/backup-status.mjs` at `receiptPath`. Database recovery-point/verification times, independent media/ledger verification and expiry health must attest actual accepted work. Do not generate a successful sample receipt or advance timestamps to simulate backup success. `timeoutSeconds` is an integer from 30 through 240 for the producer; failed or uncertain capture must not replace the last accepted receipt.

After preparing reviewed private paths, use only the read-only validation modes first:

```powershell
& $reviewedPwshPath -NoProfile -NonInteractive -File $reviewedRunnerPath -ConfigPath $privateJobConfiguration -ValidateOnly
& $reviewedPwshPath -NoProfile -NonInteractive -File $reviewedRegistrarPath -ConfigPath $privateJobConfiguration -ValidateOnly
```

Both require `BACKUP_JOB_CONFIGURATION_VALID` and exit 0; validation performs no capture, publication, state update or task registration. Installation remains a later deliberate step after producer/copy/expiry and alert evidence is accepted. The registrar refuses an existing `KevinMelBackupCapture` task and never replaces the existing expiry task. Its eventual capture task uses the current Interactive/Limited operator, no stored password, a two-minute trigger, `IgnoreNew`, catch-up/wake and hidden task/PowerShell windows. Execution is bounded by `timeoutSeconds + 480` seconds, at most 12 minutes, to allow validation and success/failure publication. A long run skips overlapping triggers; stale status still alerts through the independent watchdog, without a five-minute completion or notification guarantee.

The issue 118 correction assigns each child to a Windows kill-on-close Job
atomically during process creation, before the suspended child can execute.
Descendants remain contained; child output goes to NUL without pipe buffers,
and the capture lock/Job handle is not inherited. A surviving descendant makes
the child operation fail, and cleanup must confirm the Job is empty before
normal progress. An unsupported containment mechanism refuses the launch.

Before **any** child, including status publication, the coordinator holds its
exclusive `capture.lock` and writes and durably flushes `BACKUP_JOB_INFLIGHT`.
Only that run's marker is cleared after all child cleanup is confirmed. A crash,
failed durable write, nonempty marker or uncertain cleanup does not silently
resume capture; a later run refuses the nonempty lock even when the OS lock is
free. Preserve the marker and last accepted evidence, investigate local
descendants and remote capture/publication work, and independently confirm all
relevant work has stopped before deliberately clearing the existing marker.
Any forced child termination retains this uncertainty, even when the local
Job is confirmed empty: an already-submitted remote copy or Git push may still
be active. The coordinator preserves the marker and suppresses further failure
publication in that case. Confirm both local and remote completion independently.
Record that operator action and revalidate before a new capture. Never delete
the lock as a blanket retry fix or assume crash/restart guarantees automatic
resumption. Recheck real backup freshness and watchdog state after recovery.

October 22 implementation verification used Node 24.21.0 and PowerShell 7.6.5: 57 protocol/local-Git fixture checks and 24 coordinator/registrar checks passed. These cover a status-only remote tree, unchanged application index/HEAD, concurrent/refused pushes, preserved accepted evidence, strict pins/private configuration, duplicate keys, missing/stale/future receipts, single-flight locking and bounded child timeout/cleanup. In-memory watchdog checks covered incident/reminder/recovery, malformed or missing status, write failures, deduplication and synthetic/live isolation. That implementation exercise published no live status, registered no scheduled task and sent no notification. The later synthetic phone-delivery verification is credited above; the actual home producer and live monitoring remain unproved.

The later local issue 118 correction passed 20 Windows regressions plus independent
review, including descendants after leader exit/timeout, abrupt coordinator death,
preserved marker/restart refusal, exclusive locking, literal arguments and
discarded output. These are isolated fixtures; they do not merge the correction,
install the real capture task or prove a live accepted backup.

The dated hosted rehearsal verifies authenticated original reads, isolated recovery writes and cleanup for the actual small staging archive. Guest PUT/CORS/grant-expiry/retry behavior, representative capacity, full database recovery, recurring scheduling, live operational alerts (OPS-03), backup retention and the broader operational targets remain release acceptance. Audio also participates in synthetic original-preserving export, restoration and current-ledger erasure tests. Audio admission is already enabled; physical recording/audibility, private original comparison and affected canonical-origin acceptance retain their recorded limits. Decoder/recovery checks do not establish phone recording behavior or representative hosted recovery capacity.
