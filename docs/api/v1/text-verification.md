# MSG-01 — durable text verification

Verified locally on October 4, 2026, on `feature/persist-messages` from main `4a91fd1`.
The [v1 contract](README.md) remains authoritative. These results verify the local
text slice; they do not certify production release, load capacity, or media storage.

## Behavior and boundaries

- POST commits one contribution envelope and text memory before returning 201.
  Equivalent same-key POST returns 200 with original IDs/time and current states;
  changed normalized content returns 409 IDEMPOTENCY_CONFLICT.
- Raw JSON types and UTF-16 lengths are validated before ECMAScript whitespace
  normalization. Anonymous names become null; internal whitespace remains intact.
  NUL/unpaired surrogates are validation errors rather than database failures.
- The server fixes eventKey, memoryType, PENDING, and COUPLE_ONLY. Receipt GET
  requires the ID and UUID-v4 retry key. Valid wrong keys, unknown IDs, and malformed
  IDs return the same safe 404; missing/malformed keys return 400.
- Guest receipts contain IDs/states only. Errors contain safe messages, a server
  UUID requestId/X-Request-ID, and fieldErrors. API responses use no-store.
  Neither guest content nor retry keys are logged by the submission code.
- V2 stores SHA-256 over deterministic PostgreSQL JSONB creation fields. The
  existing unique retry-key constraint arbitrates concurrent transactions. A
  separate READ COMMITTED lookup after ON CONFLICT observes the committed winner.
  No exception is caught and queried inside an aborted PostgreSQL transaction.
- V1 is unchanged. V2 preserves legacy rows/content/IDs and backfills normalized
  single-text envelopes; unsupported legacy keys remain reserved. Future review
  or media migrations must preserve creation fingerprints and retry identity.
- The form uses the real v1 adapter, retains the normalized draft/key across
  uncertain outcomes, coalesces repeat taps, and retries only on an explicit action.
  A saved message must be deliberately reset before creating another submission.
  Retry-After blocks early retry. Retry state is in memory; refresh/tab closure
  recovery is not implemented. Photos remain previews, separate from saved text.
- Browser Origin/Fetch-Metadata checks protect text POST. Vite preserves the
  original Host header so same-origin development requests pass the server check.
  Production forwarding/origin configuration and abuse controls remain OPS/SEC work.

## Reproducible checks

Run from the repository root in Git Bash, with the existing Java/Node runtimes and
Docker Desktop running. No dependencies were added.

```sh
./backend/mvnw -f backend/pom.xml test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

Backend: **16 passed, zero failures/errors/skips**. Frontend: **62 passed, zero
failures/skips**. Lint and production build passed; preview/mock markers were absent
from the production assets. Whitespace checks passed.

| Evidence | What it establishes |
|---|---|
| ContributionHttpTest | Real TCP HTTP plus disposable PostgreSQL: named/anonymous normalization, strict body/header validation, raw length/Unicode boundaries, private receipts, wrong-key 404, conflict, current-state replay, and preserved fingerprint after later content changes |
| Concurrent HTTP requests | Eight equivalent requests yield one 201 and seven 200 responses with identical bodies; changed-content race yields one 201 and one 409; exactly one envelope/memory persists |
| Waiting contender test | PostgreSQL reports the contender blocked on the uncommitted unique key; rollback lets the contender create successfully |
| Insert and deferred-commit failure tests | Neither row remains; HTTP returns safe 503; the same uncommitted key can subsequently succeed |
| Lost-response recovery | HTTP creation response is deliberately discarded before retrying the original intent; replay preserves identity/count. The frontend mock separately loses a committed response and proves retained-key recovery |
| ContributionUpgradeRestartTest | Populated V1 upgrades to V2 without changing stored content/IDs; equivalent legacy replay succeeds; unsupported keys remain reserved; Flyway rerun is a no-op; full Spring shutdown/restart against the same PostgreSQL preserves accepted receipts; stopped test database yields safe 503 |
| DatabaseMigrationTest / HealthControllerTest | Existing migration/defaults/constraints/rollback/rerun and health behavior remain covered |
| textSubmission.test.js / shared API tests | One request/key for repeated taps, deliberate uncertain retry, no key rotation on conflicts/5xx/cancellation, correction after known validation rejection, Retry-After gating, and UUID-case canonicalization |

## Browser verification

The actual wedding form ran through Vite against a temporary Spring/PostgreSQL
Testcontainers server, with synthetic data only. Checked blank validation, named
and anonymous private saved acknowledgment, disabled submitted fields, explicit
new-message reset without an accidental POST, and retained/locked draft with a
retry action after the server became unavailable. The temporary server/harness was
removed; the application's regular development database was not migrated or reset.

Browser verification caught and fixed the development proxy's Host rewrite and a
new-message button default-action race. Screenshots are local ignored build
artifacts in `backend/target/msg01-evidence/`, not committed guest data.

## Remaining handoff

MSG-01 is ready for review on its feature branch; main is unchanged. No deployment,
provisioning, dependency additions, or PR merge was performed. MSG-02 still owns
full confirmation/review experience, keyboard/screen-reader accessibility, mobile
coverage and any refresh-safe draft recovery. Media, couple authentication/inbox,
rate-limit policy, production routing, backups and release checks remain their
existing issues. Production collection should wait for that release work.
