package com.kevinmel.archive.media;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.kevinmel.archive.web.ApiException;

/** New permissions can be paused; already issued permissions and receipts remain recoverable. */
@Component
public final class PhotoAdmissionPolicy {
    private final boolean paused;
    private final long maxOriginalBytes;
    private final long maxStagingBytes;

    public PhotoAdmissionPolicy(
            @Value("${archive.media.uploads-paused:false}") boolean paused,
            @Value("${archive.media.max-original-bytes:7500000000}") long maxOriginalBytes,
            @Value("${archive.media.max-staging-bytes:7500000000}") long maxStagingBytes) {
        if (maxOriginalBytes < 1 || maxStagingBytes < 1) {
            throw new IllegalArgumentException("Media capacities must be positive.");
        }
        this.paused = paused;
        this.maxOriginalBytes = maxOriginalBytes;
        this.maxStagingBytes = maxStagingBytes;
    }

    public void requireNewUpload() {
        if (paused) {
            throw new ApiException(
                    503,
                    "MEDIA_UNAVAILABLE",
                    "Photo uploads are temporarily paused. Keep your photos and try again later.",
                    60);
        }
    }

    public void requireCapacity(
            long reservedBytes,
            long requestedBytes) {
        requireCapacity(
                reservedBytes,
                requestedBytes,
                maxOriginalBytes);
    }

    public void requireStagingCapacity(
            long reservedBytes,
            long requestedBytes) {
        requireCapacity(
                reservedBytes,
                requestedBytes,
                maxStagingBytes);
    }

    private static void requireCapacity(
            long reservedBytes,
            long requestedBytes,
            long limit) {
        if (reservedBytes < 0
                || requestedBytes < 1
                || reservedBytes > limit
                || requestedBytes > limit - reservedBytes) {
            throw new ApiException(
                    503,
                    "MEDIA_UNAVAILABLE",
                    "Photo uploads are temporarily unavailable. Keep your photos and try again later.",
                    60);
        }
    }
}
