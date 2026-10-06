package com.kevinmel.archive.media;

import java.time.Clock;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.contribution.ContributionReceipt;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.web.ApiException;

@Service
public class PhotoFinalizer {
    private final PhotoRepository photos;
    private final ContributionRepository contributions;
    private final ObjectStorage storage;
    private final PhotoVerifier verifier;
    private final Clock clock;
    public PhotoFinalizer(PhotoRepository photos, ContributionRepository contributions,
            ObjectStorage storage, PhotoVerifier verifier, Clock clock) {
        this.photos = photos; this.contributions = contributions; this.storage = storage;
        this.verifier = verifier; this.clock = clock;
    }

    @Transactional
    public Result finalizePhoto(UUID contributionId, UUID memoryId, String key, UUID grantId) {
        var asset = photos.lock(contributionId, memoryId, key);
        var grant = photos.grant(grantId, asset.id());
        if (asset.state().equals("UPLOADED")) return new Result(contributions.getReceipt(contributionId, key), null);
        if (!clock.instant().isBefore(grant.expiresAt())) {
            throw new ApiException(410, "UPLOAD_GRANT_EXPIRED", "The upload permission expired. Please retry this photo.");
        }
        var candidate = storage.read(grant.stagingKey(), PhotoRequest.MAX_BYTES);
        if (candidate.isEmpty()) throw new ApiException(409, "UPLOAD_INCOMPLETE", "The photo has not arrived yet. Please retry the upload.");
        String type;
        try {
            type = verifier.verify(candidate.get(), asset);
        } catch (ApiException invalid) {
            photos.failed(asset);
            // Returning an outcome commits FAILED before the outer service emits 422.
            return new Result(null, invalid);
        }
        // Browser can still overwrite staging until grant expiry. These verified bytes alone
        // are published at the server-only original key, never the granted staging key.
        storage.publish(asset.originalKey(), candidate.get(), type);
        photos.uploaded(asset, type);
        return new Result(contributions.getReceipt(contributionId, key), null);
    }
    public record Result(ContributionReceipt receipt, ApiException failure) {}
}
