package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "archive.environment=local", "archive.revealed=true", "archive.storage.enabled=false",
        "spring.profiles.active=local"})
class InboxPostgresHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired PasswordEncoder encoder;
    private static final Instant TIME = Instant.parse("2026-10-09T12:00:00.123456Z");
    private static final String PASSWORD = "synthetic-inbox-only-password";
    private final List<UUID> contributionIds = new ArrayList<>();
    private UUID accountId;
    private String username;
    private HttpClient client;

    @BeforeEach void fixtures() {
        accountId = UUID.randomUUID();
        username = "synthetic-inbox-" + accountId;
        db.sql("""
                INSERT INTO archive_account (id, username, display_name, password_hash, role, enabled, credentials_version)
                VALUES (:id, :username, 'Synthetic Inbox Couple', :hash, 'COUPLE', true, 1)
                """).param("id", accountId).param("username", username).param("hash", encoder.encode(PASSWORD)).update();
        client = newClient();
    }

    @AfterEach void removeOnlyOwnedFixtures() {
        for (UUID contribution : contributionIds) {
            db.sql("""
                    DELETE FROM media_asset WHERE memory_id IN
                    (SELECT id FROM memory WHERE contribution_id = :contribution)
                    """).param("contribution", contribution).update();
            db.sql("DELETE FROM memory WHERE contribution_id = :contribution").param("contribution", contribution).update();
            db.sql("DELETE FROM contribution WHERE id = :contribution").param("contribution", contribution).update();
        }
        if (accountId != null) db.sql("DELETE FROM archive_account WHERE id = :id").param("id", accountId).update();
    }

    @Test void actualSessionReadsCommittedNotesAndPhotoMetadataWithoutStorageAccess() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID photo = photo(2, "PENDING", "UPLOADED", false);
        // A legacy TEXT caption must not violate the current TEXT response contract.
        db.sql("UPDATE memory SET caption = 'legacy text caption' WHERE id = :id").param("id", note).update();
        assertThat(get("/api/memories").statusCode()).isEqualTo(401);
        login();
        var listed = get("/api/memories");
        assertThat(listed.statusCode()).isEqualTo(200);
        assertThat(ids(listed)).containsExactly(photo.toString(), note.toString());
        assertThat(listed.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(listed.body()).doesNotContain("objectKey", "originals/", "uploadUrl", "idempotencyKey", "csrfToken", PASSWORD);

        var detail = get("/api/memories/" + note);
        assertThat(detail.statusCode()).isEqualTo(200);
        assertThat(detail.headers().firstValue("ETag")).contains("\"1\"");
        assertThat((String) JsonPath.read(detail.body(), "$.textContent")).isEqualTo("<script>synthetic markup</script>");
        assertThat((Object) JsonPath.read(detail.body(), "$.guestName")).isNull();
        assertThat((Object) JsonPath.read(detail.body(), "$.caption")).isNull();
        assertThat((Object) JsonPath.read(detail.body(), "$.deleteAfter")).isNull();

        db.sql("UPDATE memory SET revision = 7, updated_at = updated_at + INTERVAL '1 second' WHERE id = :id")
                .param("id", note).update();
        var changed = get("/api/memories/" + note);
        assertThat(changed.headers().firstValue("ETag")).contains("\"7\"");
        assertThat((Integer) JsonPath.read(changed.body(), "$.revision")).isEqualTo(7);

        assertThat(get("/api/memories/" + photo + "/playback").statusCode()).isEqualTo(503);
        // Unavailable original storage does not hide the durable metadata or pretend the photo disappeared.
        assertThat(get("/api/memories/" + photo).statusCode()).isEqualTo(200);
    }

    @Test void tiedTimestampKeysetPaginationDoesNotDuplicateRowsWhenNewMemoriesArrive() throws Exception {
        UUID first = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, "Guest");
        UUID second = memory(2, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID third = memory(3, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        login();
        var page = get("/api/memories?limit=2");
        assertThat(page.statusCode()).isEqualTo(200);
        assertThat(ids(page)).containsExactly(third.toString(), second.toString());
        String cursor = JsonPath.read(page.body(), "$.nextCursor");
        assertThat(cursor).isNotEmpty();
        memory(4, "kevin-mel-wedding", "PENDING", "TEXT", TIME.plusSeconds(1), null);

        var next = get("/api/memories?limit=2&cursor=" + cursor);
        assertThat(next.statusCode()).isEqualTo(200);
        assertThat(ids(next)).containsExactly(first.toString());
        assertThat((Object) JsonPath.read(next.body(), "$.nextCursor")).isNull();
        var mismatch = get("/api/memories?reviewStatus=KEEP&cursor=" + cursor);
        assertThat(mismatch.statusCode()).isEqualTo(400);
        assertThat((String) JsonPath.read(mismatch.body(), "$.error.code")).isEqualTo("INVALID_CURSOR");
        assertThat(get("/api/memories?cursor=not-valid").statusCode()).isEqualTo(400);
    }

    @Test void eventTypeDeletionUploadAndIntegrityBoundariesApplyToListAndDetail() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID photo = photo(2, "PENDING", "UPLOADED", false);
        var hidden = List.of(
                photo(3, "PENDING", "PENDING", false),
                photo(4, "PENDING", "FAILED", false),
                memory(5, "other-synthetic-event", "PENDING", "TEXT", TIME, null),
                memory(6, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null),
                memory(7, "kevin-mel-wedding", "PENDING", "AUDIO", TIME, null),
                photo(8, "PENDING", "UPLOADED", true));
        UUID kept = memory(9, "kevin-mel-wedding", "KEEP", "TEXT", TIME, null);
        UUID archived = photo(10, "ARCHIVED", "UPLOADED", false);
        login();
        assertThat(ids(get("/api/memories"))).containsExactly(photo.toString(), note.toString());
        for (UUID id : hidden) {
            var response = get("/api/memories/" + id);
            assertThat(response.statusCode()).isEqualTo(404);
            assertThat(response.body()).doesNotContain(id.toString(), "synthetic markup", "originals/");
        }
        assertThat(ids(get("/api/memories?reviewStatus=KEEP"))).containsExactly(kept.toString());
        assertThat(ids(get("/api/memories?reviewStatus=ARCHIVED"))).containsExactly(archived.toString());
        assertThat(get("/api/memories?reviewStatus=DELETE").statusCode()).isEqualTo(400);
    }

    @Test void credentialVersionAndDisablementRevokeActualSessions() throws Exception {
        memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        for (String change : List.of("credentials_version = 2", "enabled = false", "role = 'OPERATOR'")) {
            db.sql("UPDATE archive_account SET role = 'COUPLE', enabled = true, credentials_version = 1 WHERE id = :id")
                    .param("id", accountId).update();
            client = newClient();
            login();
            db.sql("UPDATE archive_account SET " + change + " WHERE id = :id").param("id", accountId).update();
            var response = get("/api/memories");
            assertThat(response.statusCode()).isEqualTo(401);
            assertThat((String) JsonPath.read(response.body(), "$.error.code")).isEqualTo("AUTH_REQUIRED");
            assertThat(response.body()).doesNotContain("synthetic markup", PASSWORD);
        }
    }

    @Test void migrationDefaultsNewRowsToPositivePersistedRevision() {
        UUID memory = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        assertThat(db.sql("SELECT revision FROM memory WHERE id = :id").param("id", memory).query(Integer.class).single()).isEqualTo(1);
        assertThatThrownBy(() -> db.sql("UPDATE memory SET revision = 0 WHERE id = :id").param("id", memory).update())
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private UUID memory(int number, String event, String status, String type, Instant at, String name) {
        UUID contribution = UUID.randomUUID();
        UUID memory = UUID.fromString("00000000-0000-4000-8000-" + String.format("%012d", number));
        contributionIds.add(contribution);
        var timestamp = OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
        db.sql("""
                INSERT INTO contribution (id, event_key, guest_name, idempotency_key, created_at)
                VALUES (:id, :event, :name, :key, :created)
                """).param("id", contribution).param("event", event).param("name", name)
                .param("key", "synthetic-private-key-" + UUID.randomUUID()).param("created", timestamp).update();
        db.sql("""
                INSERT INTO memory (id, contribution_id, memory_type, text_content, review_status, created_at, updated_at)
                VALUES (:id, :contribution, :type, :text, :status, :created, :created)
                """).param("id", memory).param("contribution", contribution).param("type", type)
                .param("text", "TEXT".equals(type) ? "<script>synthetic markup</script>" : null)
                .param("status", status).param("created", timestamp).update();
        return memory;
    }

    private UUID photo(int number, String review, String upload, boolean corruptExpectedHash) {
        UUID memory = memory(number, "kevin-mel-wedding", review, "PHOTO", TIME, "Synthetic Guest");
        UUID asset = UUID.randomUUID();
        db.sql("UPDATE memory SET caption = 'Synthetic photo caption' WHERE id = :id").param("id", memory).update();
        db.sql("""
                INSERT INTO media_asset (id, memory_id, object_key, original_filename, detected_format,
                    byte_size, checksum_sha256, upload_state, declared_content_type, expected_byte_size, expected_checksum_sha256)
                VALUES (:id, :memory, :key, 'synthetic.png', 'image/png', 100, :checksum,
                    :upload, 'image/png', 100, :expected)
                """).param("id", asset).param("memory", memory).param("key", "originals/" + asset)
                .param("checksum", "a".repeat(64)).param("expected", (corruptExpectedHash ? "b" : "a").repeat(64))
                .param("upload", upload).update();
        return memory;
    }

    private void login() throws Exception {
        var anonymous = get("/api/session");
        String token = JsonPath.read(anonymous.body(), "$.csrfToken");
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session"))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("X-CSRF-Token", token)
                .header("Origin", "http://localhost:" + port).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"" + username + "\",\"password\":\"" + PASSWORD + "\"}")).build();
        assertThat(client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
    }
    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private static List<String> ids(HttpResponse<String> response) { return JsonPath.read(response.body(), "$.items[*].memoryId"); }
    private static HttpClient newClient() {
        return HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
    }
}
