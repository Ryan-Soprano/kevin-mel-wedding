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
