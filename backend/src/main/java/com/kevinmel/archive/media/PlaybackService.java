package com.kevinmel.archive.media;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;
import org.springframework.stereotype.Service;

@Service
public class PlaybackService {
    private static final Duration LINK_LIFETIME = Duration.ofMinutes(5);
    private final ArchiveAuthorization authorization;
    private final PlaybackRepository media;
    private final ObjectStorage storage;
    private final Clock clock;

    public PlaybackService(ArchiveAuthorization authorization, PlaybackRepository media, ObjectStorage storage, Clock clock) {
        this.authorization = authorization;
        this.media = media;
        this.storage = storage;
        this.clock = clock;
    }

    public ObjectStorage.ReadGrant playback(UUID memoryId) {
        authorization.requireCoupleAccess();
        var asset = media.findPlayable(memoryId).orElseThrow(PlaybackService::notFound);
        requireVerifiedOriginal(asset);
        return storage.authorizeRead(asset.objectKey(), asset.contentType(), asset.byteSize(), clock.instant().plus(LINK_LIFETIME));
    }

    /** Shared playback uses the same verified-original boundary as the couple's private viewer. */
    public static void requireVerifiedOriginal(PlaybackRepository.PlayableMedia asset) {
        // Recheck the key/type boundary here so an alternate repository cannot broaden storage scope.
        if (asset.assetId() == null || !("originals/" + asset.assetId()).equals(asset.objectKey())
                || !MediaTypes.validTypeAndSize(asset.contentType(), asset.byteSize())
                || !("PHOTO".equals(asset.memoryType()) && MediaTypes.PHOTO_TYPES.contains(asset.contentType())
                    && asset.durationMs() == null && asset.container() == null && asset.codec() == null
                    || "AUDIO".equals(asset.memoryType()) && asset.durationMs() != null
                        && MediaTypes.audioMetadataMatches(asset.contentType(), asset.container(), asset.codec(), asset.durationMs()))) throw notFound();
    }

    private static ApiException notFound() {
        return new ApiException(404, "NOT_FOUND", "That media is unavailable.");
    }
}
