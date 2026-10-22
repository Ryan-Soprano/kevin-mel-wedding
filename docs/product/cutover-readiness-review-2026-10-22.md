# Cutover readiness review — October 22, 2026

**Decision: HOLD.** The current reviewed application is deployed behind Render
maintenance; the canonical domain still serves Coming Soon. This review corrects
the handoff and incident instructions. It does not activate backups, change
provider configuration, open collection or complete canonical phone acceptance.

## Verified application baseline

Read-only provider, GitHub and HTTPS checks on October 22 established:

| Check | Observed result | Limit |
| --- | --- | --- |
| Deployed application source and retained deployment | `0a343abf1c2047af8870707627b9ef9cefa32b93`; deploy `dep-dbd60hnavr4c73cuk67g`, live at 19:13:45.411104 UTC / 2:13:45 p.m. CDT | A provider `live` result does not establish complete readiness. Repository main can advance independently. |
| Deployed-source CI | [Run 39795263279](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39795263279) passed on application commit `0a343ab`, including backend, frontend, operational helpers, lint and build | New source changes require their own checks. |
| Merged documentation CI | PR 117 merge `8c101cd` passed [run 39848823402](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39848823402); PR 119 merge `baeab30` passed [run 39847127609](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39847127609) | Repository delivery does not change the retained application deployment or accept the new coordinator operation. |
| PR 115 review | [Configured Codex review](https://github.com/Ryan-Soprano/kevin-mel-wedding/pull/115#issuecomment-6342905313) completed without findings on `93a9257f4edbe279ce709f4be30e3b741825be34`; PR merged as `0a343ab` | Prepared tooling is distinct from installed and accepted operation. The later local coordinator finding below remains actionable. |
| Active profile | Startup at 19:13:34.548 UTC records exactly one active profile, `production` | This does not verify every effective secret/property or admission setting. |
| Fresh private report | New Shell at **20:40:12 UTC / 3:40:12 p.m. CDT** returned `OPERATIONS_OBSERVED_CHECKS_PASS`, `DATABASE_AVAILABLE`, `SCHEMA_REVIEWED`, `READINESS_EXIT=0` | Read-only database/schema/aggregate checks passed; this does not inspect current media bytes or establish backups/canonical acceptance. |
| Service controls | Maintenance enabled, automatic deployment off, one Ohio 1-CPU / 2-GiB instance | Preserve the observed maintenance state through preparation. |
| Provider root and `/api/health` | Both returned HTTP 503 while maintenance was enabled | These responses do not exercise the underlying application or private routes. |
| Canonical domain | Apex returned HTTP 200 Coming Soon; `www` redirected to the apex and returned the same page | No canonical full-app, phone-save or placemat acceptance is credited. |

The earlier `caec4a9` deployment and its guest/security evidence remain historical.
The newer image includes PR 114's private styling and PR 115's prepared backup
tools. Shipping those files in the application image does not install a Windows
capture task or enable the independent watchdog. Private couple reveal remains
closed under the existing launch policy; verify its effective value before opening.

## Earlier handoff facts reconciled before capture

[PR 117](https://github.com/Ryan-Soprano/kevin-mel-wedding/pull/117) records a
database-credential exposure and Ryan's replacement credential preparation,
followed by the historical 19:08 deployment. Complete home consumer migration
and old-database-credential revocation remain unverified. Update and privately
verify affected backup/recovery/manual database clients before revocation;
preserve the existing R2/encryption credentials and current deletion authority.
Review historical rollback environment values so they cannot reintroduce the
exposed database credential. These are reconciled records, not new remediation
or credential readbacks from this review.

PR 117 also records Ryan's intentional removal of synthetic/rehearsal originals
and his instruction to restore none. This report does not newly verify object
or metadata state. Reconcile affected database references, actual object
existence and current independent deletion evidence before accepting a complete
checkpoint or backup baseline. Preserve remaining data and authority; no blanket
database reset, invented deletion evidence or automatic restoration is authorized.

The later new-Shell private report passed at **20:40:12 UTC** with the exact
flags recorded above, superseding the failed multiline paste's pending status.
Keep the [handoff's single-line filtered command](../../HANDOFF-2026-10-19.md#1-resume-here)
for affected deployment/configuration rechecks. Maintenance stays enabled;
database/schema/aggregate success does not prove current media integrity,
complete credential-consumer remediation or accepted recovery operation.

## Recovery locations and actual operation

Ryan confirms this is the laptop traveling to the wedding. Its physical F: volume
is NTFS and had approximately **708 GiB free** during read-only inspection. It
holds the existing managed encrypted backups. No local Google Drive synchronization
was observed. This physical recovery volume is independent of the hosted
database/R2 source and may hold the accepted independent encrypted copies.
Capacity/source separation alone does not prove current capture/media/ledger
coverage; no additional cloud-backup requirement is introduced.

The installed expiry task was enabled, with hourly and operator-logon triggers,
and its last observed run at **19:24:39 UTC / 2:24:39 p.m. CDT** returned 0.
The existing four managed ciphertexts have four immutable expiry receipts; none
was eligible or late at inspection. The newest accepted conservative capture was
**October 21 at 22:26:15 UTC / 5:26:15 p.m. CDT**, roughly 21.5 hours old during
this review. The independent lifetime-ledger copy remains separate. These are
inventory/task readbacks, not a new authenticated capture or restore.

**No scheduled capture task was found.** The existing expiry task removes old
copies; it does not create new backups. Private producer integration, a current
least-privilege source connection, recurring authenticated captures and accepted
durable receipts remain required.

All 658 entries in the installed pinned PowerShell runtime matched their recorded
hashes, with none missing. The previous manual database-capture source context is
explicitly cleaned: its temporary private SSH key is absent, and remote client/
proof removal was attested. It cannot be reused as an unattended source route.
A newly approved dedicated SSH route is now registered, and laptop source
preflight passed. This establishes the tested source-access prerequisite only;
verify the real capture/client/proof lifecycle and accepted receipts separately.
Keep database external access closed.

The existing private Google Drive recovery folder contains the portable
password-protected key, its verification receipt and instructions. Its three
listed items were unshared. **No archive/database backup is present in that
folder.** Prior key-download/decryption verification retains its recorded credit;
key escrow is not an independent copy of the archive. Do not infer cloud backup
coverage from the folder name or place live backup plaintext there. Preserve
private location/key references outside tracked documentation.

Use F: for local encrypted captures if implementing the existing plan. Complete
and verify independent encrypted database, original-media and current-ledger copies
with their own original-age retention/expiry evidence before crediting coverage.
The existing F: volume can supply that independent failure domain; Drive remains
portable-key escrow. If optional cloud backup copies are later added, verify
actual uploaded bytes, private/restore access and original-age expiry; a sync
queue or file existence is not proof.
This review uploads and moves no recovery material.

## Alert delivery now credited

The private [operations issue 116](https://github.com/Ryan-Soprano/kevin-mel-wedding/issues/116)
records synthetic failure and recovery notifications. Ryan confirms **both reached
Gmail and his phone**. Credit that human delivery report; it supersedes the earlier
unconfirmed-delivery statement for these tests.

The [18:39 UTC scheduled run](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39833279715)
was skipped. Synthetic delivery does not establish live backup health or recurring
watchdog execution. Verify available included Actions allowance and the approved monitoring cap, real
producer evidence and all activation gates before enabling live checks. The
ten-minute check schedule and notifications remain best effort; the five-minute
database freshness goal is a measured target, not a delivery or data-loss guarantee.

An October 22 read-only allowance inspection showed **1,840/2,000 included
Actions minutes used** and a **$0 Actions spending budget with paid usage
blocked**; the included balance is insufficient for the entire intended window.
Ryan subsequently authorized **up to $20 for Actions wedding monitoring only**.
Financial setup is pending and the provider budget is still $0; no live watchdog
activation or subscription change is credited. Verify the actual capped window
and remaining producer/copy gates before enabling monitoring. This spending
exception does not authorize other new resources or plan increases.

## Actionable review findings

1. **Backup subprocess containment correction is locally verified; installation requires reviewed delivery.** Tracked as
   [issue 118](https://github.com/Ryan-Soprano/kevin-mel-wedding/issues/118). In
   `scripts/run-backup-job.ps1`, `Invoke-BackupChild` waits for the immediate
   adapter process and then waits five seconds for its output streams. If the
   adapter exits while a descendant retains those streams, the drain fails but
   cleanup skips process-tree termination because the immediate process has
   already exited. A bounded Windows synthetic test reproduced work continuing
   after the coordinator returned `capture_failed`. Releasing the capture lock
   can then permit another capture while that work remains active. The local
   correction assigns children atomically to a Windows kill-on-close Job before
   execution, contains descendants, discards output to NUL and confirms an empty
   Job on normal/failure cleanup. It durably writes `BACKUP_JOB_INFLIGHT` into
   the exclusive `capture.lock` before every child, including publication.
   A crash/nonempty marker or uncertain cleanup refuses restart. Preserve that
   evidence until independently confirming no local descendants or remote work
   remain, then record deliberate clearing of the existing marker; never
   blanket-delete the lock. Eighteen isolated Windows regressions and independent
   review passed. Delivery must pass current-head CI/configured review before
   installation; updated pins and remaining real producer/copy gates still apply.
   No production capture task was installed or affected by these tests.
2. **Render upload-pause instructions needed correction.** A plain restart
   reuses the existing deployment's settings. The incident and wedding operator
   sheets now direct a deliberate runtime-setting deployment and effective-pause
   verification. Upload pause still permits notes, issued grants and finalization;
   it does not establish quiescence. Current Render references confirm the
   [environment save options](https://render.com/docs/configure-environment-variables)
   and [restart semantics](https://render.com/docs/deploys#manual-deploys).
3. **Active handoff evidence was stale.** Reconcile merged PR 115, successful
   merged-main CI, current deployment/maintenance, this home-machine inspection
   and the confirmed synthetic delivery. Preserve historical results and all
   unperformed launch gates.

The coordinator regression used Windows 10.0.26200.0, PowerShell 7.6.5,
.NET 10.0.11 and Node 24.21.0. Redacted local evidence is ignored under
`logs/final-cutover-review-20261022.local/`; no guest payload, secret, private
backup identity or live fixture was used.

## Remaining launch sequence

1. Credit the completed new-Shell report, then finish affected database-credential
   consumer checks/retirement and the reported rehearsal-original reconciliation before
   accepting a complete new checkpoint or backup baseline.
2. Deliver the locally verified containment correction through current-head
   checks/review and merge, then integrate the inspected private
   producer without weakening its source, encryption, expiry or refusal guards.
3. Prove scheduled accepted captures, measured freshness, independent media/current
   ledger coverage, all-copy expiry, functional isolated recovery and live alert
   behavior. Preserve the credited phone-delivery result.
4. Record the selected immutable application and compatible rollback artifacts,
   effective production/private settings, current recoverable checkpoint and
   operator window. Keep reveal and production retention false for guest collection.
5. Follow the [Go Live checklist](go-live-checklist.md) and
   [cutover procedure](../runbooks/go-live-kevinandmel-com.md): attended go/no-go,
   domain/TLS move behind maintenance, controlled canonical canary and actual
   printed-placemat scans plus note/photo/audio/retry checks on representative phones.
6. Open broadly only after the recorded acceptance, then observe the first fifteen
   minutes and first substantial burst. Preserve every retained and new submission.

No new paid service, plan increase, fixture reset, couple activation or domain
cutover is authorized by this evidence record alone.
