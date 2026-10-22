# Bringing kevinandmel.com live

Updated October 22, 2026 with the later home configuration/R2 readback and [deployed CREATE peer-limit/expiry proof](shared-peer-recovery-verification-2026-10-22.md); the earlier source review used main `228d672f1a07a85be35a4ef39543c0f026297096`. Use with the [Go Live checklist](../product/go-live-checklist.md). This is an execution guide, not a completed cutover: **the latest recorded domain state is Coming Soon; physical shared-network/mobile retry acceptance and the selected live target's operational gates remain open.** Refresh provider state before execution; preparation is not running production acceptance.

**Current work, updated October 22:** Ryan confirms this is the wedding laptop with its recovery drive attached. Local inspection found only the healthy expiry task, not a capture task; the newest accepted capture remains October 21 at 22:26:15 UTC. The inspected private cloud recovery folder holds portable-key/support files, not actual database/archive backups. Ryan confirmed both synthetic failure and recovery alerts reached Gmail and his phone; live producer/copy/watchdog acceptance remains open. Keep the coordinator disabled pending the process-containment correction in the [October 22 readiness review](../product/cutover-readiness-review-2026-10-22.md). His accepted policy remains unattended encrypted backups, a measured five-minute database freshness target and best-effort wedding restoration when he is available, superseding the earlier automation deferral and one-hour restoration requirement. Follow the [operating policy and activation plan](operator-recovery.md#location-retention-and-recovery-targets). Preserve source-authority refusal guards and record unsupported loss scenarios. The final go/no-go must identify unresolved requirements and Ryan's decision before public collection opens.

**Resume here:** open a new app Dashboard Shell and run the exact single-line filtered read-only report at [Resume here](../../HANDOFF-2026-10-19.md#1-resume-here). The earlier multiline paste failed; fresh console readiness remains pending. Reconcile affected home database-credential consumers before retiring the old database credential, preserving existing R2/encryption credentials. Reconcile the intentionally removed rehearsal originals before accepting complete backups. Keep maintenance enabled and public collection on hold.

**October 22 timing update from Ryan:** the original **6 p.m. CDT / 23:00 UTC** target is flexible. The attended cutover may begin at any time today, Thursday, October 22, once preparation is complete and Ryan records the readiness/go-no-go decision. Public opening and distribution follow acceptance. Record actual maintenance/canary/distribution times during execution. No unattended launch is installed, and the flexible window does not waive outstanding gates.

Ryan has already printed the QR on every guest placemat and confirmed its exact URL is **`https://kevinandmel.com`**, currently reaching Coming Soon. Keep that page in place until the attended window. Use the actual placemats for final QR acceptance; the generated card proof is historical evidence. Post-cutover phone saves and the canonical destination still require acceptance.

The goal is a single combined React/Spring guest application at **https://kevinandmel.com**, with `www` redirecting there, private R2 media and the reveal closed. Keep the existing static coming-soon service available for an emergency collection stop. Do not deploy only the frontend or convert the static service into the backend.

**Approved plan, October 21; timing updated October 22:** Ryan approved preparing **promotion of the existing app, database and private bucket** at their current size, avoiding a second recurring hosting bill. There will be one hosted production environment, with local isolated environments and CI for future development. The `production` profile is now observed on Ryan's October 22 deployment; canonical cutover acceptance remains open. Move the domain away from Coming Soon only during the readiness-approved attended window today. The [final review packet](../product/promotion-final-review-2026-10-21.md) separates source fixes, verified evidence and the remaining home/provider checks.

## 1. Record the target and recovery plan

Ryan executes the infrastructure steps. Kevin and Melanie approve content, feature scope and archive decisions. Complete the checklist's pre-cutover gates first.

| Record | Value / decision |
| --- | --- |
| Canonical origin | `https://kevinandmel.com` (no trailing slash in application settings) |
| Live Render service and `APP_HOST` | Existing `kevinandmel-staging`, promoted in place; `APP_HOST` is `kevinandmel-staging.onrender.com` (hostname only) |
| Database / private R2 / deletion authority | Retain the existing targets and current authority; verify identities and recovery access privately |
| Region / plan / instances / budget | Retain one 1-CPU / 2 GiB app instance in Ohio and the existing DB plan/disk; no second hosted stack or scaling change |
| Release / CI / deployed artifact | Application commit `0a343ab` is deployed as `dep-dbd60hnavr4c73cuk67g`, production profile confirmed, maintenance enabled; exact-source CI passed. Repository main can advance independently. Verify remaining effective settings and freeze promotion/rollback artifacts |
| Rollback artifact / checkpoint | Retained compatible artifact, canonical-origin configuration, current database/bucket/ledger and fresh recoverable checkpoint |
| Cutover window / operator | Ryan; October 22 at any attended time after readiness/go-no-go acceptance; actual maintenance/canary/distribution times and next checks recorded during execution |

The retained promotion target is `kevinandmel-staging` (`srv-db7nqu67bikc73bhr580`). Latest Render readback shows commit **`0a343abf1c2047af8870707627b9ef9cefa32b93`**, deployment **`dep-dbd60hnavr4c73cuk67g`**, live October 22 at **19:13:45.411104 UTC / 2:13:45 p.m. CDT**. Startup logs at 19:13:34.548 UTC confirm exactly one active profile, `production`. Maintenance is **enabled**, automatic deployment off, with the same Ohio 1-CPU / 2 GiB instance and provider hostname enabled. [Exact-main CI run 39795263279](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39795263279) completed successfully. Apex/`www` still serve Coming Soon, with `www` redirecting to apex; provider root and `/api/health` return the expected maintenance 503. The remaining effective settings/private readiness and canonical acceptance still require verification. Merged/deployed PR 115 tooling does not establish installed backup operation; the [18:39 UTC scheduled watchdog run](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39833279715) skipped despite the separately confirmed synthetic Gmail/phone delivery.

Historical deployments: Ryan authorized the replacement-database-credential deployment `dep-dbd5u4g473hc73dh8gkg`, live October 22 at 19:08:39 UTC on `0a343ab`. Its complete startup window showed production, a fresh Hikari connection, Flyway validation/current schema and app startup, with zero entries in the complete bounded error query. The earlier `caec4a9` / `dep-dbcvtr6q1p3s73dfu31g` was live at 12:18:24.182776 UTC / 7:18:24 a.m. CDT; its sources matched `3b2fd0a` / reviewed `4f23d9f` and guest/health GETs passed while maintenance was off. Its [CI retry](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39775637661) passed all 479 backend tests. Those results retain their original scope and do not replace fresh private readiness on the latest deployment. Obtain final exact-head review/CI and exact-release CI for any further changes; none establishes backup activation or cutover acceptance.

Its database remains `kevinandmel-staging-db` (`dpg-db7n4e59fdbs73er7610-a`), PostgreSQL 17, Ohio, `0.1c-256mb`, 1 GB disk, external access denied. Treat the current deployment as the retained production archive; canonical guest collection remains closed pending acceptance. The fallback is `kevinandmel-coming-soon` (`srv-db19f3vavr4c73asu350`), at `kevinandmel-coming-soon.onrender.com`. Refresh both services' actual deploy and domain associations before making changes.

Fresh read-only Render inventory on October 21 found only those staging/coming-soon services and the staging database. The proposed separate production resources were never created.

### Promotion plan

| Existing resource | Promotion action | Preservation / verification gate |
| --- | --- | --- |
| Render app | Promote `srv-db7nqu67bikc73bhr580` using explicit production settings, the reviewed release and canonical origin | Preserve Docker setup, Ohio, `1c-2g`, one instance, manual deployment and `/api/health`; enable maintenance before changing admission/profile/origin |
| Render database | Keep `dpg-db7n4e59fdbs73er7610-a`, its internal JDBC URL and retained V14 data | Verify fresh backup/recovery access, `0.1c-256mb`, 1 GB disk and `ipAllowList: []`; no reset, restore-over, downgrade or unnecessary new migrations |
| Private Cloudflare R2 bucket | Keep the exact current account endpoint, bucket, objects and `deletions/v1/` authority; retain the prepared canonical CORS | Keep public access off and the reviewed upload lifecycle; verify current ledger/independent copy before and after promotion; do not rename/move the bucket or its object prefixes |
| Private settings | Use the freshly deployed DB credential; preserve R2/encryption credentials and stable throttle secret in private settings | Update and verify affected home consumers before retiring exposed/obsolete DB credentials. A rollback may restore historical environment values. Do not rotate other stable identities merely to relabel the environment |

Keeping these same plans/instances avoids the proposed second app/database bill. Existing fixed charges continue; real traffic, R2/storage, independent backups and taxes can still affect usage charges. No second stack, workspace upgrade, autoscaling or paid add-on is approved. The [project budget](../project-plan.md#accepted-decisions) still applies to the total spend.

Resource names containing `staging` can remain during the wedding; names alone do not determine runtime access or production behavior. Renaming is cosmetic and is deferred. After promotion, any reachable old provider hostname points at the live production archive and must not be used as a separate staging site. Routine development uses isolated local Docker data and CI; any live canary must be small, deliberate and recorded.

This is a promotion of a retained archive, not an empty database. The preceding cohorts and [fresh launch rehearsal](../product/guest-launch-rehearsal-2026-10-21.md) historically established at least 109 known synthetic groups / 155 memories, plus earlier content. Those counts do not establish current original bytes and are not a cleanup allowlist. Ryan subsequently reported intentional removal of only synthetic/rehearsal originals, with no intended keeps. Reconcile affected database references with actual source objects and current deletion authority before accepting a complete capture. Preserve remaining staging/ledger material, independent copies and private ownership journals. Prepare only a concrete owned-candidate reconciliation; do not automatically restore intentionally removed tests or reset retained data. See the [home resume sequence](../../HANDOFF-2026-10-19.md#1-resume-here) and [operator recovery](operator-recovery.md).

Paid Render Postgres provides PITR, but the [current recovery documentation](https://render.com/docs/postgresql-backups) excludes restore points within the most recent **ten minutes**. PITR alone therefore does not meet the accepted **measured five-minute database freshness target**. Ryan's October 22 policy removes the hard data-loss/one-hour wedding restoration guarantee, while still requiring unattended encrypted captures, actual freshness measurements, independent original-media/current-ledger copies, expiry and working alerts. A paid database is not proof of those controls.

The [October 21 full-database feasibility record](full-database-recovery-feasibility-2026-10-21.md) includes three accepted encrypted, authenticated and expiry-enrolled database copies plus an isolated restore matching all 19 tables / 1,232 rows and the reviewed catalog. The bounded manual observation reached a maximum conservative point age of 2m46.67s. It installed no recurring job and does not establish unattended operation, continuing freshness or current media/ledger recovery. Inspect and prove the real producer on the traveling laptop before crediting activation; a status publisher/watchdog cannot create a backup. Record the actual checkpoint chosen for cutover privately; the historical observation is not a fresh launch checkpoint.

Capture the old web DNS records, current custom-domain associations, fallback deploy, candidate deploy and private recovery references before changing anything. Leave automatic deployment off on the full app. Do not change the coming-soon service's existing deployment configuration.

## 2. Prepare the live application

### Save settings ahead of the window

The [October 21 settings preparation record](production-settings-preparation-2026-10-21.md) contains the four-value batch, its completed Save only confirmation and the later home configuration/R2 readback. These four values are already saved in the existing app's Dashboard **Environment**; read them back privately rather than repeating the completed action:

```dotenv
SPRING_PROFILES_ACTIVE=production
MEMORY_ARCHIVE_ENVIRONMENT=production
MEMORY_ARCHIVE_PUBLIC_ORIGIN=https://kevinandmel.com
MEMORY_ARCHIVE_REVEALED=false
```

Use exactly `production` for the active profile; retaining `staging` as an additional profile retains staging-only admission. Credit the [completed saved-configuration readback](production-settings-preparation-2026-10-21.md#later-home-configuration-and-r2-readback), then verify effective profile/property/JVM/start-command overrides on the resulting production deployment. Preserve the working DB/R2 credentials and identities, stable throttle secret, audio/storage controls, retention `false`, media limits, one finalizer, port/proxy and JVM sizing. This batch does not enable retention, rotate credentials or rebuild the frontend.

**The Render MCP environment-update tool was unsuitable for the completed save-only preparation.** Its [official implementation](https://github.com/render-oss/render-mcp-server/blob/main/pkg/service/tools.go) updates settings and then triggers a deployment, including with `replace=false` and automatic deployment off. Dashboard [Save only](https://render.com/docs/configure-environment-variables) left the then-current deployment running; the original hold protected the saved batch until the next deployment. Ryan subsequently deployed on October 22. Verify that deployment's effective settings without repeating the action; keep automatic deployment off and any further correction deliberate behind maintenance. Do not link an environment group as a preparation shortcut; that also deploys. Keep Coming Soon's domain associations, settings and DNS unchanged until the readiness-approved attended window.

Saved Dashboard values alone are not evidence of effective running production settings. Preserve the historical post-save checks, then verify the current deployment's identity and complete effective matrix. At the window, follow the maintenance/checkpoint procedure below; deploy again only if a verified correction requires it. A restart reuses the current deployment's settings and does not apply a newly saved correction.

### Deploy and verify during the attended window

Credit the existing guest rehearsal: named/anonymous notes, photo/audio, committed-receipt recovery, busy/partial-item retry and anonymous private-access denial. Record unresolved uploads, the shared-network result and representative-phone limits. The current startup profile is confirmed as production; its effective canonical-origin setting and remaining runtime matrix still need verification behind maintenance. Use the controlled canonical canary in section 5 for affected acceptance. Preserve synthetic identity/receipts for explicit same-item recovery. Do not repeat the completed 100-group capacity run against this production target.

The latest readback already shows Render's default **Maintenance Mode** enabled. At the agreed cutover window, keep it enabled and reverify the public 503 response before any profile/admission/origin correction or domain transfer. Take the reviewed recovery checkpoint with any required quiescence. Keep maintenance through verification and the domain transfer; remove it only for the controlled public canary in section 5. Neither the public-origin setting nor reveal/upload-pause flags provide this traffic gate.

Use the repository-root **Docker web service**, health path `/api/health`, and the pinned release. Keep the reviewed DB migration history; the current candidate bundles V14. Verify backups and rollback compatibility before startup migrations run against retained data.

The promotion candidate's `application-production.properties` now includes Render binding/port/forwarding, Secure cookies, mandatory database settings and one finalization slot. The image still defaults to Spring's `staging` profile, so select **both** production profile/environment explicitly. Confirm these effective settings on the running candidate, including any provider overrides:

| Setting | Live value / requirement |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `production` |
| `MEMORY_ARCHIVE_ENVIRONMENT` | `production`; must agree with the Spring profile and the approved data identity |
| `MEMORY_ARCHIVE_PUBLIC_ORIGIN` | `https://kevinandmel.com` |
| `SERVER_ADDRESS` | `0.0.0.0` |
| `SERVER_PORT` | Match the actual Render `PORT`, normally `10000`; confirm it rather than assuming shell expansion inside a Dashboard value |
| `SERVER_FORWARD_HEADERS_STRATEGY` | `framework`; also verify the actual proxy/peer boundary before clearing SEC-01 |
| `MEMORY_ARCHIVE_MAX_CONCURRENT_FINALIZATIONS` | `1` |
| `JAVA_TOOL_OPTIONS` | For the approved 2 GiB plan: `-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError` |
| `MEMORY_ARCHIVE_REVEALED` | `false`; guest collection does not require private couple access |
| `MEMORY_ARCHIVE_DB_URL` | The selected private internal JDBC URL, e.g. `jdbc:postgresql://INTERNAL_HOST:5432/DATABASE?sslmode=require`, without embedded credentials |
| `MEMORY_ARCHIVE_DB_USERNAME`, `MEMORY_ARCHIVE_DB_PASSWORD` | Selected database's private credentials; external DB access stays disabled |
| `MEMORY_ARCHIVE_LOGIN_THROTTLE_SECRET` | Stable privately generated secret, at least 32 bytes; preserve across restarts |
| `MEMORY_ARCHIVE_STORAGE_ENABLED` | `true` after the selected private bucket is ready |
| `MEMORY_ARCHIVE_R2_ENDPOINT` | `https://<32-hex-account-id>.r2.cloudflarestorage.com` |
| `MEMORY_ARCHIVE_R2_BUCKET` | Approved live private bucket |
| `MEMORY_ARCHIVE_R2_ACCESS_KEY_ID`, `MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY` | Bucket-scoped private Object Read & Write credentials with the required ledger operations |
| `VITE_AUDIO_ENABLED` | `true` **at Docker build time** for the required voice feature |
| `MEMORY_ARCHIVE_AUDIO_ENABLED` | `true` at runtime after audio/storage acceptance |
| `MEMORY_ARCHIVE_UPLOADS_PAUSED` | `false` for normal media collection, after acceptance |
| `MEMORY_ARCHIVE_RETENTION_ENABLED` | Preserve `false` for this guest-collection promotion. Enabling the hosted job and offering production Delete require separate private deletion-ledger/job acceptance |
| `MEMORY_ARCHIVE_RETENTION_INTERVAL_MS` | Reviewed schedule; default `300000` (five minutes), allowed one minute to one day |

Static source verification on main `f9f758b`: `application-production.properties` binds `0.0.0.0` / `${PORT:10000}`, uses framework forwarding and Secure cookies, requires explicit DB variables and fixes one finalizer. `ArchiveAccessPolicy` rejects a production-profile/archive-environment mismatch and requires an HTTPS public origin plus Secure cookies. Base properties default reveal, storage, audio and retention to false; the Docker frontend audio build argument also defaults to false. These defaults make effective settings and the deployed frontend's audio flag explicit acceptance items; this source check does not read or validate current provider values.

Keep the existing reviewed media sizes, quotas and storage budgets. Do not increase them to clear a launch gate. `sslmode=require` requests encrypted transport; it is not a claim of certificate verification. Put no credentials in Git, this guide, Notion, `VITE_*`, build arguments, screenshots or copied logs.

Verify that the current deployment has the production profile and archive environment **together**, preserving its exact DB/R2 targets and current authority. Any required correction belongs behind maintenance. Explicit DB credentials are required; the candidate no longer supplies local DB defaults in production. Staging-only Basic Auth/origin settings no longer govern the production profile; retain the old configuration privately for rollback, without using it as the live admission gate. Keep reveal false. Review any existing test-account access before later couple activation; do not create, activate or delete real accounts for anonymous guest launch.

Use the existing service settings as the preparation source of truth; inspect existing environment-group collisions privately. Ryan's October 22 deployment already reports the production profile; verify its actual commit/artifact and complete effective settings rather than repeating a deployment merely to consume the saved batch. If a runtime correction is required behind maintenance, Render's **Save and deploy** reuses the existing build; verify the resulting deployment. Confirm the existing frontend was built with `VITE_AUDIO_ENABLED=true`; if that flag must change, use **Save, rebuild and deploy** against the frozen reviewed application source and recheck the new artifact. Do not rebuild or select a different application release solely because documentation advanced main. See [Render environment configuration](https://render.com/docs/configure-environment-variables) and [Render port settings](https://render.com/docs/environment-variables).

### Private readiness and media setup

1. Verify the selected DB/bucket identities privately. Use an approved private Render shell/client; do not open database internet access for diagnostics. Run the read-only packaged report with that target's actual effective environment/settings:

   ```bash
   java -Xmx256m -Dloader.main=com.kevinmel.archive.operations.ReadinessAdministration \
     -cp /app/app.jar org.springframework.boot.loader.launch.PropertiesLauncher \
     --expect-environment production report
   ```

   The live target must report the `production` identity. The console reads base properties plus environment/JVM overrides, not profile files; supply effective overrides such as the one-slot limit. Exit 0 validates its schema/aggregate checks, not provider access, backups, retention jobs or memory. Keep the report private. See [readiness and rollback](operations-and-rollback.md).
2. Keep R2 public access (`r2.dev` and public bucket domains) off. Add the exact live origin `https://kevinandmel.com` to CORS, using the reviewed `PUT`, `GET`, `HEAD`, `Content-Type` and `MaxAgeSeconds: 300` policy. No wildcard. Keep the old provider origin only for the deliberate transition/draining window, then remove obsolete origins under the chosen canonical-host policy. It no longer serves an independent staging environment. Confirm browser CORS after cutover; the HTTP capacity harness does not prove it.
3. Preserve the one-day completed-object lifecycle on **`staging/` only**, never on `originals/`, `deletions/v1/` or an empty prefix. Here `staging/` is the app's temporary-upload object prefix and remains correct in production; do not rename it. Verify actual retention work and current independent deletion evidence separately. Application deletion retention and 30-day backup expiry are different controls. Follow [private photo storage](private-photo-storage.md), [voice memories](voice-memories.md) and [deletion/recovery](deletion-and-recovery.md).
4. Verify the running candidate's commit/deploy identity against the frozen release and exact-commit CI. Refresh affected evidence after any source/configuration change. Complete candidate-origin checks before changing its origin settings; provider-host checks may then intentionally fail while canonical routing is being prepared.

## 3. Prepare Namecheap and the collection window

Read-only checks on October 21 found:

| DNS item | Observed value | Cutover action |
| --- | --- | --- |
| Nameservers | `dns1.registrar-servers.com`, `dns2.registrar-servers.com` | Keep Namecheap DNS |
| `@` A | `216.24.57.1` | Already points to Render; normally leave it, subject to the target's current Dashboard instructions |
| `www` CNAME | `kevinandmel-coming-soon.onrender.com` | Change to the approved full-app `APP_HOST` |
| Apex AAAA | No AAAA answer observed | Check both web hostnames and remove conflicting AAAA records if present |

The resolver returned TTL 300 seconds for the apex and 1800 for `www`; these are observed answers, not a verified inventory of configured TTLs. In Namecheap **Domain List → Manage → Advanced DNS**, review the actual records. Lower the web-record TTL in advance if supported and allow the old TTL to age. Preserve MX, SPF/TXT, verification and other mail records. Keep this cutover separate from any nameserver/Cloudflare migration. See [Render's Namecheap instructions](https://render.com/docs/configure-namecheap-dns).

The apex A record routes to shared Render infrastructure. **Moving the hostname association between Render services is essential even if that A record stays identical.** Changing `www` alone leaves the apex on coming-soon.

The existing hosted staging environment becomes production in this cutover. Stop routine staging testing before promotion. Cookies/drafts belong to their original hostname and do not automatically transfer to the custom domain; a restart can expire in-memory sessions. Complete old-origin tests and record unresolved canaries before changing the service's origin configuration. Keep the existing DB/bucket, and use local isolated environments for subsequent development.

For a paid web service, enable its default **Maintenance Mode** while configuring the target and moving the domain. It serves public 503 responses, including `/api/health`, while the service remains running for private checks. Use private readiness during this window and public health after reopening. Do not point its custom maintenance HTML at an untested page with relative assets. See [Render maintenance mode](https://render.com/docs/maintenance-mode).

Maintenance blocks public app requests; it does not stop background writers or revoke already issued R2 PUT permissions. Any backup/restore requiring quiescence must also stop all relevant writers/maintenance processes and wait at least five minutes for issued grants to expire, following [operator recovery](operator-recovery.md#consistency-and-unfinished-uploads).

## 4. Move the hostname and verify TLS

1. In the Render Dashboard, inspect **Settings → Custom Domains** on both coming-soon and the approved full-app target. Capture current associations. Use a supported domain-move action if available; otherwise, in the planned window remove **only** the old apex/`www` association(s) and add `kevinandmel.com` to the full-app target. Render automatically adds `www` redirecting to the apex. Do not delete either service. If Render says the hostname is still in use, stop and resolve its association rather than changing nameservers or deleting infrastructure.
2. In Namecheap Advanced DNS, set `www` CNAME to the actual `APP_HOST` (hostname only). Keep apex `@` A `216.24.57.1` if still directed by Render. Remove only conflicting web records/redirects/AAAA, preserving mail and unrelated records.
3. Use Render's **Verify** action for the new target's custom domains and wait for valid certificates. Render manages TLS and HTTP-to-HTTPS redirects. DNS caches, certificate issuance and routing can lag; this procedure does not guarantee a downtime-free transfer. Do not distribute the link during verification or a routing/502 failure. See [Render custom domains](https://render.com/docs/custom-domains).
4. Check DNS from more than one resolver/network and test apex/`www` HTTPS with certificate validation enabled. While maintenance is on, 503 is expected from the target; it is not the final acceptance result. Verify both HTTP entry points redirect to canonical HTTPS and `https://www.kevinandmel.com` redirects to `https://kevinandmel.com` without a loop.
5. Confirm the domain belongs to the selected full-app service, not merely that it displays some Render response. Record its live deploy/commit in the operator record; use private provider evidence rather than exposing an operational version endpoint. Keep the fallback service intact.

## 5. Open a controlled public canary, then announce collection

**Turning maintenance off admits all public traffic immediately.** An unannounced URL is still public. Start this window only when the operator is ready to collect and protect real submissions and the recorded go/no-go resolves the pre-cutover requirements. Preparation, an implementation deferral or an empty launch-record field is not acceptance.

1. Disable maintenance, then verify canonical `/` serves the full guest app, its JS/CSS/gallery load, and same-origin `/api/health` returns 200. Confirm the actual running deployment is still the selected candidate. A health response alone does not prove persistence or media readiness.
2. From the canonical host, use a few clearly marked synthetic submissions: named and anonymous notes, a photo batch and supported audio. Check validation/draft preservation, receipt recovery, private `PENDING` / `COUPLE_ONLY` defaults and partial-item retry. Test browser R2 CORS and real microphone/file fallback on representative phones. A save must have a committed receipt; a successful PUT alone is insufficient. Reuse the same identity on an uncertain/busy result and honor `Retry-After`; do not create duplicates or re-upload saved siblings.
3. Check anonymous private routes and private originals remain denied, secure cookie/session behavior and cross-origin rejection. Keep reveal false; these checks do not require activating or signing into real couple accounts. Finish authenticated logout/revocation, private playback/export and shared-device acceptance separately through the approved synthetic process before activating real couple access or opening reveal.
4. Choose and test the **live target's** provider-host policy. `MEMORY_ARCHIVE_PUBLIC_ORIGIN` does not redirect hosts. After canonical acceptance, disable that live service's Render Subdomain if that is the chosen policy, or use a reviewed canonical redirect. Then test the result. The old `kevinandmel-staging.onrender.com` hostname belongs to this same production service; it is not a test environment. Don't leave an alternate guest entry point whose media CORS/session behavior is broken.
5. Check current provider memory/CPU, pending/failed media, reservation budgets, backups and alert delivery. The mixed-media rehearsal's highest returned memory sample was about 82% of 2 GiB; it was not an instantaneous peak. Retain the one-slot decoder limit. Unexpected loss, duplicate saves, privacy exposure, repeated unrecovered failures or resource exhaustion stops broad release.
6. Scan the QR on an **actual printed guest placemat** on iPhone Safari and Android Chrome. Confirm its recorded payload reaches the full app at **`https://kevinandmel.com`** after cutover. Check cellular and the available shared/venue network, then finish affected submission/return/retry cases. Ryan's earlier Coming Soon confirmation does not prove this post-cutover behavior. The generated [card proof](../product/wedding-qr-card-proof.html) and earlier [placeholder layout](../product/wedding-qr-card-draft.html) remain historical; no replacement print job is required by this guide.
7. Record the release time/timezone, deployed SHA, canonical DNS/TLS, smoke/device results, checkpoint and Kevin/Melanie's copy/feature acceptance. Only then announce availability using the existing placemats/link. Keep private credentials and guest content outside the release record.

Observe the first 15 minutes and the first substantial burst, then use the [wedding-day operations sheet](wedding-day-operations.md). Monitor content-free failed saves/busy retries, memory, liveness, actual storage and DB reservations, backup freshness and retention backlog. Review either reservation budget at 80%; do not raise limits blindly. Couple reveal/account activation remains a later operation. The planned October 31 collection review does not install an automatic closure.

## 6. Interruption and rollback

| Situation | Action |
| --- | --- |
| Media admission needs relief | Set `MEMORY_ARCHIVE_UPLOADS_PAUSED=true` and deploy the reviewed runtime setting. New media intents/grants stop; notes, issued grants, receipts and finalization remain available. This is not a full collection stop. |
| Collection must stop while investigated | Enable web-service Maintenance Mode. Record the interruption; preserve drafts, receipts, current data and operational evidence. Stop background writers too if a recovery/export requires quiescence. `REVEALED=false` does not stop guest intake. |
| App regression with compatible schema | Deploy a retained reviewed artifact against the **same current database, R2 bucket and current deletion authority**, with the correct canonical-origin configuration. Validate schema compatibility, private readiness, receipts and same-item recovery before reopening. |
| Domain routing/TLS failure | Keep collection stopped. Correct the association/DNS; if necessary return apex/`www` to the recorded coming-soon service and original web records. This restores a holding page, not working receipt/upload recovery. Cached clients and open pages may still fail. |
| Data-loss/corruption recovery | Keep traffic and relevant writers stopped; follow the separate reviewed database/archive recovery procedure with current independent deletion evidence. Do not improvise a prelaunch database restore over new contributions. |

Render rollback uses a retained prior artifact, but also restores that deploy's environment values, while custom domains use current service configuration. Review restored origin, profile, data credentials, runtime/start/health settings and one-slot limit before reopening: an older staging-origin configuration can break the live hostname. Dashboard and API rollback differ in their automatic-deployment behavior; explicitly keep/recheck it off. Artifact availability and schema compatibility are prerequisites. See [Render rollbacks](https://render.com/docs/rollbacks).

Prefer the compatible artifact with the reviewed **production** settings. Explicitly set and verify `MEMORY_ARCHIVE_REVEALED=false` before reopening every rollback; a historical deploy can restore an open reveal setting and admit test accounts under staging policy. If a rollback intentionally restores the staging profile, set both `MEMORY_ARCHIVE_PUBLIC_ORIGIN` and `MEMORY_ARCHIVE_STAGING_ORIGIN` to the canonical live origin and use the matching `staging` archive identity, while preserving the current data/authority. Check admission and anonymous private-access denial deliberately before reopening; old tester Basic Auth can otherwise block guests. Do not reopen a rollback still configured only for the provider origin.

Never reset the live database, repair Flyway history, bulk-delete a bucket/prefix, rotate guest retry identities, downgrade migrations or restore stale deletion authority to undo an application/domain change. Preserve all contributions received since opening. Record actual interruption and successful reopening checks, then verify the next backup and alert delivery.

## 7. Fill the launch execution record

Complete this record during execution; a planned value is not an observed result. Keep detailed receipts, private recovery locations, DNS/configuration exports and guest-bearing evidence in the private operator record. Record only content-free outcomes and safe evidence references here or in the checklist.

| Item | Observed value / evidence / time |
| --- | --- |
| Operator and agreed window (CDT and UTC) | Ryan, October 22 at any attended time after readiness/go-no-go acceptance (original 6 p.m. CDT / 23:00 UTC target is flexible) · actual start/end: ____ |
| Pre-change app and fallback deploy/domain readback | ____ |
| Four-value Save only batch and private override audit | Save/readback time: ____ · unchanged deploy/Coming Soon: ____ · override audit: ____ |
| Frozen application commit, exact-source CI/review and rollback artifact | ____ |
| Guest rehearsal / shared-network result / unresolved items | ____ |
| Chosen fresh checkpoint and private recovery-access verification | Safe reference: ____ · capture/verified time: ____ |
| Open recovery/automation requirements and decision before public canary | Requirements: ____ · Ryan's go/no-go and time: ____ |
| Maintenance enabled and public 503 verified | ____ |
| Production-setting deploy ID, commit/artifact and effective matrix checked | ____ |
| Private readiness, retained DB/R2/authority, CORS and lifecycle readback | ____ |
| Apex/`www` service association, DNS, valid TLS and canonical redirects | ____ |
| Maintenance disabled / controlled public canary started | ____ |
| Canonical note/photo/audio, receipts, same-item retry and private denial | ____ |
| iPhone Safari / Android Chrome / cellular / shared-network evidence | ____ |
| Actual placemat QR payload and post-cutover destination | Ryan-confirmed payload: `https://kevinandmel.com` · post-cutover canonical destination/phone evidence: ____ |
| Live provider-host policy tested | ____ |
| Health, memory, failed/pending items and remaining monitoring limits | ____ |
| Kevin/Melanie guest copy and feature acceptance | ____ |
| Final distribution go/no-go, sharing time and first-15-minute/burst observer | ____ |

Leave private couple activation/reveal unchecked: production guest collection does not accept authenticated playback/export, logout/revocation or shared-device behavior. Keep `MEMORY_ARCHIVE_REVEALED=false` until that separate acceptance is complete.
