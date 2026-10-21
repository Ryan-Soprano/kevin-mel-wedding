# Go Live checklist — kevinandmel.com

Prepared October 21, 2026 from read-only infrastructure checks and the recorded staging rehearsals. **Current decision: HOLD pending the pre-cutover gates and successful cutover acceptance below.** This document prepares launch; it does not change DNS, deploy, spend money or open collection.

**Launch target confirmed by Ryan: Thursday evening, October 22, 2026 (America/Chicago / CDT).** The exact cutover time remains to be recorded. The date is a deadline for the checks below, not evidence that they passed.

The launch is anonymous guest collection at **https://kevinandmel.com**. Private couple access stays closed (`MEMORY_ARCHIVE_REVEALED=false`); account activation and the later reveal have their own acceptance. Ryan owns infrastructure and the cutover. Kevin and Melanie own guest-facing content, moderation and archive decisions.

**Approved plan, October 21:** Ryan declined the extra monthly cost of a second hosted stack and approved preparing [promotion of the existing staging resources](../runbooks/go-live-kevinandmel-com.md#promotion-plan) at their current size, replacing Coming Soon during the October 22 evening cutover. This retires hosted staging; future development uses isolated local environments and CI. Promotion has not been performed, and no new paid resources are authorized or provisioned. Use the [final review packet](promotion-final-review-2026-10-21.md) for the home review and remaining evidence.

Use the [step-by-step launch guide](../runbooks/go-live-kevinandmel-com.md) to execute this checklist. Preserve the older [release checklist](wedding-release-checklist.md) as the detailed acceptance/history record.

## Work backward from Thursday evening

| When | Required outcome |
| --- | --- |
| Wednesday, October 21 | Prepare promotion of the current app/database/private bucket without a second hosted stack; investigate shared-network throttling; identify and close gaps in backup/recovery, alerts and guest privacy evidence. Leave cosmetic cleanup outside this work. |
| Thursday daytime, October 22 | Finish those gates, freeze the reviewed release with exact-commit CI, verify the selected target's running configuration/recovery access, and prepare DNS/domain rollback plus the final QR proof. |
| Thursday evening, before sharing | Make the go/no-go decision from recorded evidence, execute the domain/TLS cutover, complete canonical-origin phone/save/retry and printed-QR checks, then distribute the link/cards. Observe the first 15 minutes and first substantial burst. |

An unresolved launch blocker keeps collection closed; record the issue and next action rather than silently marking it accepted to meet the deadline. Private couple activation/reveal remains separate.

## Evidence already available

- [x] Exact staging release `01fc4e5e50d3f2f1bab35aace7feec0ad993dc53` passed [main CI](https://github.com/Ryan-Soprano/kevin-mel-wedding/actions/runs/39623274106): 479 backend, 577 frontend and 14 operational-helper tests, plus lint/build. No Surefire shutdown timeouts were observed in that run.
- [x] That release is running on `kevinandmel-staging.onrender.com`, deployment `dep-dbcdaqoae00c739d46ag`. Automatic deployment is off. This identifies the tested staging candidate, not an approved production target.
- [x] Seven isolated browser scenarios passed on staging: gallery, named/anonymous notes, committed-response recovery, five-photo upload, audio file fallback after microphone denial, partial-photo retry, and anonymous private-access denial. Earlier physical-phone checks are recorded in QA-02; repeat the cases affected by the new origin.
- [x] The bounded mixed-media run completed 100 synthetic groups / 140 memories, with all 76 busy media finalizations recovering using the same identity and no second upload. A separate real retry-key cooldown recovered after its advertised wait.
- [x] A [small independent archive restore](../runbooks/recovery-rehearsal-2026-10-20.md) passed, including notes, photo/audio originals and current deletion evidence. Its 17m38s pause-through-checks result excludes preparation and does not prove the complete hosted recovery targets.
- [x] Both custom-domain addresses currently reach the coming-soon page over valid HTTPS; `www` redirects to the apex. Namecheap still hosts DNS. The apex already has Render's A record.

The browser/capacity reports remain local under `logs/staging-flows-20261021.local/` and `logs/staging-capacity-20261021.local/`. They establish their recorded workloads, not maximum-size media, venue Wi-Fi or every private-account flow.

## Before starting the cutover

- [x] **Avoid a duplicate hosted stack.** Ryan approved preparing the existing environment for promotion. No second application/database stack is being provisioned.
- [ ] **Verify the promotion target and checkpoint.** Confirm the existing app/database/private bucket/current deletion authority, unchanged sizing and private operator access. Take a fresh recoverable checkpoint and prepare the production profile/origin/proxy/port settings before the maintenance window. Do not reset or replace retained data to make the archive look empty.
- [ ] **Close the shared-network gate.** Verify the actual captured peer/proxy boundary, shared-parent denial and recovery through a private diagnostic and a bounded retest. The staging fresh-key probe reached 401 CREATE attempts without the planned shared-parent denial; that result is inconclusive. Do not raise quotas or trust arbitrary forwarding headers to make the check pass.
- [ ] **Accept the burst/retry experience.** Only 56/99 initial groups finished on the first pass; 43 needed deliberate recovery. Keep one finalization slot and the tested 2 GiB sizing unless new measurements support a change. Confirm the actual guest UI handles busy-item retry on representative phones without losing drafts or saved siblings.
- [ ] **Prove hosted recovery and alerting for the selected live data.** Record scheduled database recovery points within five minutes, verified private media/current deletion-ledger copies, complete recovery within one hour, independent-copy access, and enforced 30-day contribution-bearing backup expiry. Finish the outstanding recovery/key/source-ledger-loss requirements in OPS-02/OPS-03; the small restore does not waive them. Test content-free outage, failed-save, storage, capacity and backup-freshness alerts to Ryan.
- [ ] **Finish guest-launch privacy/security acceptance.** Verify anonymous private-route/object denial, Secure anonymous session and CSRF/origin behavior, private cache boundaries and safe logging using approved synthetic evidence. Keep R2 private, credentials out of logs and database external access disabled. Authenticated private-account acceptance remains a separate gate before couple access.
- [x] **Preserve the retained archive.** The two recent rehearsals' 105 known synthetic groups / 150 memories remain private with their ownership journals. Promotion reuses that archive; it does not start with an empty database. Keep any later fixture cleanup separate and scoped, and do not presume that every record is synthetic.
- [ ] **Freeze the release candidate.** Record the reviewed commit, passing CI on that exact commit, immutable deployed artifact and a schema-compatible rollback artifact. A later source change needs affected checks and exact-commit CI again. Leave cosmetic Sonar warnings outside launch scope.
- [ ] **Record the operating window.** Ryan has working Render, Namecheap, private storage and recovery access, time to observe the cutover, an interruption plan and coverage through the agreed collection period. Kevin/Melanie approve available features and guest copy. No final cards or guest announcement yet.

## During the cutover, before sharing the link

- [ ] Put the chosen target behind maintenance/admission before a deployment can accept public guests, then apply the [live configuration matrix](../runbooks/go-live-kevinandmel-com.md#2-prepare-the-live-application). Verify running settings, not merely saved Dashboard values. Keep reveal closed.
- [ ] Confirm the selected database/schema privately, a fresh recoverable checkpoint, private bucket permissions, exact-origin browser CORS, staging-only lifecycle and retention operation. `/api/health` alone is not readiness.
- [ ] Move the apex and `www` custom-domain associations from coming-soon to the full app. Verify Namecheap web records, Render domain verification, valid certificates and HTTP/`www` redirects. Preserve mail/TXT records and the fallback service.
- [ ] Verify the deployed commit/artifact is the chosen release and the full guest app, assets and API are served together at the canonical origin. Decide and test access to the live service's old `onrender.com` hostname.
- [ ] Open the controlled public canary window. Save clearly marked synthetic named/anonymous notes, a photo batch and audio from the canonical site; verify committed receipts, private defaults and same-item retry. Check anonymous private-access denial and private-object denial. Do not activate real couple accounts for this smoke.
- [ ] Generate/approve the final QR for **https://kevinandmel.com**, include that readable fallback URL, and prepare a printed proof. On representative iPhone Safari and Android Chrome, scan it, complete the affected note/photo/audio and retry cases, and return through the gallery. Check cellular and the available venue/shared network; record any network limitation honestly.
- [ ] Confirm health, memory, failed/pending media, reservations, backup freshness and alert delivery after the canary. Resolve unexpected failures before broad release.
- [ ] Record owner, time, release SHA and evidence in REL-01/QA-02/SEC-02/OPS-03, then distribute the accepted QR cards/link.

## After opening

- [ ] Observe the first 15 minutes and the first substantial burst; then follow the [wedding-day operations sheet](../runbooks/wedding-day-operations.md). Review either storage reservation budget at 80%, alongside actual provider usage and host memory.
- [ ] Keep automatic deployment off, the coming-soon fallback intact, backups/retention monitored and same-item recovery available. Do not refresh/re-upload successful siblings to work around a busy finalization.
- [ ] Treat the promoted app/database/bucket and any remaining provider URL as production. Use isolated local data and CI for routine development/testing; no further load rehearsals or fixture resets against the live archive.
- [ ] Use the [rollback section](../runbooks/go-live-kevinandmel-com.md#6-interruption-and-rollback) if needed. Preserve every new guest submission; never restore a prelaunch database as a code rollback.

Launch record: `target/service ____ · release SHA ____ · CI ____ · backup checkpoint ____ · cutover time/timezone ____ · Ryan ____ · Kevin/Melanie content acceptance ____ · remaining issues ____`.

## Before later private couple access

- [ ] Complete authenticated session/CSRF rotation, logout/revocation, private playback/export and cache/history/shared-device acceptance through the approved synthetic process before activating real couple access or opening reveal. Keep these outstanding requirements visible in SEC-02/QA-02; anonymous launch does not mark them passed.

Tracking: [REL-01](https://app.notion.com/p/3dad9739c6bc81d3a003e4539569d93a), [QA-02](https://app.notion.com/p/3dad9739c6bc81989d83caac5cf88773), [SEC-01](https://app.notion.com/p/3dad9739c6bc816aada2c689df7fa4e2), [SEC-02](https://app.notion.com/p/3dad9739c6bc81f5a989d3af6684b8b4), [OPS-02](https://app.notion.com/p/3dad9739c6bc8108b05bd630148cb2f7), [OPS-03](https://app.notion.com/p/3dad9739c6bc81538afdf1691d060353). The tracker states and evidence require reconciliation before signing off; creating this checklist changes none of them.
