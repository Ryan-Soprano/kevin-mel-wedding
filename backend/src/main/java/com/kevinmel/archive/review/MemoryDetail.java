package com.kevinmel.archive.review;

import java.time.Instant;
import java.util.UUID;

/** Private content DTO: no storage keys, retry capabilities or signed media links. */
public record MemoryDetail(UUID memoryId, UUID contributionId, String guestName, String memoryType,
        String textContent, String caption, String reviewStatus, String visibility, int revision,
        Instant createdAt, Instant updatedAt, Instant deleteAfter, PhotoMedia media) {
    @Override public String toString() { return "MemoryDetail[memoryId=" + memoryId + "]"; }

    public record PhotoMedia(String originalFilename, String detectedContentType, long byteSize,
            String checksumSha256, Double durationSeconds, String uploadState) {
        @Override public String toString() { return "PhotoMedia[byteSize=" + byteSize + "]"; }
    }
}
