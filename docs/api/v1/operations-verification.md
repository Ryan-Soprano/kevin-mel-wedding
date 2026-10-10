# OPS-03 local operations verification

## Scope

This slice adds an offline, read-only readiness report and a disposable application rollback rehearsal. It does not change public health, guest contracts, migrations, dependencies, hosting configuration or CI configuration. The [operations runbook](../../runbooks/operations-and-rollback.md) describes operator commands, pause/full-stop behavior, incident response and remaining hosted gates.

## Readiness report checks

Focused automated checks cover the following boundaries:

```bash
./backend/mvnw -f backend/pom.xml --batch-mode \
  -Dtest=ReadinessAdministrationTest,OperationsReadinessPostgresTest test
node --test scripts/rollback-helpers.test.mjs
```

- Expected-environment and explicit nonlocal database configuration guards.
- A PostgreSQL read-only consistent transaction with bounded connection/query timeouts; no mutation, migration, scheduler or provider IO.
- Bundled immutable migration history validation before aggregate queries, including missing/failed/unknown/changed history.
- Exact current column names/types/nullability for the ten known application tables, without claiming every index/constraint/default is verified.
- Conservative original/staging reservation limits, unfinished media/grants and overdue deletion work using synthetic data.
- Content-free reports and safe failure/exit behavior; configured switches remain separate from unchecked provider/job/backup health.

## Rollback rehearsal checks

The helper resolves two distinct existing application images and the existing PostgreSQL image to immutable IDs and rejects equal executable-JAR hashes. It uses exclusively owned disposable resources on a standard Docker bridge, with loopback-only app ports and no database host port. This is not network egress isolation. It establishes a previous-artifact baseline, switches to the candidate, rolls back to the previous artifact and returns to the candidate against the same database. Before restarting the previous application against candidate-written data, it requires equal bundled migration manifests and matching successful database history.

The actual packaged console report is checked against independently known fixture totals, configured gates and the explicit unchecked-provider/job/backup statements, with history and archive rows unchanged afterward. Negative cases temporarily alter only this invocation's disposable history: changed checksum, failed migration and an unknown future migration must refuse rollback while the prior app remains stopped. The exact baseline is restored after each controlled rejection; the helper never repairs production history. An optional existing older-schema artifact exercises the same refusal without changing history.

The candidate creates named/anonymous notes through real HTTP, exercises same-key replay and changed-payload conflict, and reviews controlled photo/audio metadata alongside notes. Rollback and the final candidate restart must retain exact receipts, mixed inbox filters/details, review revisions and deletion deadlines, private authorization/CSRF behavior, original associations and independently retained bytes. Restarted processes must reject the old session; sign-out must prevent reuse. The helper verifies final absence of every container/network carrying its unique ownership label after success or failure.

Synthetic fixtures establish functional invariants only. Independently retained fixture bytes are not a real R2 durability or browser-playback result. No real account, guest content, bucket, retained project database or provider resource participates.

## Recorded local verification — October 9, 2026

| Check | Observed result |
| --- | --- |
| Full backend suite in Linux with PostgreSQL 17 and FFmpeg | 322 passed; zero failures, errors or skips |
| Frontend contract suite | 286 passed; zero failures or skips |
| Frontend lint and production build | Passed |
| Rollback helper argument, local-Docker and bounded archive checks | 3 passed |

The final packaged rehearsal evidence below identifies the actual image and executable-JAR bytes. The local images have no OCI revision label, so these hashes identify the tested artifacts without claiming independently embedded Git provenance. The PostgreSQL fixture uses the existing immutable image `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.

| Artifact | Immutable local image ID | Executable JAR SHA-256 |
| --- | --- | --- |
| Final OPS-03 candidate | `sha256:503bf93fa0f63d2a460d38cc2ac6894ba5fd4059e9755c2e049adaddb9401052` | `68e274f522f4b347b59197d530a494ade7443a351ed09230b382a08ac896cbca` |
| Compatible previous application | `sha256:fc4ef11031ca91272882f741501940743e051ddfea78fd891d5bb7903536cb96` | `457c38ba33ac407d7766b6d1e4279ce31b78bd8eff4a9b7f830e2ea6342cfed6` |
| Older-schema rejection case | `sha256:9e31e708fda72ed3e8a31da7f11e70e00b76a28acef29fe2aa9bb0d8eb35a363` | `dd028952127a38bc8ac40536313ad92c3d857fd04845b65036665f30aa72fbd5` |

The full helper passed with this final candidate: packaged report totals and read-only invariants, changed/failed/unknown history refusal, older-schema artifact refusal, compatible previous-artifact rollback, final candidate restart, mixed private identities/retries/review/deletion/session checks and original fixture-byte preservation. Cleanup confirmed every exclusively owned rehearsal container and network was absent. The final full backend run above includes the recursive migration-inventory hardening, including a byte-identical nested path replacing a flat migration.

## Acceptance still open

Actual hosted isolation/HTTPS/operator access, alerts, scheduled independent backups and expiry, source-loss ledger recovery, representative recovery timing, real-provider original integrity and QA-02 physical-device/accessibility checks remain open. Neither exit `0` nor a local fixture pass authorizes production collection.
