# Photo upload confirmation — October 19, 2026

## Result

Testing feedback identified that the completed photo upload still looked like an
unfinished form. The picker, individual previews, captions and keep-page-open
guidance remained above a confirmation saying the photos were saved privately.

After every photo is confirmed and the current operation finishes, the form now
shows a dedicated receipt. Guest copy says **Your 3 photos have been sent to Kevin
and Melanie!**, with singular wording for one photo, followed by **Thanks for
sharing. You can close this page.** A checkmark reinforces completion. The picker,
large photo cards, editing controls and upload instructions are absent. No new
thumbnail strip is needed on the completed receipt.

The existing **Back to our photos** and **Share another memory** actions remain.
They retain the original receipt/reset callbacks and existing gallery/choice
destinations. There is no automatic navigation or early reset. Standalone forms
retain **Share another batch**. Private archive forms retain their private-save
wording, **View added memory**, and the completed receipt passed to their caller.
Guest review copy explains before sending that the couple may choose to share
the photos; the confirmation does not promise that they will never be shared or
that a reveal-gated archive is already viewable.

## Recovery and accessibility

Partial, rejected, delayed and uncertain uploads retain the current compose view:
original files, captions, name, per-photo statuses, selection checkboxes and
deliberate retries remain available. Confirmed guest photos say **Sent**;
uncertain outcomes still say **Not confirmed**, and failed transfers still say
**Needs retry**. Private archive statuses retain **Saved privately**. Retry-After
and busy locks are unchanged. Only a complete coordinator receipt can trigger
the new confirmation; transferring bytes alone cannot do so.

The upload coordinator and retry/reset/navigation logic are unchanged. The hook
only passes the guest/private mode to its status-copy helper. Existing result
focus moves to the receipt's focusable heading after the operation settles; an
inactive form defers that focus until reactivation. Scoped feature CSS keeps
that heading visible despite the guest form's usual hidden repeated title.
Unmounting previews releases their object URLs while the immutable batch and
receipt remain retained until an explicit next action.

## Verification

- Node 24.21.0: all **571 frontend tests**, ESLint and the production build pass.
  The **17 focused tests** include the real coordinator/JSON adapter and SSR
  checks for partial-to-complete retry, a single photo, guest/private/standalone
  receipts, delayed/busy controls and uncertain creation. The full suite includes
  existing same-key recovery, saved-sibling, grant, timeout and navigation tests.
- An initial sandboxed run could not reach localhost in four unchanged redirect
  tests (`EACCES`). The suite passes with local networking permitted; no API or
  unrelated test changes were made to accommodate the environment.
- **70 mounted browser assertions** exercise the actual StrictMode form and
  coordinator with the existing in-memory API mock. Cases cover successful
  single/multiple uploads, partial selective retry, uncertain creation replay,
  network/unavailable recovery, rejected media, expired-grant renewal,
  Retry-After locks, private receipt callbacks, standalone restart, keyboard
  completion, inactive/reactivated focus and preview URL cleanup.
- The real file picker accepts three synthetic PNGs. Further cases load local
  PNG fixtures through the actual input's change handler. The API ledger confirms
  selected retries preserve the submission key and client item identities, skip
  confirmed siblings, and transfer only the unresolved original.
- Success layout checks at **1280 × 900**, **390 × 844** and **320 × 740** find no
  horizontal overflow or clipped receipt heading. Both actions retain at least
  44-pixel targets. Desktop/mobile screenshots are visually reviewed. The final
  fixture has no console warnings/errors.
- Build output retains the existing chunk-size advisory. No dependency,
  backend, storage, publication-policy or deployment configuration is changed.

Ignored `logs/photo-confirmation.local/` contains the isolated browser fixture,
synthetic PNGs, screenshots, assertion report, test/build logs and intended-source
hash manifest. Concurrent gallery work and the existing retention branch are
preserved and excluded from this change's delivery. Browser uploads are synthetic;
these checks do not add hosted/provider, physical-phone or screen-reader evidence.
