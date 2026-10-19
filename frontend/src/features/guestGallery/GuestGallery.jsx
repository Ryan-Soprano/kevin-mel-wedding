import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { couplePhotos } from "./photos.js";
import { startSlideshow } from "./slideshow.js";
import { observeMorePhotos } from "./thumbnailLoading.js";
import "./guestGallery.css";

const SIZES = "(max-width: 480px) calc(100vw - 74px), (max-width: 1100px) calc(90vw - 26px), 962px";
const THUMBNAIL_BATCH = 24;

function subscribeToMotionPreference(notify) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", notify);
  return () => preference.removeEventListener("change", notify);
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Photo({ photo, index, total, deferLoading = false }) {
  const responsive =
    photo.smallSrc && photo.smallWidth < photo.width
      ? {
          srcSet: `${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`,
          sizes: SIZES,
        }
      : {};
  return (
    <figure
      className="guest-gallery-photo"
      role="group"
      aria-roledescription="slide"
      aria-label={`Photo ${index + 1} of ${total}`}
    >
      <img
        src={photo.src}
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading={deferLoading ? "lazy" : "eager"}
        fetchPriority={!deferLoading && index === 0 ? "high" : "auto"}
        decoding="async"
        style={{ maxWidth: photo.width }}
        {...responsive}
      />
    </figure>
  );
}

export function GalleryThumbnails({
  photos,
  visibleCount,
  currentIndex = 0,
  onOpen,
  onMore,
  onAutomaticMore,
}) {
  const shown = Math.min(visibleCount, photos.length);
  const remaining = Math.min(THUMBNAIL_BATCH, photos.length - shown);
  const hasMore = remaining > 0;
  const loadTrigger = useRef(null);
  const moreButton = useRef(null);

  useEffect(() => {
    if (!hasMore) return;
    return observeMorePhotos(loadTrigger.current, onAutomaticMore, {
      shouldLoad: () => moreButton.current !== document.activeElement,
    });
  }, [hasMore, onAutomaticMore]);

  return (
    <div className="guest-gallery-overview" id="couple-gallery-thumbnails">
      <p className="guest-gallery-overview-help">Choose a photo to see it in full.</p>
      <ol className="guest-gallery-thumbnails" aria-label="Photo thumbnails">
        {photos.slice(0, shown).map((photo, photoIndex) => (
          <li key={photo.id}>
            <button
              type="button"
              className="guest-gallery-thumbnail"
              id={`couple-gallery-thumbnail-${photoIndex}`}
              aria-label={`View photo ${photoIndex + 1} of ${photos.length}: ${photo.alt}`}
              aria-current={photoIndex === currentIndex ? "true" : undefined}
              onClick={() => onOpen(photoIndex)}
            >
              <img
                src={photo.smallSrc || photo.src}
                width={photo.width}
                height={photo.height}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </button>
          </li>
        ))}
      </ol>
      <div className="guest-gallery-overview-footer" ref={loadTrigger}>
        <p className="guest-gallery-position" role="status">Showing {shown} of {photos.length} photos</p>
        {remaining > 0 && (
          <button ref={moreButton} type="button" className="button-secondary" onClick={onMore}>
            Show {remaining} more photos
          </button>
        )}
      </div>
    </div>
  );
}

/** Deliberately public couple photos; never reads the private archive or uploads. */
export default function GuestGallery({ photos = couplePhotos, deferInitialPhoto = false, active = true, onBackToSharing }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [view, setView] = useState("preview");
  const [visibleCount, setVisibleCount] = useState(THUMBNAIL_BATCH);
  const gallery = useRef(null);
  const pendingFocus = useRef(null);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    () => false,
  );
  const rotating = active && playing && !hovered && !reducedMotion && view !== "grid";
  const currentIndex = index % (photos.length || 1);
  const appendPhotos = useCallback(() => {
    setVisibleCount((count) => Math.min(count + THUMBNAIL_BATCH, photos.length));
  }, [photos.length]);

  useEffect(() => {
    if (!rotating || photos.length < 2) return;
    return startSlideshow(() =>
      setIndex((current) => (current + 1) % photos.length),
    );
  }, [rotating, photos.length]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = gallery.current?.querySelector(`#${target.id}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [view, visibleCount]);

  function move(direction) {
    setPlaying(false);
    setIndex(
      (current) => (current + direction + photos.length) % photos.length,
    );
  }

  function showThumbnails() {
    setPlaying(false);
    setHovered(false);
    // The current slide may be beyond the thumbnail batches already opened.
    const requiredCount = Math.min(
      photos.length,
      Math.ceil((currentIndex + 1) / THUMBNAIL_BATCH) * THUMBNAIL_BATCH,
    );
    setVisibleCount((count) => Math.max(count, requiredCount));
    pendingFocus.current = { id: `couple-gallery-thumbnail-${currentIndex}` };
    setView("grid");
  }

  function openPhoto(photoIndex) {
    pendingFocus.current = { id: "couple-gallery-slide" };
    setPlaying(false);
    setHovered(false);
    setIndex(photoIndex);
    setView("viewer");
  }

  function showMore() {
    pendingFocus.current = { id: `couple-gallery-thumbnail-${visibleCount}` };
    appendPhotos();
  }

  function navigate(event) {
    if (view === "grid") return;
    if (event.key === "Escape" && view === "viewer") {
      event.preventDefault();
      showThumbnails();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  }

  if (photos.length === 0) return null;
  return (
    <section
      ref={gallery}
      className="guest-gallery"
      aria-roledescription={view === "grid" ? undefined : "carousel"}
      aria-labelledby="couple-gallery"
      aria-describedby="couple-gallery-description"
      onKeyDown={navigate}
      onFocusCapture={() => setPlaying(false)}
    >
      <header>
        <h2 id="couple-gallery" tabIndex={-1}>
          Kevin and Melanie’s photo gallery
        </h2>
        <p id="couple-gallery-description">
          Familiar faces, favorite places, and a few good stories. Browse {photos.length} photos from their lives.
        </p>
      </header>
      {view === "grid" ? (
        <GalleryThumbnails
          photos={photos}
          visibleCount={visibleCount}
          currentIndex={currentIndex}
          onOpen={openPhoto}
          onMore={showMore}
          onAutomaticMore={active ? appendPhotos : undefined}
        />
      ) : (
        <>
          {photos.length > 1 && !reducedMotion && (
            <div className="guest-gallery-playback">
              <button
                type="button"
                className="button-secondary guest-gallery-play"
                aria-controls="couple-gallery-slide"
                onClick={() => setPlaying((current) => !current)}
              >
                {playing ? "Pause slideshow" : "Play slideshow"}
              </button>
              <p className="guest-gallery-playback-status" role="status">
                {playing && hovered
                  ? "Paused while your pointer is over the photo."
                  : playing
                    ? "Photos change every five seconds."
                    : "Take your time, or play the slideshow."}
              </p>
            </div>
          )}
          <div
            className="guest-gallery-frame"
            id="couple-gallery-slide"
            tabIndex={-1}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
            aria-live={rotating ? "off" : "polite"}
            aria-atomic="true"
          >
            <Photo
              key={photos[currentIndex].id}
              photo={photos[currentIndex]}
              index={currentIndex}
              total={photos.length}
              deferLoading={deferInitialPhoto && view === "preview" && currentIndex === 0 && !playing}
            />
          </div>
          <div className="guest-gallery-controls">
            {photos.length > 1 && (
              <button
                type="button"
                className="button-secondary guest-gallery-arrow"
                aria-label="Previous photo"
                aria-controls="couple-gallery-slide"
                onClick={() => move(-1)}
              >
                ←
              </button>
            )}
            <p className="guest-gallery-position">
              Photo {currentIndex + 1} of {photos.length}
            </p>
            {photos.length > 1 && (
              <button
                type="button"
                className="button-secondary guest-gallery-arrow"
                aria-label="Next photo"
                aria-controls="couple-gallery-slide"
                onClick={() => move(1)}
              >
                →
              </button>
            )}
          </div>
        </>
      )}
      {photos.length > 1 && view !== "grid" && (
        <div className="guest-gallery-browse">
          <button type="button" className="button-secondary" onClick={showThumbnails}>
            {view === "viewer" ? "Back to thumbnails" : `Browse all ${photos.length} photos`}
          </button>
        </div>
      )}
      {onBackToSharing && (
        <p className="guest-gallery-return">
          <a href="#share-wedding-memory" onClick={onBackToSharing}>
            <span aria-hidden="true">↑</span> Back to sharing
          </a>
        </p>
      )}
    </section>
  );
}
