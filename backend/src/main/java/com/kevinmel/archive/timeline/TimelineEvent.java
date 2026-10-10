package com.kevinmel.archive.timeline;

import java.time.Instant;
import java.util.UUID;

/** Private organization only; original media and memory metadata belong to the referenced memory. */
public record TimelineEvent(UUID eventId, String title, String description, String eventDate, String datePrecision,
        String visibility, UUID revision, long memberCount, Instant createdAt, Instant updatedAt, Instant deletedAt) {
    @Override public String toString() { return "TimelineEvent[eventId=" + eventId + ", memberCount=" + memberCount + "]"; }
}
