# Guest page polish — October 15, 2026

Ryan approved a mobile opening inspired by a contemporary wedding invitation and a candid photo album. This pass replaces the earlier green-to-maroon backdrop with warm ivory and deliberate accents: Kevin's green for the invitation, Melanie's maroon for the ampersand and her profile heading.

## Result

- The opening puts one couple photo beside their names on desktop and immediately beneath them on mobile. A white print border, neutral paper backing and the handwritten “Her entrance. His perfect hair.” caption add personality without competing with the photograph. The photo opens in a native modal with a Close control, Escape dismissal and focus restored to its trigger.
- A short invitation and one **Share a memory** button open the existing memory choices. No account is needed; the name remains optional and contributions remain private. The welcome draft reminder directs guests through the new invitation to their existing draft.
- Kevin and Melanie each have a portrait beside a concise biography drawn from Ryan's descriptions. On narrow phones, text wraps around the portrait and then uses the full available width. The complete 218-photo public gallery follows their stories; its manifest, order, controls and thumbnail batching are unchanged.
- Fraunces headings, Manrope body text and one Caveat caption carry the approved typography into the guest screens. The WOFF2 copies are served locally, with system fallbacks and `font-display: swap`. Font licenses are included in the public build; there are no runtime requests to a font provider and no new package dependencies.
- Photo and voice forms keep the note form's quiet card treatment. Existing selection feedback, optional captions, limits, recording controls and uncertain/failed upload recovery remain intact. Original files, drafts and retry keys remain in mounted forms when guests navigate between screens.
- Confirmed results still offer **Back to our photos** or **Share another memory**. Returning to the welcome preserves other drafts. Navigation focuses the new heading and starts at the top; busy or uncertain submissions retain their navigation lock.

## Verification

All **478 frontend tests**, ESLint and the production build pass. Existing gallery presentation assertions now cover the focal image, invitation order, individual portraits with biographies and the removal of direct welcome choices. Existing recovery, ownership, history, gallery and privacy cases remain in place. The production build retains its existing large-chunk advisory.

Browser checks covered 1280 × 900, 390 × 844 and 320 × 740 viewports, with no horizontal overflow. The 320px review also checked biography wrapping. A local note draft survived welcome → choices → note → choices → welcome → choices → continued note and browser Back/Forward. The sharing button focused the choices heading at the top; photo and voice screens remained reachable. The enlarged photo closed with Escape and restored focus. No synthetic note was submitted. Screenshots and test output remain in ignored `logs/guest-polish/`.

This is browser emulation and frontend verification. Microphone capture, successful hosted media storage, physical phones, screen-reader use and reception-network acceptance remain separate release checks. Backend code, collection gates, provider settings and deployment configuration are unchanged. Ryan will redeploy after the PR is merged.
