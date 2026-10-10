package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;

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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.imageio.ImageIO;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Mixed public-to-private journeys. Storage is synthetic: playback issuance and original bytes,
 * not a provider GET, browser playback, microphone capture or hosted-cookie acceptance. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "archive.environment=local", "spring.profiles.active=local",
        "archive.audio.enabled=true", "archive.revealed=true", "archive.storage.enabled=false",
        "archive.media.uploads-paused=false", "archive.retention.enabled=false"})
@Import(AudioHttpTest.Fixtures.class)
class WeddingJourneyHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String PASSWORD = "synthetic-wedding-journey-password";
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired PasswordEncoder encoder;
    @Autowired AudioHttpTest.FakeStorage storage;
    @Autowired PhotoHttpTest.MutableClock clock;
    private HttpClient guest;
    private HttpClient couple;
    private CookieManager cookies;
    private String username;
    private String csrf;
    private byte[] photo;
    private byte[] voice;

    @BeforeEach void disposableFixtures() throws Exception {
        // This database belongs only to this Testcontainers class, never to configured development/provider data.
        db.sql("TRUNCATE contribution, archive_account CASCADE").update();
        storage.objects.clear(); storage.outage = false; storage.publishes = 0;
        clock.now = Instant.parse("2026-10-09T12:00:00Z");
        guest = HttpClient.newHttpClient();
        cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        couple = HttpClient.newBuilder().cookieHandler(cookies).build();
        csrf = null;
        username = "synthetic-journey-" + UUID.randomUUID();
        db.sql("""
                INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version)
                VALUES(:id,:username,'Synthetic Journey Couple',:hash,'COUPLE',true,1)
                """).param("id", UUID.randomUUID()).param("username", username).param("hash", encoder.encode(PASSWORD)).update();
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB), "png", bytes);
        photo = bytes.toByteArray();
        voice = AudioFixtures.audio("audio/webm", .3);
    }

    @Test void namedAndAnonymousNotesPhotosAndAudioReachOnePrivatePaginatedInbox() throws Exception {
        var expected = new LinkedHashMap<String, String>();
        var expectedContributions = new LinkedHashMap<String, String>();
        var expectedTypes = new LinkedHashMap<String, String>();
        var media = new LinkedHashMap<String, byte[]>();
        for (String name : new String[]{" Synthetic Wedding Guest ", null}) {
            var note = create(textBody(name));
            expected.put(note.memory(0), name == null ? null : name.trim());
            expectedContributions.put(note.memory(0), note.id());
            expectedTypes.put(note.memory(0), "TEXT");
            assertThat(value(note.receipt(), "$.completion")).isEqualTo("COMPLETE");
            assertThat(replay(note).body()).isEqualTo(note.receipt().body());

            var photos = create(mediaBody("PHOTO", name, photo, 2));
            for (int i = 0; i < 2; i++) {
                expected.put(photos.memory(i), name == null ? null : name.trim());
                expectedContributions.put(photos.memory(i), photos.id());
                expectedTypes.put(photos.memory(i), "PHOTO");
                media.put(photos.memory(i), photo);
                var done = upload(photos, i, photo);
                assertThat(value(done, "$.completion")).isEqualTo(i == 0 ? "PARTIAL" : "COMPLETE");
            }
            var audio = create(mediaBody("AUDIO", name, voice, 1));
            expected.put(audio.memory(0), name == null ? null : name.trim());
            expectedContributions.put(audio.memory(0), audio.id());
            expectedTypes.put(audio.memory(0), "AUDIO");
            media.put(audio.memory(0), voice);
            assertThat(value(upload(audio, 0, voice), "$.completion")).isEqualTo("COMPLETE");
        }
        assertThat(get(guest, "/api/memories").statusCode()).isEqualTo(401);
        for (String id : expected.keySet()) {
            assertThat(get(guest, "/api/memories/" + id).statusCode()).isEqualTo(401);
            assertThat(get(guest, "/api/memories/" + id + "/playback").statusCode()).isEqualTo(401);
        }
        login();
        assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrderElementsOf(expected.keySet());
        for (var item : expected.entrySet()) {
            var detail = get(couple, "/api/memories/" + item.getKey());
            assertThat(detail.statusCode()).isEqualTo(200);
            assertThat(detail.headers().firstValue("Cache-Control")).contains("no-store");
            assertThat((Object) JsonPath.read(detail.body(), "$.guestName")).isEqualTo(item.getValue());
            assertThat(value(detail, "$.contributionId")).isEqualTo(expectedContributions.get(item.getKey()));
            assertThat(value(detail, "$.memoryType")).isEqualTo(expectedTypes.get(item.getKey()));
            assertThat(value(detail, "$.reviewStatus")).isEqualTo("PENDING");
            assertThat(value(detail, "$.visibility")).isEqualTo("COUPLE_ONLY");
            assertThat(detail.body()).doesNotContain("objectKey", "originals/", "uploadUrl", PASSWORD);
            if (media.containsKey(item.getKey())) {
                assertThat(value(detail, "$.media.checksumSha256")).isEqualTo(hash(media.get(item.getKey())));
                assertThat(get(couple, "/api/memories/" + item.getKey() + "/playback").statusCode()).isEqualTo(200);
                assertOriginal(item.getKey(), media.get(item.getKey()));
            } else {
                assertThat(value(detail, "$.memoryType")).isEqualTo("TEXT");
                assertThat(value(detail, "$.textContent")).isEqualTo("Synthetic wedding note");
            }
        }
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isEqualTo(6);
        assertThat(storage.publishes).isEqualTo(6);
        logoutAndRejectOldCookie(expected.keySet().iterator().next());
    }

    @Test void partialPhotoBatchAndFailedAudioRecoverWithoutHidingSavedMixedSiblings() throws Exception {
        var note = create(textBody("Synthetic Recovery Guest"));
        var photos = create(mediaBody("PHOTO", null, photo, 3));
        var audio = create(mediaBody("AUDIO", "Synthetic Voice Guest", voice, 1));
        login();
        assertThat(paginatedIds("PENDING", 2)).containsExactly(note.memory(0));

        var firstGrant = grant(photos, 0);
        stage(firstGrant, new byte[photo.length]);
        assertThat(finish(photos, 0, firstGrant).statusCode()).isEqualTo(422);
        assertThat(value(receipt(photos), "$.memories[0].uploadState")).isEqualTo("FAILED");
        assertThat(get(couple, "/api/memories/" + photos.memory(0)).statusCode()).isEqualTo(404);
        stage(firstGrant, photo);
        finish(photos, 0, firstGrant); // Discard the confirmation, then reconcile the committed receipt explicitly.
        assertThat(value(receipt(photos), "$.completion")).isEqualTo("PARTIAL");
        assertThat(finish(photos, 0, firstGrant).statusCode()).isEqualTo(200);
        assertThat(value(replay(photos), "$.memories[0].uploadState")).isEqualTo("UPLOADED");

        var expiredGrant = grant(photos, 1);
        clock.now = clock.now.plusSeconds(300);
        stage(expiredGrant, photo);
        assertThat(finish(photos, 1, expiredGrant).statusCode()).isEqualTo(410);
        assertThat(value(upload(photos, 1, photo), "$.completion")).isEqualTo("PARTIAL");

        var audioGrant = grant(audio, 0);
        stage(audioGrant, voice);
        storage.outage = true;
        try {
            assertThat(finish(audio, 0, audioGrant).statusCode()).isEqualTo(503);
            assertThat(value(receipt(audio), "$.completion")).isEqualTo("PENDING");
            assertThat(get(couple, "/api/memories/" + note.memory(0)).statusCode()).isEqualTo(200);
            assertThat(get(couple, "/api/memories/" + photos.memory(0)).statusCode()).isEqualTo(200);
            assertThat(get(couple, "/api/memories/" + photos.memory(0) + "/playback").statusCode()).isEqualTo(503);
        } finally { storage.outage = false; }

        db.sql("""
                CREATE FUNCTION reject_journey_audio_commit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.audio_duration_ms IS NOT NULL THEN RAISE EXCEPTION 'synthetic private commit detail'; END IF;
                RETURN NEW; END $$
                """).update();
        db.sql("""
                CREATE CONSTRAINT TRIGGER reject_journey_audio_commit AFTER UPDATE ON media_asset
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_journey_audio_commit()
                """).update();
        try {
            var failedCommit = finish(audio, 0, audioGrant);
            assertThat(failedCommit.statusCode()).isEqualTo(503);
            assertThat(failedCommit.body()).doesNotContain("synthetic private commit", "originals/", audio.key());
            assertThat(value(receipt(audio), "$.completion")).isEqualTo("PENDING");
            assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrder(note.memory(0), photos.memory(0), photos.memory(1));
        } finally {
            db.sql("DROP TRIGGER reject_journey_audio_commit ON media_asset").update();
            db.sql("DROP FUNCTION reject_journey_audio_commit()").update();
        }
        assertThat(value(finish(audio, 0, audioGrant), "$.completion")).isEqualTo("COMPLETE");
        assertThat(finish(audio, 0, audioGrant).body()).isEqualTo(receipt(audio).body());
        assertThat(value(replay(audio), "$.completion")).isEqualTo("COMPLETE");
        assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrder(note.memory(0), photos.memory(0), photos.memory(1), audio.memory(0));
        assertThat(get(couple, "/api/memories/" + photos.memory(2)).statusCode()).isEqualTo(404);
        assertThat(get(couple, "/api/memories/" + photos.memory(2) + "/playback").statusCode()).isEqualTo(404);
        assertOriginal(photos.memory(0), photo); assertOriginal(photos.memory(1), photo); assertOriginal(audio.memory(0), voice);
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isEqualTo(3);
        assertThat(db.sql("SELECT count(*) FROM memory").query(Long.class).single()).isEqualTo(5);
    }

    @Test void sameCoupleSessionReviewsMixedMemoriesWithoutPublishingOrChangingPhotoSiblings() throws Exception {
        var note = create(textBody(null));
        var photos = create(mediaBody("PHOTO", "Synthetic Photo Guest", photo, 2));
        upload(photos, 0, photo); upload(photos, 1, photo);
        var audio = create(mediaBody("AUDIO", null, voice, 1));
        upload(audio, 0, voice);
        login();
        var ids = List.of(note.memory(0), photos.memory(0), photos.memory(1), audio.memory(0));
        assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrderElementsOf(ids);
        for (String id : ids) {
            for (String status : List.of("KEEP", "ARCHIVED", "DELETE", "PENDING")) {
                var before = get(couple, "/api/memories/" + id);
                var changed = review(id, status, before.headers().firstValue("ETag").orElseThrow());
                assertThat(changed.statusCode()).isEqualTo(200);
                assertThat(value(changed, "$.visibility")).isEqualTo("COUPLE_ONLY");
                assertThat(value(changed, "$.reviewStatus")).isEqualTo(status);
                if (status.equals("PENDING")) {
                    assertThat(paginatedIds(status, 2)).containsExactlyInAnyOrderElementsOf(ids);
                } else {
                    assertThat(paginatedIds(status, 2)).containsExactly(id);
                    assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrderElementsOf(ids.stream().filter(sibling -> !sibling.equals(id)).toList());
                }
                if (!id.equals(note.memory(0))) {
                    assertThat(get(couple, "/api/memories/" + id + "/playback").statusCode()).isEqualTo(status.equals("DELETE") ? 404 : 200);
                }
                for (String sibling : ids) {
                    if (!sibling.equals(id)) {
                        var detail = get(couple, "/api/memories/" + sibling);
                        assertThat(detail.statusCode()).isEqualTo(200);
                        assertThat(value(detail, "$.reviewStatus")).isEqualTo("PENDING");
                        assertThat(value(detail, "$.visibility")).isEqualTo("COUPLE_ONLY");
                    }
                }
                assertThat(get(guest, "/api/memories/" + id).statusCode()).isEqualTo(401);
            }
        }
        for (var created : List.of(note, photos, audio)) {
            var replay = replay(created);
            assertThat(replay.statusCode()).isEqualTo(200);
            assertThat(value(replay, "$.completion")).isEqualTo("COMPLETE");
            assertThat(JsonPath.<List<String>>read(replay.body(), "$.memories[*].memoryId")).isEqualTo(created.memoryIds());
            assertThat(JsonPath.<List<String>>read(replay.body(), "$.memories[*].visibility")).containsOnly("COUPLE_ONLY");
        }
        assertOriginal(photos.memory(0), photo); assertOriginal(photos.memory(1), photo); assertOriginal(audio.memory(0), voice);
        assertThat(storage.publishes).isEqualTo(3);
        assertThat(db.sql("SELECT count(*) FROM review_audit").query(Long.class).single()).isEqualTo(16);
        assertThat(paginatedIds("PENDING", 2)).containsExactlyInAnyOrderElementsOf(ids);
        assertThat(paginatedIds("KEEP", 2)).isEmpty();
        assertThat(paginatedIds("ARCHIVED", 2)).isEmpty();
        assertThat(paginatedIds("DELETE", 2)).isEmpty();
        logoutAndRejectOldCookie(audio.memory(0));
    }

    private Map<String, Object> textBody(String name) {
        var body = new LinkedHashMap<String, Object>();
        body.put("message", "Synthetic wedding note");
        if (name != null) body.put("guestName", name);
        return body;
    }
    private Map<String, Object> mediaBody(String type, String name, byte[] bytes, int count) throws Exception {
        var body = new LinkedHashMap<String, Object>();
        body.put("memoryType", type);
        if (name != null) body.put("guestName", name);
        var items = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < count; i++) {
            var item = new LinkedHashMap<String, Object>();
            item.put("clientItemId", UUID.randomUUID().toString());
            item.put("originalFilename", type.equals("AUDIO") ? "synthetic-tone.webm" : "synthetic-photo.png");
            item.put("declaredContentType", type.equals("AUDIO") ? "audio/webm" : "image/png");
            item.put("byteSize", bytes.length); item.put("checksumSha256", hash(bytes));
            item.put("caption", "Synthetic private caption " + i);
            if (type.equals("AUDIO")) item.put("durationSeconds", .3);
            items.add(item);
        }
        body.put("items", items);
        return body;
    }
    private Created create(Map<String, Object> body) throws Exception {
        String key = UUID.randomUUID().toString(), serialized = JSON.writeValueAsString(body);
        var result = send(guest, "POST", "/api/contributions", key, serialized, Map.of());
        assertThat(result.statusCode()).isEqualTo(201);
        assertThat(result.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(result.body()).doesNotContain("guestName", "caption", "textContent", "originalFilename", "objectKey", "uploadUrl", key);
        assertThat(JsonPath.<List<String>>read(result.body(), "$.memories[*].reviewStatus")).containsOnly("PENDING");
        assertThat(JsonPath.<List<String>>read(result.body(), "$.memories[*].visibility")).containsOnly("COUPLE_ONLY");
        String contribution = value(result, "$.contributionId");
        var memoryIds = JsonPath.<List<String>>read(result.body(), "$.memories[*].memoryId");
        assertThat(db.sql("SELECT id FROM memory WHERE contribution_id=:id ORDER BY item_position")
                .param("id", UUID.fromString(contribution)).query(UUID.class).list().stream().map(UUID::toString).toList())
                .containsExactlyElementsOf(memoryIds);
        if (body.get("items") instanceof List<?> items) {
            var clientIds = items.stream().map(item -> ((Map<?, ?>) item).get("clientItemId").toString()).toList();
            assertThat(JsonPath.<List<String>>read(result.body(), "$.memories[*].clientItemId")).containsExactlyElementsOf(clientIds);
            assertThat(db.sql("SELECT client_item_id FROM memory WHERE contribution_id=:id ORDER BY item_position")
                    .param("id", UUID.fromString(contribution)).query(UUID.class).list().stream().map(UUID::toString).toList())
                    .containsExactlyElementsOf(clientIds);
        }
        return new Created(key, serialized, result, contribution, memoryIds);
    }
    private HttpResponse<String> replay(Created item) throws Exception { return send(guest, "POST", "/api/contributions", item.key(), item.body(), Map.of()); }
    private HttpResponse<String> receipt(Created item) throws Exception { return send(guest, "GET", "/api/contributions/" + item.id() + "/receipt", item.key(), null, Map.of()); }
    private HttpResponse<String> grant(Created item, int position) throws Exception {
        var response = send(guest, "POST", item.path(position) + "/upload-grants", item.key(), null, Map.of());
        assertThat(response.statusCode()).isEqualTo(201);
        return response;
    }
    private void stage(HttpResponse<String> grant, byte[] bytes) { storage.objects.put("staging/" + value(grant, "$.grantId"), bytes.clone()); }
    private HttpResponse<String> finish(Created item, int position, HttpResponse<String> grant) throws Exception {
        return send(guest, "POST", item.path(position) + "/finalize", item.key(), JSON.writeValueAsString(Map.of("grantId", value(grant, "$.grantId"))), Map.of());
    }
    private HttpResponse<String> upload(Created item, int position, byte[] bytes) throws Exception {
        var permission = grant(item, position); stage(permission, bytes);
        var finished = finish(item, position, permission);
        assertThat(finished.statusCode()).isEqualTo(200);
        return finished;
    }
    private void login() throws Exception {
        var current = get(couple, "/api/session");
        var response = send(couple, "POST", "/api/session", null,
                JSON.writeValueAsString(Map.of("username", username, "password", PASSWORD)),
                Map.of("X-CSRF-Token", value(current, "$.csrfToken")));
        assertThat(response.statusCode()).isEqualTo(200);
        csrf = value(response, "$.csrfToken");
        assertThat(csrf).isNotBlank();
    }
    private HttpResponse<String> review(String id, String status, String revision) throws Exception {
        return send(couple, "PATCH", "/api/memories/" + id + "/review", null,
                JSON.writeValueAsString(Map.of("reviewStatus", status)), Map.of("X-CSRF-Token", csrf, "If-Match", revision));
    }
    private void logoutAndRejectOldCookie(String id) throws Exception {
        String oldCookie = cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("MEMORY_ARCHIVE_SESSION"))
                .map(cookie -> cookie.getName() + "=" + cookie.getValue()).findFirst().orElseThrow();
        assertThat(send(couple, "DELETE", "/api/session", null, null, Map.of("X-CSRF-Token", csrf)).statusCode()).isEqualTo(204);
        for (String path : List.of("/api/memories", "/api/memories/" + id, "/api/memories/" + id + "/playback")) {
            assertThat(get(couple, path).statusCode()).isEqualTo(401);
            assertThat(send(guest, "GET", path, null, null, Map.of("Cookie", oldCookie)).statusCode()).isEqualTo(401);
        }
    }
    private List<String> paginatedIds(String status, int limit) throws Exception {
        var ids = new LinkedHashSet<String>();
        String cursor = null;
        int pages = 0;
        do {
            String path = "/api/memories?reviewStatus=" + status + "&limit=" + limit + (cursor == null ? "" : "&cursor=" + cursor);
            var response = get(couple, path);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
            var page = JsonPath.<List<String>>read(response.body(), "$.items[*].memoryId");
            assertThat(page).hasSizeLessThanOrEqualTo(limit);
            assertThat(JsonPath.<List<String>>read(response.body(), "$.items[*].visibility")).allMatch("COUPLE_ONLY"::equals);
            for (String id : page) assertThat(ids.add(id)).as("A memory appears on only one page").isTrue();
            cursor = value(response, "$.nextCursor");
            assertThat(++pages).as("Pagination terminates").isLessThan(20);
        } while (cursor != null);
        return List.copyOf(ids);
    }
    private void assertOriginal(String memory, byte[] bytes) {
        String key = db.sql("SELECT object_key FROM media_asset WHERE memory_id=:id")
                .param("id", UUID.fromString(memory)).query(String.class).single();
        assertThat(storage.objects.get(key)).isEqualTo(bytes);
    }
    private HttpResponse<String> get(HttpClient client, String path) throws Exception { return send(client, "GET", path, null, null, Map.of()); }
    private HttpResponse<String> send(HttpClient client, String method, String path, String key, String body, Map<String, String> headers) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(60))
                .header("X-Api-Contract", "1").header("Content-Type", "application/json").header("Origin", "http://localhost:" + port);
        if (key != null) request.header("Idempotency-Key", key);
        headers.forEach(request::header);
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private static String value(HttpResponse<String> response, String path) { return JsonPath.read(response.body(), path); }
    private static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private record Created(String key, String body, HttpResponse<String> receipt, String id, List<String> memoryIds) {
        String memory(int position) { return memoryIds.get(position); }
        String path(int position) { return "/api/contributions/" + id + "/memories/" + memory(position); }
    }
}
