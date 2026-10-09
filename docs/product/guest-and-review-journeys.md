# Guest contribution and couple review journeys

Status: Ready for FND-03 review  
Last updated: 2026-10-05\
Owners: Ryan (product confirmation) and Codex (documentation maintenance)

## Purpose

Define the intended guest contribution flow and private couple review flow before application implementation. These low-fidelity screens describe behavior, content, state, and recovery; they are not a visual-design specification.

## Product boundaries

- Guests do not create accounts.
- Guest names are optional.
- Every saved item starts as `PENDING` and `COUPLE_ONLY`.
- A guest submission never becomes public automatically.
- Kevin and Melanie review individual memories privately after the wedding reveal.
- Ryan operates the infrastructure but does not make moderation or publication decisions.
- Event planning, RSVPs, travel information, and an unapproved public gallery are outside scope.
- Wedding materials may advertise only contribution types that pass their implementation and release checks.

## Current support gate

This table prevents a target wireframe from being mistaken for a released capability.

| Contribution type | Current repository capability | Wedding-ready today? |
|---|---|---|
| Written note | The wedding form offers compose, review, edit, private saved confirmation, and same-key manual retry after an uncertain response. Browser keyboard/semantic and narrow-width checks passed; actual screen-reader/device and production operations checks remain. | No |
| Photos | MED-02 adds the grouped one-to-five original-photo form with captions, review/edit, verified finalization, accurate partial results and selective retained-original retry. UX-01 supplies the guest navigation. Existing local/provider evidence is retained; physical-phone and hosted release checks remain deferred. See [batch verification](med02-verification.md). | No |
| Audio | Browser recording and file-upload fallback are planned but not implemented. | No |
| Couple inbox | INB-01 adds sign-in, authorized note/photo list/detail pages, original preview/download and recovery states using AUTH-01/02 gates. Review mutations, audio playback, actual browser/device/hosted acceptance and real reveal onboarding remain pending. See [inbox verification](../api/v1/inbox-verification.md). | No |

The choose-type screen is therefore a target-state design. Before wedding QR material is printed, unsupported choices must be hidden rather than labeled “coming soon.”

## Experience principles

1. **Fast at the event:** a guest should understand the invitation and reach a contribution form in one decision.
2. **Private by default:** explain plainly that the contribution goes to Kevin and Melanie, not a public feed.
3. **Safe retries:** interrupted or repeated submissions must not silently create duplicates.
4. **No dead ends:** every failure state provides a useful retry, edit, or fallback action.
5. **Accessible without guesswork:** controls use visible labels, status changes are announced, and color is never the only signal.
6. **Preserve the surprise:** guest-facing copy must not imply that the couple can already access the archive before the reveal.

## Guest journey

### Flow map

```text
Scan QR
  -> Landing
  -> Choose note, photo, or audio
  -> Optional name
  -> Compose or select media
  -> Preview
  -> Submit
  -> Success receipt
       -> Finish
       -> Add another memory

At any step:
  validation problem -> explain beside the field -> keep entered work -> retry
  connection problem -> keep entered work -> retry
  unsupported browser/media -> offer a supported fallback
```

### G-01 — QR landing

```text
+--------------------------------------------------+
| Kevin & Melanie                                  |
| Help Kevin and Melanie remember their wedding.   |
|                                                  |
| Share a note, photo, or audio memory for them.   |
| Your contribution stays private until they       |
| choose what to keep or share.                    |
|                                                  |
| [ Share a memory ]                               |
| No account needed                                |
+--------------------------------------------------+
```

Primary action: **Share a memory**  
Failure state: if application startup fails, show a short unavailable message and a retry control rather than an empty page.

### G-02 — Choose contribution type

```text
+--------------------------------------------------+
| What would you like to share?                    |
|                                                  |
| [ Write a note ]                                 |
|   A message up to 5,000 characters               |
|                                                  |
| [ Add photos ]                                   |
|   Up to 5 supported photos                       |
|                                                  |
| [ Record audio ]                                 |
|   Up to 2 minutes                                |
|                                                  |
| [ Back ]                                         |
+--------------------------------------------------+
```

Release rule: render only types that are fully supported in the deployed wedding build. The target order favors the most reliable fallback: text, photos, then audio.

Each pass through this flow creates one memory type. After a successful submission, a guest can choose **Share another memory** to contribute a different type. This keeps validation, uploads, retries, and independent couple review understandable.

### G-03 — Optional name

```text
+--------------------------------------------------+
| Who is this memory from?                         |
|                                                  |
| Your name (optional)                             |
| [____________________________________________]   |
|                                                  |
| Leave this blank to share without your name.     |
|                                                  |
| [ Continue ]  [ Back ]                           |
+--------------------------------------------------+
```

Validation: at most 100 characters. Whitespace-only input is treated as no name.

### G-04A — Compose a written note

```text
+--------------------------------------------------+
| Write a note                                     |
|                                                  |
| Message                                          |
| [                                              ] |
| [                                              ] |
| [                                              ] |
| 0 / 5,000 characters                            |
|                                                  |
| [ Preview ]  [ Back ]                            |
+--------------------------------------------------+
```

Validation: require non-blank text and preserve the draft after validation or connection failures.

### G-04B — Select photos

```text
+--------------------------------------------------+
| Add photos                                       |
|                                                  |
| [ Choose photos ]                                |
| JPEG, PNG, or WebP; up to 5; 10 MB each          |
|                                                  |
| [thumbnail] [thumbnail] [thumbnail]              |
| [ Select photos to remove ]                      |
|                                                  |
| [ Preview ]  [ Back ]                            |
+--------------------------------------------------+
```

Validation: reject an invalid selection as a group, explain the exact limit, and retain previously accepted photos. HEIC/HEIF remains hidden until real-device evidence supports it.

### G-04C — Record audio

```text
+--------------------------------------------------+
| Record an audio memory                           |
|                                                  |
| [ Start recording ]   00:00 / 02:00              |
|                                                  |
| Prefer a file instead? [ Choose audio file ]     |
| Having trouble? [ Write a note instead ]         |
|                                                  |
| [ Preview ]  [ Back ]                            |
+--------------------------------------------------+
```

Required states: microphone permission explanation, recording, paused/stopped, playback, replace recording, permission denied, unsupported browser, and upload fallback. Exact accepted formats remain evidence-gated.

### G-05 — Preview and submit

```text
+--------------------------------------------------+
| Ready to send?                                   |
|                                                  |
| From: [name or "Name not provided"]              |
| [note text, photo thumbnails, or audio player]   |
|                                                  |
| Only Kevin and Melanie can review this memory.   |
|                                                  |
| [ Send memory ]  [ Edit ]                        |
+--------------------------------------------------+
```

Submitting state: disable repeated submission, preserve the draft, and announce progress. The client supplies an idempotency key so an uncertain retry can return the original durable receipt.

### G-06 — Result

Success copy:

> Thank you — your memory was saved for Kevin and Melanie.

Actions: **Done** and **Share another memory**.

The success screen does not show a guest-facing receipt code. The system still retains its durable internal receipt and idempotency data for safe retries and operational support.

Failure copy:

> We couldn’t confirm that your memory was saved. Your work is still here. Please try again.

When the outcome is uncertain, offer **Try again** with the same key and keep the preview locked; editing could turn a committed note into a changed-payload conflict. A known validation rejection returns to the editable fields with a field-level explanation. Never tell the guest to recreate the contribution until the original attempt is resolved.

## Couple review journey

AUTH-01 implements session authentication and reveal/role gates, with reveal closed by default. AUTH-02 issues a single-object HTTPS GET for an eligible verified PHOTO original after a fresh couple/reveal check and authenticated storage HEAD verification. Links last at most 300 seconds, with their actual signature expiry returned. INB-01 implements sign-in and the read-only note/photo list/detail/preview/download screens and APIs. Review actions, audio playback and real reveal onboarding remain target designs. See [inbox verification](../api/v1/inbox-verification.md), [AUTH-01 verification](../api/v1/auth-verification.md), [AUTH-02 verification](../api/v1/authorization-verification.md), and the [account-access runbook](../runbooks/account-access.md). No real couple accounts or credentials have been provisioned.

The later photo viewer must omit application credentials, use `no-referrer`, and keep signed URLs out of persistence and logs. A link can be reused by anyone who obtains it until its own expiry. Sign-out, account reset/disablement, and closing reveal prevent new links without revoking issued links or an in-progress download; `no-store` does not erase received bytes. DELETE items cannot receive playback until the future INB-02 restore flow restores them. Future inbox/review guards are implemented access boundaries, not evidence that these screens or their successful actions already exist.

### Flow map

```text
Sign in
  -> Inbox list
  -> Open memory detail
  -> Keep, archive, or request delete
  -> Return to the same filtered position

Inbox states:
  loading | results | empty | recoverable error | session expired
```

### C-01 — Inbox list

```text
+--------------------------------------------------+
| Memory inbox                         [ Sign out ] |
| [ Pending ] [ Kept ] [ Archived ]                |
|                                                  |
| 24 pending memories                              |
| ------------------------------------------------ |
| Name not provided · Written note · Oct 24        |
| “Wishing you both…”                    [ Open ]   |
| ------------------------------------------------ |
| Jordan · 3 photos · Oct 24             [ Open ]  |
| ------------------------------------------------ |
+--------------------------------------------------+
```

Loading: use a named loading status without presenting stale actions.  
Empty: “No pending memories right now.”  
Error: “We couldn’t load the inbox.” with **Try again**.  
Session expired: explain that no action was saved and return to sign-in.

### C-02 — Memory detail

```text
+--------------------------------------------------+
| [ Back to inbox ]                                |
|                                                  |
| From Jordan · Oct 24, 2026                       |
| [full note, photo, or audio player]              |
|                                                  |
| Status: Pending · Visibility: Couple only        |
|                                                  |
| [ Keep ]  [ Archive ]  [ Delete… ]               |
+--------------------------------------------------+
```

- **Keep** changes review status but remains private.
- **Archive** removes the item from the active queue and remains recoverable.
- **Delete…** opens a confirmation that explains the 30-day recoverable deletion window; it does not imply immediate permanent erasure.
- Publication is a separate future decision and is not offered by these controls.

### C-03 — Action feedback

On success, announce the new state and offer **Undo** when the lifecycle contract permits it. On failure, retain the current item and explain that no change was saved. Repeated actions must be safe.

## Copy deck

| Location | Draft copy |
|---|---|
| Landing invitation | Help Kevin and Melanie remember their wedding. |
| Privacy summary | Your contribution goes to Kevin and Melanie. It is not posted publicly. |
| No-account reassurance | No account needed. |
| Optional name | Leave this blank to share without your name. |
| Preview privacy | Only Kevin and Melanie can review this memory. |
| Success | Thank you — your memory was saved for Kevin and Melanie. |
| Retry | Your work is still here. Please try again. |
| Surprise constraint | Do not say that Kevin and Melanie can already view or receive notifications about submissions. |

## Confirmed product decisions

- [x] Use the reusable invitation “Help Kevin and Melanie remember their wedding.”
- [x] Create one memory type per pass through the flow; **Share another memory** starts another contribution.
- [x] Use “Name not provided” in the private inbox when the guest leaves the name blank.
- [x] Do not show a guest-facing receipt code unless later support testing demonstrates a need.
- [x] Use “Your memory was saved for Kevin and Melanie” without implying that they can access the archive before the reveal.
- [x] Keep deletion recoverable for 30 days and reflect that window in confirmation and undo copy.
- [x] Decide the final wedding-ready type list at release freeze and completely hide unsupported types.

## Acceptance checklist

- [x] Target guest path covers landing, type choice, optional name, compose, preview, submission, result, and failures.
- [x] Draft privacy, surprise, validation, success, and retry copy is recorded.
- [x] Couple inbox covers list, detail, loading, empty, error, keep, archive, and delete states.
- [x] Unsupported release options are gated instead of advertised.
- [x] Product questions requiring Ryan’s decision are explicitly listed.
