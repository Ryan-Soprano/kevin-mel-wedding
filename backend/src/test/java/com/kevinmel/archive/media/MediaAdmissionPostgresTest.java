package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Real PostgreSQL reservations; only this class's disposable test database is reset. */
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = {"archive.media.max-original-bytes=100", "archive.media.max-staging-bytes=100"})
@Import(PhotoHttpTest.Fixtures.class)
class MediaAdmissionPostgresTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @Autowired JdbcClient db;
    @Autowired PhotoRepository photos;
    @Autowired ContributionRepository contributions;
    @Autowired PlatformTransactionManager manager;
    @Autowired Clock clock;
    @Autowired PhotoFinalizer finalizer;
    @Autowired ObjectStorage storage;

    @BeforeEach void resetDisposableDatabase() { db.sql("TRUNCATE contribution CASCADE").update(); }

    PhotoRequest request(int bytes) {
        return new PhotoRequest(null, List.of(new PhotoRequest.Item(UUID.randomUUID(), "fixture.png", "image/png",
                bytes, "0".repeat(64), null)));
    }
    PhotoRepository.Saved create(PhotoRepository repository, PhotoRequest body, String key) {
        return new TransactionTemplate(manager).execute(status -> repository.create(body, key));
    }
    MediaService pausedService() {
        var paused = new PhotoRepository(db, contributions, clock, new PhotoAdmissionPolicy(true, 100, 100));
        return new MediaService(paused, finalizer, storage, clock, 2);
    }
    ObjectStorage.UploadGrant grant(MediaService service, PhotoRepository.Saved saved, String key) {
        return new TransactionTemplate(manager).execute(status -> service.authorize(saved.receipt().contributionId(),
                saved.receipt().memories().getFirst().memoryId(), key));
    }
    void assertUnavailable(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ApiException.class, failure -> {
            assertThat(failure.status()).isEqualTo(503);
            assertThat(failure.code()).isEqualTo("MEDIA_UNAVAILABLE");
            assertThat(failure.retryAfterSeconds()).isEqualTo(60);
            var response = new ApiExceptionHandler().handleApi(failure, new MockHttpServletRequest());
            assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("60");
            assertThat(response.getHeaders().getFirst("Cache-Control")).isEqualTo("no-store");
        });
    }

    @Test void unfinishedAndDeletedReservationsCountWhileReplayDoesNotDoubleCount() {
        String key = UUID.randomUUID().toString(); var body = request(100);
        var saved = create(photos, body, key);
        assertThat(create(photos, body, key).receipt().contributionId()).isEqualTo(saved.receipt().contributionId());
        assertUnavailable(() -> create(photos, request(1), UUID.randomUUID().toString()));
        db.sql("UPDATE memory SET review_status='DELETE', delete_after=CURRENT_TIMESTAMP + INTERVAL '30 days'").update();
        assertUnavailable(() -> create(photos, request(1), UUID.randomUUID().toString()));
        assertThat(db.sql("SELECT COUNT(*) FROM contribution").query(Long.class).single()).isEqualTo(1);
        // Once confirmed purge has removed content, its original reservation can be released.
        db.sql("UPDATE memory SET purged_at=CURRENT_TIMESTAMP, text_content=NULL, caption=NULL").update();
        assertThat(create(photos, request(1), UUID.randomUUID().toString()).created()).isTrue();
    }

    @Test void independentConcurrentCreatesCannotOverbookTheLastOriginalBytes() throws Exception {
        try (var executor = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2); var start = new CountDownLatch(1);
            var tasks = java.util.stream.IntStream.range(0, 2).mapToObj(index -> executor.submit(() -> {
                ready.countDown(); assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
                try { create(photos, request(60), UUID.randomUUID().toString()); return "saved"; }
                catch (ApiException failure) { return failure.code(); }
            })).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(tasks.get(0).get(15, TimeUnit.SECONDS), tasks.get(1).get(15, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("saved", "MEDIA_UNAVAILABLE");
            assertThat(db.sql("SELECT SUM(expected_byte_size) FROM media_asset").query(Long.class).single()).isEqualTo(60);
        }
    }

    @Test void pauseRejectsNewIntentsAndGrantsButKeepsExistingIdentityAndText() {
        String key = UUID.randomUUID().toString(); var body = request(40); var saved = create(photos, body, key);
        var paused = new PhotoRepository(db, contributions, clock, new PhotoAdmissionPolicy(true, 100, 100));
        assertThat(create(paused, body, key).created()).isFalse();
        assertUnavailable(() -> create(paused, request(1), UUID.randomUUID().toString()));
        assertUnavailable(() -> grant(pausedService(), saved, key));
        assertThat(new TransactionTemplate(manager).execute(status -> contributions.saveTextContribution(
                "kevin-mel-wedding", null, "Text remains available", UUID.randomUUID().toString())).contributionId()).isNotNull();
        assertThat(contributions.getReceipt(saved.receipt().contributionId(), key).completion()).isEqualTo("PENDING");
    }

    @Test void livePermissionIsReusedAndExpiredReservationsDoNotSilentlyReleaseStagingBudget() {
        String key = UUID.randomUUID().toString(); var saved = create(photos, request(60), key);
        var service = new MediaService(photos, finalizer, storage, clock, 2);
        var first = grant(service, saved, key); var retry = grant(service, saved, key);
        assertThat(retry.grantId()).isEqualTo(first.grantId());
        assertThat(grant(pausedService(), saved, key).grantId()).isEqualTo(first.grantId());
        assertThat(retry.expiresAt()).isEqualTo(first.expiresAt());
        assertThat(db.sql("SELECT COUNT(*) FROM upload_grant").query(Long.class).single()).isEqualTo(1);
        db.sql("UPDATE upload_grant SET created_at=:created, expires_at=:expired")
                .param("created", java.time.OffsetDateTime.ofInstant(clock.instant().minusSeconds(600), java.time.ZoneOffset.UTC))
                .param("expired", java.time.OffsetDateTime.ofInstant(clock.instant().minusSeconds(300), java.time.ZoneOffset.UTC)).update();
        assertUnavailable(() -> grant(service, saved, key));
        assertThat(db.sql("SELECT COUNT(*) FROM upload_grant").query(Long.class).single()).isEqualTo(1);
    }

    @Test void concurrentDifferentAssetGrantsCannotOverbookStaging() throws Exception {
        var repository = new PhotoRepository(db, contributions, clock, new PhotoAdmissionPolicy(false, 200, 100));
        var service = new MediaService(repository, finalizer, storage, clock, 2);
        String firstKey = UUID.randomUUID().toString(), secondKey = UUID.randomUUID().toString();
        var first = create(repository, request(60), firstKey);
        var second = create(repository, request(60), secondKey);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2); var start = new CountDownLatch(1);
            var tasks = java.util.stream.IntStream.range(0, 2).mapToObj(index -> executor.submit(() -> {
                ready.countDown(); assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
                try { grant(service, index == 0 ? first : second, index == 0 ? firstKey : secondKey); return "granted"; }
                catch (ApiException failure) { return failure.code(); }
            })).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(tasks.get(0).get(15, TimeUnit.SECONDS), tasks.get(1).get(15, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("granted", "MEDIA_UNAVAILABLE");
            assertThat(db.sql("SELECT COUNT(*) FROM upload_grant").query(Long.class).single()).isEqualTo(1);
        }
    }
}
