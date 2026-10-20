package com.kevinmel.archive.album;

import java.time.Instant;
import java.util.UUID;

public record AlbumDetail(
        UUID albumId,
        String name,
        String visibility,
        UUID revision,
        long memberCount,
        Instant createdAt,
        Instant updatedAt,
        Instant deletedAt) {
    @Override
    public String toString() {
        return "AlbumDetail[albumId=" + albumId + ", memberCount=" + memberCount + "]";
    }
}
