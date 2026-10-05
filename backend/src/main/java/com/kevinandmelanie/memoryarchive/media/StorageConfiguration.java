package com.kevinandmelanie.memoryarchive.media;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.kevinandmelanie.memoryarchive.web.ApiException;

@Configuration
public class StorageConfiguration {
    @Bean
    @ConditionalOnMissingBean(Clock.class)
    Clock archiveClock() { return Clock.systemUTC(); }

    @Bean
    @ConditionalOnProperty(name = "archive.storage.enabled", havingValue = "false", matchIfMissing = true)
    ObjectStorage disabledStorage() {
        return new ObjectStorage() {
            public void requireAvailable() { throw unavailable(); }
            public UploadGrant authorize(UUID id, String key, String type, Instant expiry) { throw unavailable(); }
            public Optional<byte[]> read(String key, int max) { throw unavailable(); }
            public void publish(String key, byte[] bytes, String type) { throw unavailable(); }
        };
    }

    static ApiException unavailable() {
        return new ApiException(503, "MEDIA_UNAVAILABLE", "Photo storage is unavailable. Keep your photo and try again later.");
    }
}
