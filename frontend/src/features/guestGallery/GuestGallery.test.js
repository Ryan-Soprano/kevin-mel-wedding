import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { couplePhotos } from "./photos.js";
import { startSlideshow } from "./slideshow.js";

test("approved public manifest appends 166 photos while preserving the original 52 and their order", () => {
  assert.equal(couplePhotos.length, 218);
  assert.equal(new Set(couplePhotos.map(photo => photo.id)).size, couplePhotos.length);
  assert.equal(new Set(couplePhotos.map(photo => photo.src)).size, couplePhotos.length);
  for (const [index, photo] of couplePhotos.entries()) {
    assert.equal(photo.id, index + 1);
    const filename = `couple-${String(photo.id).padStart(3, "0")}`;
    assert.ok(photo.src.endsWith(`/assets/${filename}.webp`));
    assert.ok(Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 1120);
    assert.ok(Number.isInteger(photo.height) && photo.height > 0 && photo.height <= 1600);
    assert.ok(typeof photo.alt === "string" && photo.alt.trim());
    assert.doesNotMatch(photo.src, /\/api\/|\.pdf(?:$|\?)|image_page|melkev|https?:\/\//);
    if (photo.smallSrc) {
      assert.equal(photo.smallWidth, 560);
      assert.ok(photo.smallWidth < photo.width);
      assert.ok(photo.smallSrc.endsWith(`/assets/${filename}-560.webp`));
      assert.doesNotMatch(photo.smallSrc, /\/api\/|https?:\/\//);
    }
    if (photo.id > 52) assert.ok(photo.smallSrc, "each new photo has its responsive copy");
  }
  assert.match(couplePhotos[0].alt, /Grand Central/);
  // Snapshot only the October 10 selection, so later approved additions can append
  // without changing any original identity, framing, description or order.
  const originals = couplePhotos.slice(0, 52).map(({ id, src, width, height, alt, smallSrc, smallWidth }) => [
    id, new URL(src).pathname.split("/").at(-1), width, height, alt,
    smallSrc ? new URL(smallSrc).pathname.split("/").at(-1) : null, smallWidth ?? null,
  ]);
  assert.equal(createHash("sha256").update(JSON.stringify(originals)).digest("hex"),
    "4aae8619a2f003229c2ef3bc35817fbca6413053d7cb6e4e1e6f47c00a231f5c",
    "the original 52 photo descriptors must remain unchanged");
});

test("all 401 public assets match the manifest, intrinsic dimensions and metadata-free lossy WebP format", () => {
  const assets = couplePhotos.flatMap(photo => [photo.src, photo.smallSrc].filter(Boolean));
  assert.equal(assets.length, 401);
  assert.equal(new Set(assets).size, assets.length);
  assert.deepEqual(readdirSync(new URL("./assets/", import.meta.url)).sort(),
    assets.map(src => new URL(src).pathname.split("/").at(-1)).sort());
  for (const photo of couplePhotos) {
    for (const src of [photo.src, photo.smallSrc].filter(Boolean)) {
      const bytes = readFileSync(new URL(src));
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF", src);
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP", src);
      assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, src);
      // These optimized copies use one VP8 image chunk. Requiring its exact
      // extent also excludes appended EXIF, XMP and ICC metadata chunks.
      assert.equal(bytes.toString("ascii", 12, 16), "VP8 ", src);
      const imageBytes = bytes.readUInt32LE(16);
      assert.equal(20 + imageBytes + imageBytes % 2, bytes.length, src);
      assert.deepEqual([...bytes.subarray(23, 26)], [0x9d, 0x01, 0x2a], src);
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      if (src === photo.src) {
        assert.equal(width, photo.width, src);
        assert.equal(height, photo.height, src);
      } else {
        assert.equal(width, photo.smallWidth, src);
        assert.ok(Math.abs(height - photo.height * width / photo.width) <= 1, src);
      }
    }
  }
});

test("real public gallery immediately renders one accessible slide with navigation, optional playback and the memory invitation", async () => {
  // Real React SSR through existing tools. Browser download scheduling, visual
  // layout, metadata stripping and phone acceptance are verified separately.
  const server = await createServer({ configFile: false, logLevel: "silent", root: fileURLToPath(new URL("../../../", import.meta.url)),
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: GuestGallery } = await server.ssrLoadModule("/src/features/guestGallery/GuestGallery.jsx");
    const markup = renderToStaticMarkup(createElement(GuestGallery));
    const images = markup.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(images.length, 1); assert.equal(images.filter(image => image.includes('loading="eager"')).length, 1);
    assert.equal(images.filter(image => image.includes('fetchPriority="high"')).length, 1);
    // React SSR may hint the current slide; the rest must not be preloaded.
    const imagePreloads = (markup.match(/<link\b[^>]*>/g) ?? []).filter(link => link.includes('as="image"'));
    assert.equal(imagePreloads.length, 1); assert.ok(imagePreloads[0].includes(couplePhotos[0].src));
    assert.ok(markup.includes(`Photo 1 of ${couplePhotos.length}`));
    assert.ok(!markup.includes(`Photo ${couplePhotos.length} of ${couplePhotos.length}`));
    assert.ok(markup.includes(`width="${couplePhotos[0].width}" height="${couplePhotos[0].height}"`));
    assert.match(markup, /aria-roledescription="carousel"/); assert.match(markup, /aria-roledescription="slide"/);
    assert.match(markup, /aria-label="Previous photo"/); assert.match(markup, /aria-label="Next photo"/);
    assert.match(markup, /Play slideshow/); assert.match(markup, /aria-live="polite"/);
    assert.doesNotMatch(markup, /Skip photos and share a memory|Back to Share a memory/);
    assert.doesNotMatch(markup, /\/api\/|image_page|\.pdf|<audio|<video/);
    const responsivePhoto = { id: 1, src: "/assets/synthetic-large.webp", smallSrc: "/assets/synthetic-small.webp",
      width: 1120, height: 840, smallWidth: 560, alt: "Synthetic responsive fixture" };
    const responsive = renderToStaticMarkup(createElement(GuestGallery, { photos: [responsivePhoto] }));
    assert.match(responsive, /srcSet="\/assets\/synthetic-small.webp 560w, \/assets\/synthetic-large.webp 1120w"/);
    assert.match(responsive, /sizes="\(max-width: 600px\) calc\(100vw - 48px\), \(max-width: 1020px\) 90vw, 908px"/);
    assert.doesNotMatch(responsive, /Previous photo|Next photo|Play slideshow/);
    assert.equal(renderToStaticMarkup(createElement(GuestGallery, { photos: [] })), "");
    const { default: App } = await server.ssrLoadModule("/src/app/App.jsx");
    const landing = renderToStaticMarkup(createElement(App, { audioEnabled: false }));
    assert.ok(landing.indexOf("id=\"share-wedding-memory\"") < landing.indexOf("guest-gallery-photo"));
    assert.doesNotMatch(landing, /Browse Kevin and Melanie|Skip photos and share a memory|favourite/);
    assert.match(landing, /your favorite photos/);
    assert.match(landing, /Your contribution goes directly to Kevin and Melanie’s private vault. It is not posted publicly/);
  } finally { await server.close(); }
});

test("slideshow advances every five seconds only in a visible tab and clears timers/listeners when paused or unmounted", () => {
  const documentImpl = new EventTarget();
  documentImpl.hidden = false;
  const timers = new Map();
  let nextTimer = 0, advances = 0;
  const stop = startSlideshow(() => advances++, {
    documentImpl,
    setIntervalImpl(callback, milliseconds) { assert.equal(milliseconds, 5000); timers.set(++nextTimer, callback); return nextTimer; },
    clearIntervalImpl(timer) { assert.ok(timers.has(timer)); timers.delete(timer); },
  });
  assert.equal(timers.size, 1);
  timers.values().next().value(); assert.equal(advances, 1);
  documentImpl.hidden = true;
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 0);
  documentImpl.hidden = false;
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 1);
  stop(); assert.equal(timers.size, 0);
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 0, "cleanup prevents visibility changes from restarting playback");
});
