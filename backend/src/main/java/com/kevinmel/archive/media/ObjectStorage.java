package com.kevinmel.archive.media;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Only the server can publish a verified original; browser grants target staging keys. */
public interface ObjectStorage {
    void requireAvailable();
    UploadGrant authorize(UUID grantId, String stagingKey, String contentType, long byteSize, Instant expiresAt);
    ReadGrant authorizeRead(String originalKey, String contentType, long byteSize, Instant expiresAt);
    Optional<byte[]> read(String objectKey, int maxBytes);
    void publish(String originalKey, byte[] bytes, String contentType);

    record UploadGrant(UUID grantId, String method, String uploadUrl, Instant expiresAt, Map<String, String> headers) {
        @Override public String toString() {
            return "UploadGrant[grantId=" + grantId + ", uploadUrl=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }

    record ReadGrant(String url, Instant expiresAt) {
        @Override public String toString() {
            return "ReadGrant[url=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }
}
