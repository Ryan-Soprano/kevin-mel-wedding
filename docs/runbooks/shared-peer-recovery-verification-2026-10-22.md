# Hosted shared-peer limit and recovery verification — October 22, 2026

Status: **deployed CREATE peer denial and natural-expiry recovery passed**.
This record grants no deployment or launch acceptance.

## Scope and method

Ryan requested completion of the shared-Wi-Fi investigation while preserving
Coming Soon and withholding deployments. He subsequently authorized a PR and
merge after verification and the existing CI/review gates. This change records
evidence; it changes no application code, UI, provider configuration or limits.

The retained application is `kevinandmel-staging`, service
`srv-db7nqu67bikc73bhr580`, deployed commit
`3b2fd0a985fdc526843dde34bb8a6086a8e2da87`, deploy
`dep-dbchp7dg1s2s73blbqa0`. Its application sources match the current checkout;
later commits changed documentation. One existing 1-CPU / 2-GiB instance was used.

The October 21 public probe positively observed multiple listener-captured
connection-peer buckets from one client. It also proved retry-key denial on
attempt 13 after 12 admissions. It did not prove a shared-parent denial. Sending
another 401 requests through distributed public proxies would not reliably isolate one
400-request parent below the 800-request global limit.

The October 22 diagnostic instead uses one controlled IPv4 loopback peer
inside the existing deployed service. It supplies only the approved HTTPS
scheme/host/port forwarding metadata and matching staging Origin needed by
staging admission. It supplies no forwarded client-address header. The servlet
listener captures the actual loopback peer before forwarding filters. This is
an internal proxy simulation, not a claim that a public client can choose its peer.

A separately reviewed standalone Java helper runs through PropertiesLauncher
with a 64-MiB maximum heap, without Spring startup or migrations. It retains
credentials, retry UUIDs and HMAC identities only in remote memory. Its JDBC
samples use fresh, verified read-only transactions, bounded queries and rollback.
The exact expected loopback HMAC is compared privately; no residual inference
or guessed proxy alias establishes denial. Only aggregate outcomes are recorded.

## Acceptance controls

- Start with quiet snapshots, an absent/expired loopback window and sufficient
  global headroom. Check continuity between requests as well as each HTTP bracket.
- Send at most **402** one-byte malformed CREATE calls: 400 admissions, one parent
  denial, and one same-key recovery after natural expiry. No note/media is created.
- Each admitted `400 VALIDATION_FAILED` must increment global and exact peer
  counters and allocate its fresh key at one attempt. Limits remain global 800,
  captured peer 400 and key 12 per independent 15-minute window.
- Request 401 must return `429 RATE_LIMITED`; global increments below 800, the
  exact peer stays at 400, and the denied fresh key remains absent. Retry-After
  must agree with that peer's database window, within sample-time rounding.
- Wait until database time is past that exact window's start plus 900 seconds.
  Retry the denied UUID once; it must reach validation with a new peer window
  at one and that key at one. No counter reset, quota change or artificial clock.
- Contribution, memory and media-asset counts must remain unchanged. Unrelated
  counter changes stop the test. Only normal first-request cleanup of privately
  observed rows older than one day is allowed, bounded by the app's 1000-row batch.
- Require explicit terminal proof and successful helper exit. Stop on uncertain
  HTTP results, redirects, noisy observations, timeouts or a 25-minute deadline.

## Results and cleanup

The quiet baseline had an expired global CREATE window at 13 attempts. The first
controlled request naturally opened the new window. Normal app maintenance
removed five privately observed counter rows older than one day; no later pruning
or unrelated counter change was accepted.

All **400** malformed admissions reached `400 VALIDATION_FAILED`, each with the
required global/peer/key increments. Request **401** returned `429 RATE_LIMITED`:
the exact peer remained at **400**, global advanced to **401 of 800**, and the
fresh denied key remained absent. **Retry-After was 744 seconds**, matching the
peer's database deadline. Denial was observed at approximately **11:26:34 UTC /
6:26:34 a.m. CDT**; its peer window expires at approximately **11:38:58 UTC /
6:38:58 a.m. CDT**. No limit was raised and no counter was manually reset.

At approximately **11:39:00 UTC / 6:39 a.m. CDT**, request **402** reused the
denied UUID and reached `400 VALIDATION_FAILED`. Its exact peer had naturally
expired; a new peer window started at **one**, the previously absent key was
allocated at **one**, and global naturally started a new window at **one**.
This proves admission resumed for the blocked retry; the malformed body never
became a saved contribution.

The explicit terminal PASS confirmed **402 total calls**, same-key recovery,
natural expiry, unchanged contribution/memory/media-asset counts and zero
unrelated counter changes. The helper and SSH coordinator exited successfully.
Independent Java 25 controls passed **14/14 probe + 16/16 observer**, and all
12 transferred class hashes matched the reviewed manifest. The prior 69 focused
security/session tests remain distinct evidence on the unchanged application.

Cleanup verified the diagnostic process absent and removed all 12 class files
and their owned remote directory. The local temporary private key was removed.
The temporary Render public key was matched by its fingerprint, removed, and
verified absent in the Dashboard; its actual label was `kevinmel`. The browser
controller worked again, so no further owner readback was needed. Database external
access stayed closed. No application setting, limit, DNS record, guest content
or media object was changed by this diagnostic.

Private, ignored receipts are under `logs/wifi-recovery-20261022.local/`:
`hosted-events.json`, the reviewed class manifest and the coordination/cleanup
record. These machine-local files do not transfer through Git; essential results
are recorded here. Preserve them privately rather than rerun a completed probe.

The app remained on its original live deploy and both public addresses served
Coming Soon during verification. Its auto-deploy remains off. The static Coming
Soon service auto-deploys from main, so both the documentation commit and actual
PR merge commit must contain `[skip render]`; CI and AI review still run normally.

## Evidence limits and launch use

This can establish the deployed **CREATE peer limit and natural-expiry recovery**.
It does not exhaust a particular public Render proxy's bucket, test all hosted
GRANT/FINALIZE/RECEIPT limits, demonstrate physical venue throughput, or prove
draft-preserving mobile retry UX. Those distinctions remain visible at cutover.
The earlier 69 focused security/session tests and PostgreSQL shared-guest workload
remain separate local evidence; this diagnostic does not replace them.

Do not rerun historical helpers, increase limits or clear throttle rows as an
automatic response to a busy reception. Honor Retry-After and retain the same
draft/retry identity. See [guest protection](guest-protection.md) and the
[go-live checklist](../product/go-live-checklist.md).
