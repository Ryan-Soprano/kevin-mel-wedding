# MED-01 verification

Date: 2026-10-05. Branch: `feature/private-photo-storage`, based on main `d692019` (merged MSG-02). Status: local implementation verified; **real R2 and physical-phone acceptance pending**. Ryan approved AWS SDK for Java v2 and TwelveMonkeys WebP dependencies and requested setup instructions because no private test bucket exists.

## Automated evidence

- Full Maven suite: **33 tests, zero failures/errors/skips** on Java 25, using disposable PostgreSQL 17 Testcontainers. Applied V1 and V2 are unchanged; fresh schema and populated-V1 upgrade now reach V3 without losing legacy text. Disabled photo storage creates no intent and leaves text submission operational.
- Frontend Node suite: **73 tests passed**; ESLint and production build passed. No frontend dependencies were added.
- `PhotoHttpTest`: actual HTTP and PostgreSQL cover committed private intents/receipts, normalized name, equivalent replay and changed-payload/type conflict, five ordered items with partial completion, concurrent creation/finalization, capability/grant ownership, premature/expired finalize and renewal, known invalid-byte `FAILED` commit, storage outage, and deferred database commit failures. A published object after a failed DB commit is recovered by same-item retry.
- `PhotoValidationTest`: raw UTF-16 boundaries, strict metadata types/limits, unsupported fields/formats, paths/controls, NUL/unpaired surrogates, case-insensitive duplicate IDs, fingerprint claims/order, actual JPEG/PNG/WebP decode, corrupt images, dimension bounds, size and SHA-256 mismatch.
- `R2ObjectStorageTest`: AWS-generated SigV4 PUT grants bind a staging key and Content-Type for no more than five minutes. An in-process HTTP S3 fixture checks signed server IO, exact original bytes, bounded reads, missing objects, and safe access failures. **This fixture is not Cloudflare R2.**
- `PhotoRestartTest`: pending intent/grant survives application shutdown; finalization after restart succeeds; a further restart retains complete receipt and byte-identical original in the external fixture. **This proves application/DB recovery against fixture storage, not provider durability.**
- Photo coordinator tests: one hash/key/item through repeated taps and deliberate retries; lost create/PUT/finalize responses; reconcile before retransfer; expiry renewal; invalid-byte replacement; incomplete receipts cannot confirm; 429 wait; local validation before network; uncertain failures retain original draft.

## Browser evidence

The isolated `/contract-preview.html` uses the actual single-photo form/coordinator with the synthetic adapter. It does not contact R2. Checked missing-file validation/focus, disabled metadata during send/uncertain result, announced progress/error, retained file and explicit retry, complete-result focus, and explicit share-another reset/focus. Browser verification caught and fixed an accidental reset-triggered submit. The wedding form was also checked at 320 px: controls fit, no horizontal overflow, and missing-file validation focuses the picker. Production uses the real adapter; the mock remains outside the normal build.

The independent photo form remains mounted when the text form is reviewed, submitted, or finished, preserving its own pending retry state. Preview URLs are revoked when the file changes/unmounts. Retry state is memory-only: refresh or tab closure is not supported recovery. Choosing another after a known invalid-photo rejection abandons the old intent for operator cleanup.

## Remaining acceptance

- Follow the [private R2 runbook](../../runbooks/private-photo-storage.md) with Ryan: private bucket, scoped token, exact-origin CORS, staging-only lifecycle, backend secrets, approved HTTPS test environment.
- Actual iPhone Safari and Android Chrome selection/upload/retry; HEIC rejection; VoiceOver/TalkBack announcement and focus checks.
- Retrieve real private original as operator, compare input/download/DB SHA-256 and size, restart with the same R2/DB, prove same receipt identity.
- Real provider grant expiry/action/key/type restrictions, unsigned original denial, private bucket settings, and disallowed-origin CORS.
- Public-release abuse controls, production routing, backups/restore, monitoring, and infrastructure readiness remain separate SEC/OPS/QA/REL tasks. Batch UI and selective item retry belong to MED-02; audio verification and couple-only archive/playback remain later work.

MED-01 must not be marked Done on the strength of local or mock evidence alone. No provider, deployment, or PR merge was performed during implementation.
