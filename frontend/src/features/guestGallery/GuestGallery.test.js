import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { couplePhotos } from "./photos.js";
import { startSlideshow } from "./slideshow.js";

test("approved public manifest includes all 52 standalone photos in fixed source order with bounded full-frame dimensions", () => {
  assert.equal(couplePhotos.length, 52); assert.equal(new Set(couplePhotos.map(photo => photo.id)).size, 52);
  for (const [index, photo] of couplePhotos.entries()) {
    assert.equal(photo.id, index + 1);
    assert.ok(typeof photo.src === "string" && photo.src.includes("couple-"));
    assert.ok(Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 1600);
    assert.ok(Number.isInteger(photo.height) && photo.height > 0 && photo.height <= 1600);
    assert.ok(typeof photo.alt === "string" && photo.alt.trim());
    assert.doesNotMatch(photo.src, /\/api\/|\.pdf(?:$|\?)|image_page|melkev|https?:\/\//);
    if (photo.smallSrc) {
      assert.ok(Number.isInteger(photo.smallWidth) && photo.smallWidth > 0 && photo.smallWidth < photo.width);
      assert.doesNotMatch(photo.smallSrc, /\/api\/|https?:\/\//);
    }
  }
  assert.match(couplePhotos[0].alt, /Grand Central/);
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
    // React SSR may hint the eager hero; below-fold lazy photos must not be preloaded.
    const imagePreloads = (markup.match(/<link\b[^>]*>/g) ?? []).filter(link => link.includes('as="image"'));
    assert.equal(imagePreloads.length, 1); assert.ok(imagePreloads[0].includes(couplePhotos[0].src));
    assert.match(markup, /Photo 1 of 52/); assert.doesNotMatch(markup, /Photo 52 of 52/);
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
    assert.match(responsive, /sizes="\(max-width: 600px\) calc\(100vw - 40px\), 560px"/);
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

test("slideshow advances every 3.5 seconds only in a visible tab and clears timers/listeners when paused or unmounted", () => {
  const documentImpl = new EventTarget();
  documentImpl.hidden = false;
  const timers = new Map();
  let nextTimer = 0, advances = 0;
  const stop = startSlideshow(() => advances++, {
    documentImpl,
    setIntervalImpl(callback, milliseconds) { assert.equal(milliseconds, 3500); timers.set(++nextTimer, callback); return nextTimer; },
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
