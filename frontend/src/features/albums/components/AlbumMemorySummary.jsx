import {
  getAlbumMemoryExcerpt,
  getAlbumMemoryHeading,
  getAlbumMemorySource,
  ALBUM_MEMORY_TYPES,
  ALBUM_REVIEW_LABELS,
} from "../albumDisplay.js";

export default function AlbumMemorySummary({ memory }) {
  return (
    <>
      <h3>{getAlbumMemoryHeading(memory)}</h3>
      <p>
        {ALBUM_MEMORY_TYPES[memory.memoryType]} ·{" "}
        {ALBUM_REVIEW_LABELS[memory.reviewStatus]} ·{" "}
        {getAlbumMemorySource(memory)}
      </p>
      {memory.memoryDate && <p>Memory date: {memory.memoryDate}</p>}
      <p className="inbox-excerpt">{getAlbumMemoryExcerpt(memory)}</p>
    </>
  );
}
