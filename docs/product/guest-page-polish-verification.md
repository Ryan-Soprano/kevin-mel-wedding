# Guest page polish — October 15, 2026

Ryan requested a guest-focused polish pass and clarified that the five-photo scrapbook belongs above Share a memory. This change builds on the current welcome page at `f7e2bb8`.

## Result

- The welcome keeps its existing design and copy. Its order is introduction, five-photo scrapbook, direct contribution choices, then the full public gallery. The scrapbook has a wider desktop layout and modestly wider phone layout, preserving the three-over-two arrangement. Its sharing shortcut points down and focuses the contribution heading without adding hash history.
- Photo and voice forms share the note form's card, field, spacing and action treatment. Photo selection uses compact previews, explicit Remove controls and optional expandable captions. Removing a photo restores focus to another Remove control or the picker. Editing a full five-photo selection has a focusable fallback.
- Existing per-file selection feedback retains acceptable files and reports skipped files. Limits, HEIC/HEIF copy-conversion instructions and original-file guidance remain available in an expandable help section. Failed/uncertain upload recovery remains visible and preserves the original selection.
- Voice recording has a prominent recording panel, a quiet timer and playback preview. File upload and optional captions use disclosures. Recording errors offer a direct written-message fallback, and caption validation opens and focuses the affected field.
- A confirmed result offers Back to our photos or Share another memory. Returning to the welcome preserves other drafts and displays a reminder when one remains unfinished. Screen navigation focuses the heading and starts at the top of the page.

## Verification

All **478 frontend tests**, ESLint and the production build pass. Existing tests cover retained originals, partial uploads, same-submission recovery, navigation locks and draft ownership; presentation expectations were updated for the new collage order and completion labels. The build retains its existing large-chunk advisory.

The local browser review checked the welcome at 1280 × 900 and phone width 390, and narrow-screen voice/draft navigation at 320 × 740. It confirmed five scrapbook images before sharing, sharing before the full gallery, the scrapbook shortcut's focus and unchanged hash, form styling, expandable voice/file guidance, retained note drafts and the welcome draft reminder. No horizontal overflow was observed in these checks. Screenshots and synthetic fixtures remain in ignored `logs/guest-polish/`.

This is browser emulation and frontend verification. Microphone capture, successful hosted media storage, physical phones, screen-reader use and reception-network acceptance remain separate release checks. No dependencies, backend code, collection gates, provider settings or deployment configuration changed.
