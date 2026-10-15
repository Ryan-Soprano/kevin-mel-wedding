import { memoryTime } from "../../inbox/memoryDisplay.js";
import { partialDateLabel } from "../timelineFields.js";
import { getTimelineMemoryExcerpt, getTimelineMemoryHeading, getTimelineMemorySource, TIMELINE_MEMORY_TYPES, TIMELINE_REVIEW_LABELS } from "../timelineDisplay.js";

export default function TimelineMemorySummary({ memory }) {
  return (
    <>
      <h3>{getTimelineMemoryHeading(memory)}</h3>
      <p>{TIMELINE_MEMORY_TYPES[memory.memoryType]} · {TIMELINE_REVIEW_LABELS[memory.reviewStatus]} · {getTimelineMemorySource(memory)}</p>
      <p>Memory date: {partialDateLabel(memory.memoryDate, memory.datePrecision)}</p>
      <p>Saved on: <time dateTime={memory.createdAt}>{memoryTime(memory.createdAt)}</time> · Eastern</p>
      <p className="inbox-excerpt">{getTimelineMemoryExcerpt(memory)}</p>
    </>
  );
}
