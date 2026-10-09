package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import com.kevinmel.archive.MemoryArchiveApplication;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.review.InboxRepository;

@Testcontainers
class AudioRestartTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    static final AudioHttpTest.FakeStorage externalStorage = new AudioHttpTest.FakeStorage();
    @TestConfiguration static class Storage {
        @Bean @Primary ObjectStorage fixtureStorage() { return externalStorage; }
    }
    org.springframework.context.ConfigurableApplicationContext start(boolean enabled) {
        return new SpringApplicationBuilder(MemoryArchiveApplication.class, Storage.class).run("--server.port=0",
                "--archive.audio.enabled=" + enabled, "--archive.media.uploads-paused=" + !enabled,
                "--spring.datasource.url=" + postgres.getJdbcUrl(), "--spring.datasource.username=" + postgres.getUsername(),
                "--spring.datasource.password=" + postgres.getPassword());
    }
    @Test void pendingPermissionFinalizesAfterRestartWithAudioAdmissionAndUploadsClosed() throws Exception {
        externalStorage.objects.clear(); externalStorage.outage = false;
        byte[] bytes = AudioFixtures.audio("audio/webm", .25);
        var body = AudioHttpTest.metadata(bytes, "audio/webm", 30);
        String key = UUID.randomUUID().toString(); UUID contribution, memory, grant;
        try (var first = start(true)) {
            var service = first.getBean(MediaService.class); var receipt = service.create(body, key).receipt();
            contribution = receipt.contributionId(); memory = receipt.memories().getFirst().memoryId();
            grant = service.authorize(contribution, memory, key).grantId(); externalStorage.objects.put("staging/" + grant, bytes);
        }
        try (var second = start(false)) {
            var service = second.getBean(MediaService.class);
            assertThat(service.authorize(contribution, memory, key).grantId()).isEqualTo(grant);
            assertThat(service.finalizeUpload(contribution, memory, key, Map.of("grantId", grant.toString())).completion()).isEqualTo("COMPLETE");
        }
        try (var third = start(false)) {
            assertThat(third.getBean(ContributionRepository.class).getReceipt(contribution, key).completion()).isEqualTo("COMPLETE");
            assertThat(third.getBean(MediaService.class).create(body, key).created()).isFalse();
            assertThat(third.getBean(InboxRepository.class).detail(memory).orElseThrow().media().durationSeconds()).isBetween(.2, .4);
            assertThat(externalStorage.objects.entrySet().stream().filter(e -> e.getKey().startsWith("originals/")).map(Map.Entry::getValue).toList())
                    .hasSize(1).allMatch(saved -> Arrays.equals(saved, bytes));
        }
    }
}
