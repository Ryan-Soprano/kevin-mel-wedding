import { couplePhotos } from "./photos.js";
import "./guestGallery.css";

const SIZES = "(max-width: 600px) calc(100vw - 40px), 560px";

function Photo({ photo, index, total }) {
  const responsive = photo.smallSrc && photo.smallWidth < photo.width
    ? { srcSet: `${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`, sizes: SIZES } : {};
  return <figure className={index === 0 ? "guest-gallery-photo guest-gallery-hero" : "guest-gallery-photo"}>
    <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt}
      loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "auto"} decoding="async"
      style={{ maxWidth: photo.width }} {...responsive} />
    <figcaption>Photo {index + 1} of {total}</figcaption>
  </figure>;
}

/** Deliberately public couple photos; never reads the private archive or uploads. */
export default function GuestGallery({ photos = couplePhotos }) {
  if (photos.length === 0) return null;
  return <section className="guest-gallery" aria-labelledby="couple-gallery" aria-describedby="couple-gallery-description">
    <header>
      <h2 id="couple-gallery" tabIndex={-1}>Kevin and Melanie’s photo gallery</h2>
      <p id="couple-gallery-description">{photos.length} photos shared for you to browse. Your own wedding contributions stay private for Kevin and Melanie.</p>
      <a className="guest-gallery-link" href="#share-wedding-memory">Skip photos and share a memory</a>
    </header>
    <div className="guest-gallery-photos">{photos.map((photo, index) => <Photo key={photo.id} photo={photo} index={index} total={photos.length} />)}</div>
    <a className="guest-gallery-link" href="#share-wedding-memory">Back to Share a memory</a>
  </section>;
}
