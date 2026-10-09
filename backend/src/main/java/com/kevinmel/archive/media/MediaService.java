package com.kevinmel.archive.media;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Semaphore;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.contribution.ContributionReceipt;
import com.kevinmel.archive.web.ApiException;

@Service
public class MediaService {
    private final PhotoRepository photos;
    private final PhotoFinalizer finalizer;
    private final ObjectStorage storage;
    private final Clock clock;
    private final Semaphore finalizationSlots;
    private final boolean audioEnabled;
    @Autowired
    public MediaService(PhotoRepository photos, PhotoFinalizer finalizer, ObjectStorage storage, Clock clock,
            @Value("${archive.media.max-concurrent-finalizations:2}") int maxConcurrentFinalizations,
            @Value("${archive.audio.enabled:false}") boolean audioEnabled) {
        this.photos = photos; this.finalizer = finalizer; this.storage = storage; this.clock = clock;
        this.audioEnabled = audioEnabled;
        if (maxConcurrentFinalizations < 1) throw new IllegalArgumentException("Finalization limit must be positive.");
        finalizationSlots = new Semaphore(maxConcurrentFinalizations);
    }
    public MediaService(PhotoRepository photos, PhotoFinalizer finalizer, ObjectStorage storage, Clock clock,
            int maxConcurrentFinalizations) {
        this(photos, finalizer, storage, clock, maxConcurrentFinalizations, false);
    }
    public PhotoRepository.Saved create(Map<String, Object> body, String key) {
        if ("AUDIO".equals(body.get("memoryType"))) {
            var normalized = AudioRequest.from(body);
            // Repository permits equivalent committed retries before checking new-admission gates.
            if (audioEnabled) storage.requireAvailable();
            return photos.create(normalized, key, audioEnabled);
        }
        var normalized = PhotoRequest.from(body);
        storage.requireAvailable();
        return photos.create(normalized, key);
    }

    @Transactional
    public ObjectStorage.UploadGrant authorize(UUID contributionId, UUID memoryId, String key) {
        var asset = photos.lock(contributionId, memoryId, key);
        if (asset.state().equals("UPLOADED")) throw new ApiException(409, "ALREADY_COMPLETE", "This memory is already saved.");
        storage.requireAvailable();
        var active = photos.activeGrant(asset.id(), clock.instant());
        if (active.isPresent()) {
            var grant = active.get();
            return storage.authorize(grant.id(), grant.stagingKey(), asset.contentType(), asset.byteSize(), grant.expiresAt());
        }
        if ("AUDIO".equals(asset.memoryType()) && !audioEnabled) throw PhotoRepository.audioUnavailable();
        photos.requireNewUpload();
        photos.requireStagingCapacity(asset.byteSize());
        UUID grantId = UUID.randomUUID();
        String stagingKey = "staging/" + grantId;
        var created = clock.instant();
        var expires = created.plusSeconds(300);
        var grant = storage.authorize(grantId, stagingKey, asset.contentType(), asset.byteSize(), expires);
        photos.addGrant(grantId, asset, stagingKey, created, expires);
        return grant;
    }

    public ContributionReceipt finalizeUpload(UUID contributionId, UUID memoryId, String key, Map<String, Object> body) {
        if (!body.keySet().equals(java.util.Set.of("grantId")) || !(body.get("grantId") instanceof String raw)
                || !raw.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw new ApiException(400, "VALIDATION_FAILED", "Supply the upload grant ID.");
        }
        // Admit before the transactional read/decode/publish, so waiting requests retain no media buffers or locks.
        if (finalizationSlots != null && !finalizationSlots.tryAcquire()) {
            throw new ApiException(503, "MEDIA_UNAVAILABLE", "Media verification is busy. Please retry this memory.", 5);
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
