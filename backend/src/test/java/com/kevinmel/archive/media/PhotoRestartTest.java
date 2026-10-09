package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.*;
import java.security.MessageDigest;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import com.kevinmel.archive.MemoryArchiveApplication;
import com.kevinmel.archive.contribution.ContributionRepository;

@Testcontainers
class PhotoRestartTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    static final PhotoHttpTest.FakeStorage externalStorage = new PhotoHttpTest.FakeStorage();
    @TestConfiguration static class Storage {
        @Bean @Primary ObjectStorage fixtureStorage() { return externalStorage; }
    }
    org.springframework.context.ConfigurableApplicationContext start() {
        return start(false);
    }
    org.springframework.context.ConfigurableApplicationContext start(boolean uploadsPaused) {
        return new SpringApplicationBuilder(MemoryArchiveApplication.class, Storage.class).run("--server.port=0",
                "--archive.media.uploads-paused=" + uploadsPaused,
                "--spring.datasource.url=" + postgres.getJdbcUrl(), "--spring.datasource.username=" + postgres.getUsername(),
                "--spring.datasource.password=" + postgres.getPassword());
    }
    @Test void pendingGrantAndCompletedOriginalSurviveApplicationRestart() throws Exception {
        externalStorage.objects.clear(); externalStorage.outage = false;
        var output = new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", output);
        byte[] bytes = output.toByteArray(); String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        String key = UUID.randomUUID().toString();
        Map<String, Object> body = Map.of("memoryType", "PHOTO", "items", List.of(Map.of("clientItemId", UUID.randomUUID().toString(),
                "originalFilename", "restart.png", "declaredContentType", "image/png", "byteSize", bytes.length, "checksumSha256", hash)));
        UUID contribution, memory, grant;
        try (var first = start()) {
            var service = first.getBean(MediaService.class); var saved = service.create(body, key).receipt();
            contribution = saved.contributionId(); memory = saved.memories().getFirst().memoryId();
            grant = service.authorize(contribution, memory, key).grantId();
            externalStorage.objects.put("staging/" + grant, bytes);
        }
        try (var second = start(true)) {
            var service = second.getBean(MediaService.class);
            var done = service.finalizeUpload(contribution, memory, key, Map.of("grantId", grant.toString()));
            assertThat(done.completion()).isEqualTo("COMPLETE");
        }
        try (var third = start()) {
            assertThat(third.getBean(ContributionRepository.class).getReceipt(contribution, key).completion()).isEqualTo("COMPLETE");
            var replay = third.getBean(MediaService.class).create(body, key);
            assertThat(replay.created()).isFalse(); assertThat(replay.receipt().contributionId()).isEqualTo(contribution);
            assertThat(externalStorage.objects.entrySet().stream().filter(e -> e.getKey().startsWith("originals/")).map(Map.Entry::getValue).toList()).hasSize(1).allMatch(value -> Arrays.equals(value, bytes));
        }
    }
}
