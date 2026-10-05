package com.kevinandmelanie.memoryarchive.media;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(name = "archive.storage.enabled", havingValue = "true")
public class R2StorageConfiguration {
    @Bean(destroyMethod = "close")
    R2ObjectStorage r2Storage(
            @Value("${archive.storage.endpoint:}") String endpoint,
            @Value("${archive.storage.bucket:}") String bucket,
            @Value("${archive.storage.access-key-id:}") String access,
            @Value("${archive.storage.secret-access-key:}") String secret) {
        if (!endpoint.matches("https://[0-9a-f]{32}\\.r2\\.cloudflarestorage\\.com")
                || !bucket.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]") || access.isBlank() || secret.isBlank()) {
            throw new IllegalStateException("Enabled photo storage requires a private R2 endpoint, bucket, and server credentials.");
        }
        return new R2ObjectStorage(URI.create(endpoint), bucket, access, secret);
    }
}
