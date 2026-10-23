package com.kevinmel.archive.media;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.kevinmel.archive.web.ApiException;

@Configuration
public class StorageConfiguration {
    @Bean
    @ConditionalOnMissingBean(Clock.class)
    Clock archiveClock() {
        return Clock.systemUTC();
    }

    @Bean
    @ConditionalOnProperty(name = "archive.storage.enabled", havingValue = "false", matchIfMissing = true)
    ObjectStorage disabledStorage() {
        return new ObjectStorage() {
            public void requireAvailable() {
                throw ApiException.expectedUnavailable(
                        "Photo storage is unavailable. Keep your photo and try again later.", 0);
            }

            public UploadGrant authorize(
                    UUID id,
                    String key,
                    String type,
                    long byteSize,
                    Instant expiry) {
                throw unavailable();
            }

            public ReadGrant authorizeRead(
                    String key,
                    String type,
                    long size,
                    Instant expiry) {
                throw privateMediaUnavailable();
            }

            public Optional<byte[]> read(
                    String key,
                    int max) {
                throw unavailable();
            }

            public void publish(
                    String key,
                    byte[] bytes,
                    String type) {
                throw unavailable();
            }
        };
    }

    static ApiException unavailable() {
        return new ApiException(
                503,
                "MEDIA_UNAVAILABLE",
                "Photo storage is unavailable. Keep your photo and try again later.");
    }

    static ApiException privateMediaUnavailable() {
        return new ApiException(
                503,
                "MEDIA_UNAVAILABLE",
                "The saved memory is temporarily unavailable. Please try again later.");
    }
}
