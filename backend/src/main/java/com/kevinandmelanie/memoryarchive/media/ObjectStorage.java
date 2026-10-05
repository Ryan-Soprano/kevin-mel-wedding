package com.kevinandmelanie.memoryarchive.media;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Only the server can publish a verified original; browser grants target staging keys. */
public interface ObjectStorage {
    void requireAvailable();
    UploadGrant authorize(UUID grantId, String stagingKey, String contentType, Instant expiresAt);
    Optional<byte[]> read(String objectKey, int maxBytes);
    void publish(String originalKey, byte[] bytes, String contentType);

    record UploadGrant(UUID grantId, String method, String uploadUrl, Instant expiresAt, Map<String, String> headers) {}
}
