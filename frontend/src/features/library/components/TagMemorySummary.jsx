import { memoryTime } from "../../inbox/memoryDisplay.js";
import {
  TAG_MEMORY_TYPES,
  TAG_REVIEW_STATUSES,
  getTagMemoryHeading,
  getTagMemorySource,
  getTagMemoryExcerpt,
} from "../tagDisplay.js";

export default function TagMemorySummary({ memory }) {
  return (
    <>
      <h3>{getTagMemoryHeading(memory)}</h3>
      <p className="library-result-meta">
        {TAG_MEMORY_TYPES[memory.memoryType]} ·{" "}
        {TAG_REVIEW_STATUSES[memory.reviewStatus]} ·{" "}
        {getTagMemorySource(memory)}
      </p>
      {memory.memoryDate && (
        <p className="library-result-date">
          Memory date: {memory.memoryDate}
        </p>
      )}
      <p className="library-result-date">
        Saved on: {memoryTime(memory.createdAt)} · Eastern
      </p>
      <p className="inbox-excerpt">
        {getTagMemoryExcerpt(memory)}
      </p>
    </>
  );
}
