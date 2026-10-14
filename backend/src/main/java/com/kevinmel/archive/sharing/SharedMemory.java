package com.kevinmel.archive.sharing;

import java.time.Instant;
import java.util.UUID;
import com.kevinmel.archive.review.MemoryDetail;

/** Deliberately omits guest identity, private workflow details and storage capabilities. */
public record SharedMemory(UUID memoryId, String memoryType, String textContent, String caption,
        String title, String description, String memoryDate, String datePrecision, Instant createdAt, Media media) {
    public static SharedMemory from(MemoryDetail memory) {
        var asset = memory.media();
        return new SharedMemory(memory.memoryId(), memory.memoryType(), memory.textContent(), memory.caption(),
                memory.title(), memory.description(), memory.memoryDate(), memory.datePrecision(), memory.createdAt(),
                asset == null ? null : new Media(asset.detectedContentType(), asset.byteSize(), asset.durationSeconds()));
    }
    public record Media(String detectedContentType, long byteSize, Double durationSeconds) {}
    @Override public String toString() { return "SharedMemory[memoryId=" + memoryId + "]"; }
}
