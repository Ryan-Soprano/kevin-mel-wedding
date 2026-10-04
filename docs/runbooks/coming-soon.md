# Temporary coming-soon page

Created 2026-10-04 for Ryan's registered `kevinandmel.com` domain. This is a standalone static page, not a production deployment of the memory archive. Ryan authorized publishing it on October 4; record the provider URL and DNS/HTTPS verification only after they work.

## Files and boundaries

The deployable folder is [coming-soon/](../../coming-soon/). It contains `index.html`, `styles.css`, `favicon.svg`, `robots.txt`, and one approved image at `images/kevin-mel-grand-central.jpg`. Publish this folder, never the repository root or the existing React application.

The page uses system fonts and the Grand Central selfie Ryan selected as photo #1 on October 4. The local JPEG is a byte-for-byte copy of `melkev/IMG_4373.jpg` (475 × 633 pixels, under 90 KB), with no cropping, recompression, or AI alteration. Inspection found only a Software EXIF tag and no GPS EXIF metadata. The source remains untouched. The keepsake frame and ornamental rings are CSS; the meaningful photo has descriptive alternative text, while decoration is excluded from the accessibility tree.

There are no external images, fonts, scripts, cookies, analytics, forms, API calls, or backend/database dependencies. Its text does not reveal the private archive or promise working collection features. All visible content works without JavaScript.

Ryan requested a more celebratory palette after reviewing the photo. The current design uses peach/blush background glows, deep-plum typography and stamp, berry accents, and muted-gold ornamentation. The photo remains unchanged. The palette is for this temporary page, not an approved replacement for the full application's design system.

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

## Proposed QR-page photo gallery

Ryan supplied Kevin's photo ZIP on October 4 and requested a selection for guests to browse. The originals were reviewed without alteration, including the 52-page scanned-photo PDF. A 14-image shortlist and review contact sheet were prepared outside the deployable folder. Ryan subsequently chose only #1 for the temporary coming-soon page. That single image is the only photo included in the deployable folder; the raw source collection is excluded.

For the separate wedding-day QR landing page, Ryan believes Kevin wants all image files in the supplied folder, rather than the 14-photo shortlist, and will confirm with him. Treat the complete-gallery scope as provisional. Confirm whether it includes the scanned PDF's photos as well as the 52 standalone images, remove accidental duplicates only with agreement, and do not build or publish the full gallery on the basis of this tentative preference.

The proposed gallery should preserve full image framing, use a simple vertical scroll on phones, and load below-the-fold images lazily. Before inclusion, confirm the final selection and any names/captions with Ryan, create appropriately sized web copies without location metadata, and keep the supplied originals separately. Photos deliberately selected for a public guest gallery are distinct from future private guest contributions; the private inbox must never supply public gallery content automatically.

Do not stage the raw `melkev/` extraction or the ZIP with a blanket `git add`. Stage only explicitly reviewed web assets after the selection is agreed. The supplied photos and PDF remain the sources of truth, not the review thumbnails.

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

The initial deployment of commit `5f7b100ca51e9296d9b513930bcb24b1871d84e2` succeeded on October 4. The live provider URL is [https://kevinandmel-coming-soon.onrender.com/](https://kevinandmel-coming-soon.onrender.com/), service ID `srv-db19f3vavr4c73asu350`. Browser verification confirmed the intended page title, loaded photo, applied grid styling, and no scripts. Render added `kevinandmel.com` and `www.kevinandmel.com` as custom domains, but both await DNS verification and certificate issuance. Do not describe the custom domain as live until HTTPS works there.

## DNS and HTTPS handoff

Namecheap is the registrar. Cloudflare remains the planned authoritative DNS provider; registrar and DNS provider are separate roles. Inspect the actual current nameservers and existing records before deciding where to edit DNS. Do not delete unrelated mail, verification, or other records.

Follow [Render's custom-domain instructions](https://render.com/docs/custom-domains), then the instructions for the chosen DNS provider. If Ryan chooses to keep Namecheap DNS temporarily, record that change and use [the Namecheap-specific guide](https://render.com/docs/configure-namecheap-dns). Do not apply both providers' directions to competing nameserver configurations.

Verify `https://kevinandmel.com` and `https://www.kevinandmel.com`, their canonical redirect behavior, and an issued HTTPS certificate before recording deployment as complete. Registration alone is not proof of working DNS or HTTPS.

## Replace with the full application

This static site cannot run Spring Boot. Once the separate full application is ready, verify it on its provider URL first. Coordinate moving the custom domain to that service, update the relevant DNS records, and verify HTTPS, guest flows, and rollback behavior before retiring the temporary site. Keep the domain and its renewal unchanged.

Track provisioning and release evidence in Notion OPS-01. Creating these files alone does not complete OPS-01 or demonstrate wedding-day traffic capacity.

