package com.kevinandmelanie.memoryarchive.media;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Semaphore;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinandmelanie.memoryarchive.contribution.ContributionReceipt;
import com.kevinandmelanie.memoryarchive.web.ApiException;

@Service
public class MediaService {
    private final PhotoRepository photos;
    private final PhotoFinalizer finalizer;
    private final ObjectStorage storage;
    private final Clock clock;
    private final Semaphore finalizationSlots;
    public MediaService(PhotoRepository photos, PhotoFinalizer finalizer, ObjectStorage storage, Clock clock,
            @Value("${archive.media.max-concurrent-finalizations:0}") int maxConcurrentFinalizations) {
        this.photos = photos; this.finalizer = finalizer; this.storage = storage; this.clock = clock;
        if (maxConcurrentFinalizations < 0) throw new IllegalArgumentException("Finalization limit must be nonnegative.");
        finalizationSlots = maxConcurrentFinalizations == 0 ? null : new Semaphore(maxConcurrentFinalizations);
    }
    public PhotoRepository.Saved create(Map<String, Object> body, String key) {
        var normalized = PhotoRequest.from(body);
        storage.requireAvailable();
        return photos.create(normalized, key);
    }

    @Transactional
    public ObjectStorage.UploadGrant authorize(UUID contributionId, UUID memoryId, String key) {
        var asset = photos.lock(contributionId, memoryId, key);
        if (asset.state().equals("UPLOADED")) throw new ApiException(409, "ALREADY_COMPLETE", "This photo is already saved.");
        storage.requireAvailable();
        UUID grantId = UUID.randomUUID();
        String stagingKey = "staging/" + grantId;
        var created = clock.instant();
        var expires = created.plusSeconds(300);
        var grant = storage.authorize(grantId, stagingKey, asset.contentType(), expires);
        photos.addGrant(grantId, asset, stagingKey, created, expires);
        return grant;
    }

    public ContributionReceipt finalizeUpload(UUID contributionId, UUID memoryId, String key, Map<String, Object> body) {
        if (!body.keySet().equals(java.util.Set.of("grantId")) || !(body.get("grantId") instanceof String raw)
                || !raw.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw new ApiException(400, "VALIDATION_FAILED", "Supply the upload grant ID.");
        }
        // Admit before the transactional read/decode/publish, so waiting requests retain no image buffers or locks.
        if (finalizationSlots != null && !finalizationSlots.tryAcquire()) {
            throw new ApiException(503, "MEDIA_UNAVAILABLE", "Photo verification is busy. Please retry this photo.");
        }
        try {
            var result = finalizer.finalizePhoto(contributionId, memoryId, key, UUID.fromString(raw));
            if (result.failure() != null) throw result.failure();
            return result.receipt();
        } finally {
            // The transactional proxy has committed or rolled back before returning to this service.
            if (finalizationSlots != null) finalizationSlots.release();
        }
    }
}
