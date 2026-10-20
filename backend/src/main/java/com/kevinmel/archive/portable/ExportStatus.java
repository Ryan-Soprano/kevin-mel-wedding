package com.kevinmel.archive.portable;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Bounded progress and opaque identities; private archive content never appears here. */
public record ExportStatus(
        UUID exportId,
        String state,
        Instant createdAt,
        Instant capturedAt,
        Instant expiresAt,
        Instant hardExpiresAt,
        int totalMemories,
        int totalOriginals,
        long totalOriginalBytes,
        Map<String, Long> excludedCounts,
        int originalPartCount,
        Integer indexPartNumber,
        int processedOriginalParts,
        int availableOriginals,
        int unavailableOriginals,
        boolean complete,
        boolean indexNeedsRefresh,
        PreparedPart preparedPart,
        Attempt lastAttempt,
        String errorCode,
        int pollAfterSeconds) {
    public record PreparedPart(
            int partNumber,
            String kind,
            String filename,
            long byteSize,
            String sha256,
            UUID generation,
            UUID attemptId) {
    }

    public record Attempt(
            UUID attemptId,
            String kind,
            Integer partNumber,
            String state) {
    }

    public record Part(
            int partNumber,
            String kind,
            String state,
            int availableOriginals,
            int unavailableOriginals) {
    }

    public record Issue(
            int partNumber,
            UUID memoryId,
            UUID assetId,
            String code) {
    }

    public record Parts(
            UUID exportId,
            List<Part> items,
            String nextCursor) {
    }

    public record Issues(
            UUID exportId,
            List<Issue> items,
            String nextCursor) {
    }
}
