# INB-02 private note/photo lifecycle verification

## Implementation

The existing read-only inbox now supports **Keep privately**, **Archive**, **Restore to inbox**, and separately confirmed **Delete**. Pending, Kept, Archived and Recently deleted filters use the same authorized keyset pagination. Review actions preserve `COUPLE_ONLY`; publication is a separate future feature. Complete audio and device/hosted acceptance remain deferred.

`PATCH /api/memories/{memoryId}/review` uses the existing `{reviewStatus}` body, current CSRF token and exact `If-Match: "revision"`. The service requires current couple/reveal access before and after acquiring the memory lock, checks the latest revision and commits state/revision/audit together. A current-revision same-state request returns the unchanged detail/ETag; a stale request returns 412. Missing precondition is 428; wildcards, weak/multiple/zero/overflow revisions, invalid state and extra fields fail safely. Authorization tests cover every state including no-op and non-couple roles.

First deletion sets `deleteAfter` from server UTC plus 30 elapsed days. Repeated Delete cannot extend it; restoring clears it. Deleted detail/list is available only before the deadline, while new playback is always denied. Expired/claimed/purged items are unavailable. V7 adds deadlines/claims/tombstones, minimal review audit, SQL ledger and erased-key digests without modifying V1–V6; it backfills historical DELETE deadlines from their prior updated time.

## Client recovery

The controller freezes one memory ID, source/target status and revision. Repeat taps coalesce; active/uncertain actions lock competing navigation, media and sign-out controls, and warn before leaving the page. There are no automatic mutation retries.

A timeout, lost body or unexpected success can follow a commit. **Reload current state** reconciles manually. An unchanged revision does not prove the original request cannot commit later, so uncertainty stays locked; an explicit retry sends only the same frozen request and precondition. An advanced revision makes that old precondition unable to commit: display the current state and let the couple choose again, without attributing the other user's change to this request. A rejected retry does not erase uncertainty about the first attempt. CSRF recovery deliberately obtains a fresh session; authentication/authority failures clear private content and owned Blob URLs.

Confirmed/reconciled results and unavailable details invalidate cached pages and restart the filter from page one on Back; temporary detail failures preserve the current page. Access-unavailable recovery still offers explicit sign-out with fresh CSRF, and a lost sign-out response requires deliberate retry. Deleted previews are revoked; the Recently deleted detail displays the server deadline and restoration action without photo playback. Delete confirmation names the individual memory, explains the 30-day live recovery period and backup retention, focuses Cancel first, and never cascades to contribution siblings. Presentation uses safe text rendering and no persistent private state.

## Erasure and recovery

The bounded maintenance path first persists an independent immutable private R2 deletion record, then deletes owned objects and commits the metadata scrub. Retry keeps the same plan. Minimal memory/envelope reservations preserve valid guest receipts without storing purged guest content. A digest reservation also blocks recreation after replay into a backup predating the contribution itself. See the [deletion/recovery runbook](../../runbooks/deletion-and-recovery.md) for offline replay, scheduling readiness and rolling-backup implications.

## Verification and remaining acceptance

Automated cases cover revision races, no-op/first-deadline semantics, queued revocation, CSRF/origin/contract/role gates, safe audit, upgrade/backfill, guest receipt/IO tombstones, late commits, sticky retry uncertainty, preview cleanup, bounded strict ledger parsing, conditional independent writes, failed IO/SQL retries and isolated old-backup replay. The pull request's GitHub Actions results provide full PostgreSQL/backend and frontend evidence at its exact head.

Local integrated test counts and CI evidence are recorded in the PR and Notion. No new dependency, real account, provider resource, purchase or deployment is part of this change. Real R2 conditional-write/list/delete behavior, hosted retention/recovery-copy monitoring and backup RPO/RTO remain OPS-01/OPS-02/OPS-03 acceptance. Actual-browser/device/accessibility/audio checks remain pending before release.
