# Home recovery verification — October 21, 2026

Ryan requested inspection and verification of the home recovery setup, followed
by work on the remaining launch gaps. This record supplements the
[October 20 rehearsal](recovery-rehearsal-2026-10-20.md). **Launch remains HOLD:**
local ciphertext integrity and expiry verification do not establish continuous
database backup, complete disaster recovery or the launch RPO/RTO.

Later on October 21, the [full database feasibility test](full-database-recovery-feasibility-2026-10-21.md)
accepted three encrypted database captures and verified one isolated restoration.
That follow-up supplements the historical results below; continuous five-minute
RPO and complete one-hour RTO still remain open.

## Application and infrastructure baseline

The user redeployed the existing Render application. Provider readback identifies
commit `3b2fd0a985fdc526843dde34bb8a6086a8e2da87`, deployment
`dep-dbchp7dg1s2s73blbqa0`, live October 21 at 20:13:36 UTC / 3:13:36 p.m. CDT.
Its application, Docker, script and workflow sources match the prepared
`4f23d9f` release; the later commit changes the handoff only. The prior
exact-release CI remains evidence for those application sources.

The existing one-CPU / 2 GiB single application instance retains automatic
deployment off. The existing PostgreSQL 17 instance is available at its retained
size, with its external allow list empty. Public guest HTML/assets and health
returned HTTP 200 at 20:19 UTC. These requests establish availability, not full
application readiness or a production-profile cutover. No provider settings,
accounts, stored submissions, domain associations or reveal setting were changed
by this home verification.

## Verified at home

| Check | Result and scope |
| --- | --- |
| Installed expiry definition | Reviewed registration helper readback passed: exact current operator, Limited/Interactive, enabled hourly and sign-in triggers, catch-up/wake, no startup trigger, IgnoreNew, five-minute execution limit. Installed runtime and helper inventory validation passed. |
| Actual ciphertext archive | Authenticated AES-GCM decryption through the reviewed reader passed, and its plaintext digest matched the trusted rehearsal receipt. Output went only to a hashing/discard stream; no plaintext file was created. Source ciphertext was unchanged. |
| Independent lifetime ledger ciphertext | The same authenticated-decryption and trusted-digest checks passed, with no plaintext file and no source change. This verifies the retained copy, not its freshness against today's live authority. |
| Immutable expiry enrollment | Original October 20 capture and day-29 eligibility/day-30 deadline were preserved. Expiry dry-run found no eligible or unmanaged backup and required no cleanup. |
| Observed execution at scheduled time | Observer started at 20:21:13 UTC. The next scheduled time was 20:24:38; execution was observed at 20:24:39, completing at 20:24:42 with result 0. The next hourly time advanced. The observer did not invoke a manual start. Archive, receipt and lifetime ledger were unchanged, and incident latches stayed clean. Windows task history was disabled, so no trigger-reason event was available. |
| Existing synthetic controls | Fresh isolated reruns passed 33 expiry controls and 31 CMS controls using the installed reviewed PowerShell 7.6.5 runtime. Historical helpers and receipts were preserved. |
| New portable escrow controls | An additive prototype passed 31 controls and independent review, including modern PFX profile/MAC import, incorrect-password/certificate/hash rejection, tampering, size/ACL/reparse guards, source preservation and decryption without the original DPAPI wrapper. Real-key acceptance is separate below. |
| Linux portability controls | Six synthetic controls passed using a fixed local Linux image with no network, a read-only filesystem, exact encrypted-file mounts and container output logging disabled before crypto starts. The actual human-password/key-copy acceptance remains separate. |

The actual archive's conservative capture is **October 20, 23:52:36 UTC**. It was
about 20.46 hours old when verified at 20:20 UTC on October 21. This is an archive
snapshot, not a full database backup or a five-minute recovery point. Its expiry
eligibility is November 18 at 23:52:36 UTC; its hard deadline is November 19 at
that same UTC time. Enrollment and verification did not reset its age.

Private detailed receipts, source bindings and machine-local helpers remain in
the approved operator locations. No backup identities, ciphertext/plaintext
hashes, key material, capabilities, credentials or guest content are included
here. Machine-local code and evidence do not transfer through Git.

## Portable recovery access

The original recipient remains encrypted PKCS8 with a DPAPI CurrentUser-wrapped
random password. Original-profile access was verified again. The additive
portable helper exports encrypted PKCS12/PFX with explicit AES-256-CBC,
PBKDF2-HMAC-SHA256 and SHA256 MAC at 300,000 iterations. Passwords must be
20–1024 printable ASCII characters because the tested cross-tool password path
does not establish Unicode interoperability.

The prototype authenticates and checks the trusted plaintext digest before
streaming to a caller-owned private sink. Failed streaming must be discarded;
no partially returned stream is a verified recovery artifact. Real operation
requires a human-entered local password, separate retention of that password,
verification of the actual archive and ledger through the portable key, and an
independently accessible encrypted-key copy. Synthetic success does not fulfill
those steps. The original recipient and DPAPI wrapper must remain intact.

These machine-local prototypes refuse payloads above 128 MiB. Their small
synthetic fixtures do not establish successful maximum-size decoding inside the
128 MiB Linux probe container, or recovery of the eventual wedding archive.
Representative-size complete recovery remains an independent launch gate.

**Actual portable escrow passed October 21 at 20:39:54 UTC / 3:39:54 p.m. CDT.**
Ryan entered the new password in a reviewed local masked-input window and
attested separate retention. The encrypted portable key decrypted both actual
archive and retained ledger copies through the reviewed Windows path and an
isolated Linux runtime, matching the trusted plaintext digests. The original
recipient and ciphertexts were preserved. The new encrypted key and receipt
passed private-ACL and ciphertext-identity readback. No plaintext files were
created; container output logging was disabled before crypto began.

Ryan selected private cloud storage for an independently accessible key copy.
The connected account and a dedicated folder were verified owner-only before
upload. The encrypted key and verification receipt were uploaded, and both
files' permissions were read back as owner-only. A fresh authorized download of
the encrypted key matched the verified local file's SHA-256 in memory at
20:46:35 UTC. The password, original DPAPI wrapper, original encrypted PKCS8,
and contribution-bearing archive were not uploaded. Private operator records
retain the cloud location; no private cloud IDs or links belong in Git.

**Ryan confirmed access from another device** to both the private cloud folder
and the separately saved password. This is human-reported account/secret access
evidence. The Linux check proves decryption without Windows DPAPI on the same
physical host; the cloud readback proves the encrypted copy's current bytes.
Executing complete recovery on another physical machine remains unproved.

## Availability and remaining launch work

Ryan confirmed that the home computer can remain powered on, signed in, online
and connected to the recovery drive during wedding collection. Locking the
session does not require logging out. This is an operating commitment, not a
tested offline/reboot guarantee or 30-day availability proof. Preserve the
existing failure/late/unmanaged-file latches. Volume encryption could not be
confirmed through the available read access, so retain ciphertext only.

1. Reuse the verified portable key for complete recovery execution on another
   physical machine. Actual key creation, independent cloud-copy integrity and
   Ryan's separate-device account/password access check are already recorded.
2. Establish full database backup and isolated restoration, including the
   records omitted from archive exports and current configuration/account
   recovery with reveal closed. The existing archive console requires stopped
   writers and expired PUT grants; it is not an online recurring DB backup job.
3. Meet the **five-minute database RPO** with a measured durable recovery point.
   Render's [current PITR procedure](https://render.com/docs/postgresql-backups)
   excludes the latest ten minutes, so PITR alone does not satisfy this gate.
   A periodic job's interval plus capture/upload/verification delay and missed
   runs must fit the target; alerts alone do not create a recoverable copy.
4. Establish recurring independent media/current-ledger copies and content-free
   backup-freshness/failure alerts. Verify every contribution-bearing copy's
   expiry and coverage when the home host or drive is unavailable.
5. Resolve total original-ledger-authority loss under the existing fail-closed
   identity rules. A relocated ledger copy cannot currently replace the source
   endpoint/bucket identity. Do not weaken that guard to obtain a passing restore.
6. Time a complete recovery, including access/preparation, full DB, media,
   current deletion replay, configuration, verification and a running
   reveal-closed app, within one hour at representative size.

The [operator requirements](operator-recovery.md#location-retention-and-recovery-targets),
[deletion authority rules](deletion-and-recovery.md) and
[Go Live checklist](../product/go-live-checklist.md) remain authoritative.

The next database work item is a measured, isolated feasibility test of a
single-flight [PostgreSQL 17 logical dump](https://www.postgresql.org/docs/17/app-pgdump.html)
over the existing internal connection, encrypted before persistent storage and
copied independently. A full dump can capture a consistent database during
writes, but its completion/freshness and resource cost need measurement at the
retained application/database sizes. A five-minute scheduling interval is not
proof of a five-minute recovery point. A hard ceiling also needs an explicit
policy for durable writes when verified backup freshness becomes insufficient,
including background and in-flight work. No such scheduler or admission policy
was installed by this home-key/expiry work. Preserve the existing requirement
until a proven implementation or Ryan's explicit requirement decision.
