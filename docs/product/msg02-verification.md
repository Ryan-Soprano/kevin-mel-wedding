# MSG-02 guest note form verification

Status: implementation ready for review; actual device and screen-reader checks remain.
Last checked: 2026-10-05.

## Implemented flow

The wedding form has visible **Write a note**, **Ready to send?**, and saved-result steps. A guest can edit before sending, inspect the normalized name and note, and finish or begin a separate note after a valid durable receipt. Blank text and server field errors return focus to the affected input and preserve the draft. The review and result headings receive focus on step changes. Progress is announced through a polite status; errors use alerts and are linked to invalid inputs.

An uncertain response keeps the original draft and idempotency key. The review step shows the same note, removes Edit, and offers a deliberate **Try again** action. A receipt is the only path to a saved message. A 30-second deadline now bounds both the request and response body, aborts the transport, and leaves the same draft/key available for manual retry. Late responses cannot complete an expired attempt or unlock an active retry. This state survives only while the page stays open; no private draft/key is written to browser storage. The separate photo form does not enter the text request.

## Verification

From `frontend/`, `npm test` passed 62/62, `npm run lint` passed, and `npm run build` passed. Existing coordinator tests cover repeated taps sharing one request, lost committed responses, rejection, conflicts, cancellation, rate delay, and new-message key rotation. MSG-01's real HTTP/PostgreSQL tests cover commit, duplicate, rollback, restart, and privacy behavior.

The actual React form was exercised in a local browser with a disposable synthetic HTTP responder implementing the text receipt shape. These are UI checks, not a replacement for the MSG-01 database tests:

| Case | Observed result |
|---|---|
| Empty/whitespace note | Inline message error announced; focus returned to message; no send control reached |
| Keyboard Tab then Enter | Review opened, normalized name/note shown, review heading focused |
| Valid send | One POST, private saved result only after complete receipt; result heading focused |
| Done / another note | Done showed a final static result; another note cleared fields and focused message |
| HTTP 400 field rejection | Existing note retained; server message linked to invalid message field and focus returned there |
| Response lost after commit | Review kept the note and removed Edit; retry used the identical key/body, returned the original receipt, and stored one logical note |
| 320, 390, 768 CSS-pixel widths | No horizontal document overflow; long unbroken note wraps inside review |

The synthetic responder and temporary development servers were stopped after verification. The browser accessibility tree exposed labels, alerts, statuses, regions, and focus changes. This is semantic/keyboard evidence, not a claim that VoiceOver, TalkBack, NVDA, or a physical phone was tested.

## Release follow-up

### October 14 presentation and hook refactor

`ContributionForm` is now a 20-line shell composing `ContributionCompose`, `ContributionReview` and `ContributionResult`. `useContributionForm` owns editable state, focus, flow reporting and coordinator wiring; display helpers replace nested conditional labels and messages. The result view uses the step as its key to preserve the original success-to-done heading remount.

Byte comparisons confirm that `textSubmission.js`, the shared/private adapters and the App/AddMemory parent wiring are unchanged. The original guards, retained normalized draft/key, known-validation correction, uncertain-outcome lock, complete-receipt confirmation, deadlines and deliberate retries are preserved. Callback Done captures the receipt before resetting; standalone Done retains the receipt and key until disposal. Countdown expiry changes UI availability without submitting automatically.

Pinned Node 24.21.0 verification passes frontend lint, all 380 tests and the production build. Added assertions in the existing text-submission test file cover real React presentation, guest/private copy, escaping, validation descriptions, progress, send-label precedence, Edit gating and saved/done controls. They do not execute effects or establish focus, timers or hook transitions. Twenty-one existing backend submission, replay/upgrade/restart and couple-authoring checks pass with disposable PostgreSQL 17 and synthetic fixtures. Independent source and SSR-test review found no blockers. No new tracked test files or dependencies were added.

Mounted Chromium checks use the actual extracted form/hook, unchanged coordinator and real JSON transport/decoders with the isolated synthetic server. Forty guest/private cases and 453 assertions pass across desktop 1280×900, narrow 320×720 and CSS 200% text layouts (32 px base text), with focused desktop supplements for server fields, fallback errors, standalone Done and stalled request/body deadlines. They cover normalized review/edit, local validation, duplicate taps, retained-key recovery, 429/503 cooldown without automatic retry, active focus, latest callbacks and receipt/reset behavior. Zero page errors or external requests were observed; browser and Vite cleanup pass. Sample narrow and enlarged-text screenshots were reviewed. This is component/transport evidence, not SQL persistence, hosted operation, physical-phone or screen-reader acceptance.

Two supplemental unmount/replacement cases and 16 assertions also pass, including disposal, draft clearing and ignoring late callbacks after a replacement controller is mounted. Browser/Vite cleanup is verified.

The fresh combined application package also passes 305 assertions across six guest/private/layout flows against a UUID-owned disposable PostgreSQL 17 database. Real saved-note creation, same-key replay, private viewing and application restart preserve all six newly saved notes. There are no page errors or provider requests; the native Java process and browser stop and the exact owned database is removed. Package SHA-256: `cfb69fa86b6b3a676a7651dbf5636836d26da1d51849dc399748214265c13047`. This is local packaged HTTP/SQL persistence evidence with synthetic notes; hosted, physical-device and screen-reader acceptance remains separate.

This increment changes presentation and hook wiring. No deployment, provider/account/credential change, migration or CI change is included. SonarQube is not configured in the repository checks; its IDE/server re-scan remains separate. The earlier dated verification and physical-device/screen-reader/release follow-ups below remain historical evidence and retained acceptance work. Exact scoped delivery and verification are recorded in Notion.

October 5 review follow-up on `feature/review-acceptance`: **76 frontend tests**, lint and production build pass. Three deterministic regressions cover hanging requests, stalled JSON bodies, retained-key recovery, late responses and timer cleanup. An independent code review found no actionable issue. The actual React form against a separate loopback synthetic responder timed out a deliberately stalled response, announced the uncertain outcome, retained the locked note, and succeeded only after **Try again**. The responder recorded two requests with the same key/body and one logical synthetic note; this is UI evidence, not an additional database persistence claim.

A permitted 100-character unbroken guest name reproduced horizontal overflow at 320 CSS pixels (document width 1,515 pixels). Inherited `overflow-wrap: anywhere` on the note review/result fixes it: the same input produces a 305-pixel document inside a 320-pixel viewport. Physical-phone and 200% text-zoom acceptance remain open.

Before treating text collection as wedding ready, run the saved, rejected, and interrupted paths on an iPhone with Safari/VoiceOver and an Android phone with Chrome/TalkBack. Check actual touch targets, 200% text zoom, keyboard navigation on desktop, announced focus and errors, and recovery after the browser loses connectivity. Use synthetic notes against an approved test environment; do not use real guest content. Production security, hosting, monitoring, and recovery checks are tracked separately.
