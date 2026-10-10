# Albums and event collections — local verification

ARC-02 implements shared private many-to-many albums: create, rename, organization-only delete, add/remove and independent earlier/later order. Lists, member pages and selectors are bounded. Existing memory detail, review, media permissions and editable metadata remain the only way to operate on originals. See the [album contract](../api/v1/albums.md).

Verification uses `feature/private-albums`, based on main `e1249c1`. Final-head CI and merge identities are recorded in the ARC-02 tracker and pull request. Ignored `logs/arc02-local/` contains local synthetic fixtures, logs, packages and screenshots.

## Automated verification

- The final frontend passed **322 tests**, ESLint and the production Vite build. New coverage includes strict private/ETag decoding, legacy memory UUIDs, 24-member paging and cross-page moves, many-to-many/no-op behavior, tombstone creation retries, memory Delete/Restore, stale and uncertain saves, exact retry, preparation interruption, CSRF refresh, access loss, shared authoring/review/navigation fences and ignored-abort late results. A confirmed save remains confirmed when its follow-up read times out. Installing a fresh revision clears old members, candidates and page cursors before another read, including failed partner-order reconciliation.
- The final Java 25/Linux backend clean run passed **358 tests**, with zero failures, errors or skips, including nine album HTTP cases, three album contract cases and 42 PostgreSQL recovery cases. Seven existing reception/rollback helper tests passed. Independent backend/recovery/frontend source review found no remaining concrete blocker.
- Additive V11 leaves V1–V10 unchanged. Recovery v4 preserves private collection names, tokens, tombstones, membership identities and sparse order. New recovery cases exercise mixed note/photo/audio relationships, empty/deleted albums, nine legacy bundle/target combinations, 25 rehashed invalid graphs rejected before writes, older/populated-target refusal and post-backup authoritative memory erasure.

## Packaged browser rehearsal

The rehearsal serves the combined production JAR in a disposable nonroot, read-only Linux container with tmpfs PostgreSQL. Storage, audio admission and retention are off; requests stay on loopback. It uses installed Chrome and the existing bundled Playwright, with desktop 1280 × 900, narrow 320 × 720 and actual 200% browser zoom. Original media preservation is separately exercised through controlled backend/recovery storage fixtures.

The final combined package passed **65 rendered states**: 21 desktop, 21 narrow and 23 at actual 200% Chrome zoom (629 CSS-pixel viewport, device-pixel ratio 2). Chrome 155.0.8059.39 and bundled Playwright 1.62.1 exercised 25-member pagination and cross-page ordering, shared membership, duplicate-add no-op tokens, private access, stale cursors, partner conflicts, committed-but-discarded responses, controlled blur/resume, existing memory detail, original Delete/Restore without automatic rejoining, member removal, album-only deletion and delayed-create tombstone reconciliation. No JavaScript errors or horizontal overflow were observed. Native viewport screenshots confirmed narrow and zoomed controls, and independent visual review checked pagination, selectors, conflicts and deletion confirmation.

Tested compilation image: `sha256:52a6d86c41e2c1ea4ca8d6ddb380f3c15b83780f37b1bbfec8332720a09bb796`. Packaged runtime: `sha256:36deefd3598168f2d825ccfd3b1a4b623a824677d5c0e3ebe011266c928c29bb`. Combined JAR SHA-256: `0b159b00b59699b37df14500a4aba94eccf9e9e5004a873a76033483e01ed6f2`. Owned Java/package runners, browser containers, network and disposable browser profile were verified absent after completion.

## Retained acceptance

This is local engineering verification ahead of Kevin and Melanie's real onboarding and feedback. REV-01/REV-03 acceptance remains open. Physical phones/tablets, assistive technology, actual hidden-tab/BFCache behavior, native dialogs, live-provider originals and hosted capacity/network/recovery acceptance remain open. Controlled blur/resume and synthetic storage do not establish those behaviors. Audio gates remain off for release.

No paid resources, deployment, hosting change, production account activation, invitation or tester message is part of this implementation. Self-service couple export remains ARC-05; current operator recovery excludes accounts, passwords, sessions and configuration. Album-only organization can return from older valid backups because it has no independent deletion ledger; current memory-erasure authority still removes erased members and originals.
