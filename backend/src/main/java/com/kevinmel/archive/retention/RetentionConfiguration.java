package com.kevinmel.archive.retention;

import java.util.UUID;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.media.R2ObjectStorage;

@Configuration
public class RetentionConfiguration {
    @Bean DeletionStorage deletionStorage(ObjectStorage storage) { return adapt(storage); }

    static DeletionStorage adapt(ObjectStorage storage) {
        return new DeletionStorage() {
            private R2ObjectStorage privateStore() {
                if (!(storage instanceof R2ObjectStorage r2)) throw new IllegalStateException("Private deletion storage is unavailable.");
                return r2;
            }
            public void record(DeletionRecord record) { privateStore().recordDeletion(record); }
            public Page ledger(String cursor, int limit) { return privateStore().deletionLedger(cursor, limit); }
            public void deleteOriginal(UUID id) { privateStore().deleteRetainedOriginal(id); }
            public void deleteStaging(UUID id) { privateStore().deleteRetainedStaging(id); }
        };
    }

    @Configuration
    @EnableScheduling
    @ConditionalOnProperty(name = "archive.retention.enabled", havingValue = "true")
    static class ScheduledRetention {
        private final RetentionService service;
        private final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ScheduledRetention.class);
        ScheduledRetention(RetentionService service, ObjectStorage storage,
                @org.springframework.beans.factory.annotation.Value("${archive.retention.interval-ms:300000}") long interval) {
            if (!(storage instanceof R2ObjectStorage)) throw new IllegalStateException("Enabled retention requires private R2 storage.");
            if (interval < 60_000 || interval > 86_400_000) throw new IllegalStateException("Retention interval must be between one minute and one day.");
            this.service = service;
        }

        @Scheduled(fixedDelayString = "${archive.retention.interval-ms:300000}", initialDelayString = "${archive.retention.interval-ms:300000}")
        void purgeExpired() {
            try {
                var result = service.purgeBatch(20);
                if (result.failed() > 0) log.warn("Retention maintenance has {} unconfirmed items; retry is required.", result.failed());
            } catch (RuntimeException failure) { log.warn("Retention maintenance is unconfirmed; check private operations readiness."); }
        }
    }
}
