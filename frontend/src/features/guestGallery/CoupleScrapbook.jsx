import { useEffect, useRef, useState } from "react";
import { couplePhotos } from "./photos.js";
import "./coupleScrapbook.css";

const photo = couplePhotos.find((selection) => selection.id === 92);
const alt = "Melanie and Kevin smiling together in a flower-filled garden.";

export default function CoupleScrapbook() {
  const dialog = useRef(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && !dialog.current.open) dialog.current.showModal();
  }, [expanded]);

  return (
    <>
      <div className="couple-scrapbook">
        <figure className="scrapbook-print">
          <button
            type="button"
            className="scrapbook-enlarge"
            aria-label="See Kevin and Melanie’s photo in full"
            aria-haspopup="dialog"
            onClick={() => setExpanded(true)}
          >
            <img
              src={photo.src}
              srcSet={`${photo.smallSrc} ${photo.smallWidth}w, ${photo.src} ${photo.width}w`}
              sizes="(max-width: 560px) 75vw, 360px"
              width={photo.width}
              height={photo.height}
              alt={alt}
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </button>
        </figure>
      </div>
      <dialog
        ref={dialog}
        className="scrapbook-dialog"
        aria-label="Kevin and Melanie’s photo"
        onClose={() => setExpanded(false)}
      >
        <button
          type="button"
          className="scrapbook-dialog-close"
          aria-label="Close photo"
          onClick={() => dialog.current.close()}
        >
          <span aria-hidden="true">×</span>
        </button>
        {expanded && <img src={photo.src} width={photo.width} height={photo.height} alt={alt} />}
      </dialog>
    </>
  );
}
