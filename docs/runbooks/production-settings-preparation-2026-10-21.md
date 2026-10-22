# Production settings preparation — October 21, 2026

Ryan originally requested preparation for **Thursday, October 22 at 6 p.m. CDT / 23:00 UTC**, keeping Coming Soon until the attended cutover. On October 22 he made that time flexible: the attended cutover may begin at any time today once preparation is complete and he records the readiness/go-no-go decision. Promote the existing app/database/private bucket at their current sizes. No second hosted stack, scheduled launch, account activation, reveal or fixture cleanup is part of this preparation.

**Latest state, October 22: Ryan manually deployed application commit `726cb035fd041e2089b9864f874686ef822f0dc4` as `dep-dbd7vgfavr4c73d4gih0`, live at 21:28:41 UTC / 4:28:41 p.m. CDT. Maintenance was restored ON around 21:33 UTC / 4:33 p.m. CDT. Guarded running-process startup-input checks and private database/schema checks passed.** [Exact-source CI 39857342756](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39857342756) passed, with independent frontend-diff review clear; configured GitHub AI review is not credited for this direct user commit. The [home handoff](../../HANDOFF-2026-10-19.md#1-resume-here) retains the filtered command for affected rechecks. Keep maintenance **ON**, automatic deployment **OFF**, reveal `false`, retention `false` and canonical Coming Soon in place. The new approximately 21:58 UTC DB-only checkpoint passed authenticated readback, independent encrypted F: publication, immutable expiry enrollment, same-snapshot proof and exact source-proof cleanup. Full media/recovery, scheduled backup operation, credential-consumer retirement and canonical acceptance remain separate. No domain move or canonical public canary occurred.

The original Save only action and screenshot below are historical preparation evidence, not current credential authority. Ryan saved the four intended values without changing the running deployment at that step; the connector lacked a save-only update. Later deployments and security remediation are recorded separately below. Never obtain current DB credentials from an old screenshot or chat value.

## October 22 credential remediation and current deployment

A database password was inadvertently pasted into chat and must be treated as
exposed. This document records no value, username or raw connection URL. Ryan
created a replacement default DB credential and privately confirmed that the
app's saved username/password match it; he used **Save only** before authorizing
the deployment. Use only the current private Dashboard default credential for
app/home consumers. Home backup/recovery clients must be reconciled before old
credential retirement; complete remediation/retirement is not yet verified.

The historical credential deployment was `dep-dbd5u4g473hc73dh8gkg` on application
commit `0a343abf1c2047af8870707627b9ef9cefa32b93`, created at 19:08:02.439722 UTC and
LIVE at **19:08:39.066959 UTC / 2:08:39 p.m. CDT**. Backend/frontend CI checks
passed on that exact source; backend/Docker sources match earlier `caec4a9`.
The complete 43-entry startup-log readback for 19:08–19:10 UTC shows production
profile, a new Hikari JDBC connection/pool, validated/up-to-date Flyway schema,
and Tomcat/application startup. No authentication, permission, migration or
actual OOM failure was found; the complete error-filtered query returned zero
entries. Maintenance remains ON and automatic deployment OFF at the existing
single 1-CPU / 2 GiB size. Public provider root/health GETs returned maintenance
503; the canonical homepage returned 200 Coming Soon. No DNS move occurred.

Historical later readback showed the same application commit deployed as
`dep-dbd60hnavr4c73cuk67g`, live October 22 at **19:13:45.411104 UTC /
2:13:45 p.m. CDT**. Startup at 19:13:34.548 UTC confirms exactly one active
profile, `production`; maintenance remains enabled, automatic deployment off,
with the same Ohio single 1-CPU / 2 GiB instance. Provider root/health return
maintenance 503 and canonical apex/`www` still serve Coming Soon. The earlier
JDBC/Flyway observation is historical, not fresh verification of all effective
settings or private readiness on this later deployment.

**Historical observation at 20:40:12 UTC on October 22, on `0a343ab`:** the new Shell report returned
`OPERATIONS_OBSERVED_CHECKS_PASS`, `DATABASE_AVAILABLE`, `SCHEMA_REVIEWED` and
`READINESS_EXIT=0`. This confirms read-only database/schema/aggregate checks,
not current R2 bytes, backups, complete consumer remediation or canonical
acceptance. Current `726cb03` readiness subsequently returned the same pass flags;
its guarded running-process startup-input checks also passed, with reveal/retention false.
The handoff owns the one-line command and continuation; use it for affected
future rechecks without hardcoding old credentials. Maintenance remains on.

Earlier private console DB/schema observations, all ten guarded PID1 startup
checks, and no-extra-override/no-external-configuration checks passed on the prior
deployment. Ryan confirmed that the internal DB target matches the retained
database. Keep those dated results as historical evidence; they are not fresh
post-rotation acceptance. Render rollback can restore historical environment
values, so a fallback must be reconciled with current credentials and preserved
production/reveal/retention settings before traffic reopens.

Ryan confirmed no external Render Log Stream destination and both R2 public
access mechanisms off. The endpoint alone did not establish a historical bucket
name. He reported deleting all `originals/` entries in the app-configured bucket
about thirty minutes before the report, confirmed that these were only
synthetic/rehearsal uploads, and intended to keep none. No DB metadata or ledger
cleanup is proved by that object operation. Preserve current deletion authority
and remaining bytes; reconcile DB/object/ledger state privately before accepting
backups or opening collection. Do not restore unwanted rehearsal originals,
reset the archive or create replacement canaries merely to clear this gap.
The October 20 approved cleanup concerned only a separate isolated restore
target; its scope did not authorize source-wide original deletion.

## Prepared batch

The following four-value batch is already saved on [the existing full-app service](https://dashboard.render.com/web/srv-db7nqu67bikc73bhr580). It is retained here as the preparation record; read it back privately rather than repeating the completed save. The original instruction was to edit these four existing values together, preserving every other variable, and choose **Save only**:

```dotenv
SPRING_PROFILES_ACTIVE=production
MEMORY_ARCHIVE_ENVIRONMENT=production
MEMORY_ARCHIVE_PUBLIC_ORIGIN=https://kevinandmel.com
MEMORY_ARCHIVE_REVEALED=false
```

Read back all four values privately. Use exactly `production`, without an additional `staging` profile. Preserve bucket/deletion authority, stable throttle secret, audio/storage/retention controls, upload state, media limits, one finalizer, heap, port and proxy configuration. The later DB security rotation above is a separate authorized action; do not enable retention or rotate unrelated secrets merely to relabel the environment.

The source-checked production profile already provides Render binding/port/forwarding, Secure cookies, explicit database requirements and one finalizer. The working frontend already supports the rehearsed audio feature. These four runtime changes need no frontend rebuild. The later readback below supersedes the preparation's earlier pending provider-value/override audit. Use the full [production matrix](go-live-kevinandmel-com.md#2-prepare-the-live-application) to verify effective profile, property/JVM/start-command overrides and running acceptance after deployment; saved settings are not running proof.

## Save-only boundary

During the original preparation, [Render Dashboard Save only](https://render.com/docs/configure-environment-variables) retained the running deployment. Saved values apply to the **next deployment**, not to a clock time, so the original instructions held manual/API deployments and rebuilds. Ryan subsequently deployed on October 22; verify that deployment's effective settings before cutover. Keep automatic deployment off and further corrections deliberate. A restart reuses the current deploy's settings. Do not link an environment group while staging a batch because linking deploys.

The Render MCP environment-update wrapper is unsuitable here: its [official implementation](https://github.com/render-oss/render-mcp-server/blob/main/pkg/service/tools.go) merges/updates variables and then calls `TriggerDeploy`, including with `replace=false`. Automatic deployment off does not prevent this explicit call. The underlying [bulk REST endpoint](https://api-docs.render.com/reference/update-env-vars-for-service) has different semantics: it does not automatically deploy but replaces the complete variable list. No API credential was created or full-list replacement attempted for this four-value action.

## Evidence and remaining acceptance

| Item | Recorded state |
| --- | --- |
| App target | `kevinandmel-staging`, `srv-db7nqu67bikc73bhr580`, Ohio, one 1-CPU / 2 GiB instance |
| Historical save-only baseline | `dep-dbchp7dg1s2s73blbqa0`, commit `3b2fd0a985fdc526843dde34bb8a6086a8e2da87`; automatic deployment off, maintenance off |
| Current October 22 deployment | `dep-dbd7vgfavr4c73d4gih0` / application commit `726cb035fd041e2089b9864f874686ef822f0dc4`, live 21:28:41 UTC; maintenance restored ON around 21:33 UTC, automatic deployment OFF. Guarded running-process startup-input checks and private readiness passed; full media/recovery/scheduled backup/canonical acceptance remains open |
| Historical afternoon deployment | `dep-dbd60hnavr4c73cuk67g` / application commit `0a343ab`, live 19:13:45.411104 UTC; production startup and 20:40:12 UTC database/schema report passed within their recorded scope |
| Historical credential deployment | `dep-dbd5u4g473hc73dh8gkg`, same application commit, live 19:08:39.066959 UTC; complete production/JDBC/Flyway/Tomcat startup observed after the replacement DB credential was saved privately |
| Historical morning deployment | Ryan manually deployed `dep-dbcvtr6q1p3s73dfu31g`, live at 12:18:24.182776 UTC / 7:18:24 a.m. CDT, commit `caec4a96656b1cde101a5ee470c8fd90698878c9`; same service/size, automatic deployment off and maintenance off then. Application sources matched `3b2fd0a`; startup logs confirmed production profile. Later private console/PID1 checks retain their pre-rotation scope |
| Bounded app-log readback | No error-level application entries returned for 12:18–12:27:22 UTC on October 22; this is a bounded observation, not uptime or complete launch acceptance |
| Saved four-value batch | Ryan replied done to the Save only instruction and supplied a screenshot showing exactly the four intended values; no independent environment-read operation is available through the connector |
| Post-save unchanged deployment and public Coming Soon | October 22 at 00:20:31 UTC / October 21 at 7:20:31 p.m. CDT: same live deploy/commit, no newer deploy listed, auto-deploy off; certificate-validated apex and `www` both 200 Coming Soon, `www` redirects to apex |
| Public DNS readback | Apex A `216.24.57.1`; `www` CNAME `kevinandmel-coming-soon.onrender.com`, unchanged from baseline; resolver TTL 1761 seconds, not an authoritative configured-TTL inventory |
| Printed placemats | Ryan confirms QR printed on every guest placemat, exact encoded URL `https://kevinandmel.com`, and current Coming Soon access; post-cutover physical scans remain pending |
| Canonical routing and current public hold | Canonical homepage remains 200 Coming Soon; provider root/health return maintenance 503. No domain/DNS move or controlled canonical canary occurred. Earlier guest/health 200 observations are historical; neither public status nor source equality verifies current media bytes or launch acceptance |

The private ignored `logs/production-settings-20261021.local/` folder holds the four nonsecret candidate values and content-free receipts under owner-only access. No credential values or guest content belong in this record. The initial screenshot visibly confirms profile/environment `production`, canonical HTTPS origin and reveal `false`; masked surrounding values were not inspected at that step. The later readback below adds preparation evidence. Saving the batch is not proof of the running configuration, private readiness, canonical browser CORS, production TLS, actual placemat/phone saves or any deferred recovery requirement.

## Later home configuration and R2 readback

The [October 22 handoff](../../HANDOFF-2026-10-19.md#later-home-production-configuration-readback) records the later home readback that superseded the original pending preparation audit. Ryan confirmed the saved production profile/environment, canonical origin and reveal `false`. His full environment screenshot confirmed audio/storage enabled, `VITE_AUDIO_ENABLED=true`, retention `false`, and `JAVA_TOOL_OPTIONS=-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError`. He confirmed `PORT=10000`, no linked environment groups and no secret files; no extra datasource/server/config/profile override keys appeared in the table. Upload-pause and retention-interval overrides were absent (source defaults `false` and `300000` ms). The private observer verified the retained DB target and matching throttle-HMAC configuration without exporting secrets. Preserve retention `false`. This screenshot remains preparation evidence and is not authority for credentials after today's rotation; current deployment/fresh-report status is above.

Ryan added only the canonical origin to existing R2 CORS. Unsigned OPTIONS retests passed exact-origin PUT/GET/HEAD for canonical and staging origins, including PUT Content-Type and the existing 300-second max-age; a foreign reserved origin remained denied. No object bodies were uploaded or read. Ryan confirmed public development URL disabled, no custom domains, one-day completed-object deletion enabled for exactly `staging/`, and no completed-object delete rule for an empty prefix, `originals/` or `deletions/v1/`. The separate default incomplete-multipart abort rule was preserved. These historical settings checks do not prove current bytes after the reported object removal. Canonical browser saves, phone/printed-QR acceptance and current media consistency remain pending. The current database/schema report passed; it does not establish those media checks. Read-only reconciliation found missing uploaded originals, with exact private ownership evidence for only part of the set. The scoped plan is prepared, but permanent disposal is not authorized; preserve unrelated/unmatched data and current authority.

Continue from the [home handoff's ordered actions](../../HANDOFF-2026-10-19.md#1-resume-here): credit the fresh report, then finish credential consumers, rehearsal-media reconciliation and actual home producer/copy/expiry/recovery acceptance. Explicit synthetic warning/recovery delivery to Gmail and iPhone is confirmed; it is not an installed live monitor. Follow the existing operator activation plan for remaining budget/host-proof/live gates.

At an **attended time on October 22 once readiness is accepted**, use the [cutover procedure](go-live-kevinandmel-com.md). Maintenance is already ON; preserve it while resolving the recorded go/no-go decisions and taking the required checkpoint. Do not repeat a deployment merely to consume an old saved batch. Then deliberately move custom domains/DNS, verify TLS/CORS and open the controlled canonical canary. Removing maintenance already admits public traffic through the printed QR. Scan an actual placemat on iPhone and Android and complete affected save/retry checks before announcing availability. Kevin/Melanie's content acceptance and the checklist's recovery and physical shared-network requirements remain separate. Keep reveal false and retention false.
