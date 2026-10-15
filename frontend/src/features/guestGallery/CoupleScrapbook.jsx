import { couplePhotos } from "./photos.js";
import "./coupleScrapbook.css";

// Keep the welcome selections together so the couple can easily change them.
const WELCOME_PHOTO_IDS = Object.freeze({
  melanie: 15,
  kevin: 90,
  together: 148,
});

const COUPLE_PHOTOS = [
  {
    key: "together",
    photo: couplePhotos.find((photo) => photo.id === WELCOME_PHOTO_IDS.together),
    alt: "Melanie and Kevin leaning together and smiling for a selfie.",
  },
  {
    key: "arch",
    photo: {
      src: new URL("./welcome-assets/couple-arch.webp", import.meta.url).href,
      smallSrc: new URL("./welcome-assets/couple-arch-384.webp", import.meta.url).href,
      width: 768,
      height: 1024,
      smallWidth: 384,
    },
    alt: "Melanie and Kevin smiling together outside a brick archway, Kevin wearing glasses and a tan jacket.",
  },
  {
    key: "globe",
    photo: {
      src: new URL("./welcome-assets/couple-globe.webp", import.meta.url).href,
      smallSrc: new URL("./welcome-assets/couple-globe-384.webp", import.meta.url).href,
      width: 768,
      height: 1024,
      smallWidth: 384,
    },
    alt: "Kevin and Melanie smiling in front of a large metal globe under a blue sky.",
  },
  {
    key: "melanie",
    photo: couplePhotos.find((photo) => photo.id === WELCOME_PHOTO_IDS.melanie),
    alt: "Melanie smiling with her chin resting on her hand.",
  },
  {
    key: "kevin",
    photo: couplePhotos.find((photo) => photo.id === WELCOME_PHOTO_IDS.kevin),
    alt: "Kevin smiling while holding a small dog.",
  },
];

function WelcomePhoto({ photo, alt, sizes }) {
  return (
    <img
      src={photo.src}
      srcSet={
        photo.smallSrc
          ? `${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`
          : undefined
      }
      sizes={photo.smallSrc ? sizes : undefined}
      width={photo.width}
      height={photo.height}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export default function CoupleScrapbook() {
  return (
    <section className="couple-scrapbook" aria-labelledby="couple-scrapbook">
      <header className="couple-scrapbook-heading">
        <h2 id="couple-scrapbook">A few favorite moments</h2>
      </header>

      <div className="couple-scrapbook-photos">
        {COUPLE_PHOTOS.map((selection) => (
          <figure
            key={selection.key}
            className={`scrapbook-photo scrapbook-photo--${selection.key}`}
          >
            <WelcomePhoto
              photo={selection.photo}
              alt={selection.alt}
              sizes="(max-width: 680px) 33vw, 220px"
            />
          </figure>
        ))}
      </div>
      <p className="scrapbook-caption">
        She makes an entrance. He brings the perfect hair.
      </p>
    </section>
  );
}
