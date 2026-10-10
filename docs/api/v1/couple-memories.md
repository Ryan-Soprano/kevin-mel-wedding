# Private couple memories and editable details — ARC-01

Kevin and Melanie can add notes, photos and voice memories from the signed-in archive. Creation requires a current enabled `COUPLE` account, an open reveal gate and same-origin requests. Guest collection stays independent. Real account activation, hosted access and the remaining audio/device acceptance stay deliberate later steps.

## Creation and upload recovery

The private workflow uses these contract-v1 routes:

| Method and route | Success | Purpose |
|---|---|---|
| POST `/api/memories/contributions` | 201 new / 200 replay | Create a private note or a media intent |
| GET `/api/memories/contributions/{contributionId}/receipt` | 200 | Reconcile the signed-in author's submission |
| POST `/api/memories/contributions/{contributionId}/memories/{memoryId}/upload-grants` | 201 | Authorize an unfinished original upload |
| POST `/api/memories/contributions/{contributionId}/memories/{memoryId}/finalize` | 200 | Verify original bytes and return committed states |
| PATCH `/api/memories/{memoryId}/metadata` | 200 | Conditionally replace editable details |

All routes require `X-Api-Contract: 1`; an absent or unsupported version returns `400 UNSUPPORTED_CONTRACT`. All mutations require the session's `X-CSRF-Token`; creation/upload recovery also requires the usual random UUID-v4 `Idempotency-Key`. Private receipts, grants and finalization are bound to the current author's account and retry key. The internal namespace is `couple:` followed by SHA-256 of the account UUID, a colon and the canonical external retry UUID. A second account's reuse of the same external key is a separate submission; it cannot recover the first author's upload. Public guest endpoints cannot operate on couple contributions.

Authenticated JSON is bounded before MVC: creation at 65,536 bytes, metadata at 16,384 bytes and finalize at 1,024 bytes. Exceeding these bounds returns `413 PAYLOAD_TOO_LARGE`; a body on receipts or grant requests returns `400 VALIDATION_FAILED`. These routes retain media capacity/reservation checks without applying anonymous guest admission quotas to signed-in authors.

Creation reuses the guest payload's original `message` or media `memoryType` and `items`. Omit `guestName` or supply null; a non-null name or initial metadata fields return `400 VALIDATION_FAILED`. Text bodies omit `memoryType`; add optional metadata after creation. A note's raw input contains at most 5,000 UTF-16 code units and must remain nonblank after the documented trimming rules. Photo batches contain one to five JPEG/PNG/WebP originals, at most 10 MB each. Audio contains one supported original of at most 25 MB and 120 seconds; both existing audio admission gates still apply. Existing captions, checksums, ordered client item IDs, capacity reservations, upload verification and deliberate same-key/per-item retries remain in use. A transfer alone does not confirm a saved memory. No original bytes, signed permissions or draft retry state are persisted by the browser.

Only authenticated couple creation bypasses guest review: it assigns `KEEP` and `COUPLE_ONLY`. Media remains absent from browsing until verified finalization. A replay returns its current state and never resets later review decisions or editable details. Guest contributions continue to enter `PENDING` and `COUPLE_ONLY`. Neither route publishes content.

## Editable details

After creating a memory, or when opening an existing guest memory, either partner can edit these optional fields. They supplement the original text, caption and file; they do not replace them.

| Field | Boundary | Meaning |
|---|---|---|
| `title` | nullable string, raw length at most 200 UTF-16 code units | Short display title |
| `description` | nullable string, raw length at most 2,000 UTF-16 code units | Private context about the memory |
| `memoryDate` | nullable canonical string | The remembered date, separate from upload time |
| `datePrecision` | `UNKNOWN`, `YEAR`, `MONTH`, `DAY` | Explicit certainty about that date |

`UNKNOWN` requires a null date. `YEAR` uses `YYYY`, `MONTH` uses `YYYY-MM`, and `DAY` uses a real calendar date `YYYY-MM-DD`, with years 0001–9999. Month/day bounds and leap years are validated. Partial dates never acquire an invented first day. Future dates are allowed for letters and planned milestones. Optional blank text becomes null; trimming and Unicode validation match the shared v1 rules.

The PATCH body contains exactly those four fields. `If-Match: "<revision>"` is required and shares the persisted memory revision with review actions. Supply a strong quoted integer from 1 through 2,147,483,647; a missing header returns `428 PRECONDITION_REQUIRED`, and malformed revisions or invalid fields return `400 VALIDATION_FAILED`. A changed update increments that revision and keeps `updatedAt` nondecreasing; an identical update at the current revision is a no-op. The response is the current private memory detail with an agreeing ETag. Stale edits return `412 METADATA_CONFLICT`. Reload before deliberately applying a conflicting edit. An uncertain outcome must be reconciled against current state before another edit or review action. Account/reveal authority is checked again after acquiring the memory lock. Deleted, purging and unavailable memories cannot be edited and return `404 NOT_FOUND`.

`createdAt`, original text/caption, media bytes, checksums, filenames and media upload timestamps remain unchanged. List/detail responses include `source` (`GUEST` or `COUPLE`) and the four editable fields. Existing records default to `GUEST` with null details and unknown date precision.

## Preservation and erasure

Additive migration V10 stores historical couple attribution and editable details without modifying V1–V9. The historical author UUID serves the same archival role as review audit actor UUIDs; it is not current authorization and is absent from receipt/list/detail responses. Both remain in operator archive data while account/password/session/configuration records remain excluded.

Recovery package v3 preserves these fields and requires V10. Reviewed legacy v1/v2 packages can restore upwards with guest/null/unknown defaults; a v3 package cannot restore into V8/V9. Current independent deletion-ledger replay and ordinary retention purge remove title, description and memory date together with original text/caption. Historical attribution and audit identities remain retained. New metadata does not change the existing deletion recovery window.

Resuming an unfinished private upload after isolated recovery requires the original author's account UUID, external retry key and original files. Account recovery remains separate from archive-data import; newly created account identities can browse/edit eligible memories but cannot recover another identity's unfinished upload.

V10 deliberately closes binary rollback to a V9 artifact under the exact migration guard. Use a separately verified compatible V10 artifact, fix forward, or follow isolated operator recovery; do not reverse migrations or edit Flyway history to permit rollback.

See [local verification](../../product/arc01-verification.md), [operator recovery](../../runbooks/operator-recovery.md) and [operations/rollback](../../runbooks/operations-and-rollback.md). Kevin and Melanie's real onboarding and feedback remain part of REV-01/REV-03 acceptance.
