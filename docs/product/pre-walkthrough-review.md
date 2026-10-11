# Pre-walkthrough archive and export review

Reviewed October 11, 2026 on `feature/pre-walkthrough-review`, based on merged main `5b4216d`. This records source review, synthetic regressions and documentation preparation before Ryan, Kevin and Melanie's walkthrough. It supplies no human walkthrough, physical-device, live-provider or hosted release acceptance.

## Findings and corrections

| Trigger | Before | Corrected behavior and regression |
|---|---|---|
| Couple account is disabled while a metadata UPDATE is blocked in PostgreSQL | The edit could commit and return private detail with HTTP 200 despite revocation | Recheck current couple authority after the write inside the transaction. The real HTTP/PostgreSQL test holds the UPDATE on an exact fixture advisory lock, disables the account, releases the lock, and requires HTTP 401, no private response content, and unchanged stored metadata/revision. It failed before the fix and passed afterward. A separate unit regression checks result suppression. |
| Hidden export returns, loads progress, then times out reading its part page | Access became unavailable while private export progress remained in presentation state; its return context could also be lost | Clear export presentation with the other private state on a failed access recheck. Keep only the existing opaque identity until the whole resume succeeds. The deterministic regression covers an acknowledged job and an uncertain committed prepare action, verifies cleared state, ignores a late result, and returns to the same job after a fresh access check. The original regression failed before the fix. |

## Scope reviewed

- Private couple authority on metadata writes, archive mutations and export capture/preparation/download; existing session/reveal gates and conditional revisions.
- Export snapshot invalidation after memory or organization changes; original-file length/SHA-256 checks; bounded delivery, missing-original reports and deliberate attempt reconciliation.
- Memory Delete/Restore effects on albums, timeline events and tags; original preservation and current deletion authority in recovery.
- Frontend export action fences, abort/deadline handling, Blob cleanup, hide/resume/sign-out and late-result suppression.
- Offline reader text escaping and generated relative original paths. The existing portable format remains separate from operator database recovery.

Independent review of each code fix found no remaining concrete issue in this scope. This is a focused review, not proof of every security or operational property of a future deployment.

## Verification

- Final backend source: **91 focused Linux tests passed**, zero failures, errors or skips. These include couple authoring, album/timeline/library HTTP flows, export lifecycle/security/snapshot/writer cases, owner-only temporary files and metadata/review validation. The deterministic PostgreSQL revocation/rollback regression is included.
- Reused the already installed local Java 25/Maven/FFmpeg build image with fresh backend source and disposable PostgreSQL 17. No dependencies were downloaded or installed. Reports remain in ignored `backend/target/review-linux-reports/`; the owned runner and test containers were removed.
- Frontend: **377 tests passed**, ESLint and production Vite build passed. The expanded export recovery regression passes both ordinary and uncertain-control resume paths. Local checks use bundled Node 24.19.0; the repository's CI uses the team runtime from `.nvmrc`.
- Fresh combined walkthrough image: `sha256:262b120db02b462aa6f893551b8fc9d46cf3658f31b436b94b2f5b8f16f60cee`. Offline Maven packaging used the existing cached builder and runtime with current backend source and final frontend build; bundled JavaScript matches that build byte for byte. The executable JAR SHA-256 is `bd5456b5a5e320b44c4f29855cc7d5d72ec4cb06b3e3d3ea6040a4c7f5172664`.
- That exact image passed `scripts/local-review.mjs --self-check`: synthetic real-API seeding and packaged-asset checks passed, then owned cleanup verified absence. The builder was removed and no containers remained running. The regular Compose database was not used. Build provenance remains in ignored `backend/target/pre-walkthrough-image-248d3176/`.
- The Vite build retains its existing warning for a main chunk above 500 kB. This review does not change bundling or the public gallery.
- Documentation links and labels are checked against current source/contracts and existing technical runbooks. Fresh provider/storage checks, native browser-save behavior and physical-device usability are outside this run.

The repository's existing CI remains the full Linux backend/frontend gate for the pull request; exact-head results belong in that PR and the Notion evidence. Historical full-suite and packaged-browser results remain in their original verification records, including [ARC-05](arc05-verification.md) and the [local couple review](local-couple-review-verification.md).

## Guides and tracker reconciliation

The [couple quick-start guide](couple-quick-start.md) explains review, authoring, organization, portable exports, support and ownership. The [wedding-day operator sheet](../runbooks/wedding-day-operations.md) sequences pre-arrival checks, incidents, backups, unfinished-upload reconciliation and post-event preservation. Both link existing technical procedures instead of replacing them.

The Notion tracker distinguishes implemented local features from remaining acceptance. Stale references to unimplemented login UI, audio integration and future review actions are corrected; local timeline/export implementation does not close real onboarding or release gates. REL-02/REV-02 preparation is recorded without claiming actual wedding operation or independent archive handoff.

## Remaining acceptance

Follow the [25-minute walkthrough](../runbooks/local-couple-review.md) and record actual feedback. Its example now selects the fresh immutable local image containing these fixes. The prior browser/lifecycle verification remains tied to its original package; the new package's self-check supplements that evidence and does not supply human walkthrough acceptance.

Physical phones, assistive technology, native dialogs/saves, actual media/provider behavior, full-app hosting/HTTPS, independent backups and restore targets, real account activation/handoff, final QR print/scans and the wedding release decision remain open in the [release checklist](wedding-release-checklist.md). Audio admission remains off pending acceptance. Hosting, spending, account activation, messages and optional backlog features are outside this work.
