# Full database recovery feasibility — October 21, 2026

**Status: three actual encrypted database captures and one isolated actual-data restoration passed, together with read-only source inventory and synthetic controls. A bounded manual observation stayed within five minutes. Continuous five-minute database recovery-point objective (RPO) and complete one-hour recovery-time objective (RTO) remain unproved; the launch gates remain HOLD.** This record does not clear the [Go Live checklist](../product/go-live-checklist.md).

Ryan requested inspection and improvement of home recovery before launch. This work uses the existing hosted application/database/private storage and disposable local containers. It creates no additional paid service, changes no hosted plan or source configuration, and performs no deployment. Source database operations are read-only. Private operator receipts hold execution identities and detailed verification; this document contains no backup location, cloud resource identifier, key, capability, payload hash or source row.

The [October 20 archive rehearsal](recovery-rehearsal-2026-10-20.md) remains separate evidence. Its operator archive preserves reviewed archive data and original media, while intentionally excluding accounts, throttles and private share-link capabilities. A full database backup covers those database records too; it does not itself copy media or current independent deletion evidence.

## Evidence established

| Area | Observed result | Scope and limit |
| --- | --- | --- |
| Actual source inventory | PostgreSQL **17.11**, **9,696,947 database bytes**, **19 public tables**, UTF8 encoding and `en_US.UTF8` collation/ctype. No extra user schemas, user sequences, invalid indexes or unvalidated constraints were reported. The installed extension inventory contained `plpgsql`. | Read-only identity/schema/size observation, not a completed backup or restore. Database size is not the size of a resulting dump. |
| Portable client bundle | PostgreSQL **17.11** client executables and all **35** frozen bundle entries verified; loader/library resolution, hosts-file lookup, synthetic DNS and libpq resolution checks passed. | The complete reviewed runtime closure is used, including its bundled loader. This avoids relying on the hosted base image's older libc. Packaging checks alone do not establish recovery. |
| Encrypted binary relay | **16 controls passed**, including exact binary/empty round trips, authenticated readback, pinned executable/certificate checks, preserved existing output, byte/deadline bounds, failed/early consumers and producer diagnostics. | Synthetic processes, key and payload only. No actual database copy is credited by these controls. |
| Exported-snapshot source helper | **12 controls passed**: same-snapshot dump/proof under concurrent writes, capture binding, existing-proof refusal, incomplete-proof rejection, restoration/hash/catalog comparison, private RAM cleanup and tested backend cancellation. | Isolated synthetic source. Tested cleanup includes cancellation before readiness; it does not promise instantaneous remote backend termination during arbitrary network loss. |
| Full database restore fixture | All **18 application tables plus migration history**, **129 columns**, **103 validated constraints** and **47 valid indexes** verified. Every restored row matched the source snapshot's equivalent committed prefix. | Exact repository V1–V14 SQL, with synthetically populated migration-history metadata; this fixture did not run the Flyway engine or start a restored application. |

### Synthetic full database timing and failure checks

The source and destination each used **0.1 CPU / 256 MiB**, bounded tmpfs database storage, no host ports or binds, no external network and disabled container logging. The harness used the existing local PostgreSQL image. Custom-format dump bytes remained in a bounded process-memory buffer and pipes; no plaintext dump file was created.

The serial dump produced **54,186 bytes in 1.323 seconds**. Restoration into a proved empty destination used a single transaction, fail-on-error and explicit omission of source ownership/privileges; it took **1.284 seconds**. Setup through verification took **79.639 seconds**, or **82.548 seconds including verified cleanup**. These are small synthetic metadata/relationship measurements, not representative hosted outage or media-recovery timing.

A concurrent writer committed 48 ordered synthetic markers. The restored snapshot contained complete contribution/memory pairs for markers 1–5 and omitted the 43 later commits. This established a consistent observed snapshot. It did not establish recurring backup coverage, independent encrypted durability or a five-minute RPO.

The nonempty-destination guard refused restoration and preserved its sentinel. Restored foreign-key, sharing-state and account-role constraints rejected invalid mutations without persisting them. Source and restored column/default/type/collation definitions matched. Constraint and index comparisons retained raw definitions and normalized only PostgreSQL's equivalent uppercase-literal varchar-array/text-array cast representation. Controls confirmed that changed enum values, operators and type lengths remain unequal. All owned containers were removed.

## Actual database copy and isolated restoration

The prepared actual-data path reads one exported repeatable-read snapshot for both the custom-format dump and its proof. The proof binds the capture to exactly 19 unique table manifests, one schema catalog and one snapshot record. Table manifests contain counts and digests, not row values. Concurrent application commits after that snapshot are outside that backup.

The binary stream is encrypted before local persistence. Acceptance requires successful producer/consumer exit, authenticated decrypt-to-hash readback, matching stream length/digest and the custom-dump header. Dump plaintext must remain in bounded pipes/RAM. The current reviewed crypto helpers have a **128 MiB plaintext limit**; exceeding the limit fails closed rather than silently changing the format or storage policy.

Publication stages encrypted bytes separately from managed backups. The same expiry-task lock protects the move and immutable expiry enrollment. Private atomic receipts preserve intent, publication and enrollment milestones, including failures. Contribution-bearing copies retain their conservative original capture time, become eligible for removal at 29 days and have a 30-day hard deadline. A failed or unconfirmed run does not become a successful backup merely because a file exists.

| Actual acceptance | Recorded outcome |
| --- | --- |
| Capture-bound snapshot proof and encrypted stream accepted | Three separately identified actual captures passed. Each encrypted copy contains **138,608 bytes**; the restored copy's custom-format dump contains **137,978 bytes**. |
| Authenticated actual-data readback and immutable expiry enrollment | All three passed. Conservative home intent minus five seconds through authenticated verification, expiry enrollment and durable file flush took **20.377, 21.295 and 20.143 seconds**, respectively. These are observed capture/publication durations, not last-commit RPO measurements. |
| Restoration into an isolated, proved empty PostgreSQL target | Passed: serial actual-data restore took **1.367 seconds**. Plaintext existed only in pipes and tmpfs database files; no plaintext dump file was created. |
| All 19 table counts/digests and reviewed catalog definitions match that snapshot | Passed: **1,232 rows** across all 19 tables matched the same exported source snapshot using complete-row digest/count comparisons. **129 columns, 103 validated constraints and 47 valid indexes** matched; the 13 raw varchar-literal cast differences were the same narrowly normalized representations exercised synthetically. |
| Actual setup-to-verification interval and cleanup | **18m41.080s** from target setup start through verification. This includes readiness correction, helper QA and integration waiting, but excludes prior provider access, client construction/preparation, media/configuration recovery and running-application readiness. The exact local target was removed and its removal verified. This is not full RTO evidence. |
| Bounded recovery-point observation | Passed within the manual observation below; recurring scheduling and continuing five-minute RPO coverage remain unproved. |

Earlier local acceptance failures published or enrolled no new backup, left no new staged ciphertext and preserved the prior intent; source data was unchanged by those attempts. The accepted copy followed correction and verification of local receipt/module invocation handling. No source database writes, deployment, sizing change or external-access allowlist change was performed for this exercise.

These actual results are separate from the synthetic timings, source inventory, running deployment and previous archive-only restore. The accepted snapshots are recoverable database evidence; they do not establish recurring coverage or complete application recovery.

### Bounded manual recovery-point observation

The observed interval was **October 21, 22:21:48.7097523–22:26:36.1307464 UTC**, or **5:21:48–5:26:36 p.m. CDT**. Across the three accepted captures, the maximum conservative age of the previously available point was **166.669 seconds (2m46.67s)**. All 19 table manifests agreed across this bounded observation; the restored copy matched its own exported source snapshot.

This credits the recorded manual sequence only. It did not install or observe an unattended backup schedule, establish a latest committed fixture's continuous recovery guarantee, or prove coverage after the observation ended. The capture intent is deliberately early for retention/freshness accounting; it is not an exact database commit timestamp.

### Operator expiry and cleanup readback

Final private inventory found **four managed ciphertexts and four immutable expiry receipts**: the previous archive copy and three database copies. The separate lifetime ledger remained present, and no staged ciphertext remained. A dry run found no eligible, late or unmanaged item, reported no attention required and preserved the lifetime ledger.

Task Scheduler reported a last run of **22:24:39 UTC**, result **0**; the completed-sweep timestamp advanced to **22:24:41.4164 UTC**. Failure time was null and all missed-deadline, unmanaged-item and validation-failure latches were false. This observer did not manually start the task. Task history was disabled, so this is task/status readback rather than an event-log reconstruction of its trigger. It does not establish logged-out, reboot, offline or continuous host/storage availability, and no real backup was old enough to expire during this check.

The exact local restore target was removed. Task-owned remote helper and RAM-proof directories were removed after ownership/hash checks. Local temporary private SSH-key removal was verified; Ryan confirmed removal of the corresponding temporary Render public-key entry. No plaintext dump persisted; the restored database's plaintext files existed only in the isolated tmpfs target that was removed.

### Bounded availability and resource observation

During **22:14–22:29 UTC**, the provider's returned 60-second MAX samples showed database CPU up to **0.01124 cores** (about **11.24%** of its 0.1-core plan), database memory **75,177,980 bytes** (about **71.7 MiB**), and database connections ranging **10–11**, returning to **10**. Application CPU reached **0.01916 cores** and memory **229,834,750 bytes** (about **219.2 MiB**). These are sampled observations, not instantaneous peaks or proof under guest-write pressure. Existing resource sizing and external database access restrictions were unchanged.

All **30 bounded read-only GET checks** returned HTTP 200. Reported header-response timing had a **0.071-second median** and **0.308-second maximum**. Only two checks overlapped capture-producer intervals. This establishes the observed read availability; it is not a concurrent submission benchmark, guest media acceptance or a write-performance guarantee.

## Recovery boundaries before any web access

A successful database restoration still leaves the following work:

- **Globals and configuration:** recover the necessary database creation settings, roles/access policy, application environment, secrets, canonical origin, capacity settings and compatible application artifact separately. Restoration with no-owner/no-privileges deliberately avoids importing provider role/ACL assumptions. Preserve immutable migration history; do not repair or downgrade it to make a binary start.
- **Accounts and links:** a full database copy includes password hashes, enabled flags, credential versions, throttles and private share-link digests. An older copy can restore an older account or capability decision. Reconcile current account, revocation and publication authority before exposure. In-memory sessions are not recovered.
- **Public exposure:** keep the restored application isolated from public traffic. `MEMORY_ARCHIVE_REVEALED=false` closes couple access; existing public/shared-memory routes also depend on restored visibility and link records. Reveal closed alone is not a complete recovery exposure boundary.
- **Media:** verify a separate independent copy of every surviving saved original required by the selected database snapshot, including exact photo/audio bytes and metadata. Unfinished upload bytes are not saved originals. Preserve retry identity and existing receipts; do not fabricate completion.
- **Current deletion evidence:** retain or recover complete, current independent authority before replay. An older database or media copy must not resurrect erased content. The current archive console's source-authority binding and relocated-ledger/source-bucket-loss limitation remain as documented in [operator recovery](operator-recovery.md#restore-with-current-deletion-evidence).
- **Replay isolation:** the [retention console](deletion-and-recovery.md) uses one storage target for ledger reads and original/staging deletions. Do not point an isolated restored database at live storage merely to read its ledger. Use a separately reviewed current-authority transfer and target-only storage access, then verify scrubbing, absent erased bytes, reserved retry identities and unaffected siblings before reopening.

No actual media copy, current-ledger replay, source-bucket-loss recovery, account activation or web reopening is established by this database exercise. Preserve the existing archive and deletion authority.

## Next work package

1. **Convert the bounded result into a measured operating design.** Use the accepted actual captures and isolated restoration as a baseline, keeping preparation/access, snapshot age, encrypted durable publication, authentication and verification measurements separate. Preserve failed-run evidence and do not reinterpret the observed setup interval as a complete RTO. Every additional restoration must prove target identity/emptiness first; never overwrite the live database.
2. **Implement and observe recurring capture.** Choose cadence from measured snapshot-to-independent-durable-publication duration, scheduler variation and skipped-run behavior. Prevent overlapping captures. A five-minute schedule alone cannot prove a five-minute RPO: scheduling delay, completion/transfer time and failures also consume the available window. Restore approved committed markers to establish an actual recovery-point bound, and verify continuing coverage through the collection period.
3. **Add freshness and failure alerts with an operating policy.** Track the last accepted durable recovery point, copy/expiry failures, prolonged runs and operator access. Send content-free actionable alerts to Ryan through the agreed channel. Define and implement what keeps or places collection on hold when the required freshness/access cannot be verified. A saved setting or successful manual run is not evidence that the unattended path ran. The existing media-upload pause does not stop notes or all writers.
4. **Enforce bounded retention on every copy.** Cover encrypted primary/independent copies, incomplete or failed captures and provider copies. Preserve incident latches and independently verify automatic expiry. The home task's login, power, storage and runtime dependencies require explicit availability coverage; content-free lifetime deletion evidence stays separate from contribution-bearing expiry.
5. **Rehearse complete operational restoration.** Include portable key access, database, original media, current deletion authority/replay, account/configuration reconciliation, a compatible running application with private boundaries, committed receipts and deliberate same-item recovery. Time the whole process at representative size, including preparation and the recovery destination. Record source/host/provider-loss assumptions honestly before claiming the one-hour RTO.

The [operator recovery targets](operator-recovery.md#location-retention-and-recovery-targets) remain authoritative. Continuous five-minute database RPO, complete one-hour RTO, recurring media/ledger copies, all-copy expiry and alert delivery remain open until their own evidence passes. The [promotion guide](go-live-kevinandmel-com.md) and Go Live checklist continue to govern opening collection.
