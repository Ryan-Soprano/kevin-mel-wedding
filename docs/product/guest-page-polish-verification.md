# Guest page polish — October 15, 2026

Ryan requested a guest-focused polish pass and clarified that the five-photo scrapbook belongs above Share a memory. This change builds on the current welcome page at `f7e2bb8`.

## Result

- The welcome's order is introduction, five-photo scrapbook, direct contribution choices, then the full public gallery. The scrapbook has a wider desktop layout and modestly wider phone layout, preserving the three-over-two arrangement. The redundant Add your own memory shortcut is removed so the caption leads directly to Share a memory.
- A welcome-only color palette adds a peach introduction panel, berry names, a golden eyebrow badge, static starbursts and colored scrapbook tape. Photo, note and voice choices use coral, golden yellow and teal surfaces with matching dark icons and focus outlines. The composition screens keep their existing quiet card treatment.
- Photo and voice forms share the note form's card, field, spacing and action treatment. Photo selection uses compact previews, explicit Remove controls and optional expandable captions. Removing a photo restores focus to another Remove control or the picker. Editing a full five-photo selection has a focusable fallback.
- Existing per-file selection feedback retains acceptable files and reports skipped files. Limits, HEIC/HEIF copy-conversion instructions and original-file guidance remain available in an expandable help section. Failed/uncertain upload recovery remains visible and preserves the original selection.
- Voice recording has a prominent recording panel, a quiet timer and playback preview. File upload and optional captions use disclosures. Recording errors offer a direct written-message fallback, and caption validation opens and focuses the affected field.
- A confirmed result offers Back to our photos or Share another memory. Returning to the welcome preserves other drafts and displays a reminder when one remains unfinished. Screen navigation focuses the heading and starts at the top of the page.

## Verification

All **478 frontend tests**, ESLint and the production build pass. Existing tests cover retained originals, partial uploads, same-submission recovery, navigation locks and draft ownership; presentation expectations were updated for the new collage order and completion labels. The build retains its existing large-chunk advisory.

Local browser reviews checked the welcome at 1280 × 900, 390 × 844 and 320 × 740. The color follow-up confirmed all five scrapbook images, sharing before the full gallery, removal of the redundant shortcut, keyboard focus directly into the sharing choices, photo-form navigation and restoration of its existing palette. Sampled header and choice text contrasts range from 5.99:1 to 7.23:1. No horizontal overflow was observed. Earlier form checks covered expandable voice/file guidance, retained note drafts and the welcome draft reminder. Screenshots and synthetic fixtures remain in ignored `logs/guest-polish/`, including `colorful-welcome.png`.

This is browser emulation and frontend verification. Microphone capture, successful hosted media storage, physical phones, screen-reader use and reception-network acceptance remain separate release checks. No dependencies, backend code, collection gates, provider settings or deployment configuration changed.
