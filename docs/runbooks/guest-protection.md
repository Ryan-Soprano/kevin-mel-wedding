# Guest collection protection and capacity

Ryan is the sole infrastructure operator. This is a reviewable procedure for the note/photo slice; provider settings, production changes and physical deletion require the existing approval/setup workflow. Do not copy guest content, keys, signed URLs or credentials into evidence.

## Pause and recover

Set the backend-only `MEMORY_ARCHIVE_UPLOADS_PAUSED=true` in the approved environment and restart/redeploy through its reviewed procedure. It stops new photo intents and new permissions; already issued permissions remain usable and recoverable until their own expiry, finalization can finish, receipt recovery and notes remain available. This is an admission pause, not revocation of signed URLs. Leave the existing retry key/files/page intact and retry deliberately after the server's delay.

After reviewing the cause and available capacity, remove the pause (`false`) and repeat a synthetic note/photo smoke before reopening. Do not clear throttle counters or raise limits as an automatic response to a busy reception. Wrong-size or expired provider requests cannot be treated as saved uploads.

## Read-only capacity report

Run against the intended authorized database using private connection settings. These queries return counts/bytes only. On the wedding day, inspect at collection opening, after a large burst, and at least every 15 minutes while active. Inspect actual private provider storage separately, including any objects outside current database reservations. Alert delivery/automation remains OPS work.

```sql
SELECT COUNT(*) AS unpurged_assets,
       COALESCE(SUM(COALESCE(a.expected_byte_size, a.byte_size)), 0) AS reserved_original_bytes
FROM media_asset a JOIN memory m ON m.id = a.memory_id
WHERE m.purged_at IS NULL;

SELECT COUNT(*) AS retained_grants,
       COALESCE(SUM(COALESCE(a.expected_byte_size, a.byte_size)), 0) AS reserved_staging_bytes,
       COUNT(*) FILTER (WHERE g.expires_at > CURRENT_TIMESTAMP) AS live_grants
FROM upload_grant g JOIN media_asset a ON a.id = g.media_asset_id;

SELECT COUNT(*) AS active_throttle_buckets, MAX(attempts) AS highest_attempt_count
FROM archive_anonymous_throttle
WHERE window_started_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes';
```

Default original and temporary budgets are separately 7,500,000,000 bytes, controlled by `MEMORY_ARCHIVE_MAX_ORIGINAL_BYTES` and `MEMORY_ARCHIVE_MAX_STAGING_BYTES`. One hundred five-photo batches at maximum size reserve 5 GB of originals and 5 GB of staging. Review actual usage at 80% of either budget; pause new permissions if unexpected growth or provider billing approaches Ryan's accepted intervention limit. Every unfinished/soft-deleted asset counts until confirmed purge. Every retained grant counts even after expiry. Conservative reservations can exceed actual usage and intentionally stop new permission issuance rather than assume storage has been erased.

Finalization concurrency is bounded by `MEMORY_ARCHIVE_MAX_CONCURRENT_FINALIZATIONS` (positive; default two, staging one). Increasing it requires revisiting the [measured decoder memory](staging-deployment.md) and approved runtime budget. Count busy/429 outcomes without recording request payloads or raw identities. A fail-closed database error requires database recovery, not bypassing admission.

## Temporary and invalid-object cleanup

Keep the reviewed private `staging/` one-day lifecycle rule, public-development URLs/custom domains disabled, and exact-origin CORS; confirm these with the existing [storage runbook](private-photo-storage.md). Lifecycle deletion is asynchronous and does not release database reservations automatically.

During an approved maintenance window:

1. Pause new photo permissions and wait for all issued five-minute grants to expire. Allow retained finalization/reconciliation first. Preserve original data and take the agreed recovery copy.
2. Prepare a concrete candidate list privately. Use a minimum 24-hour quiet period and reconcile exact `staging/<grant UUID>` keys with grant associations, expiry, current item state and provider listing. Preserve live grants. Preserve every saved original. Never derive a path from a guest filename or delete a prefix wholesale.
3. Obtain approval for the candidate list. Delete only its exact staging objects and confirm each removal with the approved authenticated provider check. Failed or ambiguous deletion retains its database reservation.
4. Recheck each expired grant/asset association under the paused maintenance window, then remove only the confirmed-cleaned grant rows in a transaction. Deleting rows first releases capacity without proving erasure and is prohibited. Keep at least a resumable current grant for any still-active item and allow a new permission for a recoverable unfinished item after reopening.
5. Refresh aggregate/provider capacity, retain a content-free count/outcome record, and reopen only after a synthetic retry confirms the same intent can obtain a new permission and finalize without duplicating saved siblings.

An original publication can succeed before database commit fails. Retry the same original intent first; it publishes identical verified bytes to the same key. Abandoned/invalid original cleanup follows the existing quiet-period, association and explicit-candidate procedure in the storage runbook. Couple-approved DELETE originals use the separate [30-day deletion/ledger procedure](deletion-and-recovery.md); operations do not grant couple moderation authority.

## Remaining release checks

Repeat correct and wrong-size signed PUTs through actual private R2 and physical browsers; confirm filename/key/method/type/size restrictions, expiry, exact-origin CORS, unsigned denial and verified original integrity. Record only outcomes. Verify hosted peer/origin behavior, shared-network throughput and operator monitoring before public collection. Audio remains provisional until its implementation/format evidence is complete. See [SEC-01 verification](../api/v1/anonymous-protection-verification.md) and the [SEC-02 release review](security-review.md).
