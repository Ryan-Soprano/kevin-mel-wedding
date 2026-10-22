# Wedding-day operator sheet — REL-02 preparation

Prepared October 11, 2026; launch references refreshed October 22. **Procedure prepared; complete hosted operation and release acceptance remain pending.** Ryan is the sole infrastructure operator. Kevin and Melanie decide moderation, publication and continued intake. Kade may support development and synthetic review without production access.

Before resuming at home, read the [primary handoff](../../HANDOFF-2026-10-19.md#1-resume-here) for the latest deployment, private readiness and credential reconciliation. Keep application maintenance enabled and Coming Soon in place until the remaining gates pass. The real home backup producer and live watchdog remain off.

This sheet puts the existing technical procedures into an event sequence for October 24. Start with the current [Go Live checklist](../product/go-live-checklist.md) and [cutover guide](go-live-kevinandmel-com.md), preserving the [older release checklist](../product/wedding-release-checklist.md) as detailed acceptance/history. Record the approved build, accepted contribution types, full-app HTTPS address, private storage, backups, operator access and actual phone/QR/network evidence. Ryan confirmed an attended cutover may happen any time October 22 once readiness is accepted. The existing app now runs the production profile; public-domain opening remains pending. Audio is enabled under Ryan's October 14 instruction, with remaining device/canonical-origin acceptance recorded separately. Keep reveal and production retention false for guest collection; any later activation requires its own accepted procedure.

**October 22 operating decision:** Ryan confirms this is the wedding laptop with its recovery drive attached; they will travel together to the private-home wedding's private room. He authorized unattended encrypted backups and Gmail alerts to his phone, and confirmed both synthetic failure and recovery alerts reached Gmail and his phone. Five-minute database freshness is a measured target, and response/restoration are best effort when he is available; the former one-hour wedding recovery requirement is superseded. The [activation plan](operator-recovery.md#wedding-automation-activation--october-22) still needs the real capture producer, recurring independent encrypted copies and live watchdog proof. Only the hourly expiry task was found installed. Keep the coordinator disabled pending the process-containment correction in the [October 22 readiness review](../product/cutover-readiness-review-2026-10-22.md). No new paid resources or production access for another person are authorized.

## Before launch and the October 24 reception

- [ ] Fill the private operator record below with the actual approved target and access references. Keep credentials, backup paths, guest content, retry identities and signed links outside the repository and tracker.
- [ ] Identify the exact deployed artifact and the reviewed recovery/rollback artifacts. Use [OPS-03](operations-and-rollback.md) for the readiness report and compatibility checks; its local rehearsal does not establish that any earlier build can safely use the current schema.
- [ ] Record real health/log/alert destinations, how Ryan reaches them from the venue, and who can tell Ryan that guests are having trouble. This document creates no alerts or automatic messages.
- [ ] Set up the same Windows laptop in the private room: plug it into power, prevent automatic sleep while plugged in, keep Windows signed in (screen locking is allowed), attach the recovery drive and verify the venue network. An open lid alone does not establish background availability. Verify fresh scheduled backup/status and phone-alert evidence after travel; this sheet changes no power settings.
- [ ] Record the hosted database recovery mechanism, last verified recovery point, private original-media backup, encrypted independent copy and current deletion-ledger recovery evidence under the [updated operating policy](operator-recovery.md#location-retention-and-recovery-targets). Complete the home credential/original-removal reconciliation before accepting a new baseline. Observe scheduled captures, measure the five-minute freshness target, verify independent media/ledger coverage, functional isolated recovery access and 30-day contribution-bearing expiry, and verify real backup-condition monitoring through the already tested phone route within its accepted operating window. Record that window's end and disable live monitoring then; it has no automatic end. Uninstalled producer integration or disabled status/watchdog code does not establish these results.
- [ ] Rehearse the incident choices below with synthetic data. Use the [tester guide](../product/qa02-tester-guide.md) for guest and private-archive behavior and the [release checklist](../product/wedding-release-checklist.md) for actual phones, assistive technology, reception network and printed QR acceptance.
- [ ] Review the final evidence and freeze the accepted release. Record the concrete release decision before opening collection; the earlier October 17 rehearsal/October 20 freeze dates are historical targets.

```text
Private operator record — retain outside Git/Notion:
Date/time and local timezone:
Approved environment and privately verified DB/bucket identity:
Reviewed deployed commit and immutable artifact:
Stable full-app guest address and release-evidence reference:
Accepted/enabled contribution types and effective runtime gates:
Health/log/alert/access references; venue access fallback:
Backup/recovery mechanism and encrypted-copy references:
Last verified DB recovery point and timed-restore evidence:
Current independent deletion-ledger evidence/reference:
Approved budget, capacity thresholds and maintenance procedure:
Ryan coverage and next check time:
Release decision and remaining issues:
```

In the tracker, record only dates, reviewed build identities, content-free outcomes and evidence references. Even aggregate operator output remains private.

## Before guests arrive and immediately before collection opens

1. Confirm the intended full application is serving the reviewed HTTPS address. Check the actual printed QR reaches the guest welcome and approved public gallery, rather than the temporary coming-soon page. Keep private inbox and media permissions out of guest materials.
2. Check public `/api/health`, then the [private read-only readiness report](operations-and-rollback.md#read-only-operator-report) against the verified database with the running service's effective settings. Health proves liveness only. A readiness pass checks the reviewed schema and database aggregates; it does not check provider access, backups, scheduled retention, alerts or host capacity.
3. Submit a clearly synthetic note through the real guest flow. Exercise each accepted and enabled media type with known synthetic originals. Confirm committed receipts and verified completion; transferred bytes or a pending intent are insufficient. For media integrity/private retrieval, follow the already accepted [storage](private-photo-storage.md) and [audio](voice-memories.md) procedures. Kevin/Melanie verify private account/review behavior through their own authority when required. Ryan does not acquire moderation authority by performing an operator check.
4. Reconcile any uncertain result using the existing receipt/current-state check and the same action identity. For a partly saved photo group, retry only unfinished items with the retained group/files. Do not create another submission to compensate for an unconfirmed result. Retain synthetic fixtures until their outcome is understood; Kevin/Melanie decide their review state.
5. Check actual backup freshness and independent-copy access, current deletion-ledger recovery evidence, private storage/CORS/original access, retention-job results and alert delivery through their reviewed hosted procedures. Inspect actual host and provider capacity separately from database reservations. An enabled switch is not evidence a job ran.
6. Record the private baseline and next check. If a required release or operational check is unconfirmed, hold opening and follow the incident procedure. A fresh smoke check supplements the earlier acceptance evidence; it does not replace it.

## While collection is active

- At opening, after a large burst and when Ryan is available, follow [guest-protection capacity checks](guest-protection.md#read-only-capacity-report), aiming for 15-minute checks where practical. Record gaps rather than imply continuous attendance. Review private database reservations and actual provider usage, unfinished/failed media, live grants and retention backlog. Review either original/staging budget at 80%; retained expired grants and soft-deleted/unfinished assets still consume conservative reservations.
- Check hosted availability, submission/storage/capacity alerts and database recovery-point freshness through the recorded private destinations. The independent watchdog should report stale, missing or explicitly failed backup status through the tested Gmail route; assess alerts as available without promising a maximum response/restoration time. Respect server cooldowns and `Retry-After`; do not clear counters or increase finalization concurrency to work around reception load.
- Record time, content-free symptom/outcome and the next operator check. Keep raw request bodies, names, originals, keys, provider errors and screenshots of private material out of incident notes in the tracker.
- Keep collection results accurate. A saved receipt may be confirmed even after a lost response; an unfinished intent is still unfinished. Preserve guest pages, original files and existing retry identities during deliberate recovery.

## Incident choices

Use [OPS-03 incident response](operations-and-rollback.md#incident-response-and-stopping-collection) for the exact technical steps. These are operational choices, not new automated controls.

| Observed problem | Ryan's action | Evidence required before normal operation resumes |
|---|---|---|
| Guest timeout, partial group or cooldown while the service remains healthy | Help retain the existing page/files/identity and follow its deliberate current-state/retry path. Respect the delay. | The same receipt/item resolves accurately and saved siblings remain singular; no fresh submission disguises uncertainty. |
| Media capacity pressure or unexpected storage/billing growth | Apply the backend upload pause through reviewed runtime configuration using Render **Save and deploy**, preserving the reviewed artifact; **Save only** plus Restart does not apply newly saved settings. Verify the effective pause. It stops new photo/audio intents and grants; notes, issued grants, receipt recovery and finalization remain available. | Cause and capacity reviewed, actual provider usage reconciled, intended settings restored and a synthetic same-item recovery succeeds. Existing signed permissions are not revoked by a pause. |
| Database/storage failure, broad outage or any recovery/rollback requiring quiescence | Stop application traffic and every application/maintenance process. Wait at least five minutes for issued PUT permissions to expire. Preserve database, originals, retry identities and the current independent deletion ledger. | Reviewed target/configuration/schema, committed receipts, private boundaries, exact originals and deliberate recovery verified with synthetic content. Keep traffic closed while these are unconfirmed. |
| Suspected loss or incompatibility | Follow [isolated operator recovery](operator-recovery.md) or the reviewed same-schema rollback plan. Restore into a separate target with current deletion authority. | Complete integrity and deletion-replay checks, target access/configuration recovery and operational readiness. Do not reverse migrations, clear a populated target or overwrite current deletion evidence. |
| Expired staging objects or an overdue deletion backlog | Use [explicit-candidate staging cleanup](guest-protection.md#temporary-and-invalid-object-cleanup) or the [deletion/ledger procedure](deletion-and-recovery.md). | Exact approved cleanup and confirmed provider/DB results. No prefix-wide deletion, reservation release before confirmed cleanup, or operator-selected guest moderation. |

Draft words for an actual interruption: **“Sharing is temporarily unavailable. Keep your original files and the current page open. If the page offers a retry, use it after the displayed wait.”** For an uncertain result: **“We couldn't confirm that your memory was saved. Keep this page open and use Try again.”** These are reviewable wording only; this preparation sends or publishes nothing and promises no offline queue.

## After the reception, while intake continues

1. Record a private checkpoint: reviewed artifact, collection state, last recovery point, aggregate counts/reservations, unfinished/failed media, incidents and unresolved retries. Verify backups and the current independent deletion-ledger copy remain healthy. The wedding ending does not automatically stop collection.
2. Reconcile unfinished work deliberately. Preserve contribution/media/grant metadata and exact saved originals. Original-file storage may succeed before a database commit fails, so recover the same intent first. Staging bytes are temporary and are not durable saved originals; recovery cannot recreate bytes never confirmed saved. Authors need their original files and matching retry identity to resume/reupload. Do not mark these items complete from counts alone.
3. If an operator archive package is needed, schedule a deliberate maintenance window and follow [OPS-02 consistency and unfinished uploads](operator-recovery.md#consistency-and-unfinished-uploads): stop source traffic, retention and finalization, wait at least five minutes for grants to expire, and establish quiescence before export. Upload pause alone is insufficient. Use a new private directory, verify exact originals and retain the current independent deletion authority. Missing/corrupt originals or an incomplete package remain unready.
4. Preserve completed operator recovery packages, database backups and encrypted independent copies according to the enforced 30-day contribution-bearing policy, including incomplete export directories. The export console neither schedules copies nor enforces expiry. Current content-free deletion tombstones/retry reservations persist for the archive lifetime.
5. Kevin/Melanie can prepare a [portable archive export](../api/v1/exports.md) through their own session. Verify every downloaded part and the refreshed index were actually saved; extract one snapshot's parts into one private folder and open the offline reader. Keep prior downloads until a new complete set is saved. Do not mix snapshots. Missing originals, exclusions or unfinished memories need an honest incomplete report. This readable export does not replace operator/database backups and excludes deleted, unfinished and unavailable content.
6. After any maintenance interruption, follow the incident reopening checks and a synthetic collection smoke. Record actual downtime and the next backup/health check. Continue the agreed intake period unless a deliberate safety or release decision pauses it.

## October 31 review and continued ownership

Collection is intended to remain available through October 31, 2026. That date is a handoff/review target; this runbook installs no scheduled closure. Before that review, summarize unresolved uploads, incidents, backup/restore evidence and portable-export completeness without guest content. Kevin/Melanie decide whether continued intake fits their archive; Ryan records the resulting operational plan, support coverage and budget decision.

Any later intake change needs its own reviewed implementation/configuration and verification. The media upload pause does not stop notes or close the whole collection. A couple export is not proof every received item was saved or handed off. Use the [release-review record](../product/wedding-release-checklist.md#release-review-record) to link actual rehearsal/release evidence and the later intake decision, keeping unperformed device/provider/hosted checks pending.

```text
Content-free event/handoff record:
Reviewed build and event checkpoint times:
Actual opening/reopening decisions and owner:
Synthetic collection outcomes and evidence references:
Availability/backup/restore/alert evidence and remaining issues:
Incidents, confirmed downtime and unresolved-retry counts:
Post-event preservation/package/export outcomes:
October 31 intake decision and next review:
Ryan support coverage and private operator-record reference:
```
