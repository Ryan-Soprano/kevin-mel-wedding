package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.security.MessageDigest;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PhotoHttpTest.Fixtures.class)
class PhotoHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired FakeStorage storage;
    @Autowired MutableClock clock;
    final HttpClient client = HttpClient.newHttpClient();
    byte[] image;

    @BeforeEach void fixtures() throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB), "png", out);
        image = out.toByteArray();
        storage.objects.clear(); storage.publishes = 0; storage.outage = false;
        clock.now = Instant.parse("2026-10-05T12:00:00Z");
    }
    HttpResponse<String> send(String method, String path, String key, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("Idempotency-Key", key)
                .header("Content-Type", "application/json").method(method, body == null
                    ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<String> create(String key, String body) throws Exception { return send("POST", "/api/contributions", key, body); }
    String value(HttpResponse<String> response, String path) { return JsonPath.read(response.body(), path); }
    String item(UUID id, byte[] bytes, String type) throws Exception {
        return "{\"clientItemId\":\"" + id + "\",\"originalFilename\":\"private.png\",\"declaredContentType\":\"" + type
            + "\",\"byteSize\":" + bytes.length + ",\"checksumSha256\":\"" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
            + "\",\"caption\":\" private caption \"}";
    }
    String body(String item) { return "{\"guestName\":\" Guest \",\"memoryType\":\"PHOTO\",\"items\":[" + item + "]}"; }
    String path(HttpResponse<String> receipt, int position) {
        return "/api/contributions/" + value(receipt, "$.contributionId") + "/memories/" + value(receipt, "$.memories[" + position + "].memoryId");
    }
    HttpResponse<String> grant(String path, String key) throws Exception { return send("POST", path + "/upload-grants", key, null); }
    HttpResponse<String> finish(String path, String key, HttpResponse<String> grant) throws Exception {
        return send("POST", path + "/finalize", key, "{\"grantId\":\"" + value(grant, "$.grantId") + "\"}");
    }
    void stage(HttpResponse<String> grant, byte[] bytes) { storage.objects.put("staging/" + value(grant, "$.grantId"), bytes.clone()); }

    @Test void privateCommittedIntentReplayAndImmutableVerifiedOriginal() throws Exception {
        String key = UUID.randomUUID().toString(), request = body(item(UUID.randomUUID(), image, "image/png"));
        var receipt = create(key, request);
        assertThat(receipt.statusCode()).isEqualTo(201);
        assertThat(value(receipt, "$.completion")).isEqualTo("PENDING");
        assertThat(receipt.body()).doesNotContain("Guest", "caption", "filename", "objectKey", "uploadUrl", key);
        assertThat(value(receipt, "$.memories[0].reviewStatus")).isEqualTo("PENDING");
        assertThat(value(receipt, "$.memories[0].visibility")).isEqualTo("COUPLE_ONLY");
        assertThat(receipt.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(db.sql("SELECT guest_name FROM contribution WHERE idempotency_key=:key").param("key", key).query(String.class).single()).isEqualTo("Guest");
        assertThat(create(key.toUpperCase(), request).body()).isEqualTo(receipt.body());
        assertThat(create(key, request.replace("private caption", "changed caption")).statusCode()).isEqualTo(409);
        assertThat(create(key, "{\"message\":\"different type\"}").statusCode()).isEqualTo(409);
        String path = path(receipt, 0);
        var grant = grant(path, key);
        assertThat(grant.statusCode()).isEqualTo(201);
        assertThat(value(grant, "$.method")).isEqualTo("PUT");
        assertThat(value(grant, "$.headers['Content-Type']")).isEqualTo("image/png");
        assertThat(Instant.parse(value(grant, "$.expiresAt"))).isEqualTo(clock.now.plusSeconds(300));
        assertThat(finish(path, key, grant).statusCode()).isEqualTo(409);
        stage(grant, image);
        var done = finish(path, key, grant);
        assertThat(done.statusCode()).isEqualTo(200);
        assertThat(value(done, "$.completion")).isEqualTo("COMPLETE");
        var original = storage.objects.entrySet().stream().filter(e -> e.getKey().startsWith("originals/")).findFirst().orElseThrow();
        assertThat(original.getValue()).isEqualTo(image);
        stage(grant, new byte[]{1, 2, 3}); // Reusing a PUT grant can only damage temporary bytes.
        clock.now = clock.now.plusSeconds(301);
        assertThat(finish(path, key, grant).body()).isEqualTo(done.body()); // Lost finalized response, even after expiry.
        assertThat(storage.publishes).isEqualTo(1);
        assertThat(original.getValue()).isEqualTo(image);
        assertThat(grant(path, key).statusCode()).isEqualTo(409);
        assertThat(create(key, request).body()).isEqualTo(done.body());
        assertThat(db.sql("SELECT detected_format FROM media_asset WHERE memory_id=:id").param("id", UUID.fromString(value(receipt, "$.memories[0].memoryId"))).query(String.class).single()).isEqualTo("image/png");
    }

    @Test void invalidBytesCommitFailedAndPermitSameItemRenewal() throws Exception {
        for (byte[] bad : List.of(new byte[]{1}, new byte[image.length])) {
            String key = UUID.randomUUID().toString();
            var receipt = create(key, body(item(UUID.randomUUID(), image, "image/png")));
            String path = path(receipt, 0);
            var grant = grant(path, key); stage(grant, bad);
            assertThat(finish(path, key, grant).statusCode()).isEqualTo(422);
            var current = send("GET", "/api/contributions/" + value(receipt, "$.contributionId") + "/receipt", key, null);
            assertThat(value(current, "$.memories[0].uploadState")).isEqualTo("FAILED");
            assertThat(storage.objects.keySet()).noneMatch(k -> k.startsWith("originals/"));
            var renewed = grant(path, key); stage(renewed, image);
            assertThat(value(finish(path, key, renewed), "$.completion")).isEqualTo("COMPLETE");
            storage.objects.clear();
        }
    }

    @Test void expiredMissingAndForeignGrantsNeverConfirm() throws Exception {
        String key = UUID.randomUUID().toString();
        var receipt = create(key, body(item(UUID.randomUUID(), image, "image/png")));
        String path = path(receipt, 0); var grant = grant(path, key);
        assertThat(grant(path, UUID.randomUUID().toString()).statusCode()).isEqualTo(404);
        assertThat(finish(path, UUID.randomUUID().toString(), grant).statusCode()).isEqualTo(404);
        assertThat(send("POST", path + "/finalize", key, "{\"grantId\":\"" + UUID.randomUUID() + "\"}").statusCode()).isEqualTo(404);
        var other = create(key = UUID.randomUUID().toString(), body(item(UUID.randomUUID(), image, "image/png")));
        assertThat(finish(path(other, 0), key, grant).statusCode()).isEqualTo(404);
        clock.now = clock.now.plusSeconds(300);
        stage(grant, image);
        String originalKey = db.sql("SELECT idempotency_key FROM contribution WHERE id=:id").param("id", UUID.fromString(value(receipt, "$.contributionId"))).query(String.class).single();
        assertThat(finish(path, originalKey, grant).statusCode()).isEqualTo(410);
        var renewed = grant(path, originalKey); stage(renewed, image);
        assertThat(value(finish(path, originalKey, renewed), "$.completion")).isEqualTo("COMPLETE");
        assertThat(send("POST", path(other, 0) + "/upload-grants", key, "{\"objectKey\":\"override\"}").statusCode()).isEqualTo(400);
        assertThat(send("POST", path(other, 0) + "/finalize", key, "{\"grantId\":\"bad\"}").statusCode()).isEqualTo(400);
    }

    @Test void orderedBatchReportsPartialThenComplete() throws Exception {
        String key = UUID.randomUUID().toString(); var items = new ArrayList<String>();
        for (int i = 0; i < 5; i++) items.add(item(UUID.randomUUID(), image, "image/png"));
        var receipt = create(key, "{\"memoryType\":\"PHOTO\",\"items\":[" + String.join(",", items) + "]}");
        assertThat(receipt.statusCode()).isEqualTo(201);
        for (int i = 0; i < 5; i++) {
            String path = path(receipt, i); var grant = grant(path, key); stage(grant, image);
            var current = finish(path, key, grant);
            assertThat(value(current, "$.completion")).isEqualTo(i == 4 ? "COMPLETE" : "PARTIAL");
            assertThat(value(current, "$.memories[" + i + "].clientItemId")).isEqualTo(JsonPath.read(items.get(i), "$.clientItemId"));
        }
    }

    @Test void concurrentRetriesCreateOneIntentAndPublishOneOriginal() throws Exception {
        String key = UUID.randomUUID().toString(), request = body(item(UUID.randomUUID(), image, "image/png"));
        try (var executor = Executors.newFixedThreadPool(8)) {
            var start = new CountDownLatch(1); var tasks = new ArrayList<Future<HttpResponse<String>>>();
            for (int i = 0; i < 8; i++) tasks.add(executor.submit(() -> { start.await(); return create(key, request); }));
            start.countDown(); var responses = new ArrayList<HttpResponse<String>>();
            for (var task : tasks) responses.add(task.get(30, TimeUnit.SECONDS));
            assertThat(responses.stream().filter(r -> r.statusCode() == 201).count()).isEqualTo(1);
            assertThat(responses.stream().filter(r -> r.statusCode() == 200).count()).isEqualTo(7);
            assertThat(responses.stream().map(HttpResponse::body).distinct().count()).isEqualTo(1);
            String path = path(responses.getFirst(), 0); var grant = grant(path, key); stage(grant, image);
            var a = executor.submit(() -> finish(path, key, grant)); var b = executor.submit(() -> finish(path, key, grant));
            assertThat(a.get().statusCode()).isEqualTo(200); assertThat(b.get().statusCode()).isEqualTo(200);
            assertThat(storage.publishes).isEqualTo(1);
        }
    }

    @Test void databaseCommitFailureRollsBackConfirmationAndRetryRecovers() throws Exception {
        String key = UUID.randomUUID().toString(); var receipt = create(key, body(item(UUID.randomUUID(), image, "image/png")));
        String path = path(receipt, 0); var grant = grant(path, key); stage(grant, image);
        db.sql("CREATE FUNCTION reject_photo_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.upload_state='UPLOADED' THEN RAISE EXCEPTION 'private storage diagnostic'; END IF; RETURN NEW; END $$").update();
        db.sql("CREATE CONSTRAINT TRIGGER reject_photo_commit AFTER UPDATE ON media_asset DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_photo_commit()").update();
        try {
            var failure = finish(path, key, grant);
            assertThat(failure.statusCode()).isEqualTo(503);
            assertThat(failure.body()).doesNotContain("private storage", "originals/", key, "UPDATE");
            assertThat(value(send("GET", "/api/contributions/" + value(receipt, "$.contributionId") + "/receipt", key, null), "$.completion")).isEqualTo("PENDING");
        } finally {
            db.sql("DROP TRIGGER reject_photo_commit ON media_asset").update(); db.sql("DROP FUNCTION reject_photo_commit()").update();
        }
        assertThat(value(finish(path, key, grant), "$.completion")).isEqualTo("COMPLETE");
        assertThat(storage.objects.values()).allMatch(bytes -> Arrays.equals(bytes, image));
    }

    @Test void storageOutageIsSafeAndCannotConfirmPhoto() throws Exception {
        String key = UUID.randomUUID().toString(); var receipt = create(key, body(item(UUID.randomUUID(), image, "image/png")));
        String path = path(receipt, 0); var grant = grant(path, key); stage(grant, image); storage.outage = true;
        var failure = finish(path, key, grant);
        assertThat(failure.statusCode()).isEqualTo(503); assertThat(value(failure, "$.error.code")).isEqualTo("MEDIA_UNAVAILABLE");
        assertThat(value(send("GET", "/api/contributions/" + value(receipt, "$.contributionId") + "/receipt", key, null), "$.completion")).isEqualTo("PENDING");
    }

    @Test void invalidMetadataAndCrossOriginRequestsCreateNothing() throws Exception {
        String valid = body(item(UUID.randomUUID(), image, "image/png"));
        for (String invalid : List.of(valid.replace("image/png", "image/heic"), valid.replace("private.png", "../private.png"),
                valid.replace("\"byteSize\":" + image.length, "\"byteSize\":1.5"), valid.replace("PHOTO", "AUDIO"),
                valid.replace("\"caption\":", "\"objectKey\":\"override\",\"caption\":"))) {
            String key = UUID.randomUUID().toString(); assertThat(create(key, invalid).statusCode()).isEqualTo(400);
            assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", key).query(Long.class).single()).isZero();
        }
        var denied = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/contributions"))
                .header("Content-Type", "application/json").header("X-Api-Contract", "1").header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Origin", "https://other.example").POST(HttpRequest.BodyPublishers.ofString(valid)).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(denied.statusCode()).isEqualTo(403);
    }

    @Test void intentCommitFailureRollsBackEnvelopeMemoryAndAsset() throws Exception {
        db.sql("CREATE FUNCTION reject_photo_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private insert diagnostic'; END $$").update();
        db.sql("CREATE CONSTRAINT TRIGGER reject_photo_intent AFTER INSERT ON media_asset DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_photo_intent()").update();
        String key = UUID.randomUUID().toString();
        try {
            var response = create(key, body(item(UUID.randomUUID(), image, "image/png")));
            assertThat(response.statusCode()).isEqualTo(503); assertThat(response.body()).doesNotContain("private insert", "originals/", key);
            assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", key).query(Long.class).single()).isZero();
        } finally { db.sql("DROP TRIGGER reject_photo_intent ON media_asset").update(); db.sql("DROP FUNCTION reject_photo_intent()").update(); }
    }

    @TestConfiguration static class Fixtures {
        @Bean @Primary FakeStorage fakeStorage() { return new FakeStorage(); }
        @Bean @Primary MutableClock mutableClock() { return new MutableClock(); }
    }
    static class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-10-05T12:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
    static class FakeStorage implements ObjectStorage {
        final Map<String, byte[]> objects = new ConcurrentHashMap<>(); volatile int publishes; volatile boolean outage;
        public void requireAvailable() { if (outage) throw StorageConfiguration.unavailable(); }
        public UploadGrant authorize(UUID id, String key, String type, long byteSize, Instant expires) {
            requireAvailable(); return new UploadGrant(id, "PUT", "https://storage.example/" + key, expires, Map.of("Content-Type", type));
        }
        public ReadGrant authorizeRead(String key, String type, long size, Instant expires) {
            throw StorageConfiguration.privateMediaUnavailable();
        }
        public Optional<byte[]> read(String key, int max) {
            requireAvailable(); return Optional.ofNullable(objects.get(key)).map(bytes -> Arrays.copyOf(bytes, Math.min(bytes.length, max + 1)));
        }
        public void publish(String key, byte[] bytes, String type) { requireAvailable(); objects.put(key, bytes.clone()); publishes++; }
    }
}
