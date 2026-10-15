# Guest page polish — October 15, 2026

The guest page uses warm ivory, a candid couple photo and restrained green/maroon accents. Ryan's follow-up restores direct memory choices on the landing page and removes the separate biography/profile section.

## Result

- Guests can choose **Add photos**, **Write a message**, or **Record a message** directly beneath the opening. Voice collection retains its existing build gate. There is no intermediate Share a memory button or extra step before choosing a memory type.
- The separate individual biography section is removed. The opening keeps the couple photograph, white print border, neutral paper backing and handwritten “Her entrance. His perfect hair.” caption. The existing 218-photo gallery follows the sharing choices.
- The opening photo remains the only eager, high-priority welcome image. The gallery's initial photo stays lazy with normal priority; deliberate navigation and playback load the selected slide eagerly. Its manifest, order, controls and thumbnail batching are unchanged.
- Landing buttons retain draft/saved labels, such as **Continue your note**. The unfinished-memory reminder tells guests to choose the corresponding memory type below. The existing choices screen remains available from form Back and Share another actions.
- Fraunces headings, Manrope body text and the Caveat caption remain locally served with system fallbacks, `font-display: swap` and public font licenses. No runtime font-provider request or package dependency is added.
- Photo and voice forms keep the note form's quiet card treatment. Original files, drafts and retry keys remain in mounted forms during navigation. Busy or uncertain submissions retain their navigation locks, and confirmed results retain **Back to our photos** and **Share another memory**.

## Verification

All **478 frontend tests**, ESLint and the production build pass. Updated landing assertions cover two direct choices with audio disabled, three with audio enabled, their labels/privacy copy, removal of profiles and the redundant CTA, and retained image priorities. Existing history, ownership, recovery, gallery and privacy cases remain in place. The existing large-chunk build advisory remains.

Browser checks at 1280 × 900, 390 × 844 and 320 × 740 confirmed direct welcome buttons, removal of the profile section and no horizontal overflow. A local note draft survived direct landing entry, browser Back to welcome and **Continue your note**. Heading focus, form Back navigation and direct photo/voice entry were checked. No synthetic note was submitted. Screenshots and command output remain in ignored `logs/guest-polish/`.

These are browser-emulation and frontend checks. Physical-phone microphone capture, hosted media storage, screen-reader use and reception-network acceptance remain separate release checks. Backend code, collection gates, provider settings and deployment configuration are unchanged. Ryan handles redeployment.
