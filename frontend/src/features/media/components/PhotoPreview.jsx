import { useEffect, useRef } from "react";

export default function PhotoPreview({ file }) {
  const imageRef = useRef(null);

  useEffect(() => {
    const previewUrl = URL.createObjectURL(file);
    const imageElement = imageRef.current;

    imageElement.src = previewUrl;

    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);

  return <img ref={imageRef} className="photo-card__image" alt="" />;
}
