# Local operational readiness and application rollback — OPS-03

**Current hold, Friday, October 23:** Final `96826fb` is deployed with maintenance ON, automatic deployment OFF and operational signals enabled. Its exact-artifact isolated restore and full encrypted backup passed independent acceptance on the final running instance. The backup and operational collector tasks have independently accepted natural scheduled runs. Both live watchdogs are enabled with host proof and accepted manually dispatched live baselines. The genuine operational stale warning and recovery after a controlled collector pause/resume reached Gmail and Ryan's phone; collector continuity and natural all-clear resumption passed independent checks. Automatic GitHub watchdog firing after activation remains unobserved. Keep Coming Soon and maintenance until that and the attended canonical iPhone/placemat/new-original checks pass. The older failed capture remains unaccepted with cause unknown and preserved evidence.

Ryan is the sole infrastructure operator. Kevin and Melanie retain moderation authority. This procedure prepares checks; it does not open collection, activate real accounts or establish recurring backup/alert acceptance. Ryan approved promotion of the existing hosted resources at their current sizes, with no second stack. His latest preferred cutover is Friday afternoon, October 23, conditional on readiness and without rushing. Couple wording, registry and contribution-type approval are confirmed. Keep deployment deliberate and collection behind Coming Soon until operational and canonical acceptance.

Start home resumption with the [primary handoff](../../HANDOFF-2026-10-19.md#1-resume-here) for the latest deployed identity, credential checks and maintenance state. Keep maintenance enabled until the remaining private readiness and release gates pass; a clean startup does not establish complete storage or backup readiness.

## Read-only operator report

`com.kevinmel.archive.operations.ReadinessAdministration` runs directly as an offline console. It starts no web server, migration, retention scheduler or storage client. It reads a bounded, consistent PostgreSQL snapshot and prints fixed labels plus aggregate counts/bytes, never guest content, record IDs, retry keys, signed URLs, credentials, database addresses or exception details. Keep even aggregate operational evidence private.

Use the existing [local console classpath instructions](account-access.md#build-and-launch-locally), with compiled classes and dependencies from the same reviewed build. In Git Bash on Windows:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" \
  com.kevinmel.archive.operations.ReadinessAdministration --help
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" \
  com.kevinmel.archive.operations.ReadinessAdministration --expect-environment local report
```

For the packaged JAR, use its existing Spring Boot launcher rather than starting Spring:

```bash
java -Xmx256m -Dloader.main=com.kevinmel.archive.operations.ReadinessAdministration \
  -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --expect-environment local report
```

Configure the intended database through the existing private `MEMORY_ARCHIVE_DB_*` settings. Nonlocal reports require explicit URL, username and password; the expected environment must match `MEMORY_ARCHIVE_ENVIRONMENT`. An environment label alone cannot identify a database: Ryan must verify the actual private target. The console loads `application.properties` and environment/JVM overrides, not profile-specific files. Supply the running service's effective capacity/gate overrides when comparing its configuration. In particular, do not infer staging's finalization limit from the console defaults.

The report validates the database migration history against the exact immutable migrations bundled with its own build before reading archive aggregates. A missing, failed, unknown or changed migration makes the report unconfirmed; it never repairs history or applies migrations. Connection and statement timeouts bound the check. A database outage is different from the public `/api/health` liveness response, which remains deliberately minimal.

`SCHEMA_REVIEWED` additionally checks names, PostgreSQL type names and nullability of columns in the eighteen known application tables, including private timeline events, links/state, tags/associations and memory share links. It does not check type modifiers such as VARCHAR length, unrelated tables, indexes, constraints or defaults, or establish an older binary's behavior. The bundled inventory permits the repository's blank `.gitkeep` marker only; it does not permit an extra migration to escape validation.

Inspect original/staging reservations against their configured limits, pending/failed media, live-grant count and overdue deletion work. Staging reservations include every retained grant, including expired ones. Database reservations count unfinished and soft-deleted work conservatively; they do not measure actual provider usage or confirm object removal. Review either budget at 80% and follow [pause/capacity/cleanup](guest-protection.md) before raising limits. Failed media needs deliberate receipt/retry reconciliation; an overdue retention backlog needs the [deletion runbook](deletion-and-recovery.md), not direct row deletion.

Configured storage, audio, reveal, upload pause and retention switches describe this console process's settings. Enabled storage is **unchecked**: no provider request occurs. Retention job health, backup freshness, alert delivery, memory/CPU and hosted RPO/RTO are not observed by this report. A configured switch does not prove the running application has the same settings or that a scheduled job has succeeded.

Exit `0` means the observed database/schema/aggregate checks passed, including the report's action thresholds; it is not a launch or provider-readiness approval. Exit `1` means action is required or the database checks are unconfirmed. Exit `2` means usage, target or configuration was refused. Preserve the fixed outcome and timestamp in private operator evidence, without copying process settings or raw diagnostic output.

The same console can check an operator-held previous packaged JAR without executing it:

```bash
MSYS2_ARG_CONV_EXCL='*' java -cp "$archive_account_classpath" \
  com.kevinmel.archive.operations.ReadinessAdministration --expect-environment local \
  schema-check --prior-jar "$archive_prior_jar"
```

Every `schema-check` requires explicit private database URL, username and password, including `local`; it cannot fall back to the local development target. Use a reviewed private artifact path, not a downloaded/unidentified binary. `ROLLBACK_SCHEMA_MATCH` means the two bundled migration manifests agree and the connected database has the matching successful history. `ROLLBACK_SCHEMA_UNCONFIRMED` keeps rollback closed. This check alone cannot establish application behavior, original integrity or hosted readiness; the two-artifact rehearsal supplies the tested behavioral evidence.

## Incident response and stopping collection

For a local process, application logs are in the terminal that started the backend. For the reviewed local application container, Ryan can inspect its private output with `docker logs "$archive_application_container"`, using the known container name rather than searching unrelated containers. Public `/api/health` supplies liveness only; the private console report observes the database. Record the actual hosted log/health destinations and operator access for the retained promotion target in the [launch execution record](go-live-kevinandmel-com.md#7-fill-the-launch-execution-record).

1. Record the time, reviewed application artifact/commit and content-free symptom. Inspect the private application log and readiness report; do not enable SQL/request/SDK logging that could include guest data or capabilities. A successful liveness request alone cannot establish durable submissions.
2. For media capacity pressure, set `MEMORY_ARCHIVE_UPLOADS_PAUSED=true` through the reviewed runtime configuration. On the retained Render service, use **Save and deploy** to apply the runtime setting to the reviewed artifact and verify the resulting deployment and effective pause; **Save only** followed by Restart reuses the old deployment settings. This stops new photo/audio intents and upload grants; notes, issued grants, receipt recovery and finalization remain available. It does not revoke signed permissions. Use Maintenance Mode if the incident requires a full collection stop.
3. For a full incident or any recovery/rollback requiring quiescence, stop application traffic and every application/maintenance process. An upload pause is insufficient. Wait at least five minutes for issued PUT permissions to expire. Preserve the database, original objects, current independent deletion ledger, credentials and existing guest retry identities.
4. Diagnose the database, storage or application failure privately. Use [operator recovery](operator-recovery.md) for a separate isolated restore when data recovery is required. Do not clear tables, remove object prefixes or overwrite current deletion evidence to make a restart look healthy.
5. Reopen only after the intended configuration, migration history, committed receipts, private account/review boundaries, original integrity and deliberate same-item recovery are verified. Test with synthetic content first. Communicate an accurate retry instruction; a failed request must not be described as a saved contribution.

A provider rollback can restore the older artifact's environment values, including replaced credentials, profile, origin and safety flags. Keep maintenance enabled while privately verifying settings and operations against retained current data/authority. Both obsolete provider logins have now been retired after scoped checks and Ryan's approval; the current default passed fresh read-only identity/schema checks. Use that retained login in rollback settings and future clients, following the [recovery reconciliation](operator-recovery.md#wedding-automation-activation--october-22). An application rollback must not restore retired credentials or overwrite current database/deletion evidence.

## Disposable rollback rehearsal

`scripts/smoke-rollback.mjs` exercises a candidate and a previous application artifact against the same newly created PostgreSQL 17 database. It never builds or pulls images, connects to an existing database/bucket or deploys a service. Both application images and `postgres:17` must already exist locally. It resolves the images to immutable local IDs and records only nonsecret technical outcomes. Its containers/network and any fixture storage belong exclusively to this invocation and are removed after success or failure.

```bash
node scripts/smoke-rollback.mjs \
  --candidate-image "$archive_candidate_image_id" \
  --previous-image "$archive_previous_image_id"
```

Set the two variables to the full local `sha256:` IDs from `docker image inspect --format '{{.Id}}' <reviewed-local-tag>`. The helper rejects mutable tags and requires genuinely distinct application artifacts. It establishes a previous-artifact baseline, switches to the candidate, rolls back to the previous artifact and returns to the candidate against the same database. Its conservative compatibility gate requires the exact same bundled migration set and checksums, plus the corresponding successful database history. A different or unrecognized schema is refused before restarting the previous application against candidate-written data; this gate does not infer that an older binary can interpret a newer schema. Applied migrations remain immutable. Different-schema rollback needs an explicit, separately reviewed compatibility plan; fix forward or perform an isolated, verified recovery when that plan cannot be established. Never reverse migrations or edit Flyway history as an automatic rollback step.

The rehearsal checks committed receipt/retry identity, private archive/account behavior and synthetic original associations across the application switch. Consult [OPS-03 verification](../api/v1/operations-verification.md) for the exact exercised paths and fixture limits. A local rollback pass proves only these two pinned artifacts and the tested schema/data; it does not prove every earlier version is safe or establish physical-browser, real-R2, host memory, backup retention or recovery timing.

## Later hosted acceptance

The [latest recovery evidence](../product/cutover-readiness-review-2026-10-22.md) credits authorized disposal, lifetime authority and scoped historical recovery. The failed older scheduled capture remains unaccepted with cause unknown; exact evidence was preserved and its marker independently reconciled. Final `96826fb` is running on the final instance live October 23 at 04:04:52 UTC / October 22 at 11:04:52 p.m. CDT, with maintenance ON, auto-deploy OFF and operational signals true. All 27 guarded startup/process checks passed; its exact-artifact contained restore at 04:16:02 UTC and full encrypted backup at 04:18:23 UTC are independently accepted. The enabled backup and operational collector tasks each have two independently accepted natural scheduled runs; their latest Scheduler results were 0. New canonical canary originals still need binary-media backup/readback. Canonical phone/privacy acceptance remains open; authenticated private-account acceptance is separate from anonymous launch.

Current natural scheduled backup and collector runs are independently accepted. Keep OPS-03 open until automatic GitHub watchdog firing after activation is observed and accepted; continue measured freshness and all-copy expiry checks. The [operating policy](operator-recovery.md#location-retention-and-recovery-targets) retains measured five-minute freshness and best-effort restoration. Both the earlier backup synthetic pair and fresh operational warning/recovery pair reached Gmail and Ryan's phone. Synthetic delivery does not establish live detector/watchdog operation. At Monday, October 26, noon CDT / 17:00 UTC, disable and verify both watchdog enable variables and stop/disable the operations collector task; preserve backup/expiry tasks. No automatic end is installed.

Ryan selected automatic failed-guest-save, storage and capacity alerts before launch. PRs 123 and 124 are merged; final `96826fb` has operational signals enabled. Independently reviewed collector tooling and an actual read-back all-clear observation are accepted. Two natural scheduled collector runs and their all-clear GitHub publications are independently accepted; live watchdog gates are enabled, and the genuine operational stale/recovery pair reached Gmail and Ryan's phone. Automatic GitHub watchdog firing remains unobserved. The new synthetic warning/recovery pair's Gmail/phone delivery is confirmed; backup monitoring does not close the separate operational detector criterion. A successful comment API response is not delivery proof.

Provider controls remain separate: GitHub's $20 Actions stop-at-limit is verified. Cloudflare's $1/$20 thresholds are email-only; its sample reached Gmail and phone delivery remains untested. The authorized Cloudflare $20 October 24–25 CDT window has no hard stop or automatic end. Preserve the documented caps and verify actual shared usage; these controls do not form a combined provider spending stop.
