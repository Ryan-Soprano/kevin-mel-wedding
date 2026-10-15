import { useEffect, useState, useSyncExternalStore } from "react";
import { couplePhotos } from "./photos.js";
import { startSlideshow } from "./slideshow.js";
import "./guestGallery.css";

const SIZES = "(max-width: 600px) calc(100vw - 48px), (max-width: 1020px) 90vw, 908px";

function subscribeToMotionPreference(notify) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", notify);
  return () => preference.removeEventListener("change", notify);
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Photo({ photo, index, total }) {
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
        loading="eager"
        fetchPriority={index === 0 ? "high" : "auto"}
        decoding="async"
        style={{ maxWidth: photo.width }}
        {...responsive}
      />
    </figure>
  );
}

/** Deliberately public couple photos; never reads the private archive or uploads. */
export default function GuestGallery({ photos = couplePhotos }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    () => false,
  );
  const rotating = playing && !hovered && !reducedMotion;
  const currentIndex = index % (photos.length || 1);

  useEffect(() => {
    if (!rotating || photos.length < 2) return;
    return startSlideshow(() =>
      setIndex((current) => (current + 1) % photos.length),
    );
  }, [rotating, photos.length]);

  function move(direction) {
    setPlaying(false);
    setIndex(
      (current) => (current + direction + photos.length) % photos.length,
    );
  }

  function navigate(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  }

  if (photos.length === 0) return null;
  return (
    <section
      className="guest-gallery"
      aria-roledescription="carousel"
      aria-labelledby="couple-gallery"
      aria-describedby="couple-gallery-description"
      onKeyDown={navigate}
      onFocusCapture={() => setPlaying(false)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <header>
        <h2 id="couple-gallery" tabIndex={-1}>
          Kevin and Melanie’s photo gallery
        </h2>
        <p id="couple-gallery-description">
          {photos.length} photos shared for you to browse. Your own wedding
          contributions stay private for Kevin and Melanie.
        </p>
      </header>
      <div
        className="guest-gallery-frame"
        id="couple-gallery-slide"
        aria-live={rotating ? "off" : "polite"}
        aria-atomic="true"
      >
        <Photo
          key={photos[currentIndex].id}
          photo={photos[currentIndex]}
          index={currentIndex}
          total={photos.length}
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
        {photos.length > 1 && !reducedMotion && (
          <button
            type="button"
            className="button-secondary guest-gallery-play"
            aria-controls="couple-gallery-slide"
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? "Pause slideshow" : "Play slideshow"}
          </button>
        )}
      </div>
    </section>
  );
}
