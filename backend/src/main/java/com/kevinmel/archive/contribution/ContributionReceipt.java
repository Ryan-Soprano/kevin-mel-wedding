package com.kevinmel.archive.contribution;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A guest receipt intentionally contains no content or private retrieval
 * credentials.
 */
public record ContributionReceipt(
        UUID contributionId,
        String eventKey,
        Instant createdAt,
        String completion,
        List<MemoryReceipt> memories) {
    public record MemoryReceipt(
            UUID memoryId,
            UUID clientItemId,
            String memoryType,
            String uploadState,
            String reviewStatus,
            String visibility) {
    }
}
