# Public guest photo gallery — local verification

On October 10, 2026, Ryan selected all 52 standalone supplied photos for the wedding QR landing page, excluding the scanned PDF and 30 scan-review extracts. The gallery appears on the full app's public welcome screen, with the Grand Central photo first and the contribution action before the gallery. It does not read private memories, albums, uploads or playback grants.

## Assets and behavior

- The 52 source files total 17,837,756 bytes. Their SHA-256 hashes remain unchanged. All selected scenes remain included; similar or repeated photographs were not removed.
- The 69 WebP files, including 17 smaller responsive variants, total 4,517,912 bytes; the largest primary copy is 236,614 bytes. Copies preserve full framing and orientation, use profile-aware sRGB conversion, contain no EXIF/XMP/ICC metadata and do not upscale source pixels. Maximum primary dimensions are 1120 pixels wide and 1600 pixels high. Originals, the PDF, scan extracts and ignored contact sheets are excluded from the production package.
- Vite emits reviewed static images through `/assets/`, which already permits anonymous reads. The first image is eager; the other 51 are lazy. Intrinsic dimensions reserve layout space. Keyboard links let visitors browse photos or return to Share a memory. No dates or chronological order are inferred from filenames.
- The gallery unmounts during contribution screens and does not appear in the private inbox. Guest contributions remain private; approved public photos do not grant private media access.

## Verification

The final frontend passed 324 tests, ESLint and the production build. Independent source/asset review verified the exact selection, source/output hashes, decoded dimensions, metadata removal, public static serving and private-data separation. No backend, dependency, CI, deployment, runtime configuration or provider change is included.

The combined production JAR passed **33 browser states**: 11 each on desktop 1280 × 900, narrow 320 × 720 and actual 200% Chrome zoom. All 52 images decoded in each layout with their full aspect ratio and no CSS upscaling or horizontal overflow. Initial page requests fetched only 1, 4 and 2 gallery images respectively. Anonymous HTTP checks verified all 69 `/assets/` files returned 200 as `image/webp` with hashes matching the reviewed local copies; raw source files were not served, and private memory/album APIs still required authentication. Keyboard anchors focused their intended targets; the gallery-to-note flow saved a durable private contribution and kept submitted content outside the returned gallery. The private sign-in view contained no gallery. No JavaScript errors were observed.

The backend source is unchanged from ARC-02's clean 358-test Linux run; the package reused its immutable tested compilation image. Gallery runtime image: `sha256:c5f9325080b377db9239cbb069e9f36599778d84d3a0cb976440996e427b67af`. Combined JAR SHA-256: `50ba33a025c41980f50f4addc830605312d48931d212ccc1be9135531710c582`. Chrome 155.0.8059.39 and bundled Playwright 1.62.1 exercised only local fixtures. Owned package/browser containers, database, network and disposable zoom profile were verified absent afterward. Source photos and synthetic fixtures are not added to Git.

## Retained release acceptance

The live coming-soon page still has only its single approved photo. Building this gallery does not deploy the full application or verify a saved/printed QR destination. Final HTTPS hosting, the stable collection address, actual printed QR scans, physical-phone/accessibility and reception-network loading remain open in the [release checklist](wedding-release-checklist.md). No spending, deployment, DNS change, account activation or tester message is part of this implementation. ARC-03 timeline work remains authorized after this guest-facing gap is completed.

## October 14, 2026 — approved public carousel expansion

The October 10 evidence above describes the original release and is retained unchanged. Ryan explicitly approved all 176 source images in `melkev/wedding3.0` for the public carousel. The files total 313,208,313 bytes, and their hashes remain unchanged. Four exact matches to existing source files and six manually verified copies of existing photographs were excluded from the additions. Similar photographs with distinct poses or framing remain included. The original 52 manifest entries and 69 WebP assets are unchanged, including their order and the first Grand Central photo.

The expansion appends 166 photos as IDs 53–218, bringing the current gallery to **218 photos**. Each addition has a primary copy and a 560-pixel responsive copy: 332 new WebP files totaling 43,461,780 bytes. The complete gallery contains 401 WebP assets totaling 47,979,692 bytes. Copies preserve framing and orientation, use profile-aware sRGB conversion, contain no EXIF/XMP/ICC metadata, and remain bounded by 1120 pixels wide and 1600 pixels high without upscaling. One HEIC source lacks usable ICC or specified NCLX primaries/transfer data; its decoded RGB uses the documented sRGB fallback. Alt descriptions were written after reviewing the visible scenes. Original HEIC/JPEG/PNG files, local conversion records and contact sheets remain outside the production package; no new dependency was needed.

The current guest welcome renders a single carousel slide immediately. Previous/Next buttons and arrow keys support manual browsing; Play slideshow starts optional playback at the existing five-second interval. Hover or a hidden tab suspends playback; manual navigation or focus stops it. Reduced-motion settings retain manual browsing. The carousel uses responsive image sizes for the current guest layout, up to 908 pixels on desktop. Share a memory remains before it, and the gallery unmounts during contribution screens. These approved public copies do not read private archive data or change the privacy of contributions.

All four focused gallery tests pass, and the updated test file passes ESLint. The regression checks require the 218-photo selection, unchanged original 52 descriptors/order, unique static asset URLs, exact asset coverage, intrinsic WebP dimensions, metadata-free image chunks, one rendered slide, responsive image hints and five-second timer cleanup. Current packaged-browser and physical-phone acceptance are separate from the historical checks above; record their results before treating this expansion as release acceptance.

## October 15, 2026 — welcome review and compact collage

The welcome now uses the requested ivory, olive, wine, parchment and charcoal palette, with contribution choices immediately available before the photos. Existing mounted forms, audio enablement, draft/retry identity, uncertain-result navigation protection and explicit saved-result actions remain in place.

Kevin's concern about biographies resembling profiles changed the proposed introduction into a small photo collage. Gallery photos 148, 15 and 90 appear with the two additionally supplied couple photos (brick archway and sunny globe selfie). The couple photographs are larger than the solo snapshots on desktop; narrow screens use three photographs above two. There are no biographies or "Meet" introductions. The playful shared caption is preview copy for their feedback. The two supplied 768 × 1024 PNGs have metadata-free WebP copies and 384 × 512 responsive copies in a separate `welcome-assets` directory. Source copies remain in ignored local review files. The approved 218-photo gallery, original 52 descriptors/order and 401 gallery assets are unchanged.

The public gallery adds an optional thumbnail overview in batches of 24, with lazy image loading, full-frame viewing and return to the originating thumbnail. Play works with the pointer over its control; only hovering the photo temporarily pauses playback, with visible status. Keyboard focus/manual navigation stop playback, reduced motion retains manual browsing, and the existing hidden-tab timer/cleanup remain. Form guidance adds optional writing ideas, expandable audio-format help and individual photo-selection feedback that retains acceptable originals. HEIC/HEIF conversion is not added; the picker explains using a JPEG/PNG copy while keeping the original.

Verification: all **471 frontend tests**, ESLint and the production build pass. An isolated local headless Chromium check exercised 1280 × 900, 768 × 1024, 390 × 844 and 320 × 720 viewports. Welcome/forms had no horizontal overflow or JavaScript page errors. Checks covered direct form entry, retained note drafts through in-page and browser navigation, mixed valid/unsupported/empty photo selection, expandable audio help, the collage focus button without hash-history entries, reduced-motion controls, five-second advancement, pointer pause/resume, manual stop, first/last wrapping, 24/48 thumbnail batches, and Back/Escape focus restoration. Desktop/mobile screenshots were rendered and inspected; local evidence is under ignored `logs/welcome-review/`.

All browser API requests were intercepted with in-memory responses, and the checks sent no contribution/upload requests. This is local browser emulation, not physical iPhone/Android, hosted/backend/provider acceptance or deployment. No dependencies, accounts, infrastructure, DNS or deployment settings changed.

## October 15, 2026 — welcome review and compact collage

The welcome now uses the requested ivory, olive, wine, parchment and charcoal palette, with contribution choices immediately available before the photos. Existing mounted forms, audio enablement, draft/retry identity, uncertain-result navigation protection and explicit saved-result actions remain in place.

Kevin's concern about biographies resembling profiles changed the proposed introduction into a small photo collage. Gallery photos 148, 15 and 90 appear with the two additionally supplied couple photos (brick archway and sunny globe selfie). The couple photographs are larger than the solo snapshots on desktop; narrow screens use three photographs above two. There are no biographies or "Meet" introductions. The playful shared caption is preview copy for their feedback. The two supplied 768 × 1024 PNGs have metadata-free WebP copies and 384 × 512 responsive copies in a separate `welcome-assets` directory. Source copies remain in ignored local review files. The approved 218-photo gallery, original 52 descriptors/order and 401 gallery assets are unchanged.

The public gallery adds an optional thumbnail overview in batches of 24, with lazy image loading, full-frame viewing and return to the originating thumbnail. Play works with the pointer over its control; only hovering the photo temporarily pauses playback, with visible status. Keyboard focus/manual navigation stop playback, reduced motion retains manual browsing, and the existing hidden-tab timer/cleanup remain. Form guidance adds optional writing ideas, expandable audio-format help and individual photo-selection feedback that retains acceptable originals. HEIC/HEIF conversion is not added; the picker explains using a JPEG/PNG copy while keeping the original.

Verification on the isolated branch based on `main`: all **468 frontend tests**, ESLint and the production build pass. An isolated local headless Chromium check exercised 1280 × 900, 768 × 1024, 390 × 844 and 320 × 720 viewports. Welcome/forms had no horizontal overflow or JavaScript page errors. Checks covered direct form entry, retained note drafts through in-page and browser navigation, mixed valid/unsupported/empty photo selection, expandable audio help, the collage focus button without hash-history entries, reduced-motion controls, five-second advancement, pointer pause/resume, manual stop, first/last wrapping, 24/48 thumbnail batches, and Back/Escape focus restoration. Desktop/mobile screenshots were rendered and inspected; local evidence is under ignored `logs/welcome-review/`.

All browser API requests were intercepted with in-memory responses, and the checks sent no contribution/upload requests. This is local browser emulation, not physical iPhone/Android, hosted/backend/provider acceptance or deployment. No dependencies, accounts, infrastructure, DNS or deployment settings changed.

## October 19, 2026 — directory review follow-up

The current welcome uses the single portrait from gallery photo 148. The four
arch/globe WebP variants described in the historical collage records above have
no runtime, build or script consumers and are removed. All 218 approved gallery
entries and 401 active image hashes remain unchanged; the structural asset audit
confirms exact paths, dimensions and metadata-free WebP chunks.

Automatic thumbnail loading remains enabled in batches of 24. Passive loading
pauses while Show more has focus, so the focused control cannot disappear at the
final batch; deliberate activation retains focus on the first new thumbnail.
The observer still loads once per footer approach. The existing focused suite
passes seven tests, and mounted Chromium at 1280, 390 and 320 px passes 97
assertions for focus, manual/passive loading, native dialog, keyboard return,
reduced motion, slideshow and cleanup behavior. The previous focus loss was
reproduced at all three widths before the fix. These synthetic checks retain the
separate device/provider/release acceptance boundaries above. Full batch evidence
and file decisions are in the [directory review guide](../development/directory-review.md).

## October 19, 2026 - complete supplied-photo review

Ryan requested a duplicate check of the scanned PDF and the two later couple
photos, followed by adding every missing non-duplicate photograph to the guest
slideshow. This supersedes the historical scan exclusions above.

The review covered all 52 PDF pages, the 30 saved `image_page*.jpg` files and both
later couple photos against the existing 218 gallery photos and one another.
The PDF pages were rendered with Poppler, and their embedded JPEGs were extracted
without changing the supplied PDF. Perceptual hashes identified comparison
candidates; visual contact-sheet and full-image reviews determined duplicates.
Different expressions, poses and group compositions remain included.

| Supplied material | Reviewed | Added | Gallery IDs |
| --- | ---: | ---: | --- |
| Scanned PDF | 52 pages | 50 | 219-268 |
| Saved scan JPEGs | 30 | 30 | 269-298 |
| Later archway and globe couple photos | 2 | 2 | 299-300 |
| Total | 84 | 82 | 219-300 |

PDF pages 21/22 contain the same two-women photograph, and pages 23/24 contain
the same mother/newborn photograph. The upright, cleaner scans on pages 22 and
24 represent those photographs as gallery photos 239 and 240. The 30 saved JPEGs
are additional scenes, despite their historical "scan-review extract" label;
their filenames do not correspond to the current PDF page numbers. All 30 are
distinct from the PDF, the original gallery and one another. The two later couple
photos are also distinct. JPEG `image_page15.jpg` receives a 180-degree display
rotation; its supplied source remains unchanged.

The [source audit](guest-gallery-source-audit.json) records every reviewed source,
inclusion or duplicate decision, gallery ID, dimensions and SHA-256 hashes. The
later couple primaries were recovered byte-for-byte from their previously
reviewed Git assets because the original PNGs are not present in this checkout.
Their existing 768 x 1024 primary copies are retained, with new 560-pixel copies
derived for the gallery's responsive sizing.

The current slideshow and thumbnail browser contain **300 photos**. All original
218 descriptors, order and 401 image hashes are unchanged. The 164 new WebP files
total 8,665,260 bytes; the complete 565-file image collection totals 56,644,952
bytes. New copies preserve framing and aspect ratio, use profile-aware sRGB
conversion, strip metadata and remain within 1120 x 1600 pixels without
upscaling. Original source files remain unchanged and outside the application
package. Independent source/asset and visual review confirmed the mappings,
duplicate decisions, rotation and preserved originals.

All **567 frontend tests**, ESLint and the final production build pass. Eight
focused gallery tests include complete 84-source accounting, both duplicate
representatives, all 82 added IDs, recorded output hashes, unchanged original
descriptors and exact coverage of all 565 metadata-free image files. The initial
sandboxed run could not connect to four disposable redirect-test servers
(`connect EACCES`); the complete suite passed with local loopback access.

Headless Edge exercised the final production build at 1280, 390 and 320 pixels.
All 565 built image assets decoded; all 300 thumbnails were reachable at each
width. Every one of the 82 additions opened and decoded in the desktop viewer,
with seven representative additions also checked at each narrow width. The
actual five-second timer crossed photo 218 to 219 and wrapped 300 to 1. No
JavaScript page errors or horizontal overflow were observed. Screenshots of the rotated beach
scan and final globe photo were inspected. Owned browser/server resources were
closed. Local evidence is under ignored `logs/gallery-completion.local/`.

The build retains its non-fatal JavaScript chunk-size advisory. These results
cover the local source and static production frontend build, without a backend;
deployment and physical phone acceptance remain separate.

## October 19, 2026 - return to the currently viewed thumbnail

Both thumbnail-entry paths now use the currently displayed photo. Browsing the
slideshow and choosing **Browse all 300 photos** opens the thumbnail batch that
contains that photo. Opening photo 86, navigating to photo 124 and choosing
**Back to thumbnails** returns to photo 124; Escape follows the same path.

Previously the preview always targeted the first thumbnail, while the viewer
restored the originally clicked thumbnail and its old page scroll coordinates.
Mounted desktop and narrow-browser reproduction confirmed that photo 300 was
absent after preview-to-grid navigation, and that returning after 86 to 124
focused photo 86 while photo 124 was still outside the rendered batches.

The return action exposes enough 24-photo batches to include the current photo,
capped at the collection size, while preserving any larger already-opened batch.
It then focuses and scrolls that thumbnail into view. The current thumbnail has
an `aria-current` marker and an inset border without changing cell dimensions.
Removing the original-click scroll snapshot also avoids restoring stale page
coordinates after viewport changes. The selection stays in component state;
gallery photos, slideshow timing and private archive boundaries are unchanged.

All 567 frontend tests, ESLint and the production build pass. Existing gallery
tests verify the current-thumbnail semantics for photos 1, 124 and 300, including
that photo 86 is no longer marked current after navigating to 124. These static
rendering checks do not substitute for mounted state/focus/scroll verification.

The final production frontend passes **39 mounted Edge browser states**, 13 each
at 1280 x 900, 390 x 900 and 320 x 900. Checks cover preview-to-grid navigation,
86 to 124 and back, reverse navigation with Escape, first/last wrapping,
unchanged selection, preserved larger batches, manual Show more focus, passive
loading without stolen focus, viewport resizing, slideshow progression/stop and
reduced motion. Each return checks the current thumbnail, keyboard focus and
visible position; thumbnail bounds allow one pixel for browser scroll rounding.
All checked layouts have no horizontal overflow or JavaScript page errors.
Screenshots of the restored photo 124 and its current marker were inspected at
all three widths. Evidence and source hashes are under ignored
`logs/gallery-navigation.local/`; owned browsers and the local server are closed.
These static frontend checks do not establish hosted/backend or physical-phone
acceptance. No new dependency or test file was introduced, and the reserved
`frontend/e2e/.gitkeep` remains unchanged.

## October 19, 2026 - welcome photo selection

Ryan selected gallery photo 151, the sunny city-street selfie, as the main welcome
photo in place of photo 148. The opening print and its full-photo dialog now use
photo 151's existing assets and dimensions, with a matching alternative
description. The caption remains "Her entrance. His perfect hair." The gallery's
300 entries and ordering are unchanged. The five focused gallery tests, edited
JavaScript lint checks and production build pass.
