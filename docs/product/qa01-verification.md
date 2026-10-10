# QA-01 — Integrated wedding flow verification

## Scope

This rehearsal connects the implemented guest collection and private review modules. It uses synthetic notes, generated photo/audio bytes, disposable PostgreSQL and isolated object-storage fixtures. It requires no paid resources, provider credentials or new dependencies.

Ryan confirmed on October 9, 2026 that functional pre-wedding MVP work and local verification come first; hosting options and costs will be evaluated afterward. Actual provider, physical-device and accessibility acceptance remains open until observed.

## Repeatable automated rehearsal

The frontend [mixed journey test](../../frontend/src/app/weddingJourneyIntegration.test.js) uses the real JSON adapter, note/photo/audio coordinators and inbox controller together against one synthetic server. It checks deliberate recovery, saved-photo sibling preservation, receipt-to-inbox identities, private review and sign-out cleanup. Synthetic media in this fixture proves transport/controller behavior; it does not exercise a browser recorder, image/audio decoder or R2.

The backend [mixed HTTP journey test](../../backend/src/test/java/com/kevinmel/archive/media/WeddingJourneyHttpTest.java) starts the real Spring HTTP application and a disposable PostgreSQL 17 database. It exercises public creation, verified media finalization, cookie/CSRF authentication, mixed private inbox and review transitions together. Photos are decoded and audio is verified with the existing FFmpeg runtime. Object storage is isolated in memory: original-byte assertions and playback permission issuance do not prove a real signed R2 download.

```sh
node --test frontend/src/app/weddingJourneyIntegration.test.js
./backend/mvnw -f backend/pom.xml --batch-mode -Dtest=WeddingJourneyHttpTest test
```

The backend command requires local Docker and the already approved FFmpeg/ffprobe runtime described in the [audio runbook](../runbooks/voice-memories.md). Use the existing Linux application/build layers when those binaries are unavailable on Windows; do not install or provision a new tool merely to label a check complete.

## Failure coverage

Keep the focused existing regressions alongside this mixed rehearsal:

| Scenario | Existing checks |
|---|---|
| Lost committed response and repeated submission | Text HTTP/upgrade/restart tests; photo/audio HTTP tests; guest coordinator integration tests |
| Partial photo batch and selective retry | `PhotoHttpTest`, `photoBatchIntegration.test.js` |
| Interrupted transfer, stalled response body and deliberate retry | Text/photo/audio submission tests and API client timeout tests |
| Expired or wrong-item upload permission | Photo/audio HTTP and submission coordinator tests |
| Database commit or object-storage failure | Photo/audio HTTP finalization tests; text persistence tests |
| Authentication, stale revision and review conflict | Session, inbox/review security and controller tests |
| Process restart and retained recovery identity | Text/photo/audio restart tests and isolated container smoke |
| Export/restore and erasure evidence | Operator recovery and retention PostgreSQL tests |

A simulated discarded response is recovery evidence, not proof of a real network interruption. An uploaded fixture is not a saved original until verified finalization and database commit succeed.

## QA-02 browser rehearsal still required

With disposable local accounts and synthetic content, check the guest welcome flow, named and anonymous notes, a multi-photo batch and a recorded or selected audio clip. Repeat taps must retain the same logical contribution. Retry after a partial failure must preserve saved siblings and the exact remaining originals.

Sign into the private inbox and check attribution, captions, grouping, original preview/download and audio playback. Keep, Archive, Delete and Restore must stay private. Confirm Delete shows its recovery deadline; stale review conflicts must reload current state. Sign-out must clear private rows, details and owned media URLs before another person uses the device.

Refresh/tab closure currently clears guest drafts, selected files and in-memory retry identity. It does not delete an already committed contribution, and it does not provide persistent offline or resumable upload. A newly selected file or fresh submission creates a new intent; it must not be counted as recovery of the earlier one.

Record keyboard/focus, 200% text zoom/reflow, screen-reader announcements, permission refusal, background/lock interruption and actual iPhone Safari/Android Chrome separately in QA-02 and the linked feature records. Hosted HTTPS, proxy/session, R2 CORS/original integrity, capacity and restart checks follow the later hosting decision. None is satisfied by these local fixtures.

## Evidence

October 9, 2026: all three mixed HTTP/PostgreSQL scenarios pass in the disposable Linux Java/FFmpeg runtime, with zero failures, errors or skips. The runner uses a read-only source mount and its own Testcontainers database; it passes no R2/provider credentials. The new frontend mixed journey passes, and the complete frontend suite passes all 286 tests, plus lint and the production build. Independent review found no blocking issues. No product defect was observed in this rehearsal.

Final pull-request CI remains a delivery gate and its outcome belongs in QA-01's Notion evidence. QA-02's actual-browser/device/accessibility checks and the later provider/operations checks remain open. No browser, device, provider or production pass is implied by the local results.
