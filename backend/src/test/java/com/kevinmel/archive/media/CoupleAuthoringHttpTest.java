package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import javax.sql.DataSource;

import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.retention.RetentionRepository;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.contribution.ContributionScope;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Real session/HTTP/database boundaries and verified synthetic media. No provider, device or browser claim. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "archive.environment=local", "spring.profiles.active=local", "archive.audio.enabled=true",
        "archive.revealed=true", "archive.storage.enabled=false", "archive.media.uploads-paused=false",
        "archive.retention.enabled=false"})
@Import(CoupleAuthoringHttpTest.Fixtures.class)
class CoupleAuthoringHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String PASSWORD = "synthetic-couple-authoring-password";
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired DataSource dataSource;
    @Autowired PasswordEncoder encoder;
    @Autowired ControlledStorage storage;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired RetentionRepository retention;
    @Autowired ContributionRepository contributions;
    @Autowired PhotoRepository photos;
    @Autowired PlatformTransactionManager transactions;
    private final HttpClient guest = HttpClient.newHttpClient();
    private Session couple;
    private byte[] photo;
    private final Map<HttpResponse<String>, String> retryKeys = new java.util.IdentityHashMap<>();

    @BeforeEach void isolatedFixtures() throws Exception {
        db.sql("TRUNCATE contribution, archive_account CASCADE").update();
        storage.objects.clear(); storage.outage = false; storage.publishes = 0; storage.signings = 0; storage.afterRead = null;
        retryKeys.clear();
        clock.now = Instant.parse("2026-10-09T12:00:00Z");
        couple = login("COUPLE");
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB), "png", bytes);
        photo = bytes.toByteArray();
    }

    @Test void retriesAreActorBoundConcurrentAndSeparateFromGuestCapabilities() throws Exception {
        String key = UUID.randomUUID().toString(), body = JSON.writeValueAsString(Map.of("message", "Original private note"));
        List<HttpResponse<String>> responses = new ArrayList<>();
        try (var workers = Executors.newFixedThreadPool(4)) {
            var futures = new ArrayList<java.util.concurrent.Future<HttpResponse<String>>>();
            for (int i = 0; i < 4; i++) futures.add(workers.submit(() -> post(couple, key, body)));
            for (var future : futures) responses.add(future.get(30, TimeUnit.SECONDS));
        }
        assertThat(responses.stream().map(HttpResponse::statusCode).toList()).containsExactlyInAnyOrder(201, 200, 200, 200);
        String id = value(responses.getFirst(), "$.contributionId"), memory = value(responses.getFirst(), "$.memories[0].memoryId");
        for (var response : responses) assertThat(value(response, "$.contributionId")).isEqualTo(id);
        // Thirteen same-key private calls must not consume the anonymous per-key allowance.
        for (int i = 0; i < 13; i++) assertThat(post(couple, key, body).statusCode()).isEqualTo(200);
        assertThat(post(couple, key, JSON.writeValueAsString(Map.of("message", "Changed payload"))).statusCode()).isEqualTo(409);
        assertThat(send(couple.client(), "GET", privateReceipt(id), key, null, Map.of()).statusCode()).isEqualTo(200);
        assertThat(send(guest, "GET", "/api/contributions/" + id + "/receipt", key, null, Map.of()).statusCode()).isEqualTo(404);
        var other = login("COUPLE");
        assertThat(send(other.client(), "GET", privateReceipt(id), key, null, Map.of()).statusCode()).isEqualTo(404);
        var otherReceipt = post(other, key, body);
        assertThat(otherReceipt.statusCode()).isEqualTo(201);
        assertThat(value(otherReceipt, "$.contributionId")).isNotEqualTo(id);
        var publicReceipt = send(guest, "POST", "/api/contributions", key, body, Map.of());
        assertThat(publicReceipt.statusCode()).isEqualTo(201);
        assertThat(value(publicReceipt, "$.contributionId")).isNotEqualTo(id);
        assertThat(value(publicReceipt, "$.memories[0].reviewStatus")).isEqualTo("PENDING");
        var detail = get(couple, "/api/memories/" + memory);
        assertThat(value(detail, "$.source")).isEqualTo("COUPLE");
        assertThat(value(detail, "$.reviewStatus")).isEqualTo("KEEP");
        assertThat(detail.body()).doesNotContain(couple.id().toString(), "authorAccountId", "author_account_id", "couple:", key);
        String internal = db.sql("SELECT idempotency_key FROM contribution WHERE id=:id").param("id", UUID.fromString(id)).query(String.class).single();
        assertThat(internal).matches("couple:[0-9a-f]{64}").doesNotContain(couple.id().toString());
        assertThat(send(guest, "GET", "/api/contributions/" + id + "/receipt", internal, null, Map.of()).statusCode()).isEqualTo(400);
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isEqualTo(3);
    }

    @Test void malformedUnauthorizedAndBoundedBodiesCreateNothing() throws Exception {
        for (String invalid : List.of("null", "", "{}", "{\"message\":\"ok\",\"title\":\"not initial metadata\"}",
                "{\"message\":\"ok\",\"guestName\":\"guest\"}", "{\"message\":\"ok\",\"guestName\":17}",
                "{\"message\":\"ok\",\"source\":\"COUPLE\"}")) {
            var response = post(couple, UUID.randomUUID().toString(), invalid);
            assertThat(response.statusCode()).as(invalid).isEqualTo(400);
            assertThat(value(response, "$.error.code")).isEqualTo("VALIDATION_FAILED");
        }
        String key = UUID.randomUUID().toString(), body = "{\"message\":\"Private fixture\"}";
        assertThat(send(guest, "POST", "/api/memories/contributions", key, body, Map.of()).statusCode()).isIn(401, 403);
        assertThat(send(couple.client(), "POST", "/api/memories/contributions", key, body, Map.of()).statusCode()).isEqualTo(403);
        assertThat(send(couple.client(), "POST", "/api/memories/contributions", key, body,
                Map.of("X-CSRF-Token", couple.csrf(), "Origin", "https://other.example.test")).statusCode()).isEqualTo(403);
        var operator = login("COUPLE");
        db.sql("UPDATE archive_account SET role='OPERATOR' WHERE id=:id").param("id", operator.id()).update();
        assertThat(post(operator, key, body).statusCode()).isEqualTo(401);
        assertThat(post(couple, key, " ".repeat(65_537)).statusCode()).isEqualTo(413);
        var chunked = request("POST", "/api/memories/contributions", key, Map.of("X-CSRF-Token", couple.csrf()))
                .method("POST", HttpRequest.BodyPublishers.ofInputStream(() -> new java.io.ByteArrayInputStream(new byte[65_537]))).build();
        assertThat(couple.client().send(chunked, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isZero();
        db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id", couple.id()).update();
        assertThat(post(couple, key, body).statusCode()).isIn(401, 403);
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isZero();
    }

    @Test void databaseRejectsInvalidSourceActorPairsAndPrivateGuestAttribution() {
        for (String shape : List.of("guest-with-actor", "couple-without-actor", "couple-with-guest-name", "couple-with-bare-key")) {
            String source = shape.equals("guest-with-actor") ? "GUEST" : "COUPLE";
            UUID author = shape.equals("couple-without-actor") ? null : couple.id();
            String name = shape.equals("couple-with-guest-name") ? "Invalid private guest attribution" : null;
            String key = source.equals("COUPLE") && !shape.equals("couple-with-bare-key") ? "couple:" + "1".repeat(64) : UUID.randomUUID().toString();
            assertThatThrownBy(() -> db.sql("""
                    INSERT INTO contribution(event_key, idempotency_key, source, author_account_id, guest_name)
                    VALUES('kevin-mel-wedding', :key, :source, :author, :name)
                    """).param("key", key).param("source", source)
                    .param("author", author).param("name", name).update())
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        }
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isZero();
    }

    @Test void metadataSharesReviewRevisionPreservesContentAndNormalizesPartialDates() throws Exception {
        var created = create(Map.of("message", "Original text remains immutable"));
        String id = memory(created, 0), path = "/api/memories/" + id;
        var before = get(couple, path);
        String originalCreated = value(before, "$.createdAt");
        var metadata = metadata("  Our memory\u00a0", "  Kept for later  ", "2024-02-29", "DAY");
        assertThat(edit(id, metadata, null).statusCode()).isEqualTo(428);
        var changed = edit(id, metadata, etag(before));
        assertThat(changed.statusCode()).isEqualTo(200);
        assertThat(value(changed, "$.title")).isEqualTo("Our memory");
        assertThat(value(changed, "$.description")).isEqualTo("Kept for later");
        assertThat(value(changed, "$.memoryDate")).isEqualTo("2024-02-29");
        assertThat(value(changed, "$.createdAt")).isEqualTo(originalCreated);
        assertThat(value(changed, "$.textContent")).isEqualTo("Original text remains immutable");
        assertThat(edit(id, metadata, etag(changed)).body()).isEqualTo(changed.body());
        assertThat(edit(id, metadata, etag(before)).statusCode()).isEqualTo(412);
        assertThat(value(edit(id, metadata, etag(before)), "$.error.code")).isEqualTo("METADATA_CONFLICT");
        assertThat(review(id, "ARCHIVED", etag(before)).statusCode()).isEqualTo(412);
        var reviewed = review(id, "ARCHIVED", etag(changed));
        assertThat(reviewed.statusCode()).isEqualTo(200);
        assertThat(edit(id, metadata(null, null, "2024-02", "MONTH"), etag(changed)).statusCode()).isEqualTo(412);
        var month = edit(id, metadata(null, null, "2024-02", "MONTH"), etag(reviewed));
        assertThat(month.statusCode()).isEqualTo(200);
        var year = edit(id, metadata(null, null, "2024", "YEAR"), etag(month));
        assertThat(year.statusCode()).isEqualTo(200);
        var unknown = edit(id, metadata(" \u3000", "\t", null, "UNKNOWN"), etag(year));
        assertThat(unknown.statusCode()).isEqualTo(200);
        assertThat((Object) JsonPath.read(unknown.body(), "$.title")).isNull();
        assertThat((Object) JsonPath.read(unknown.body(), "$.memoryDate")).isNull();
        assertThat(value(unknown, "$.datePrecision")).isEqualTo("UNKNOWN");
        assertThat(value(unknown, "$.createdAt")).isEqualTo(originalCreated);
        assertThat(value(unknown, "$.textContent")).isEqualTo("Original text remains immutable");
        var guestReceipt = send(guest, "POST", "/api/contributions", UUID.randomUUID().toString(),
                JSON.writeValueAsString(Map.of("message", "Guest original", "guestName", "Synthetic Guest")), Map.of());
        assertThat(guestReceipt.statusCode()).isEqualTo(201);
        String guestId = memory(guestReceipt, 0);
        var guestEdit = edit(guestId, metadata("Couple context for guest memory", null, "2024", "YEAR"), "\"1\"");
        assertThat(guestEdit.statusCode()).isEqualTo(200);
        assertThat(value(guestEdit, "$.source")).isEqualTo("GUEST");
        assertThat(value(guestEdit, "$.guestName")).isEqualTo("Synthetic Guest");
        assertThat(value(guestEdit, "$.textContent")).isEqualTo("Guest original");
        assertThat(value(guestEdit, "$.reviewStatus")).isEqualTo("PENDING");
        var deleted = review(id, "DELETE", etag(unknown));
        assertThat(deleted.statusCode()).isEqualTo(200);
        assertThat(edit(id, metadata, etag(deleted)).statusCode()).isEqualTo(404);
    }

    @Test void privatePhotosAndVoiceVerifyRetryPreserveOriginalsAndRejectGuestUploadRoutes() throws Exception {
        byte[] voice = AudioFixtures.audio("audio/webm", .3);
        var photos = create(mediaBody("PHOTO", photo, 2));
        var audio = create(mediaBody("AUDIO", voice, 1));
        for (var receipt : List.of(photos, audio)) {
            String key = key(receipt), contribution = value(receipt, "$.contributionId");
            String mediaPath = uploadPath(receipt, 0);
            String guestPath = mediaPath.replace("/api/memories/contributions", "/api/contributions");
            assertThat(send(guest, "POST", guestPath + "/upload-grants", key, null, Map.of()).statusCode()).isEqualTo(404);
            var other = login("COUPLE");
            assertThat(send(other.client(), "POST", mediaPath + "/upload-grants", key, null, Map.of("X-CSRF-Token", other.csrf())).statusCode()).isEqualTo(404);
            assertThat(send(couple.client(), "GET", privateReceipt(contribution), key, "{}", Map.of()).statusCode()).isEqualTo(400);
            assertThat(send(couple.client(), "POST", mediaPath + "/upload-grants", key, "{}", Map.of("X-CSRF-Token", couple.csrf())).statusCode()).isEqualTo(400);
            assertThat(send(couple.client(), "POST", mediaPath + "/finalize", key, " ".repeat(1025), Map.of("X-CSRF-Token", couple.csrf())).statusCode()).isEqualTo(413);
        }
        var grant = grant(photos, 0);
        stage(grant, new byte[photo.length]);
        assertThat(finish(photos, 0, grant).statusCode()).isEqualTo(422);
        assertThat(value(receipt(photos), "$.memories[0].uploadState")).isEqualTo("FAILED");
        stage(grant, photo);
        assertThat(value(finish(photos, 0, grant), "$.completion")).isEqualTo("PARTIAL");
        assertThat(finish(photos, 0, grant).statusCode()).isEqualTo(200);
        upload(photos, 1, photo); upload(audio, 0, voice);
        assertThat(value(receipt(photos), "$.completion")).isEqualTo("COMPLETE");
        assertThat(storage.publishes).isEqualTo(3);
        for (String id : List.of(memory(photos, 0), memory(photos, 1), memory(audio, 0))) {
            var before = get(couple, "/api/memories/" + id);
            assertThat(value(before, "$.source")).isEqualTo("COUPLE");
            assertThat(value(before, "$.reviewStatus")).isEqualTo("KEEP");
            String originalCreated = value(before, "$.createdAt");
            var assetBefore = db.sql("SELECT object_key, updated_at FROM media_asset WHERE memory_id=:id")
                    .param("id", UUID.fromString(id)).query((rs, row) -> List.of(rs.getString(1), rs.getObject(2))).single();
            byte[] original = storage.objects.get(assetBefore.getFirst()).clone();
            var after = edit(id, metadata("Private title", "Private context", "2026", "YEAR"), etag(before));
            assertThat(after.statusCode()).isEqualTo(200);
            assertThat(value(after, "$.createdAt")).isEqualTo(originalCreated);
            assertThat(value(after, "$.caption")).isEqualTo(value(before, "$.caption"));
            assertThat((Object) JsonPath.read(after.body(), "$.media")).isEqualTo((Object) JsonPath.read(before.body(), "$.media"));
            assertThat(db.sql("SELECT object_key, updated_at FROM media_asset WHERE memory_id=:id")
                    .param("id", UUID.fromString(id)).query((rs, row) -> List.of(rs.getString(1), rs.getObject(2))).single()).isEqualTo(assetBefore);
            assertThat(storage.objects.get(assetBefore.getFirst())).isEqualTo(original);
            assertThat(get(guest, "/api/memories/" + id).statusCode()).isEqualTo(401);
        }
    }

    @Test void metadataValidationAndConcurrentEditorsKeepOneWinningRevision() throws Exception {
        var created = create(Map.of("message", "Guest-safe original"));
        String id = memory(created, 0), revision = etag(get(couple, "/api/memories/" + id));
        for (var invalid : List.of(metadata(null, null, "2023-02-29", "DAY"), metadata(null, null, "2024-02-30", "DAY"),
                metadata(null, null, "0000", "YEAR"), metadata(null, null, "2024-13", "MONTH"),
                metadata(null, null, "2024", "UNKNOWN"), metadata(null, null, null, "YEAR"),
                metadata("x".repeat(201), null, null, "UNKNOWN"), metadata(null, "x".repeat(2001), null, "UNKNOWN"))) {
            assertThat(edit(id, invalid, revision).statusCode()).isEqualTo(400);
        }
        var missing = metadata(null, null, null, "UNKNOWN"); missing.remove("title");
        assertThat(edit(id, missing, revision).statusCode()).isEqualTo(400);
        var extra = metadata(null, null, null, "UNKNOWN"); extra.put("textContent", "override");
        assertThat(edit(id, extra, revision).statusCode()).isEqualTo(400);
        assertThat(send(couple.client(), "PATCH", "/api/memories/" + id + "/metadata", null, " ".repeat(16385),
                Map.of("X-CSRF-Token", couple.csrf(), "If-Match", revision)).statusCode()).isEqualTo(413);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var first = workers.submit(() -> edit(id, metadata("Editor A", null, null, "UNKNOWN"), revision));
            var second = workers.submit(() -> edit(id, metadata("Editor B", null, null, "UNKNOWN"), revision));
            assertThat(List.of(first.get(30, TimeUnit.SECONDS).statusCode(), second.get(30, TimeUnit.SECONDS).statusCode()))
                    .containsExactlyInAnyOrder(200, 412);
        }
        var result = get(couple, "/api/memories/" + id);
        assertThat(etag(result)).isEqualTo("\"2\"");
        assertThat(value(result, "$.title")).isIn("Editor A", "Editor B");
        assertThat(value(result, "$.textContent")).isEqualTo("Guest-safe original");
    }

    @Test void revokedAccountWaitingForStagingCapacityGetsNoGrant() throws Exception {
        var created = create(mediaBody("PHOTO", photo, 1));
        try (var connection = dataSource.getConnection(); var workers = Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            connection.createStatement().execute("SELECT pg_advisory_xact_lock(1263350093, 1)");
            var future = workers.submit(() -> rawGrant(created, 0));
            try {
                awaitAdvisoryWait();
                db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id", couple.id()).update();
            } finally { connection.rollback(); }
            assertThat(future.get(30, TimeUnit.SECONDS).statusCode()).isEqualTo(401);
        }
        assertThat(storage.signings).isZero();
        assertThat(db.sql("SELECT count(*) FROM upload_grant").query(Long.class).single()).isZero();
    }

    @Test void scopedMediaKeepsAudioGatePauseAndSharedCapacityAdmission() throws Exception {
        byte[] voice = AudioFixtures.audio("audio/webm", .3);
        var audioRequest = AudioRequest.from(mediaBody("AUDIO", voice, 1));
        var photoRequest = PhotoRequest.from(mediaBody("PHOTO", photo, 1));
        var transaction = new TransactionTemplate(transactions);
        for (String gate : List.of("audio", "paused", "capacity")) {
            var scope = new ContributionScope("COUPLE", couple.id(), "couple:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(UUID.randomUUID().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))));
            var guarded = new PhotoRepository(db, contributions, clock,
                    new PhotoAdmissionPolicy(gate.equals("paused"), gate.equals("capacity") ? 1 : Long.MAX_VALUE, Long.MAX_VALUE));
            assertThatThrownBy(() -> transaction.execute(ignored -> gate.equals("audio")
                    ? photos.create(audioRequest, scope, false) : guarded.create(photoRequest, scope)))
                    .isInstanceOfSatisfying(ApiException.class, e -> { assertThat(e.status()).isEqualTo(503); assertThat(e.code()).isEqualTo("MEDIA_UNAVAILABLE"); });
            assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", scope.key()).query(Long.class).single()).isZero();
        }
    }

    @Test void revokedAccountAfterMediaReadCannotPublishOrCommitFailure() throws Exception {
        for (boolean valid : List.of(true, false)) {
            if (!valid) couple = login("COUPLE");
            var created = create(mediaBody("PHOTO", photo, 1));
            var permission = grant(created, 0); stage(permission, valid ? photo : new byte[photo.length]);
            var entered = new CountDownLatch(1); var resume = new CountDownLatch(1);
            storage.afterRead = () -> { entered.countDown(); await(resume); };
            try (var workers = Executors.newSingleThreadExecutor()) {
                var future = workers.submit(() -> finish(created, 0, permission));
                try {
                    assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
                    db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id", couple.id()).update();
                } finally { resume.countDown(); }
                assertThat(future.get(30, TimeUnit.SECONDS).statusCode()).isEqualTo(401);
            } finally { storage.afterRead = null; }
            assertThat(db.sql("SELECT upload_state FROM media_asset WHERE memory_id=:id")
                    .param("id", UUID.fromString(memory(created, 0))).query(String.class).single()).isEqualTo("PENDING");
            assertThat(storage.publishes).isZero();
        }
    }

    @Test void erasedPrivateMetadataIsScrubbedAndRetainedKeyCannotResurrectIt() throws Exception {
        var created = create(Map.of("message", "Erase original private note"));
        String id = memory(created, 0);
        var metadata = edit(id, metadata("Erase title", "Erase description", "2024-02", "MONTH"), "\"1\"");
        assertThat(metadata.statusCode()).isEqualTo(200);
        assertThat(review(id, "DELETE", etag(metadata)).statusCode()).isEqualTo(200);
        Instant now = clock.now.plus(Duration.ofDays(31));
        var plans = retention.claim(10, now);
        assertThat(plans).hasSize(1);
        assertThat(retention.finish(plans.getFirst(), now)).isTrue();
        var erased = db.sql("SELECT title, description, memory_date, date_precision, text_content FROM memory WHERE id=:id")
                .param("id", UUID.fromString(id)).query((rs, row) -> {
                    var values = new ArrayList<Object>(); for (int i = 1; i <= 5; i++) values.add(rs.getObject(i)); return values;
                }).single();
        assertThat(erased).containsExactly(null, null, null, "UNKNOWN", null);
        assertThat(db.sql("SELECT source FROM contribution WHERE id=:id").param("id", UUID.fromString(value(created, "$.contributionId"))).query(String.class).single()).isEqualTo("COUPLE");
        assertThat(db.sql("SELECT author_account_id FROM contribution WHERE id=:id").param("id", UUID.fromString(value(created, "$.contributionId"))).query(UUID.class).single()).isEqualTo(couple.id());
        assertThat(get(couple, "/api/memories/" + id).statusCode()).isEqualTo(404);
        var replay = post(couple, key(created), JSON.writeValueAsString(Map.of("message", "Erase original private note")));
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat(memory(replay, 0)).isEqualTo(id);
        assertThat(value(replay, "$.memories[0].reviewStatus")).isEqualTo("DELETE");
        assertThat(post(couple, key(created), JSON.writeValueAsString(Map.of("message", "Resurrect with changed content"))).statusCode()).isEqualTo(409);
        assertThat(db.sql("SELECT text_content IS NULL FROM memory WHERE id=:id").param("id", UUID.fromString(id)).query(Boolean.class).single()).isTrue();
    }

    private Session login(String role) throws Exception {
        UUID id = UUID.randomUUID(); String username = "synthetic-author-" + id;
        db.sql("INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version) VALUES(:id,:name,'Synthetic Author',:hash,:role,true,1)")
                .param("id", id).param("name", username).param("hash", encoder.encode(PASSWORD)).param("role", role).update();
        var client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
        String csrf = value(send(client, "GET", "/api/session", null, null, Map.of()), "$.csrfToken");
        var result = send(client, "POST", "/api/session", null, JSON.writeValueAsString(Map.of("username", username, "password", PASSWORD)), Map.of("X-CSRF-Token", csrf));
        assertThat(result.statusCode()).isEqualTo(200);
        return new Session(id, client, value(result, "$.csrfToken"));
    }
    private HttpResponse<String> post(Session session, String key, String body) throws Exception {
        return send(session.client(), "POST", "/api/memories/contributions", key, body, Map.of("X-CSRF-Token", session.csrf()));
    }
    private HttpResponse<String> create(Map<String, Object> body) throws Exception {
        String key = UUID.randomUUID().toString(); var result = post(couple, key, JSON.writeValueAsString(body));
        assertThat(result.statusCode()).isEqualTo(201);
        retryKeys.put(result, key);
        return result;
    }
    private HttpResponse<String> receipt(HttpResponse<String> created) throws Exception {
        return send(couple.client(), "GET", privateReceipt(value(created, "$.contributionId")), key(created), null, Map.of());
    }
    private HttpResponse<String> rawGrant(HttpResponse<String> created, int position) throws Exception {
        return send(couple.client(), "POST", uploadPath(created, position) + "/upload-grants", key(created), null, Map.of("X-CSRF-Token", couple.csrf()));
    }
    private HttpResponse<String> grant(HttpResponse<String> created, int position) throws Exception {
        var result = rawGrant(created, position); assertThat(result.statusCode()).isEqualTo(201); return result;
    }
    private void stage(HttpResponse<String> grant, byte[] bytes) { storage.objects.put("staging/" + value(grant, "$.grantId"), bytes.clone()); }
    private HttpResponse<String> finish(HttpResponse<String> created, int position, HttpResponse<String> grant) throws Exception {
        return send(couple.client(), "POST", uploadPath(created, position) + "/finalize", key(created),
                JSON.writeValueAsString(Map.of("grantId", value(grant, "$.grantId"))), Map.of("X-CSRF-Token", couple.csrf()));
    }
    private void upload(HttpResponse<String> created, int position, byte[] bytes) throws Exception {
        var grant = grant(created, position); stage(grant, bytes); assertThat(finish(created, position, grant).statusCode()).isEqualTo(200);
    }
    private HttpResponse<String> edit(String id, Map<String, Object> body, String revision) throws Exception {
        var headers = new LinkedHashMap<String, String>(); headers.put("X-CSRF-Token", couple.csrf()); if (revision != null) headers.put("If-Match", revision);
        return send(couple.client(), "PATCH", "/api/memories/" + id + "/metadata", null, JSON.writeValueAsString(body), headers);
    }
    private HttpResponse<String> review(String id, String status, String revision) throws Exception {
        return send(couple.client(), "PATCH", "/api/memories/" + id + "/review", null, JSON.writeValueAsString(Map.of("reviewStatus", status)), Map.of("X-CSRF-Token", couple.csrf(), "If-Match", revision));
    }
    private HttpResponse<String> get(Session session, String path) throws Exception { return get(session.client(), path); }
    private HttpResponse<String> get(HttpClient client, String path) throws Exception { return send(client, "GET", path, null, null, Map.of()); }
    private HttpResponse<String> send(HttpClient client, String method, String path, String key, String body, Map<String, String> headers) throws Exception {
        return client.send(request(method, path, key, headers).method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest.Builder request(String method, String path, String key, Map<String, String> headers) {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(60))
                .header("X-Api-Contract", "1").header("Content-Type", "application/json")
                .header("Origin", headers.getOrDefault("Origin", "http://localhost:" + port));
        if (key != null) request.header("Idempotency-Key", key);
        headers.forEach((name, value) -> { if (!name.equals("Origin")) request.header(name, value); });
        return request;
    }
    private Map<String, Object> mediaBody(String type, byte[] bytes, int count) throws Exception {
        var items = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < count; i++) {
            var item = new LinkedHashMap<String, Object>(); item.put("clientItemId", UUID.randomUUID().toString());
            item.put("originalFilename", type.equals("AUDIO") ? "synthetic-tone.webm" : "synthetic-photo.png");
            item.put("declaredContentType", type.equals("AUDIO") ? "audio/webm" : "image/png");
            item.put("byteSize", bytes.length); item.put("checksumSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
            item.put("caption", "Original private caption " + i); if (type.equals("AUDIO")) item.put("durationSeconds", .3);
            items.add(item);
        }
        return Map.of("memoryType", type, "items", items);
    }
    private static LinkedHashMap<String, Object> metadata(String title, String description, String date, String precision) {
        var body = new LinkedHashMap<String, Object>(); body.put("title", title); body.put("description", description); body.put("memoryDate", date); body.put("datePrecision", precision); return body;
    }
    private void awaitAdvisoryWait() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (db.sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted").query(Long.class).single() > 0) return;
            Thread.sleep(20);
        }
        throw new AssertionError("Private request did not reach the held staging advisory lock.");
    }
    private static void await(CountDownLatch latch) {
        try { if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("Synthetic IO wait timed out."); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new AssertionError(interrupted); }
    }
    private static String privateReceipt(String id) { return "/api/memories/contributions/" + id + "/receipt"; }
    private static String uploadPath(HttpResponse<String> response, int position) { return "/api/memories/contributions/" + value(response, "$.contributionId") + "/memories/" + memory(response, position); }
    private static String memory(HttpResponse<String> response, int position) { return value(response, "$.memories[" + position + "].memoryId"); }
    private static String value(HttpResponse<String> response, String path) { return JsonPath.read(response.body(), path); }
    private static String etag(HttpResponse<String> response) { return response.headers().firstValue("ETag").orElseThrow(); }
    private String key(HttpResponse<String> response) { return retryKeys.get(response); }
    private record Session(UUID id, HttpClient client, String csrf) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary ControlledStorage controlledStorage() { return new ControlledStorage(); }
        @Bean @Primary PhotoHttpTest.MutableClock mutableClock() { return new PhotoHttpTest.MutableClock(); }
    }
    static class ControlledStorage extends AudioHttpTest.FakeStorage {
        volatile Runnable afterRead;
        volatile int signings;
        @Override public UploadGrant authorize(UUID id, String key, String type, long size, Instant expires) {
            signings++; return super.authorize(id, key, type, size, expires);
        }
        @Override public Optional<byte[]> read(String key, int max) {
            var result = super.read(key, max); var hook = afterRead; if (hook != null) hook.run(); return result;
        }
    }
}
