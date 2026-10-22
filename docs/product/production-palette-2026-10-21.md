# Production palette — October 21, 2026

Ryan requested that the full application use the colors of the existing Coming Soon page. The source palette in `coming-soon/styles.css` is the reference: plum `#55283b`, forest green `#315e4c`, rose `#84354b`, sage/blush washes and warm ivory `#fbf7ee`.

The shared frontend tokens now carry those colors through the guest welcome, note/photo/voice forms, gallery, sign-in and private archive. Blush and sage replace the old beige mats and panels; controls retain dark green, visible focus rings and separate error/destructive styling. The page uses the reference's three-layer gradient. Existing typefaces, copy, layout, gallery navigation, 300 photos, first gallery image, draft/retry behavior and backend contracts are unchanged. The browser theme color also matches the ivory base. Coming Soon's own files are unchanged.

## Verification

- Clean install from the reviewed lockfile on pinned **Node 24.21.0**: no known dependency vulnerabilities. ESLint and the **Vite 8.3.3 audio-enabled production build** passed. The existing bundle-size advisory remains; no limits or code splitting were changed for this palette task.
- All **592 existing frontend tests passed**, without added tests or changed assertions.
- Independent CSS review found no actionable cascade or state regression. Reviewed shared text/status pairs are at least **5.65:1**, primary filled controls **7.19:1**, hover **9.62:1**, destructive controls **7.03:1**, and input borders **3.62:1**. These are the reviewed token pairs, not a complete accessibility certification of every possible screen.
- Isolated installed Chrome rendered the actual built frontend in **28 view/width combinations** at 320, 390, 768 and 1440 CSS pixels: welcome, scrapbook dialog, gallery thumbnails, note, photo, voice and private sign-in. No horizontal overflow, JavaScript page errors, external requests or writes occurred. Empty synthetic API reads were served on loopback; this is visual/navigation evidence, not hosted persistence or real private-account acceptance.
- Eight desktop/mobile captures were inspected, including loaded gallery imagery and voice controls, input focus, photo picker and sign-in. An initial helper captured a lazy-image/loading placeholder; it was corrected to wait for actual content. Its next selector matched intentionally retained hidden forms; the final helper selects the visible form. These were capture-helper issues and required no app behavior change. All owned browser contexts and the local server closed.

Screenshots, helper and content-free browser/build/test results stay ignored under `logs/palette-preview.local/`. No provider credentials or guest submissions were used.

## Release boundary

The palette is prepared in source, **not deployed**. The current live `3b2fd0a` build still has the prior colors. Ryan's four production values remain saved with **Save only**, and Coming Soon remains on the custom domain until the attended **October 22, 6 p.m. CDT / 23:00 UTC** cutover.

This frontend change requires an **audio-enabled rebuild of the frozen reviewed release**, behind maintenance during cutover. Runtime-only deployment reusing the old build cannot include it. Verify `VITE_AUDIO_ENABLED=true` at build time, apply the saved production runtime settings together, record the actual resulting deploy/commit/artifact and run the canonical phone/save checks. A palette merge is not permission to deploy early or to claim the new artifact has already passed hosted acceptance. Follow the [cutover guide](../runbooks/go-live-kevinandmel-com.md) and preserve the retained database, bucket, deletion authority and reveal false.
