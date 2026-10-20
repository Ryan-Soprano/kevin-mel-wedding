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

const expectedPhotoCount = 300;
const expectedAssetCount = 565;

test("approved public manifest keeps every photo unique and preserves the existing selections", () => {
  assert.equal(couplePhotos.length, expectedPhotoCount);
  assert.equal(
    new Set(couplePhotos.map((photo) => photo.id)).size,
    couplePhotos.length,
  );
  assert.equal(
    new Set(couplePhotos.map((photo) => photo.src)).size,
    couplePhotos.length,
  );
  for (const [index, photo] of couplePhotos.entries()) {
    assert.equal(photo.id, index + 1);
    const filename = `couple-${String(photo.id).padStart(3, "0")}`;
    assert.ok(photo.src.endsWith(`/assets/${filename}.webp`));
    assert.ok(
      Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 1120,
    );
    assert.ok(
      Number.isInteger(photo.height) &&
        photo.height > 0 &&
        photo.height <= 1600,
    );
    assert.ok(typeof photo.alt === "string" && photo.alt.trim());
    assert.doesNotMatch(
      photo.src,
      /\/api\/|\.pdf(?:$|\?)|image_page|melkev|https?:\/\//,
    );
    if (photo.smallSrc) {
      assert.equal(photo.smallWidth, 560);
      assert.ok(photo.smallWidth < photo.width);
      assert.ok(photo.smallSrc.endsWith(`/assets/${filename}-560.webp`));
      assert.doesNotMatch(photo.smallSrc, /\/api\/|https?:\/\//);
    }
    if (photo.id > 52 && photo.width > 560) {
      assert.ok(
        photo.smallSrc,
        "each new photo wider than 560 pixels has its responsive copy",
      );
    }
    if (photo.width <= 560) {
      assert.equal(
        photo.smallSrc,
        undefined,
        "smaller photos must not be upscaled for responsive copies",
      );
      assert.equal(photo.smallWidth, undefined);
    }
  }
  assert.match(couplePhotos[0].alt, /Grand Central/);
  // Keep both prior selections fixed, so later approved additions can append
  // without changing existing identities, framing, descriptions or order.
  const descriptors = couplePhotos.map(
    ({ id, src, width, height, alt, smallSrc, smallWidth }) => [
      id,
      new URL(src).pathname.split("/").at(-1),
      width,
      height,
      alt,
      smallSrc ? new URL(smallSrc).pathname.split("/").at(-1) : null,
      smallWidth ?? null,
    ],
  );
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(descriptors.slice(0, 52)))
      .digest("hex"),
    "4aae8619a2f003229c2ef3bc35817fbca6413053d7cb6e4e1e6f47c00a231f5c",
    "the original 52 photo descriptors must remain unchanged",
  );
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(descriptors.slice(0, 218)))
      .digest("hex"),
    "786204d51be86563058e45113a2461ad0690fbe70297e5f993f50e5ad67a84a3",
    "the existing 218 photo descriptors and their order must remain unchanged",
  );
});

test(`all ${expectedAssetCount} public assets match the manifest, intrinsic dimensions and metadata-free lossy WebP format`, () => {
  const assets = couplePhotos.flatMap((photo) =>
    [photo.src, photo.smallSrc].filter(Boolean),
  );
  assert.equal(assets.length, expectedAssetCount);
  assert.equal(new Set(assets).size, assets.length);
  assert.deepEqual(
    readdirSync(new URL("./assets/", import.meta.url)).sort(),
    assets.map((src) => new URL(src).pathname.split("/").at(-1)).sort(),
  );
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
      assert.equal(20 + imageBytes + (imageBytes % 2), bytes.length, src);
      assert.deepEqual([...bytes.subarray(23, 26)], [0x9d, 0x01, 0x2a], src);
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      if (src === photo.src) {
        assert.equal(width, photo.width, src);
        assert.equal(height, photo.height, src);
      } else {
        assert.equal(width, photo.smallWidth, src);
        assert.ok(
          Math.abs(height - (photo.height * width) / photo.width) <= 1,
          src,
        );
      }
    }
  }
});

test("source audit accounts for every scanned and later photo, including duplicate representatives", () => {
  const audit = JSON.parse(
    readFileSync(
      new URL(
        "../../../../docs/product/guest-gallery-source-audit.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(audit.basePhotoCount, 218);
  assert.equal(audit.addedPhotoCount, 82);
  assert.equal(audit.totalPhotoCount, expectedPhotoCount);
  assert.equal(audit.totalAssetCount, expectedAssetCount);
  assert.equal(audit.pdf.pageCount, 52);

  const expectedSources = [
    ...Array.from({ length: 52 }, (_, index) => `pdf:${index + 1}`),
    ...Array.from(
      { length: 30 },
      (_, index) => `scan-jpeg:image_page${index + 1}.jpg`,
    ),
    "later-couple:couple-arch.webp",
    "later-couple:couple-globe.webp",
  ];
  const reviewedSources = audit.decisions.map(
    (record) =>
      `${record.sourceKind}:${record.sourceKind === "pdf" ? record.sourcePage : record.sourceFile}`,
  );
  assert.deepEqual(
    reviewedSources.sort(),
    expectedSources.sort(),
    "each of the 84 source candidates is reviewed exactly once",
  );

  const additions = audit.decisions.filter(
    (record) => record.decision === "added",
  );
  assert.deepEqual(
    additions
      .map((record) => record.galleryId)
      .sort((left, right) => left - right),
    Array.from({ length: 82 }, (_, index) => index + 219),
    "each appended gallery photo has exactly one source record",
  );
  const duplicates = audit.decisions.filter(
    (record) => record.decision === "duplicate",
  );
  assert.deepEqual(
    duplicates.map((record) => [
      record.sourceKind,
      record.sourcePage,
      record.duplicateOfPage,
      record.galleryId,
    ]),
    [
      ["pdf", 21, 22, 239],
      ["pdf", 23, 24, 240],
    ],
  );

  const photosById = new Map(couplePhotos.map((photo) => [photo.id, photo]));
  for (const record of audit.decisions) {
    const photo = photosById.get(record.galleryId);
    assert.ok(
      photo,
      `reviewed source resolves to gallery photo ${record.galleryId}`,
    );
    assert.ok(record.decision === "added" || record.decision === "duplicate");
    if (record.decision === "duplicate") {
      const representative = additions.find(
        (candidate) =>
          candidate.sourceKind === "pdf" &&
          candidate.sourcePage === record.duplicateOfPage,
      );
      assert.ok(
        representative,
        `duplicate PDF page ${record.sourcePage} retains a representative`,
      );
      assert.equal(representative.galleryId, record.galleryId);
      continue;
    }

    assert.deepEqual(
      [record.width, record.height, record.smallWidth],
      [photo.width, photo.height, photo.smallWidth],
    );
    for (const [src, filename, digest] of [
      [photo.src, record.primary, record.primarySha256],
      [photo.smallSrc, record.small, record.smallSha256],
    ]) {
      assert.equal(new URL(src).pathname.split("/").at(-1), filename);
      assert.equal(
        createHash("sha256")
          .update(readFileSync(new URL(src)))
          .digest("hex"),
        digest,
        filename,
      );
    }
  }
});

test("real public gallery immediately renders one accessible slide with navigation, optional playback and the memory invitation", async () => {
  // Real React SSR through existing tools. Browser download scheduling, visual
  // layout, metadata stripping and phone acceptance are verified separately.
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { default: GuestGallery, GalleryThumbnails } =
      await server.ssrLoadModule("/src/features/guestGallery/GuestGallery.jsx");
    const markup = renderToStaticMarkup(createElement(GuestGallery));
    const images = markup.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(images.length, 1);
    assert.equal(
      images.filter((image) => image.includes('loading="eager"')).length,
      1,
    );
    assert.equal(
      images.filter((image) => image.includes('fetchPriority="high"')).length,
      1,
    );
    // React SSR may hint the current slide; the rest must not be preloaded.
    const imagePreloads = (markup.match(/<link\b[^>]*>/g) ?? []).filter(
      (link) => link.includes('as="image"'),
    );
    assert.equal(imagePreloads.length, 1);
    assert.ok(imagePreloads[0].includes(couplePhotos[0].src));
    assert.ok(markup.includes(`Photo 1 of ${couplePhotos.length}`));
    assert.ok(
      !markup.includes(
        `Photo ${couplePhotos.length} of ${couplePhotos.length}`,
      ),
    );
    assert.ok(
      markup.includes(
        `width="${couplePhotos[0].width}" height="${couplePhotos[0].height}"`,
      ),
    );
    assert.match(markup, /aria-roledescription="carousel"/);
    assert.match(markup, /aria-roledescription="slide"/);
    assert.match(markup, /aria-label="Previous photo"/);
    assert.match(markup, /aria-label="Next photo"/);
    assert.match(markup, /Play slideshow/);
    assert.match(markup, /aria-live="polite"/);
    assert.ok(markup.includes(`Browse all ${couplePhotos.length} photos`));
    assert.doesNotMatch(
      markup,
      /couple-scrapbook|scrapbook-snapshot|scrapbook-couple-print|welcome-assets|couple-arch|couple-globe/,
    );
    assert.ok(
      markup.indexOf("Play slideshow") <
        markup.indexOf('id="couple-gallery-slide"'),
      "playback control is the first interactive control",
    );
    assert.doesNotMatch(
      markup,
      /Skip photos and share a memory|Back to Share a memory/,
    );
    assert.doesNotMatch(markup, /\/api\/|image_page|\.pdf|<audio|<video/);
    const responsivePhoto = {
      id: 1,
      src: "/assets/synthetic-large.webp",
      smallSrc: "/assets/synthetic-small.webp",
      width: 1120,
      height: 840,
      smallWidth: 560,
      alt: "Synthetic responsive fixture",
    };
    const responsive = renderToStaticMarkup(
      createElement(GuestGallery, { photos: [responsivePhoto] }),
    );
    assert.match(
      responsive,
      /srcSet="\/assets\/synthetic-small.webp 560w, \/assets\/synthetic-large.webp 1120w"/,
    );
    assert.match(
      responsive,
      /sizes="\(max-width: 480px\) calc\(100vw - 74px\), \(max-width: 1100px\) calc\(90vw - 26px\), 962px"/,
    );
    assert.doesNotMatch(responsive, /Previous photo|Next photo|Play slideshow/);
    assert.equal(
      renderToStaticMarkup(createElement(GuestGallery, { photos: [] })),
      "",
    );
    const renderOverview = (visibleCount, currentIndex = 0) =>
      renderToStaticMarkup(
        createElement(GalleryThumbnails, {
          photos: couplePhotos,
          visibleCount,
          currentIndex,
          onOpen() {},
          onMore() {},
        }),
      );
    const overview = renderOverview(24);
    const thumbnails = overview.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(thumbnails.length, 24);
    assert.ok(thumbnails.every((image) => image.includes('loading="lazy"')));
    assert.equal(
      (overview.match(/<link\b[^>]*as="image"/g) ?? []).length,
      0,
      "browsing does not preload the full gallery",
    );
    assert.ok(
      thumbnails[1].includes(couplePhotos[1].smallSrc),
      "thumbnail uses the smaller public copy when available",
    );
    assert.ok(
      overview.includes(`aria-label="View photo 24 of ${couplePhotos.length}:`),
    );
    assert.ok(
      !overview.includes(
        `aria-label="View photo 25 of ${couplePhotos.length}:`,
      ),
    );
    assert.doesNotMatch(
      overview,
      /<span aria-hidden="true">\d+<\/span>/,
      "thumbnail numbers stay in accessible labels without visible badges",
    );
    assert.ok(overview.includes(`Showing 24 of ${couplePhotos.length} photos`));
    assert.match(overview, /Show 24 more photos/);
    assert.equal((renderOverview(48).match(/<img\b/g) ?? []).length, 48);
    const finalBatchStart = Math.floor((couplePhotos.length - 1) / 24) * 24;
    const finalBatchCount = couplePhotos.length - finalBatchStart;
    assert.ok(
      renderOverview(finalBatchStart).includes(
        `Show ${finalBatchCount} more photos`,
      ),
    );
    const allPhotos = renderOverview(finalBatchStart + 24);
    assert.equal(
      (allPhotos.match(/<img\b/g) ?? []).length,
      couplePhotos.length,
    );
    assert.ok(
      allPhotos.includes(
        `Showing ${couplePhotos.length} of ${couplePhotos.length} photos`,
      ),
    );
    assert.doesNotMatch(allPhotos, /more photos/);

    // These real component renders verify which thumbnail represents the
    // current photo. Mounted browser checks cover navigation, focus and scroll.
    const currentPhotoCases = [
      [24, 0],
      [144, 123],
      [couplePhotos.length, couplePhotos.length - 1],
    ];
    for (const [visibleCount, currentIndex] of currentPhotoCases) {
      const buttons =
        renderOverview(visibleCount, currentIndex).match(/<button\b[^>]*>/g) ??
        [];
      const currentButtons = buttons.filter((button) =>
        button.includes('aria-current="true"'),
      );
      assert.equal(
        currentButtons.length,
        1,
        "only the current photo's thumbnail is marked",
      );
      assert.ok(
        currentButtons[0].includes(
          `id="couple-gallery-thumbnail-${currentIndex}"`,
        ),
      );
      assert.ok(
        currentButtons[0].includes(
          `aria-label="View photo ${currentIndex + 1} of ${couplePhotos.length}:`,
        ),
      );
      if (currentIndex === 123) {
        const originalThumbnail = buttons.find((button) =>
          button.includes('id="couple-gallery-thumbnail-85"'),
        );
        assert.ok(
          originalThumbnail,
          "the originally opened photo remains available",
        );
        assert.ok(
          !originalThumbnail.includes('aria-current="true"'),
          "photo 86 is no longer current after navigating to photo 124",
        );
      }
    }
    const { default: App } = await server.ssrLoadModule("/src/app/App.jsx");
    const landing = renderToStaticMarkup(
      createElement(App, { audioEnabled: false }),
    );
    const scrapbookStart = landing.indexOf('class="couple-scrapbook"');
    const invitationStart = landing.indexOf('class="guest-invitation"');
    const choicesStart = landing.indexOf(
      'class="guest-choices guest-choices--welcome"',
    );
    const galleryStart = landing.indexOf('class="guest-gallery"');
    const landingImages = landing.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(
      landingImages.filter((image) => image.includes('fetchPriority="high"'))
        .length,
      1,
      "only the opening photo gets high download priority",
    );
    const galleryImage = landing.slice(galleryStart).match(/<img\b[^>]*>/)?.[0];
    assert.match(
      landing.slice(galleryStart),
      /<a href="#share-wedding-memory"[^>]*>[\s\S]*?Back to sharing<\/a>/,
    );
    assert.match(galleryImage, /loading="lazy"/);
    assert.match(galleryImage, /fetchPriority="auto"/);
    const landingPreloads = (landing.match(/<link\b[^>]*>/g) ?? []).filter(
      (link) => link.includes('as="image"'),
    );
    assert.equal(
      landingPreloads.length,
      1,
      "the gallery does not preload a competing image",
    );
    assert.ok(
      scrapbookStart >= 0 && scrapbookStart < invitationStart,
      "one focal couple photo leads into the invitation",
    );
    assert.ok(
      invitationStart < choicesStart && choicesStart < galleryStart,
      "memory choices are available on the welcome before the full gallery",
    );
    const scrapbook = landing.slice(scrapbookStart, invitationStart);
    const scrapbookImages = scrapbook.match(/<img\b[^>]*>/g) ?? [];
    const focalPhoto = couplePhotos.find((photo) => photo.id === 92);
    assert.equal(scrapbookImages.length, 1);
    assert.ok(scrapbookImages[0].includes(`src="${focalPhoto.src}"`));
    assert.ok(
      scrapbookImages[0].includes(
        'alt="Melanie and Kevin smiling together in a flower-filled garden."',
      ),
    );
    assert.ok(scrapbookImages[0].includes('loading="eager"'));
    assert.ok(scrapbookImages[0].includes('fetchPriority="high"'));
    assert.ok(
      scrapbookImages[0].includes(
        `width="${focalPhoto.width}" height="${focalPhoto.height}"`,
      ),
    );
    assert.doesNotMatch(
      scrapbook,
      /figcaption|scrapbook-caption|Her entrance|His perfect hair/,
    );
    assert.doesNotMatch(scrapbook, /scrapbook-share|Add your own memory/);

    const invitation = landing.slice(invitationStart, choicesStart);
    assert.match(
      invitation,
      /A favorite photo\. A good story\.<br\/>Help kickstart their next chapter\./,
    );
    const choices = landing.slice(choicesStart, galleryStart);
    assert.match(
      choices,
      /<h2 id="share-wedding-memory"[^>]*>Share a memory<\/h2>/,
    );
    assert.match(choices, /No account needed\. Your name is optional/);
    assert.match(
      choices,
      /Sent privately to Kevin and Melanie\. They choose which memories to share\./,
    );
    assert.equal(
      (choices.match(/class="memory-choice memory-choice--/g) ?? []).length,
      2,
    );
    assert.match(choices, /Caught a good moment\?/);
    assert.match(choices, /Add photos/);
    assert.match(choices, /Tell us a story\./);
    assert.match(choices, /Write a message/);
    assert.doesNotMatch(choices, /Record a message|Back to welcome/);
    assert.match(landing, /Lot&#x27;s of love for/);
    assert.equal((landing.match(/<h1\b/g) ?? []).length, 1);
    assert.doesNotMatch(
      landing,
      /couple-stor|Two people\. One next chapter\.|guest-share-button/,
    );
    const withAudio = renderToStaticMarkup(
      createElement(App, { audioEnabled: true }),
    );
    const audioChoices = withAudio.slice(
      withAudio.indexOf('class="guest-choices guest-choices--welcome"'),
      withAudio.indexOf('class="guest-gallery"'),
    );
    assert.equal(
      (audioChoices.match(/class="memory-choice memory-choice--/g) ?? [])
        .length,
      3,
    );
    assert.match(audioChoices, /Add photos/);
    assert.match(audioChoices, /Write a message/);
    assert.match(audioChoices, /Leave a little love\./);
    assert.match(audioChoices, /Record a message/);
    assert.doesNotMatch(
      withAudio,
      /couple-stor|Two people\. One next chapter\.|guest-share-button/,
    );
    assert.doesNotMatch(
      landing,
      /Browse Kevin and Melanie|Skip photos and share a memory|favourite/,
    );
  } finally {
    await server.close();
  }
});

test("slideshow advances every five seconds only in a visible tab and clears timers/listeners when paused or unmounted", () => {
  const documentImpl = new EventTarget();
  documentImpl.hidden = false;
  const timers = new Map();
  let nextTimer = 0,
    advances = 0;
  const stop = startSlideshow(() => advances++, {
    documentImpl,
    setIntervalImpl(callback, milliseconds) {
      assert.equal(milliseconds, 5000);
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearIntervalImpl(timer) {
      assert.ok(timers.has(timer));
      timers.delete(timer);
    },
  });
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(advances, 1);
  documentImpl.hidden = true;
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 0);
  documentImpl.hidden = false;
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
  documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(
    timers.size,
    0,
    "cleanup prevents visibility changes from restarting playback",
  );
});
