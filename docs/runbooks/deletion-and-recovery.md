# Private deletion and recovery — INB-02

## Authority and the recovery window

Kevin and Melanie choose review states through the authenticated inbox. Keep remains private; Archive is recoverable. Restore to inbox chooses `PENDING`. Delete requires a separate confirmation and sets the first server decision's deadline to 30 elapsed days later. A current-revision repeat is a no-op; a stale revision conflicts. Neither repeat taps nor recovery requests extend the deadline.

Until the deadline, the couple can find the item under **Recently deleted** and restore it. New photo/audio playback permissions are unavailable while deleted. At the exact deadline the item is unavailable to list/detail/review, even while storage cleanup is retrying. Previously issued playback permissions can last until their own five-minute expiry, and downloaded copies cannot be recalled.

Ryan operates retention maintenance that enforces expired authorized review decisions. Maintenance supplies no new keep/archive/delete/publication choices. Separately, his explicitly configured named `OPERATOR` account may use the same private review endpoints under the [October 24 account boundary](account-access.md#account-boundaries); other operators and all developers remain denied. The offline console starts no HTTP server and requires a matching environment and typed confirmation.

## Maintenance readiness

Local and test scheduling default off. Before production deletion is offered, OPS-01/OPS-02 must configure and verify `MEMORY_ARCHIVE_RETENTION_ENABLED=true`, the existing private R2 server credentials and the independent deletion-ledger recovery copy. The maintenance interval defaults to five minutes; an override must be between one minute and one day. Each run handles at most 20 expired items and retries unfinished plans on a later run. A delayed/failed purge does not reopen recovery or claim physical erasure.

Private R2 must permit server-only conditional PUT/GET/list for `deletions/v1/` and DELETE of the exact owned original/staging keys. Keep bucket public access disabled. Preserve the approved `staging/` expiration rule; never apply a lifecycle expiration rule to deletion records. This implementation adds no public ledger/export URL or new credential. Provider permissions, hosted scheduling/alerts and recovery-copy durability require acceptance before launch; this coding task does not provision or exercise them.

## Write-ahead erasure

1. Lock an expired private note/verified-photo/verified-audio memory, freeze its SQL plan and mark purge started. Audio requires a canonical WebM/Opus, Ogg/Opus or MP4/AAC original, verified duration over zero and at most 120 seconds, and the same confirmed size/checksum/type/owned-key invariants as photo originals. Pending or failed audio is not claimed as verified original media. Review and guest media IO cannot revive claimed/expired/purged items.
2. Validate the memory/contribution/asset ownership and staging scopes. Store the immutable, bounded JSON plan privately at `deletions/v1/<memory UUID>.json` with `If-None-Match: *`. A duplicate write succeeds only if the existing record is identical. A mismatch, malformed ledger or storage failure stops that item before acknowledging purge.
3. Delete only its server-derived `originals/<asset UUID>` and known `staging/<grant UUID>` objects. Missing objects are safe to retry; unknown IO failures remain unconfirmed.
4. In a transaction, remove media/grant metadata, album memberships, timeline links and tag associations, refreshing affected album/event/list/tag revisions, and scrub the note, caption, title, description and memory date. Clear the envelope's guest name only after every sibling is purged. Retain the minimal private memory/envelope IDs, type/order, retry fingerprint/key reservation, state/revision and timestamps; a valid guest replay returns the prior receipt instead of recreating content.

Object removal may precede a database failure. The independent record and frozen plan make retry safe; metadata is never reported purged until the scrub transaction commits. Review audit rows retain only actor UUID, memory UUID, status/revision transitions and times. The independent ledger contains event/opaque IDs, a SHA-256 digest of the random submission key and deletion times, with no note, name, caption, filename, checksum of media, raw capability, credential or signed URL. Content-free tombstones and retry reservations remain for the archive lifetime to prevent resurrection.

## Offline maintenance console

Build the reviewed application and dependency classpath using the existing [account console instructions](account-access.md). Use the same `archive_account_classpath` value but select `com.kevinmel.archive.retention.RetentionAdministration`:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.retention.RetentionAdministration --help
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.retention.RetentionAdministration --expect-environment local purge-expired
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" com.kevinmel.archive.retention.RetentionAdministration --expect-environment local replay-ledger
```

The latter commands require typing `purge-expired in local` or `replay-ledger in local`. Use `staging`/`production` only with the corresponding reviewed target. Nonlocal commands require explicit database URL, username and password settings; local defaults cannot satisfy this check. Labels do not identify a database: privately verify the actual connection and bucket first. The console uses `application.properties` and environment overrides, does not load profile files or apply migrations, and requires reviewed V13 already applied for current retention claims. Never redirect a write command's input; credentials belong in private runtime settings, not arguments/history. Output contains only counts and safe failures. A nonzero result may represent partial cleanup and must not be interpreted as rollback.

## Restore without resurrection

Contribution-bearing rolling backups may retain a deleted copy until that backup's own 30-day expiry. Live purge cannot erase those historical copies immediately. OPS-02 owns the backup retention and restore implementation, with OPS-03 monitoring; no hosted RPO/RTO claim is made here.

The [OPS-02 operator recovery console](operator-recovery.md) now exports note/photo/audio archive data and verifies isolated restoration with current independent deletion evidence. Audio metadata and exact original bytes survive the version 2 package; older audio packages replay current erasure and reserve absent submission keys. It supplements a full database backup; it does not prove hosted scheduling, actual provider recovery-copy durability or the operating RPO/RTO targets. Physical-device audio acceptance remains deferred.

For any restore:

1. Stop collection and private application traffic. Retain the **current independent** `deletions/v1/` ledger; never overwrite it with an older database/media backup. If recovery copies are needed, recover/merge the authoritative ledger before proceeding.
2. Restore into an isolated target and apply the current reviewed migrations without enabling traffic or scheduled maintenance against the wrong bucket.
3. Run the offline **replay-ledger** command to completion. It re-erases recorded originals/restored metadata, reapplies tombstones and reserves hashed submission keys even when the restored backup predates the original contribution. Any malformed record, future record, identity mismatch or storage/database failure stops recovery; keep traffic closed and retry safely.
4. Verify deleted IDs stay unavailable, original bytes stay absent, old guest retry capabilities cannot create fresh contributions, and unrelated siblings remain intact. Reopening traffic requires the OPS-02 restore checks, the authoritative ledger recovery-copy evidence and the intended target configuration.

Local/CI tests use disposable PostgreSQL schemas and an in-memory independent store, including a database-failure-after-object-deletion retry and replay into a pre-purge or pre-contribution fixture. They establish application ordering/invariants; they do not establish real R2 deletion/list/conditional-write behavior, hosted backup scheduling, actual recovery-copy durability or RPO/RTO.
