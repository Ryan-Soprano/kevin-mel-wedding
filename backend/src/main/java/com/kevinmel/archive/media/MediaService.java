package com.kevinmel.archive.media;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;

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
    public MediaService(PhotoRepository photos, PhotoFinalizer finalizer, ObjectStorage storage, Clock clock) {
        this.photos = photos; this.finalizer = finalizer; this.storage = storage; this.clock = clock;
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
        var result = finalizer.finalizePhoto(contributionId, memoryId, key, UUID.fromString(raw));
        if (result.failure() != null) throw result.failure();
        return result.receipt();
    }
}
