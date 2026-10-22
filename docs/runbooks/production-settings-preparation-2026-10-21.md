# Production settings preparation — October 21, 2026

Ryan requested preparation for **Thursday, October 22 at 6 p.m. CDT / 23:00 UTC**, keeping Coming Soon until that attended cutover. Promote the existing app/database/private bucket at their current sizes. No second hosted stack, scheduled launch, account activation, reveal or fixture cleanup is part of this preparation.

**Status: Ryan confirmed the Dashboard Save only action; his supplied screenshot shows all four intended values. Post-save checks found the same running deployment and Coming Soon routing.** The four existing keys were edited in place, preserving the other variables. This is human-attested saving and visible value verification, not an independent provider environment API read or proof of running production settings. The connector cannot perform a save-only update, and browser control could not initialize. No production deployment, DNS or custom-domain move was performed.

**Later source change:** Ryan requested the [Coming Soon palette for the full app](../product/production-palette-2026-10-21.md). The four saved runtime values are unchanged, but that frontend change requires rebuilding the frozen reviewed release at cutover with `VITE_AUDIO_ENABLED=true`. Reusing the current live build would keep the old colors; the runtime-only instructions below describe the earlier four-value batch in isolation.

## Prepared batch

Open [the existing full-app service](https://dashboard.render.com/web/srv-db7nqu67bikc73bhr580), then **Environment**. Edit these four existing values together, preserving every other variable, and choose **Save only**:

```dotenv
SPRING_PROFILES_ACTIVE=production
MEMORY_ARCHIVE_ENVIRONMENT=production
MEMORY_ARCHIVE_PUBLIC_ORIGIN=https://kevinandmel.com
MEMORY_ARCHIVE_REVEALED=false
```

Read back all four values privately. Use exactly `production`, without an additional `staging` profile. Preserve existing DB/R2 credentials, bucket/deletion authority, stable throttle secret, audio/storage/retention controls, upload state, media limits, one finalizer, heap, port and proxy configuration. Do not enable retention or rotate secrets as a shortcut to promotion.

The source-checked production profile already provides Render binding/port/forwarding, Secure cookies, explicit database requirements and one finalizer. The working frontend already supports the rehearsed audio feature. These four runtime changes need no frontend rebuild. Existing effective provider values and override collisions have **not** been independently read: audit profile includes/groups, `ARCHIVE_*`, `SPRING_DATASOURCE_*`, `SERVER_*`, `SPRING_APPLICATION_JSON`, JVM `-D` and start-command overrides before deployment. Use the full [production matrix](go-live-kevinandmel-com.md#2-prepare-the-live-application) for running acceptance.

## Save-only boundary

[Render Dashboard Save only](https://render.com/docs/configure-environment-variables) retains the running deployment. The saved values apply to the **next deployment**, not to a clock time: hold manual/API deployments and rebuilds and keep automatic deployment off until cutover. A restart reuses the current deploy's settings. Do not link an environment group while staging the batch because linking deploys.

The Render MCP environment-update wrapper is unsuitable here: its [official implementation](https://github.com/render-oss/render-mcp-server/blob/main/pkg/service/tools.go) merges/updates variables and then calls `TriggerDeploy`, including with `replace=false`. Automatic deployment off does not prevent this explicit call. The underlying [bulk REST endpoint](https://api-docs.render.com/reference/update-env-vars-for-service) has different semantics: it does not automatically deploy but replaces the complete variable list. No API credential was created or full-list replacement attempted for this four-value action.

## Evidence and remaining acceptance

| Item | Recorded state |
| --- | --- |
| App target | `kevinandmel-staging`, `srv-db7nqu67bikc73bhr580`, Ohio, one 1-CPU / 2 GiB instance |
| Running baseline | `dep-dbchp7dg1s2s73blbqa0`, commit `3b2fd0a985fdc526843dde34bb8a6086a8e2da87`; automatic deployment off, maintenance off |
| Saved four-value batch | Ryan replied done to the Save only instruction and supplied a screenshot showing exactly the four intended values; no independent environment-read operation is available through the connector |
| Post-save unchanged deployment and public Coming Soon | October 22 at 00:20:31 UTC / October 21 at 7:20:31 p.m. CDT: same live deploy/commit, no newer deploy listed, auto-deploy off; certificate-validated apex and `www` both 200 Coming Soon, `www` redirects to apex |
| Public DNS readback | Apex A `216.24.57.1`; `www` CNAME `kevinandmel-coming-soon.onrender.com`, unchanged from baseline; resolver TTL 1761 seconds, not an authoritative configured-TTL inventory |
| Printed placemats | Ryan confirms QR printed on every guest placemat, exact encoded URL `https://kevinandmel.com`, and current Coming Soon access; post-cutover physical scans remain pending |
| Canonical routing and running production settings | Cutover-only acceptance; no domain/DNS move or production deployment performed |

The private ignored `logs/production-settings-20261021.local/` folder holds the four nonsecret candidate values and content-free receipts under owner-only access. No credential values or guest content belong in this record. The screenshot visibly confirms profile/environment `production`, canonical HTTPS origin and reveal `false`; masked surrounding values were not inspected. Saving the batch is not proof of the running configuration, private readiness, canonical browser CORS, production TLS, actual placemat/phone saves or any deferred recovery requirement. The full private override audit remains open.

At **6 p.m. CDT tomorrow**, begin the [attended cutover procedure](go-live-kevinandmel-com.md): resolve the recorded go/no-go decisions, enable and verify maintenance, take the required checkpoint, rebuild the frozen reviewed palette release with audio enabled and the saved production runtime configuration, and verify actual settings/artifact/private readiness. Then move the custom domains/DNS, verify TLS/CORS and open the controlled canonical canary. Removing maintenance already admits public traffic through the printed QR. Scan an actual placemat on iPhone and Android and complete affected save/retry checks before announcing availability. Kevin/Melanie's content acceptance and the checklist's deferred recovery/shared-network requirements remain separately recorded. Keep reveal false.
