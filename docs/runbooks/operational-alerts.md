# Private operational alerts

Ryan selected automatic alerts before launch. This adds operational-condition monitoring alongside the existing backup freshness watchdog. Response and restoration remain best effort when Ryan is available. Neither a ten-minute GitHub schedule nor phone delivery has a guaranteed maximum delay.

The workflow is **disabled by default**. As of Friday, October 23, the final application has signals enabled, and the installed operational collector has independently accepted natural all-clear runs matching its GitHub publications. Both live watchdogs are enabled with host proof and accepted manual live baselines. A controlled collector pause produced a genuine [live stale warning](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39926468695); guarded resumption preserved continuity and naturally returned through a gap observation to all-clear, followed by a genuine [live recovery](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39927171600). Both matching emails were independently read in Gmail, and Ryan confirmed both reached his phone. This accepts that live path and recipient pair. The first automatic scheduled watchdog invocation after activation remains unobserved. Canonical HTTPS probing remains disabled while Coming Soon and maintenance are expected. Keep collection closed until the remaining automatic-watchdog and attended canonical launch checks pass. Manual dispatch and delivered alerts do not establish continuing automatic monitoring or idle R2 availability.

## Observations and privacy

The private laptop collector uses the reviewed, deployment-bound SSH route to inspect private application signals and the existing read-only database readiness report. Its private evidence contains the sampling details needed to interpret counters and process restarts. No database, R2, SSH, encryption or Gmail credentials go to GitHub Actions. There is no public operational-report endpoint.

Only these fixed categories, their observation times and states leave the laptop:

| Category | Meaning and limits |
| --- | --- |
| `application` | Current deployment/application observation. This does not prove external canonical HTTPS availability. |
| `database` | Bounded read-only connectivity/schema observation. A public liveness response cannot replace it. |
| `guestSaves` | Technical guest-save failures or uncertain client upload outcomes. Input validation, authentication denial, conflict and expected throttling are not failed-save incidents. A cleared condition never confirms an individual contribution. |
| `media` | Media-related technical failures, uncertain upload reports and failed-media/retention backlog. This does not probe idle R2 or confirm provider connectivity. An uncertain client PUT does not prove the provider is down. |
| `capacity` | The private collector's reviewed capacity decision, including the existing 80% original/staging reservation threshold. Database reservations do not establish actual provider usage, billing or available host memory. |

All states are exactly `clear`, `incident` or `unconfirmed`. No guest counts, record or request identifiers, object keys, filesystem paths, content, digests, capabilities, raw logs or exception text are permitted in the GitHub payload or comments. Publications contain no submission totals. Provider-native cost emails are a separate channel described below.

The private collector owns monotonic-counter, reset and quiet-window interpretation. Initial acceptance requires two fresh samples from the same application boot. A restart, regressed counter or observation gap must produce `unconfirmed`; it cannot silently erase an existing incident. Clear a prior technical-failure condition only after the reviewed complete quiet window (30 minutes) and two fresh samples. Persist that private history across collector restarts. Unknown or incomplete observations do not advance a successful observation time. A client signal must be bound to the actual guest intent/grant and must preserve the original error and retry identity if reporting fails.

## Exact status contract and publication

`scripts/operational-status.mjs` accepts an explicit receipt with this exact shape:

```json
{
  "schemaVersion": 1,
  "kind": "kevin-mel-operational-receipt",
  "observedAt": "2026-10-23T03:00:00.000Z",
  "application": { "checkedAt": "2026-10-23T03:00:00.000Z", "state": "unconfirmed" },
  "database": { "checkedAt": "2026-10-23T03:00:00.000Z", "state": "unconfirmed" },
  "guestSaves": { "checkedAt": "2026-10-23T03:00:00.000Z", "state": "unconfirmed" },
  "media": { "checkedAt": "2026-10-23T03:00:00.000Z", "state": "unconfirmed" },
  "capacity": { "checkedAt": "2026-10-23T03:00:00.000Z", "state": "unconfirmed" },
  "failure": "observation_gap"
}
```

The example is a shape, not actual evidence. All timestamps must be UTC with exactly three fractional digits and a trailing `Z`. Each `checkedAt` must be no later than `observedAt`, which must not be in the future. Extra fields, duplicate fields, wrong types and unknown enum values are refused. `failure` is null or one of `collector_failed`, `source_unavailable`, `storage_unavailable`, `observation_gap`, `runtime_unavailable`, `publication_failed`; a nonnull failure requires at least one nonclear check.

Validate without publication:

```text
node scripts/operational-status.mjs --validate-receipt <private-receipt.json>
```

Explicit publication:

```text
node scripts/operational-status.mjs --publish --receipt <private-receipt.json> --repository <absolute-checkout> --private-work-directory <existing-private-directory>
```

The publisher uses existing Git authentication, a private alternate index and normal non-force pushes to `refs/heads/feature/operational-status`. That ref may contain exactly one regular file, `ops/operational-status.json`, with kind `kevin-mel-operational-status`. The application worktree, index, HEAD and backup-status ref remain unchanged. A conflicting application tree, concurrent non-fast-forward update or regressing observation/check time is refused. Equal observation timestamps must contain identical evidence; a state change requires a newer check time. An initially old receipt can be published, but the watchdog treats it as unconfirmed rather than fresh. Preserve failure evidence and investigate refused publication rather than forcing the ref or relabeling old observations as fresh.

## Independent watchdog

`.github/workflows/operational-watchdog.yml` configures a ten-minute best-effort schedule at minutes 3, 13, 23, 33, 43 and 53 UTC in this revision. It uses the pinned Node version, a three-minute job limit, read-only repository contents and issue-write permission. It reads only the operational-status ref and the opted-in private operations issue. It requires the exact private repository and issue `#116`, titled `Backup watchdog operations`, with its existing `<!-- kevin-mel-backup-watchdog:allow -->` marker.

Each category has separate incident/reminder/recovery state. The observer itself has an additional `observation` condition. A missing/inaccessible/malformed/future status or any observation older than 300 seconds becomes `unconfirmed`, never healthy. A nonnull collector failure also makes the observation condition unconfirmed. An old individual check becomes unconfirmed even if the top-level timestamp is fresh. A new fault, changed fault classification, hourly unresolved reminder or transition back to clear produces a content-free issue mention through the existing Gmail/phone route. Concurrent faults cannot hide one another. Notification is written before state acknowledgement; an uncertain write can produce a duplicate rather than lose the only warning.

Operational state uses `kevin-mel-operational-watchdog-state:v1:live` and `:synthetic` comments. It is independent of backup watchdog state and synthetic tests cannot clear a live incident. Damaged or ambiguous prior state refuses the run; a successful run or issue write does not prove phone delivery. Failure of GitHub itself or the watchdog can prevent its own issue notification; monitor failed workflow runs and retain Render's separate failure-email route.

A one-minute cron refresh is prepared for review: operational checks move to minutes 3, 13, 23, 33, 43 and 53 UTC; backup checks move to 8, 18, 28, 38, 48 and 58 UTC. The six checks per hour for each workflow, five-minute stagger, spending, permissions and activation gates are unchanged. This is a bounded scheduling diagnostic, with no proven cause or fix. Verify delivery to the default branch and an actual automatic run before crediting automatic firing. Manual dispatch does not establish cron execution.

The live state retains the last valid content-free source observation as a time watermark. A replayed older clear status, an edited state at the same observation time, or a regressed individual check becomes unconfirmed and preserves that watermark. Temporary status-read failure cannot erase it.

### Activation gates

Before live activation, inspect and accept the real collector, its protected private reset/history state, deployment and storage authority bindings, bounded containment, actual publication and scheduled operation. Exercise the failure categories with isolated synthetic faults, reset/stale/missing evidence and recovery. Confirm a new operational synthetic warning/recovery pair reaches the intended notification destination; preserve the earlier backup-route delivery evidence within its scope.

The existing shared variables must be confirmed:

- `ARCHIVE_BACKUP_WATCHDOG_BUDGET_CONFIRMED=true`
- `ARCHIVE_BACKUP_WATCHDOG_RECIPIENT_CONFIRMED=true`
- `ARCHIVE_BACKUP_WATCHDOG_ISSUE=116`

Only after host acceptance set both new live gates to exactly `true`:

- `ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED`
- `ARCHIVE_OPERATIONAL_WATCHDOG_HOST_PROOF_CONFIRMED`

Explicit `workflow_dispatch` modes `synthetic-failure` and `synthetic-recovery` require the shared recipient/budget gates, but can run before the new live gates. They never read or publish live operational status. A scheduled invocation cannot select synthetic mode.

The two watchdogs together schedule 288 jobs/day. Jobs are capped at three minutes each; account-wide included usage and the approved $20 Actions stop-cap remain the spending boundary. Extra checks consume that allowance, and reaching the stop-cap can stop monitoring. No new paid stack, dependency or CI secret is added.

At Monday, October 26, noon CDT / 17:00 UTC, manually set both `ARCHIVE_BACKUP_WATCHDOG_ENABLED` and `ARCHIVE_OPERATIONAL_WATCHDOG_ENABLED` to `false`, stop/disable the operations collector task and verify those saved states. No automatic end is installed. Preserve backup and expiry tasks and the approved spending stop.

### Optional canonical HTTPS liveness

Leave `ARCHIVE_OPERATIONAL_WATCHDOG_CANONICAL_HTTPS_ENABLED` unset/false while Coming Soon and maintenance are expected. Private operational acceptance does not establish public canonical uptime.

After deliberate domain cutover and canonical acceptance, set it to exactly `true`. The probe requests only `https://kevinandmel.com/api/health`, with no credentials or redirects, a complete-request deadline and a 128-byte body bound. It accepts only HTTP 200 JSON with the exact shape `{"status":"ok"}`. Network, HTTP, body or schema failure is `unconfirmed`. There is no dependency probe in Render's health endpoint, automatic restart, rollback, traffic stop or credential change. Disabling an already failing canonical probe does not manufacture recovery. Record deliberate maintenance and inspect the condition privately.

## Provider cost and incident channels

The existing Render workspace email destination and failure-only default, inherited by the application, cover Render-supported platform failure events. Keep that route; actual unhealthy-event phone delivery remains a separate observation until tested. It does not provide guest-save, R2 or arbitrary CPU/memory threshold alerts. See [Render's supported notifications](https://render.com/docs/notifications).

Use provider-native billing notifications with the same operator Gmail/phone destination, preserving the existing Actions $20 stop-cap and budget emails. Cloudflare offers account-wide usage-based budget emails to eligible Pay-as-you-go accounts; they do not include fixed Render/database charges and are not hard stops. Record fixed monthly costs and allocate the remaining headroom to Ryan's $25 warning/$40 intervention thresholds before choosing provider thresholds. Verify actual account availability, saved settings and delivery. Do not mark combined spending monitored from one provider's partial usage figure. See [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).

Keep actual host/provider capacity, billable usage, canonical canary originals, independent backup/readback and guest-reported problems in the attended opening/burst checks. These remain useful alongside automatic detection, whose failures and blind spots must remain explicit.
