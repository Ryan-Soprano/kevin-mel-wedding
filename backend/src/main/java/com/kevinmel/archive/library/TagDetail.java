package com.kevinmel.archive.library;

import java.time.Instant;
import java.util.UUID;

public record TagDetail(
        UUID tagId,
        String name,
        String visibility,
        UUID revision,
        long memberCount,
        Instant createdAt,
        Instant updatedAt,
        Instant deletedAt) {
    @Override
    public String toString() {
        return "TagDetail[tagId=" + tagId + ",memberCount=" + memberCount + "]";
    }
}
