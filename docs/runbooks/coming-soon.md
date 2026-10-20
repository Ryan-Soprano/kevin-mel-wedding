# Temporary coming-soon page

Created 2026-10-04 for Ryan's registered `kevinandmel.com` domain. This is a standalone static page, not a production deployment of the memory archive. Ryan authorized publishing it on October 4; record the provider URL and DNS/HTTPS verification only after they work.

## Files and boundaries

The deployable folder is [coming-soon/](../../coming-soon/). It contains `index.html`, `styles.css`, `favicon.svg`, `robots.txt`, and one approved image at `images/kevin-mel-grand-central.jpg`. Publish this folder, never the repository root or the existing React application.

The page uses system fonts and the Grand Central selfie Ryan selected as photo #1 on October 4. The local JPEG is a byte-for-byte copy of `melkev/IMG_4373.jpg` (475 × 633 pixels, under 90 KB), with no cropping, recompression, or AI alteration. Inspection found only a Software EXIF tag and no GPS EXIF metadata. The source remains untouched. The keepsake frame and ornamental rings are CSS; the meaningful photo has descriptive alternative text, while decoration is excluded from the accessibility tree.

There are no external images, fonts, scripts, cookies, analytics, forms, API calls, or backend/database dependencies. Its text does not reveal the private archive or promise working collection features. All visible content works without JavaScript.

Ryan requested a more celebratory palette after reviewing the photo. On October 15, Ryan clarified that Kevin's favorite colors are greens and Mel's is maroon; the earlier attribution was reversed. The current temporary-page design pairs deep-maroon typography and stamp with forest-green highlights, a warm-ivory background, soft rose/sage glows, and muted-gold ornamentation. Their names on the photo card carry the two colors. The photo remains unchanged. This palette is for the temporary page; the full application's guest wedding theme is recorded in the [guest polish verification](../product/guest-page-polish-verification.md).

The HTML includes `noindex, nofollow`, and `robots.txt` asks crawlers not to crawl the page. These are indexing preferences, not access controls: a published page remains public.

## Local preview

From the repository root, use the dependency-free Node preview in Git Bash:

```sh
node scripts/preview-coming-soon.mjs
```

Open `http://127.0.0.1:5185/`. Stop the preview with Ctrl+C. The helper binds only to this computer's loopback interface and serves an explicit list of landing-page assets; it cannot serve the rest of the repository. It requires Node only, with no npm installation. It is a local preview helper, not the deployment server.

Check desktop and narrow-phone widths for legible copy, a fully framed photograph, and no horizontal scrolling. Also verify that the browser requests no third-party assets or API endpoints.

### Local verification on October 4, 2026

Browser checks at 320, 390, 768, and 1280 CSS-pixel widths found no horizontal scrolling. The static preview contains no script elements. HTML, CSS, favicon, and robots requests returned HTTP 200 with their expected content types; an unrelated repository-file request returned 404. The preview helper passed Node's syntax check. This is local layout/asset verification, not a full accessibility audit, production deployment, or traffic test.

After adding Ryan's selected photo, repeat browser checks at those widths confirmed the image loaded with its complete original proportions and no horizontal scrolling. The JPEG route returned HTTP 200 as `image/jpeg`; a request for the raw source folder returned 404. The photo is exposed to assistive technology through its alternative text, rather than hidden with decorative elements.

## Approved QR-page photo gallery

Ryan supplied Kevin's photo ZIP on October 4 and requested a selection for guests to browse. The originals were reviewed without alteration, including the 52-page scanned-photo PDF. A 14-image shortlist and review contact sheet were prepared outside the deployable folder. Ryan subsequently chose only #1 for the temporary coming-soon page. That single image is the only photo included in the deployable folder; the raw source collection is excluded.

On October 10, 2026, Ryan explicitly selected **all 52 standalone photos** for the separate wedding-day QR landing page. The scanned PDF and the 30 `image_page*.jpg` scan-review extracts are excluded. Keep all 52 selected files, including similar or repeated scenes; no deduplication was requested. This supersedes the earlier tentative preference and 14-photo shortlist for the QR gallery. The temporary coming-soon page keeps its single approved image.

On October 14, Ryan explicitly approved the additional `wedding3.0` source folder for the public carousel. Four exact matches to existing photos and six visually verified copies of existing photographs were excluded from the additions; similar photographs with different poses or framing remain included. The original 52 photos are unchanged, and 166 additions bring the gallery to 218 photos. The source files remain untouched.

On October 19, Ryan requested every missing non-duplicate scan and later couple photo be added. This supersedes the earlier exclusion of scanned photos from the gallery. The full app now contains **300 photos**: the existing 218, 50 distinct photos from the 52-page PDF, all 30 saved scan JPEGs, and both later couple photos. PDF pages 21/22 and 23/24 each repeat one photograph; retained pages 22 and 24 represent those pairs. The saved JPEGs contain additional scenes and do not correspond to the current PDF page numbers. The [source audit](../product/guest-gallery-source-audit.json) records all 84 inclusion/duplicate decisions, and the [release checklist](../product/wedding-release-checklist.md#expected-public-gallery-source-set) requires verification of every source group and IDs 219-300.

The full app's guest welcome includes a carousel beginning with the Grand Central photo, with full framing, intrinsic dimensions and descriptive alternative text. Only the current slide renders and loads. Visitors can browse with Previous/Next or arrow keys, or start the optional five-second slideshow; it pauses while hovered or the tab is hidden, stops after manual navigation or focus, and respects reduced-motion settings. The Share a memory action remains before the gallery. Profile-aware, metadata-free WebP copies and responsive smaller variants live under `frontend/src/features/guestGallery/assets`; Vite emits them through the existing public `/assets/` boundary. Original files remain untouched in the ignored source folders. Photos deliberately selected for this public gallery are separate from private contributions, albums and the inbox; no private archive API supplies the gallery. See [gallery verification](../product/guest-gallery-verification.md).

Do not stage the raw `melkev/` extraction, the PDF, scan-review extracts or the ZIP with a blanket `git add`. Stage only reviewed web assets from the approved public selection, including the October 19 scan additions. The supplied originals remain the sources of truth, not the review thumbnails. This build work does not change the live coming-soon service or establish that the final QR points at the full application; hosting, final destination and printed scans remain release gates.

## Render Static Site deployment

The focused site change was merged to `main` in [PR #9](https://github.com/Ryan-Soprano/kevin-mel-wedding/pull/9) on October 4, 2026. Render reads GitHub, not the local checkout. The deployed settings are:

| Field | Value |
|---|---|
| Name | `kevinandmel-coming-soon` |
| Branch | `main`, after this folder is merged |
| Root Directory | `coming-soon` |
| Build Command | `test -f index.html && test -f styles.css && test -f favicon.svg && test -f robots.txt && test -f images/kevin-mel-grand-central.jpg` |
| Publish Directory | `.` (relative to `coming-soon`, not the repository root) |
| Environment variable | `SKIP_INSTALL_DEPS=true` |

The build command checks the required static files and produces no compiled output. Do not add application credentials, a database, a paid instance, or dependencies for this page. See [Render Static Sites](https://render.com/docs/static-sites).

The initial deployment of commit `5f7b100ca51e9296d9b513930bcb24b1871d84e2` succeeded on October 4. The live provider URL is [https://kevinandmel-coming-soon.onrender.com/](https://kevinandmel-coming-soon.onrender.com/), service ID `srv-db19f3vavr4c73asu350`. PR #10 then deployed the maroon-and-green version at commit `f5228661ab37830d869f21d0c147796faa6086a2`. Render added and verified `kevinandmel.com` and `www.kevinandmel.com` as custom domains and issued certificates for both.

The shareable address is [https://kevinandmel.com/](https://kevinandmel.com/). On October 4, an HTTPS browser load showed the intended title, new colors, and loaded photo with no horizontal overflow. Direct HTTPS checks returned 200 for the root page, stylesheet, favicon, and photo; `https://www.kevinandmel.com/` redirected to the root page. The served JPEG's SHA-256 matched the local approved asset. No script or backend endpoint is required by this page.

## DNS and HTTPS handoff

Namecheap is the registrar and, as checked on October 4, also the current authoritative DNS provider (`dns1.registrar-servers.com` and `dns2.registrar-servers.com`). Cloudflare had been planned but was not enabled. The existing website records were Namecheap parking: `www` CNAME to `parkingpage.namecheap.com` and `@` URL redirect to `http://www.kevinandmel.com/`. They were changed in Namecheap Advanced DNS to `www` CNAME `kevinandmel-coming-soon.onrender.com` and `@` A `216.24.57.1`, both with 30-minute TTL. Namecheap's email-forwarding setting and its SPF TXT record were left unchanged. Authoritative DNS confirmed the new A and CNAME; public resolver caches and certificate issuance may lag. Do not delete unrelated mail, verification, or other records.

Follow [Render's custom-domain instructions](https://render.com/docs/custom-domains) and its [Namecheap-specific guide](https://render.com/docs/configure-namecheap-dns) while Namecheap remains authoritative. If DNS hosting is later moved to Cloudflare, migrate all needed records before changing nameservers; do not apply both providers' directions to competing configurations.

The HTTPS, `www` redirect, and asset checks above completed this release verification. Registration alone would not have been proof of working DNS or HTTPS; recheck these behaviors after any future DNS or provider change.

## Replace with the full application

This static site cannot run Spring Boot. Follow the separate [full-app staging procedure](staging-deployment.md) to verify the combined Spring/frontend package on its own approved provider URL first. That package and temporary staging admission pass local checks; provider setup, capacity approval and hosted phone acceptance are pending. Keep this static service, its custom domains and current DNS intact during staging. Moving the custom domain to the full app requires a later explicitly approved release step: update the relevant DNS records and verify HTTPS, guest flows and rollback before retiring the temporary site. Keep the domain and its renewal unchanged.

Track provisioning and release evidence in [Notion OPS-01](https://app.notion.com/p/3dad9739c6bc8162b3fcd36e61269c33). Creating files or passing a local package check does not complete OPS-01 or demonstrate wedding-day traffic capacity.

