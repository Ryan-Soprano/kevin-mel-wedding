import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

function Photo({ photo, index, total, deferLoading = false, enlarged = false, onOpen }) {
  const responsive =
    photo.smallSrc && photo.smallWidth < photo.width
      ? {
          srcSet: `${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`,
          sizes: enlarged ? "(max-width: 1152px) calc(100vw - 64px), 1086px" : SIZES,
        }
      : {};
  const image = (
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
  );
  return (
    <figure
      className="guest-gallery-photo"
      role="group"
      aria-roledescription="slide"
      aria-label={`Photo ${index + 1} of ${total}`}
    >
      {onOpen ? (
        <button
          type="button"
          className="guest-gallery-enlarge"
          aria-label={`Enlarge photo ${index + 1} of ${total}: ${photo.alt}`}
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {image}
        </button>
      ) : image}
    </figure>
  );
}

function PhotoControls({ index, total, slideId, onMove }) {
  return (
    <div className="guest-gallery-controls">
      {total > 1 && (
        <button
          type="button"
          className="button-secondary guest-gallery-arrow"
          aria-label="Previous photo"
          aria-controls={slideId}
          onClick={() => onMove(-1)}
        >
          ←
        </button>
      )}
      <p className="guest-gallery-position">Photo {index + 1} of {total}</p>
      {total > 1 && (
        <button
          type="button"
          className="button-secondary guest-gallery-arrow"
          aria-label="Next photo"
          aria-controls={slideId}
          onClick={() => onMove(1)}
        >
          →
        </button>
      )}
    </div>
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
              aria-haspopup="dialog"
              onClick={(event) => onOpen(photoIndex, event.currentTarget)}
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
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(THUMBNAIL_BATCH);
  const gallery = useRef(null);
  const pendingFocus = useRef(null);
  const dialog = useRef(null);
  const viewerReturn = useRef(null);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    () => false,
  );
  const rotating = active && playing && !hovered && !reducedMotion && !expanded && view !== "grid";
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

  useLayoutEffect(() => {
    if (!expanded || !active) return;
    const element = dialog.current;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const scrollbarGutter = root.style.scrollbarGutter;
    // Preserve an existing scrollbar's space without adding a new gutter on
    // phones with overlay scrollbars, which would resize the underlying grid.
    if (window.innerWidth > root.clientWidth && getComputedStyle(root).scrollbarGutter === "auto") {
      root.style.scrollbarGutter = "stable";
    }
    root.style.overflow = "hidden";
    element.showModal();
    return () => {
      if (element.open) element.close();
      root.style.overflow = overflow;
      root.style.scrollbarGutter = scrollbarGutter;
    };
  }, [active, expanded]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = gallery.current?.querySelector(`#${target.id}`);
    if (!active || !element) {
      pendingFocus.current = null;
      return;
    }
    if (view === "grid" && target.block === "center" && visibleCount < photos.length) {
      const bounds = element.getBoundingClientRect();
      const centeredTop = window.scrollY + bounds.top + (bounds.height - window.innerHeight) / 2;
      const scrollRoot = document.scrollingElement ?? document.documentElement;
      const maximumTop = Math.max(0, scrollRoot.scrollHeight - window.innerHeight);
      // Prepare enough rows before focusing, so a later passive batch cannot
      // leave this return stuck at the old document's bottom scroll limit.
      if (centeredTop > maximumTop + 1) {
        appendPhotos();
        return;
      }
    }
    pendingFocus.current = null;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: target.block ?? "nearest", behavior: "instant" });
  }, [active, appendPhotos, photos.length, view, visibleCount]);

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
    pendingFocus.current = {
      id: `couple-gallery-thumbnail-${currentIndex}`,
      block: "center",
    };
    setView("grid");
  }

  function openPhoto(photoIndex, opener) {
    viewerReturn.current = {
      opener,
      x: window.scrollX,
      y: window.scrollY,
      top: opener.getBoundingClientRect().top,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    setPlaying(false);
    setHovered(false);
    setIndex(photoIndex);
    setExpanded(true);
  }

  function closePhoto() {
    setExpanded(false);
    const target = viewerReturn.current;
    viewerReturn.current = null;
    if (!active || !target?.opener.isConnected) return;
    target.opener.focus({ preventScroll: true });
    let top = target.y;
    if (target.width !== window.innerWidth || target.height !== window.innerHeight) {
      // A rotation or resize changes row geometry: keep the opening photo in
      // view rather than restoring coordinates from the old layout.
      const bounds = target.opener.getBoundingClientRect();
      const visibleTop = Math.max(0, Math.min(target.top, window.innerHeight - bounds.height));
      top = window.scrollY + bounds.top - visibleTop;
    }
    window.scrollTo({ left: target.x, top, behavior: "instant" });
  }

  function showMore() {
    pendingFocus.current = { id: `couple-gallery-thumbnail-${visibleCount}` };
    appendPhotos();
  }

  function navigate(event) {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      dialog.current.close();
      return;
    }
    if (view === "grid" && !expanded) return;
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
          onAutomaticMore={active && !expanded ? appendPhotos : undefined}
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
              photo={photos[currentIndex]}
              index={currentIndex}
              total={photos.length}
              deferLoading={deferInitialPhoto && currentIndex === 0 && !playing}
              onOpen={(event) => openPhoto(currentIndex, event.currentTarget)}
            />
          </div>
          <PhotoControls
            index={currentIndex}
            total={photos.length}
            slideId="couple-gallery-slide"
            onMove={move}
          />
        </>
      )}
      {photos.length > 1 && view !== "grid" && (
        <div className="guest-gallery-browse">
          <button type="button" className="button-secondary" onClick={showThumbnails}>
            Browse all {photos.length} photos
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="guest-gallery-dialog"
        aria-label="Enlarged gallery photo"
        onClose={closePhoto}
      >
        {expanded && (
          <>
            <button
              type="button"
              className="guest-gallery-dialog-close"
              aria-label="Close photo"
              onClick={() => dialog.current.close()}
            >
              <span aria-hidden="true">×</span>
            </button>
            <div id="couple-gallery-enlarged-slide" aria-live="polite" aria-atomic="true">
              <Photo
                key={photos[currentIndex].id}
                photo={photos[currentIndex]}
                index={currentIndex}
                total={photos.length}
                enlarged
              />
            </div>
            <PhotoControls
              index={currentIndex}
              total={photos.length}
              slideId="couple-gallery-enlarged-slide"
              onMove={move}
            />
            <div className="guest-gallery-browse">
              <button
                type="button"
                className="button-secondary"
                onClick={() => dialog.current.close()}
              >
                {view === "grid" ? "Back to gallery" : "Back to slideshow"}
              </button>
            </div>
          </>
        )}
      </dialog>
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
