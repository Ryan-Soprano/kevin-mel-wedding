import { couplePhotos } from "./photos.js";
import "./coupleStories.css";

const PROFILES = [
  {
    name: "Kevin",
    key: "kevin",
    photo: couplePhotos.find((photo) => photo.id === 90),
    alt: "Kevin smiling while holding a small dog.",
    biography:
      "Kevin is the friend you never knew you needed: funny, endlessly resourceful, and handy with just about anything. He knows a little about everything, always lends a hand, and shows up when it matters. Loyal almost to a fault.",
  },
  {
    name: "Melanie",
    key: "melanie",
    photo: couplePhotos.find((photo) => photo.id === 15),
    alt: "Melanie smiling with her chin resting on her hand.",
    biography:
      "Melanie brings honesty, determination, and a spirit all her own. She has the grit to see things through and knows how to make an entrance. Her strength and spark are part of the story she and Kevin are building together.",
  },
];

export default function CoupleStories() {
  return (
    <section className="couple-stories" aria-labelledby="couple-stories-title">
      <h2 id="couple-stories-title">Two people. One next chapter.</h2>
      <div className="couple-stories-profiles">
        {PROFILES.map(({ name, key, photo, alt, biography }) => (
          <article
            className={`couple-story couple-story--${key}`}
            aria-labelledby={`couple-story-${key}`}
            key={key}
          >
            <figure className="couple-story-portrait">
              <img
                src={photo.smallSrc ?? photo.src}
                srcSet={
                  photo.smallSrc
                    ? `${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`
                    : undefined
                }
                sizes={photo.smallSrc ? "(max-width: 480px) 88px, 120px" : undefined}
                width={photo.width}
                height={photo.height}
                alt={alt}
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="couple-story-copy">
              <h3 id={`couple-story-${key}`}>{name}</h3>
              <p>{biography}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
