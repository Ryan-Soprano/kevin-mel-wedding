# Independent archive recovery rehearsal — October 20, 2026

The hosted staging archive completed an encrypted independent-copy export, isolated restoration, independent verification and cleanup. **Functional recovery passed for the actual small staging archive.** The exercise included saved photo and audio originals, text notes and the current independent deletion ledger. It did not establish full database disaster recovery, continuous backup coverage, the five-minute RPO or representative application RTO.

Ryan operated the exercise under the [operator recovery procedure](operator-recovery.md). Private receipts retain the detailed identities, inventory, hashes and command results. This record deliberately omits archive counts, content, backup paths, storage bucket names, credentials and private-file hashes.

## Environment and isolation

The source was PostgreSQL 17 at reviewed schema V14, with the application's existing private R2 configuration. Its running application was commit `bcbb17b40541da55f1d493cbae420ae32820a56b`, deployment `dep-dbbujo61egvs73es5500`.

The destination used a fresh, separately identified logical database on the existing PostgreSQL cluster and a distinct private R2 bucket. The empty database received the reviewed V1–V14 migrations before the outage. A temporary 2 GB Render SSH executor ran the reviewed offline console while the source application was suspended. The destination application was never started. Separate target storage credentials were limited to the destination bucket; the original source configuration remained the authority for current deletion evidence.

The logical database isolated rehearsal rows and cleanup from source data. Sharing the PostgreSQL cluster did **not** provide a separate database failure domain. The independent encrypted archive and ledger copies were stored outside the repository and provider execution host. Local volume encryption was not verified, so archive/ledger payloads were retained locally only as ciphertext; their plaintext existed only in the bounded RAM workspace. Private operator instructions and verification receipts are separate from those encrypted payloads.

## Execution record

All timestamps below are UTC. The exercise occurred on October 20 in America/Chicago, including the final checks after midnight UTC.

| Event | UTC time and observed result |
|---|---|
| Start pause timing | October 20, 23:44:52 |
| Source suspension | Provider updated at 23:45:05.824559; no running source instances observed at 23:45:32. |
| Quiescence and destination checks | Strict source-quiescence and empty-target checks passed after 23:50:49, more than five minutes after stopped instances were observed. |
| Current ledger capture | Two complete canonical scans agreed; capture completed at 23:51:36. The separate lifetime copy was encrypted and authenticated decryption reproduced its plaintext hash. |
| Interactive version 7 export | 23:52:36–23:53:13; ready result, exit 0. Saved photo/audio originals and text-note coverage were verified. |
| Independent-copy recovery | The encrypted local copy passed authenticated AES-256-GCM decryption with RSA OAEP-SHA256 key wrapping and the trusted archive hash check. The original RAM export was deleted. Decryption from the independent copy reached a new RAM workspace at 23:54:32.0723541; its trusted tar hash was checked before extraction. |
| Rejected initial restore context | 23:55:25.992132456–23:55:27.143552099; exit 2. The source/destination isolation guard rejected an aliased source-bucket setting before the confirmation prompt or recovery IO. Source authority values were captured separately, process overrides corrected and the identity probe passed. |
| Interactive restoration | 23:56:38.704867295–23:57:31.604507261; typed console confirmation, exit 0. |
| Independent post-restore verification | 23:58:23.882869993–23:58:46.029616663; exit 0. |
| Destination cleanup | Target database removal and restored-original deletion passed at 23:59:25.878411295. All target deletion evidence was preserved in the retained private bucket. |
| Source resume | Provider update at 23:59:46.378547; resumed deployment became live on October 21 at 00:00:18.564203. |
| Temporary-file cleanup | All RAM workspaces and remote temporary ciphertext were removed by 23:59:56.257705603; owned SSH/CLI processes were closed. |
| Final hosted checks | Receipt observed October 21 at 00:02:30.4416753: all 12 GET checks passed, with the same decoded JavaScript/CSS assets. |

The resumed application was commit `03e9ebebe27b61a74c30563cace046ee02740b04`, deployment `dep-dbc00su1egvs7390am30`. Resume created a new deployment; the pre-pause deployment is historical evidence.

## What verification established

The independent verifier compared every restored archive row and relationship against the immutable package with the exact current-ledger transformations, including revisions and retained reservations. It compared the complete current authority ledger, checked the destination ledger and verified that authority remained unchanged during verification.

Every surviving restored original was read through authenticated storage access and compared for exact bytes, hash, length and MIME. Photo decoding and audio duration/container/codec validation passed. The complete target object inventory contained only permitted originals and deletion evidence, with no erased originals, staging objects or unknown objects. Account, throttle and private-share-link tables were empty, as required for this isolated archive restoration.

Cleanup removed only the task-owned destination database and verified restored originals. All destination deletion records remained. The temporary bucket-only token and SSH key were revoked and their absence confirmed in the provider interfaces. The temporary executor and destination access were covered by the user's approved $5 additional-cost ceiling; the narrowly scoped RAM transfer was separately approved after automatic approval review initially blocked it. Approval does not establish a final provider bill.

## Local expiry setup after the hosted rehearsal

The local expiry helper passed 33 controls. A synthetic task run started on demand through Windows Task Scheduler removed only the expired fake artifact, preserved the fresh fake and ledger sentinel, and removed its exact temporary task. The actual archive was atomically enrolled with an immutable expiry receipt preserving its original capture time, October 20 at 23:52:36 UTC. Its 29-day eligibility date is November 18 and 30-day hard deadline November 19 at that same UTC time; enrollment did not reset its age.

The actual task was registered disabled, read back, enabled and read back again. It is configured to run as the current operator with Limited/Interactive authority, hourly and at operator logon, with catch-up, wake, IgnoreNew and a five-minute execution limit. It has no startup trigger or stored password and uses the persistent reviewed runtime/helper. Its first actual sweep, also started on demand through Task Scheduler, returned result 0 with clean latched state; the fresh archive, immutable expiry receipt and permanent ledger retained their exact hashes. A later definition readback also passed. Both runs used `Start-ScheduledTask`, proving the installed scheduler launch path/result; neither observed an automatic hourly or logon trigger firing. Private operator instructions and receipts retain the exact task and storage identities.

This establishes that tested local execution path. Ryan must remain logged in, with Windows, the private drive and runtime available. No logout, reboot or offline exercise was performed; catch-up/wake cannot guarantee execution while the host is shut down or storage unavailable. Continuous 30-day expiry across every contribution-bearing copy remains open. Content-free lifetime ledger copies are outside the contribution-bearing expiry namespace. This subsequent local setup is outside the hosted pause-to-final-check timing below.

## Timing and remaining acceptance

Pause timing through the final hosted identity checks was **17 minutes 38.442 seconds**. The successful restore console took approximately **53 seconds**, including the human confirmation prompt; independent verification took approximately **22 seconds**. Destination preparation and tooling setup occurred before pause timing and are excluded. These measurements describe this exercise and its small staging archive, not a complete disaster-recovery deadline or representative-size capacity result.

The following acceptance work remains:

- Establish and rehearse full hosted PostgreSQL restoration or PITR with actual recovery points. The separate provider database export completed on October 20 remains export evidence; this exercise did not restore that backup or prove the five-minute database RPO.
- Recover current accounts, application settings and session behavior separately, then verify readiness with reveal closed. This archive restoration excluded those records and did not test reveal or a running restored application.
- Complete recovery from loss of the original ledger authority. The console still requires the originating source endpoint/bucket identity and complete current deletion evidence. The separately encrypted lifetime ledger copy cannot directly substitute from a relocated bucket; this rehearsal does not prove total source-bucket-loss recovery.
- Complete portable operator key escrow and its access rehearsal. Current private-key access depends on the current Windows profile's DPAPI protection; portable recovery still requires an operator secret handoff step.
- Establish continuous expiry and availability coverage across all contribution-bearing copies. The local task is active and its first Task Scheduler run on demand passed, but automatic trigger firing, logout/reboot/offline behavior and uninterrupted host/storage availability were not established. Preserve incident latches and verify each other backup copy's expiry separately.
- Verify recurring database/media copies, alerts, enforced expiry of every contribution-bearing copy and a complete timed recovery at representative size. Preserve content-free deletion evidence for the archive's lifetime, separately from contribution-bearing backup expiry.

The [operator recovery targets](operator-recovery.md#location-retention-and-recovery-targets) and [deletion/recovery contract](deletion-and-recovery.md) remain authoritative. A successful archive rehearsal closes the functional exercise recorded here; it does not close those broader release requirements.
