# Production settings preparation — October 21, 2026

Ryan originally requested preparation for **Thursday, October 22 at 6 p.m. CDT / 23:00 UTC**, keeping Coming Soon until the attended cutover. On October 22 he made that time flexible: the attended cutover may begin at any time today once preparation is complete and he records the readiness/go-no-go decision. Promote the existing app/database/private bucket at their current sizes. No second hosted stack, scheduled launch, account activation, reveal or fixture cleanup is part of this preparation.

**Status: Ryan confirmed the Dashboard Save only action; his supplied screenshot shows all four intended values. The immediate post-save checks found the same deployment and Coming Soon routing. Ryan subsequently confirmed his October 22 manual deployment; startup logs confirm the `production` profile, while the complete effective runtime matrix remains unconfirmed.** The four existing keys were edited in place, preserving the other variables. The saving was human-attested with visible value verification, not an independent provider environment API read. At the save-only step, the connector could not perform a save-only update and browser control could not initialize. The save-only preparation performed no deployment, DNS or custom-domain move; the later deployment is recorded separately below.

## Prepared batch

The following four-value batch is already saved on [the existing full-app service](https://dashboard.render.com/web/srv-db7nqu67bikc73bhr580). It is retained here as the preparation record; read it back privately rather than repeating the completed save. The original instruction was to edit these four existing values together, preserving every other variable, and choose **Save only**:

```dotenv
SPRING_PROFILES_ACTIVE=production
MEMORY_ARCHIVE_ENVIRONMENT=production
MEMORY_ARCHIVE_PUBLIC_ORIGIN=https://kevinandmel.com
MEMORY_ARCHIVE_REVEALED=false
```

Read back all four values privately. Use exactly `production`, without an additional `staging` profile. Preserve existing DB/R2 credentials, bucket/deletion authority, stable throttle secret, audio/storage/retention controls, upload state, media limits, one finalizer, heap, port and proxy configuration. Do not enable retention or rotate secrets as a shortcut to promotion.

The source-checked production profile already provides Render binding/port/forwarding, Secure cookies, explicit database requirements and one finalizer. The working frontend already supports the rehearsed audio feature. These four runtime changes need no frontend rebuild. The later readback below supersedes the preparation's earlier pending provider-value/override audit. Use the full [production matrix](go-live-kevinandmel-com.md#2-prepare-the-live-application) to verify effective profile, property/JVM/start-command overrides and running acceptance after deployment; saved settings are not running proof.

## Save-only boundary

During the original preparation, [Render Dashboard Save only](https://render.com/docs/configure-environment-variables) retained the running deployment. Saved values apply to the **next deployment**, not to a clock time, so the original instructions held manual/API deployments and rebuilds. Ryan subsequently deployed on October 22; verify that deployment's effective settings before cutover. Keep automatic deployment off and further corrections deliberate. A restart reuses the current deploy's settings. Do not link an environment group while staging a batch because linking deploys.

The Render MCP environment-update wrapper is unsuitable here: its [official implementation](https://github.com/render-oss/render-mcp-server/blob/main/pkg/service/tools.go) merges/updates variables and then calls `TriggerDeploy`, including with `replace=false`. Automatic deployment off does not prevent this explicit call. The underlying [bulk REST endpoint](https://api-docs.render.com/reference/update-env-vars-for-service) has different semantics: it does not automatically deploy but replaces the complete variable list. No API credential was created or full-list replacement attempted for this four-value action.

## Evidence and remaining acceptance

| Item | Recorded state |
| --- | --- |
| App target | `kevinandmel-staging`, `srv-db7nqu67bikc73bhr580`, Ohio, one 1-CPU / 2 GiB instance |
| Historical save-only baseline | `dep-dbchp7dg1s2s73blbqa0`, commit `3b2fd0a985fdc526843dde34bb8a6086a8e2da87`; automatic deployment off, maintenance off |
| October 22 current-deploy readback | Ryan confirmed manually deploying `dep-dbcvtr6q1p3s73dfu31g`, live at 12:18:24.182776 UTC / 7:18:24 a.m. CDT, commit `caec4a96656b1cde101a5ee470c8fd90698878c9`; same service/size, automatic deployment off, maintenance off. Application sources match `3b2fd0a`. Startup logs at 12:18:12.959 UTC confirm the `production` profile; the complete effective runtime matrix remains unconfirmed |
| Bounded app-log readback | No error-level application entries returned for 12:18–12:27:22 UTC on October 22; this is a bounded observation, not uptime or complete launch acceptance |
| Saved four-value batch | Ryan replied done to the Save only instruction and supplied a screenshot showing exactly the four intended values; no independent environment-read operation is available through the connector |
| Post-save unchanged deployment and public Coming Soon | October 22 at 00:20:31 UTC / October 21 at 7:20:31 p.m. CDT: same live deploy/commit, no newer deploy listed, auto-deploy off; certificate-validated apex and `www` both 200 Coming Soon, `www` redirects to apex |
| Public DNS readback | Apex A `216.24.57.1`; `www` CNAME `kevinandmel-coming-soon.onrender.com`, unchanged from baseline; resolver TTL 1761 seconds, not an authoritative configured-TTL inventory |
| Printed placemats | Ryan confirms QR printed on every guest placemat, exact encoded URL `https://kevinandmel.com`, and current Coming Soon access; post-cutover physical scans remain pending |
| Canonical routing and running production settings | Apex and `www` still serve Coming Soon; provider URL serves the guest app and health returns 200 after the October 22 deployment. No domain/DNS move observed. Health/source equality do not establish effective production settings or canonical cutover acceptance |

The private ignored `logs/production-settings-20261021.local/` folder holds the four nonsecret candidate values and content-free receipts under owner-only access. No credential values or guest content belong in this record. The initial screenshot visibly confirms profile/environment `production`, canonical HTTPS origin and reveal `false`; masked surrounding values were not inspected at that step. The later readback below adds preparation evidence. Saving the batch is not proof of the running configuration, private readiness, canonical browser CORS, production TLS, actual placemat/phone saves or any deferred recovery requirement.

## Later home configuration and R2 readback

The [October 22 handoff](../../HANDOFF-2026-10-19.md#later-home-production-configuration-readback) records the later home readback that supersedes the earlier pending preparation audit. Ryan confirmed the saved production profile/environment, canonical origin and reveal `false`. His full environment screenshot confirmed audio/storage enabled, `VITE_AUDIO_ENABLED=true`, retention `false`, and `JAVA_TOOL_OPTIONS=-Xms64m -Xmx1536m -XX:+ExitOnOutOfMemoryError`. He confirmed `PORT=10000`, no linked environment groups and no secret files; no extra datasource/server/config/profile override keys appeared in the table. Upload-pause and retention-interval overrides were absent (source defaults `false` and `300000` ms). The private observer verified the retained DB target and matching throttle-HMAC configuration without exporting secrets. Preserve retention `false`; this is not running production acceptance.

Ryan added only the canonical origin to existing R2 CORS. Unsigned OPTIONS retests passed exact-origin PUT/GET/HEAD for canonical and staging origins, including PUT Content-Type and the existing 300-second max-age; a foreign reserved origin remained denied. No object bodies were uploaded or read. Ryan confirmed public development URL disabled, no custom domains, one-day completed-object deletion enabled for exactly `staging/`, and no completed-object delete rule for an empty prefix, `originals/` or `deletions/v1/`. The separate default incomplete-multipart abort rule was preserved. Canonical browser saves, phone/printed-QR acceptance, the complete effective runtime matrix and private readiness still require acceptance.

At an **attended time on October 22 once readiness is accepted**, begin the [cutover procedure](go-live-kevinandmel-com.md): resolve the recorded go/no-go decisions, enable and verify maintenance, take the required checkpoint, and verify the existing deployment's actual settings/artifact/private readiness. Do not repeat a deployment merely to consume the already deployed batch; any required correction needs reviewed settings and affected checks. Then move the custom domains/DNS, verify TLS/CORS and open the controlled canonical canary. Removing maintenance already admits public traffic through the printed QR. Scan an actual placemat on iPhone and Android and complete affected save/retry checks before announcing availability. Kevin/Melanie's content acceptance and the checklist's deferred recovery and physical shared-network requirements remain separately recorded. Keep reveal false.
