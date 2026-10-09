package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.net.*;
import java.net.http.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"archive.audio.enabled=true", "archive.revealed=true"})
@Import(AudioHttpTest.Fixtures.class)
class AudioHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired FakeStorage storage;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired PhotoRepository photos;
    @Autowired PhotoFinalizer finalizer;
    @Autowired MediaService media;
    @Autowired ContributionRepository contributions;
    @Autowired InboxRepository inbox;
    @Autowired PlaybackRepository playback;
    @Autowired PasswordEncoder encoder;
    @Autowired PlatformTransactionManager transactions;
    HttpClient client;

    @BeforeEach void reset() {
        storage.objects.clear(); storage.outage = false; storage.publishes = 0;
        clock.now = Instant.parse("2026-10-09T12:00:00Z");
        client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
    }
    HttpResponse<String> send(String method, String path, String key, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(60))
                .header("X-Api-Contract", "1").header("Content-Type", "application/json");
        if (key != null) request.header("Idempotency-Key", key);
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    static Map<String, Object> metadata(byte[] bytes, String type, double duration) throws Exception {
        return Map.of("memoryType", "AUDIO", "guestName", " Synthetic Guest ", "items", List.of(Map.of(
                "clientItemId", UUID.randomUUID().toString(), "originalFilename", "voice.webm", "declaredContentType", type,
                "byteSize", bytes.length, "checksumSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)),
                "durationSeconds", duration, "caption", " Private voice caption ")));
    }
    String text(HttpResponse<String> response, String path) { return JsonPath.read(response.body(), path); }
    String path(HttpResponse<String> receipt) {
        return "/api/contributions/" + text(receipt, "$.contributionId") + "/memories/" + text(receipt, "$.memories[0].memoryId");
    }
    HttpResponse<String> create(String key, Map<String, Object> body) throws Exception { return send("POST", "/api/contributions", key, JSON.writeValueAsString(body)); }
    HttpResponse<String> grant(String path, String key) throws Exception { return send("POST", path + "/upload-grants", key, null); }
    HttpResponse<String> finish(String path, String key, HttpResponse<String> grant) throws Exception {
        return send("POST", path + "/finalize", key, "{\"grantId\":\"" + text(grant, "$.grantId") + "\"}");
    }
    void stage(HttpResponse<String> grant, byte[] bytes) { storage.objects.put("staging/" + text(grant, "$.grantId"), bytes.clone()); }

    @Test void canonicalContainersPreserveOriginalsAndServerDurationThroughRetry() throws Exception {
        for (String type : List.of("audio/webm", "audio/ogg", "audio/mp4")) {
            byte[] bytes = AudioFixtures.audio(type, .35);
            String key = UUID.randomUUID().toString(); var body = metadata(bytes, type, 10);
            var receipt = create(key, body);
            assertThat(receipt.statusCode()).isEqualTo(201);
            assertThat(text(receipt, "$.completion")).isEqualTo("PENDING");
            assertThat(receipt.body()).doesNotContain("caption", "filename", "objectKey", "duration", "Guest", key);
            assertThat(create(key.toUpperCase(), body).body()).isEqualTo(receipt.body());
            var changedClaim = new HashMap<>(body);
            @SuppressWarnings("unchecked") var changedItem = new HashMap<>((Map<String, Object>) ((List<?>) body.get("items")).getFirst());
            changedItem.put("durationSeconds", 10.5); changedClaim.put("items", List.of(changedItem));
            assertThat(create(key, changedClaim).statusCode()).isEqualTo(409);
            assertThat(send("POST", "/api/contributions", key, "{\"message\":\"A different kind of memory\"}").statusCode()).isEqualTo(409);
            String path = path(receipt); var grant = grant(path, key);
            assertThat(grant.statusCode()).isEqualTo(201);
            assertThat(text(grant, "$.headers['Content-Type']")).isEqualTo(type);
            assertThat(finish(path, key, grant).statusCode()).isEqualTo(409);
            stage(grant, bytes); var done = finish(path, key, grant);
            assertThat(done.statusCode()).isEqualTo(200); assertThat(text(done, "$.completion")).isEqualTo("COMPLETE");
            UUID memory = UUID.fromString(text(receipt, "$.memories[0].memoryId"));
            var detail = inbox.detail(memory).orElseThrow();
            assertThat(detail.memoryType()).isEqualTo("AUDIO");
            assertThat(detail.media().durationSeconds()).isBetween(.3, .5);
            assertThat(detail.caption()).isEqualTo("Private voice caption");
            assertThat(db.sql("SELECT expected_duration_ms FROM media_asset WHERE memory_id=:id").param("id", memory).query(Long.class).single()).isEqualTo(10_000);
            String originalKey = playback.findPlayable(memory).orElseThrow().objectKey();
            assertThat(storage.objects.get(originalKey)).isEqualTo(bytes);
            stage(grant, new byte[]{1, 2, 3}); clock.now = clock.now.plusSeconds(301);
            assertThat(finish(path, key, grant).body()).isEqualTo(done.body());
            assertThat(storage.objects.get(originalKey)).isEqualTo(bytes);
            assertThat(grant(path, key).statusCode()).isEqualTo(409);
            assertThat(create(key, body).body()).isEqualTo(done.body());
        }
        assertThat(storage.publishes).isEqualTo(3);
    }

    @Test void failedIntegrityDoesNotPublishAndSameItemCanRecover() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/webm", .25);
        String key = UUID.randomUUID().toString(); var receipt = create(key, metadata(bytes, "audio/webm", .25));
        String path = path(receipt); var grant = grant(path, key); stage(grant, new byte[bytes.length]);
        assertThat(finish(path, key, grant).statusCode()).isEqualTo(422);
        var failed = send("GET", "/api/contributions/" + text(receipt, "$.contributionId") + "/receipt", key, null);
        assertThat(text(failed, "$.memories[0].uploadState")).isEqualTo("FAILED");
        assertThat(storage.objects.keySet()).noneMatch(k -> k.startsWith("originals/"));
        UUID memory = UUID.fromString(text(receipt, "$.memories[0].memoryId"));
        assertThat(inbox.detail(memory)).isEmpty(); assertThat(playback.findPlayable(memory)).isEmpty();
        stage(grant, bytes); assertThat(text(finish(path, key, grant), "$.completion")).isEqualTo("COMPLETE");
        assertThat(storage.publishes).isEqualTo(1);
    }

    @Test void audioCommitFailureRollsBackVerificationAndExactOriginalRetryRecovers() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/webm", .25);
        String key = UUID.randomUUID().toString(); var receipt = create(key, metadata(bytes, "audio/webm", .25));
        String path = path(receipt); var grant = grant(path, key); stage(grant, bytes);
        db.sql("CREATE FUNCTION reject_audio_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.audio_duration_ms IS NOT NULL THEN RAISE EXCEPTION 'synthetic private commit detail'; END IF; RETURN NEW; END $$").update();
        db.sql("CREATE CONSTRAINT TRIGGER reject_audio_commit AFTER UPDATE ON media_asset DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_audio_commit()").update();
        try {
            var failure = finish(path, key, grant);
            assertThat(failure.statusCode()).isEqualTo(503); assertThat(failure.body()).doesNotContain("synthetic private commit", "originals/", key);
            var pending = send("GET", "/api/contributions/" + text(receipt, "$.contributionId") + "/receipt", key, null);
            assertThat(text(pending, "$.completion")).isEqualTo("PENDING");
            assertThat(db.sql("SELECT count(*) FROM media_asset WHERE memory_id=:memory AND audio_duration_ms IS NOT NULL")
                    .param("memory", UUID.fromString(text(receipt, "$.memories[0].memoryId"))).query(Long.class).single()).isZero();
        } finally {
            db.sql("DROP TRIGGER reject_audio_commit ON media_asset").update(); db.sql("DROP FUNCTION reject_audio_commit()").update();
        }
        assertThat(text(finish(path, key, grant), "$.completion")).isEqualTo("COMPLETE");
        assertThat(storage.objects.entrySet().stream().filter(e -> e.getKey().startsWith("originals/")).map(Map.Entry::getValue).toList())
                .hasSize(1).allMatch(saved -> Arrays.equals(saved, bytes));
    }

    @Test void unavailableStorageKeepsPendingAndConcurrentFinalizePublishesOnce() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/ogg", .25);
        String key = UUID.randomUUID().toString(); var receipt = create(key, metadata(bytes, "audio/ogg", .25));
        String path = path(receipt); var grant = grant(path, key); stage(grant, bytes); storage.outage = true;
        var unavailable = finish(path, key, grant);
        assertThat(unavailable.statusCode()).isEqualTo(503); assertThat(unavailable.body()).doesNotContain("staging/", key);
        assertThat(text(send("GET", "/api/contributions/" + text(receipt, "$.contributionId") + "/receipt", key, null), "$.completion")).isEqualTo("PENDING");
        storage.outage = false;
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> finish(path, key, grant)); var second = executor.submit(() -> finish(path, key, grant));
            assertThat(first.get(60, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(second.get(60, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        }
        assertThat(storage.publishes).isEqualTo(1);
    }

    @Test void gateAndCapacityShareReservationRulesWithoutLosingCommittedRecovery() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/webm", .25);
        var body = metadata(bytes, "audio/webm", .25);
        var request = AudioRequest.from(body);
        String key = UUID.randomUUID().toString();
        var receipt = photos.create(request, key, true).receipt();
        var off = new MediaService(photos, finalizer, storage, clock, 2, false);
        assertThat(off.create(body, key).created()).isFalse();
        String refusedKey = UUID.randomUUID().toString();
        assertThatThrownBy(() -> off.create(body, refusedKey)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status()).isEqualTo(503); assertThat(e.code()).isEqualTo("MEDIA_UNAVAILABLE");
            assertThat(e.retryAfterSeconds()).isEqualTo(60);
        });
        assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", refusedKey).query(Long.class).single()).isZero();
        UUID contribution = receipt.contributionId(), memory = receipt.memories().getFirst().memoryId();
        var transaction = new TransactionTemplate(transactions);
        assertThatThrownBy(() -> transaction.execute(status -> off.authorize(contribution, memory, key)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        var grant = media.authorize(contribution, memory, key);
        assertThat(transaction.execute(status -> off.authorize(contribution, memory, key)).grantId()).isEqualTo(grant.grantId());
        storage.objects.put("staging/" + grant.grantId(), bytes);
        assertThat(off.finalizeUpload(contribution, memory, key, Map.of("grantId", grant.grantId().toString())).completion()).isEqualTo("COMPLETE");

        long reserved = db.sql("""
                SELECT COALESCE(SUM(COALESCE(a.expected_byte_size,a.byte_size)),0)::bigint
                FROM media_asset a JOIN memory m ON m.id=a.memory_id WHERE m.purged_at IS NULL
                """).query(Long.class).single();
        var full = new PhotoRepository(db, contributions, clock, new PhotoAdmissionPolicy(false, reserved, Long.MAX_VALUE));
        assertThatThrownBy(() -> transaction.execute(status -> full.create(request, UUID.randomUUID().toString(), true)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        var photo = new PhotoRequest(null, List.of(new PhotoRequest.Item(UUID.randomUUID(), "photo.png", "image/png", 1, "0".repeat(64), null)));
        assertThatThrownBy(() -> transaction.execute(status -> full.create(photo, UUID.randomUUID().toString())))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        assertThat(transaction.execute(status -> full.create(request, key, false)).created()).isFalse();
    }

    @Test void actualCoupleSessionReviewsAndPlaysOnlyVerifiedAudio() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/mp4", .3);
        String key = UUID.randomUUID().toString(); var pending = create(key, metadata(bytes, "audio/mp4", .3));
        String memory = text(pending, "$.memories[0].memoryId"), path = path(pending); var grant = grant(path, key);
        assertThat(send("GET", "/api/memories/" + memory, null, null).statusCode()).isEqualTo(401);
        UUID account = UUID.randomUUID(); String username = "synthetic-audio-" + account, password = "synthetic-audio-password";
        db.sql("""
                INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version)
                VALUES(:id,:username,'Synthetic Audio Couple',:hash,'COUPLE',true,1)
                """).param("id", account).param("username", username).param("hash", encoder.encode(password)).update();
        String csrf = text(send("GET", "/api/session", null, null), "$.csrfToken");
        var login = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session"))
                .header("X-Api-Contract", "1").header("X-CSRF-Token", csrf).header("Origin", "http://localhost:" + port)
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(
                        Map.of("username", username, "password", password)))).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(login.statusCode()).isEqualTo(200); csrf = text(login, "$.csrfToken");
        assertThat(send("GET", "/api/memories/" + memory, null, null).statusCode()).isEqualTo(404);
        stage(grant, bytes); assertThat(finish(path, key, grant).statusCode()).isEqualTo(200);
        var detail = send("GET", "/api/memories/" + memory, null, null);
        assertThat(detail.statusCode()).isEqualTo(200); assertThat(detail.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(detail.body()).doesNotContain(key, "originals/", "uploadUrl");
        assertThat(send("GET", "/api/memories/" + memory + "/playback", null, null).statusCode()).isEqualTo(200);
        int revision = 1;
        for (String review : List.of("KEEP", "ARCHIVED", "DELETE", "PENDING")) {
            var changed = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/memories/" + memory + "/review"))
                    .header("X-Api-Contract", "1").header("X-CSRF-Token", csrf).header("Origin", "http://localhost:" + port)
                    .header("If-Match", "\"" + revision++ + "\"").header("Content-Type", "application/json")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(Map.of("reviewStatus", review)))).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(changed.statusCode()).isEqualTo(200);
            assertThat(text(changed, "$.visibility")).isEqualTo("COUPLE_ONLY");
            assertThat(send("GET", "/api/memories/" + memory + "/playback", null, null).statusCode()).isEqualTo(review.equals("DELETE") ? 404 : 200);
        }
        db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id", account).update();
        assertThat(send("GET", "/api/memories/" + memory + "/playback", null, null).statusCode()).isEqualTo(401);
    }

    @TestConfiguration static class Fixtures {
        @Bean @Primary FakeStorage fakeStorage() { return new FakeStorage(); }
        @Bean @Primary PhotoHttpTest.MutableClock mutableClock() { return new PhotoHttpTest.MutableClock(); }
    }
    static class FakeStorage extends PhotoHttpTest.FakeStorage {
        @Override public ReadGrant authorizeRead(String key, String type, long size, Instant expires) {
            requireAvailable();
            byte[] bytes = objects.get(key);
            if (bytes == null || bytes.length != size || !MediaTypes.validTypeAndSize(type, size)) throw StorageConfiguration.privateMediaUnavailable();
            return new ReadGrant("https://private.example.test/" + key, expires);
        }
    }
}
