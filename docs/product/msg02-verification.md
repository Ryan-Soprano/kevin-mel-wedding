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

October 5 review follow-up on `feature/review-acceptance`: **76 frontend tests**, lint and production build pass. Three deterministic regressions cover hanging requests, stalled JSON bodies, retained-key recovery, late responses and timer cleanup. An independent code review found no actionable issue. The actual React form against a separate loopback synthetic responder timed out a deliberately stalled response, announced the uncertain outcome, retained the locked note, and succeeded only after **Try again**. The responder recorded two requests with the same key/body and one logical synthetic note; this is UI evidence, not an additional database persistence claim.

A permitted 100-character unbroken guest name reproduced horizontal overflow at 320 CSS pixels (document width 1,515 pixels). Inherited `overflow-wrap: anywhere` on the note review/result fixes it: the same input produces a 305-pixel document inside a 320-pixel viewport. Physical-phone and 200% text-zoom acceptance remain open.

Before treating text collection as wedding ready, run the saved, rejected, and interrupted paths on an iPhone with Safari/VoiceOver and an Android phone with Chrome/TalkBack. Check actual touch targets, 200% text zoom, keyboard navigation on desktop, announced focus and errors, and recovery after the browser loses connectivity. Use synthetic notes against an approved test environment; do not use real guest content. Production security, hosting, monitoring, and recovery checks are tracked separately.
