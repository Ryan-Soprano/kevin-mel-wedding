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
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "archive.environment=local", "archive.revealed=true", "archive.storage.enabled=false",
        "spring.profiles.active=local"})
class InboxPostgresHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired PasswordEncoder encoder;
    @Autowired com.kevinmel.archive.contribution.ContributionRepository contributions;
    @Autowired com.kevinmel.archive.media.PhotoRepository photos;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired com.kevinmel.archive.sharing.SharingRepository sharing;
    private static final Instant TIME = Instant.parse("2026-10-09T12:00:00.123456Z");
    private static final String PASSWORD = "synthetic-inbox-only-password";
    private final List<UUID> contributionIds = new ArrayList<>();
    private final List<String> erasedDigests = new ArrayList<>();
    private UUID accountId;
    private String username;
    private HttpClient client;
    private String csrfToken;

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
            db.sql("DELETE FROM review_audit WHERE memory_id IN (SELECT id FROM memory WHERE contribution_id = :contribution)")
                    .param("contribution", contribution).update();
            db.sql("""
                    DELETE FROM media_asset WHERE memory_id IN
                    (SELECT id FROM memory WHERE contribution_id = :contribution)
                    """).param("contribution", contribution).update();
            db.sql("DELETE FROM memory WHERE contribution_id = :contribution").param("contribution", contribution).update();
            db.sql("DELETE FROM contribution WHERE id = :contribution").param("contribution", contribution).update();
        }
        for (String digest : erasedDigests) db.sql("DELETE FROM erased_submission_key WHERE key_digest = :digest").param("digest", digest).update();
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
        assertThat(JsonPath.<Number>read(listed.body(), "$.totalCount").longValue()).isEqualTo(2);
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

    @Test void sharingAudiencesAreDurableAndEveryGuestRequestEnforcesCurrentVisibility() throws Exception {
        UUID note = memory(800, "kevin-mel-wedding", "PENDING", "TEXT", TIME, "Private guest identity");
        assertThat(guestGet("/api/shared-memories/" + note).statusCode()).isEqualTo(404);
        login();
        var shared = audience(note, "KEEP", "FRIENDS_FAMILY", 1);
        assertThat(shared.statusCode()).isEqualTo(200);
        assertThat(JsonPath.<String>read(shared.body(), "$.visibility")).isEqualTo("FRIENDS_FAMILY");
        assertThat(guestGet("/api/shared-memories/" + note).statusCode()).isEqualTo(404);
        assertThat(ids(guestGet("/api/shared-memories"))).doesNotContain(note.toString());
        var issued = shareLink(note, 2);
        assertThat(issued.statusCode()).isEqualTo(200);
        assertThat(issued.headers().firstValue("ETag")).contains("\"3\"");
        String url = JsonPath.read(issued.body(), "$.url");
        String token = url.substring(url.indexOf("#token=") + 7);
        assertThat(token).hasSize(43);
        assertThat(db.sql("SELECT token_digest FROM memory_share_link WHERE memory_id=:id").param("id", note).query(String.class).single())
                .hasSize(64).isNotEqualTo(token);
        var guest = guestGet("/api/shared-memories/" + note + "?token=" + token);
        assertThat(guest.statusCode()).isEqualTo(200);
        assertThat(guest.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(guest.headers().firstValue("Referrer-Policy")).contains("no-referrer");
        assertThat(guest.body()).contains("synthetic markup").doesNotContain("Private guest identity", "guestName", "contributionId",
                "originalFilename", "checksum", "objectKey", "token", "reviewStatus", "idempotencyKey");
        assertThat(guestGet("/api/shared-memories/" + note + "?token=" + "A".repeat(43)).statusCode()).isEqualTo(404);
        assertThat(shareLink(note, 2).statusCode()).isEqualTo(412);
        var rotated = shareLink(note, 3);
        assertThat(rotated.statusCode()).isEqualTo(200);
        String newUrl = JsonPath.read(rotated.body(), "$.url");
        String newToken = newUrl.substring(newUrl.indexOf("#token=") + 7);
        assertThat(newToken).isNotEqualTo(token);
        assertThat(guestGet("/api/shared-memories/" + note + "?token=" + token).statusCode()).isEqualTo(404);
        assertThat(guestGet("/api/shared-memories/" + note + "?token=" + newToken).statusCode()).isEqualTo(200);
        assertThat(audience(note, "KEEP", "PUBLIC", 4).statusCode()).isEqualTo(200);
        assertThat(guestGet("/api/shared-memories/" + note).statusCode()).isEqualTo(200);
        assertThat(ids(guestGet("/api/shared-memories"))).contains(note.toString());
        assertThat(ids(get("/api/memories?reviewStatus=KEEP"))).contains(note.toString());
        assertThat(get("/api/memories/" + note).statusCode()).isEqualTo(200);
        assertThat(audience(note, "KEEP", "COUPLE_ONLY", 5).statusCode()).isEqualTo(200);
        assertThat(guestGet("/api/shared-memories/" + note + "?token=" + newToken).statusCode()).isEqualTo(404);
        assertThat(ids(guestGet("/api/shared-memories"))).doesNotContain(note.toString());
        assertThat(db.sql("SELECT COUNT(*) FROM memory_share_link WHERE memory_id=:id").param("id", note).query(Long.class).single()).isZero();
        assertThat(db.sql("SELECT before_visibility||'>'||after_visibility FROM review_audit WHERE memory_id=:id ORDER BY after_revision")
                .param("id", note).query(String.class).list()).containsExactly("COUPLE_ONLY>FRIENDS_FAMILY", "FRIENDS_FAMILY>FRIENDS_FAMILY",
                        "FRIENDS_FAMILY>FRIENDS_FAMILY", "FRIENDS_FAMILY>PUBLIC", "PUBLIC>COUPLE_ONLY");
    }

    @Test void deleteArchiveAndRestoreNeverRepublishSharedContentAndPublicPagesExcludeUnsafeMedia() throws Exception {
        UUID note = memory(801, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID badPhoto = photo(802, "KEEP", "UPLOADED", true);
        db.sql("UPDATE memory SET visibility='PUBLIC' WHERE id=:id").param("id", badPhoto).update();
        assertThat(guestGet("/api/shared-memories/" + badPhoto).statusCode()).isEqualTo(404);
        assertThat(guestGet("/api/shared-memories/" + badPhoto + "/playback").statusCode()).isEqualTo(404);
        assertThat(ids(guestGet("/api/shared-memories"))).doesNotContain(badPhoto.toString());
        login();
        assertThat(audience(note, "KEEP", "PUBLIC", 1).statusCode()).isEqualTo(200);
        assertThat(patch(note, "ARCHIVED", 2).statusCode()).isEqualTo(200);
        assertThat(guestGet("/api/shared-memories/" + note).statusCode()).isEqualTo(404);
        assertThat(audience(note, "KEEP", "FRIENDS_FAMILY", 3).statusCode()).isEqualTo(200);
        String url = JsonPath.read(shareLink(note, 4).body(), "$.url");
        String token = url.substring(url.indexOf("#token=") + 7);
        var deleted = patch(note, "DELETE", 5);
        assertThat(deleted.statusCode()).isEqualTo(200);
        assertThat(JsonPath.<String>read(deleted.body(), "$.visibility")).isEqualTo("COUPLE_ONLY");
        assertThat(guestGet("/api/shared-memories/" + note + "?token=" + token).statusCode()).isEqualTo(404);
        var restored = audience(note, "KEEP", "PUBLIC", 6);
        assertThat(restored.statusCode()).isEqualTo(200);
        assertThat(JsonPath.<String>read(restored.body(), "$.visibility")).isEqualTo("COUPLE_ONLY");
        assertThat(guestGet("/api/shared-memories/" + note).statusCode()).isEqualTo(404);
        assertThat(db.sql("SELECT COUNT(*) FROM memory_share_link WHERE memory_id=:id").param("id", note).query(Long.class).single()).isZero();
    }

    @Test void playbackQueuedBehindTokenRotationChecksFreshCapabilitySnapshot() throws Exception {
        UUID note = memory(803, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        login();
        assertThat(audience(note, "KEEP", "FRIENDS_FAMILY", 1).statusCode()).isEqualTo(200);
        assertThat(shareLink(note, 2).statusCode()).isEqualTo(200);
        String oldDigest = db.sql("SELECT token_digest FROM memory_share_link WHERE memory_id=:id")
                .param("id", note).query(String.class).single();
        var future = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<java.util.Optional<MemoryDetail>>>();
        var readerPid = new java.util.concurrent.atomic.AtomicReference<Integer>();
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            new org.springframework.transaction.support.TransactionTemplate(transactions).execute(ignored -> {
                db.sql("SELECT id FROM memory WHERE id=:id FOR UPDATE").param("id", note).query(UUID.class).single();
                future.set(executor.submit(() -> new org.springframework.transaction.support.TransactionTemplate(transactions)
                        .execute(read -> {
                            readerPid.set(db.sql("SELECT pg_backend_pid()").query(Integer.class).single());
                            return sharing.accessibleDetail(note, oldDigest, true);
                        })));
                long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
                boolean waiting = false;
                // Activity inventories can be cached for this writer transaction. The known
                // reader PID lets the lock manager prove this exact writer is blocking it.
                while (System.nanoTime() < deadline) {
                    waiting = readerPid.get() != null && db.sql("SELECT pg_backend_pid() = ANY(pg_blocking_pids(:reader))")
                            .param("reader", readerPid.get()).query(Boolean.class).single();
                    if (waiting) break;
                    if (future.get().isDone()) {
                        try { throw new AssertionError("Reader completed before the owned memory-lock wait: " + future.get().get()); }
                        catch (java.util.concurrent.ExecutionException failure) { throw new AssertionError("Reader failed before the owned memory-lock wait.", failure.getCause()); }
                        catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new AssertionError(failure); }
                    }
                    try { Thread.sleep(10); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new AssertionError(failure); }
                }
                assertThat(waiting).as("Reader must have reached the memory lock before the capability rotates").isTrue();
                db.sql("UPDATE memory_share_link SET token_digest=:digest WHERE memory_id=:id")
                        .param("digest", "f".repeat(64)).param("id", note).update();
                db.sql("UPDATE memory SET revision=revision+1 WHERE id=:id").param("id", note).update();
                return null;
            });
            assertThat(future.get().get(5, java.util.concurrent.TimeUnit.SECONDS)).isEmpty();
        }
    }

    private HttpResponse<String> audience(UUID memory, String status, String visibility, int revision) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/memories/" + memory + "/review"))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("X-CSRF-Token", csrfToken)
                .header("If-Match", "\"" + revision + "\"").header("Content-Type", "application/json").header("Origin", "http://localhost:" + port)
                .method("PATCH", HttpRequest.BodyPublishers.ofString("{\"reviewStatus\":\"" + status + "\",\"visibility\":\"" + visibility + "\"}")).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> shareLink(UUID memory, int revision) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/memories/" + memory + "/share-link"))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("X-CSRF-Token", csrfToken)
                .header("If-Match", "\"" + revision + "\"").header("Origin", "http://localhost:" + port)
                .POST(HttpRequest.BodyPublishers.noBody()).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> guestGet(String path) throws Exception {
        return newClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(20)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void tiedTimestampKeysetPaginationDoesNotDuplicateRowsWhenNewMemoriesArrive() throws Exception {
        UUID first = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, "Guest");
        UUID second = memory(2, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID third = memory(3, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        login();
        var page = get("/api/memories?limit=2");
        assertThat(page.statusCode()).isEqualTo(200);
        assertThat(ids(page)).containsExactly(third.toString(), second.toString());
        assertThat(JsonPath.<Number>read(page.body(), "$.totalCount").longValue()).isEqualTo(3);
        String cursor = JsonPath.read(page.body(), "$.nextCursor");
        assertThat(cursor).isNotEmpty();
        memory(4, "kevin-mel-wedding", "PENDING", "TEXT", TIME.plusSeconds(1), null);

        var next = get("/api/memories?limit=2&cursor=" + cursor);
        assertThat(next.statusCode()).isEqualTo(200);
        assertThat(ids(next)).containsExactly(first.toString());
        assertThat(JsonPath.<Number>read(next.body(), "$.totalCount").longValue()).isEqualTo(4);
        assertThat((Object) JsonPath.read(next.body(), "$.nextCursor")).isNull();
        var afterLast = get("/api/memories?limit=2&cursor=" + new InboxCursor("PENDING", TIME, first).encode());
        assertThat(ids(afterLast)).isEmpty();
        assertThat(JsonPath.<Number>read(afterLast.body(), "$.totalCount").longValue()).isEqualTo(4);
        var mismatch = get("/api/memories?reviewStatus=KEEP&cursor=" + cursor);
        assertThat(mismatch.statusCode()).isEqualTo(400);
        assertThat((String) JsonPath.read(mismatch.body(), "$.error.code")).isEqualTo("INVALID_CURSOR");
        assertThat(get("/api/memories?cursor=not-valid").statusCode()).isEqualTo(400);
    }

    @Test void eventTypeDeletionUploadAndIntegrityBoundariesApplyToListAndDetail() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        UUID photo = photo(2, "PENDING", "UPLOADED", false);
        UUID recoverable = memory(11, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null);
        UUID purging = memory(12, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null);
        UUID purged = memory(13, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null);
        db.sql("UPDATE memory SET delete_after = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE id IN (:first,:second,:third)")
                .param("first", recoverable).param("second", purging).param("third", purged).update();
        db.sql("UPDATE memory SET purge_started_at = CURRENT_TIMESTAMP WHERE id IN (:first,:second)")
                .param("first", purging).param("second", purged).update();
        db.sql("UPDATE memory SET purged_at = CURRENT_TIMESTAMP, text_content = NULL WHERE id = :id")
                .param("id", purged).update();
        var hidden = List.of(
                photo(3, "PENDING", "PENDING", false),
                photo(4, "PENDING", "FAILED", false),
                memory(5, "other-synthetic-event", "PENDING", "TEXT", TIME, null),
                memory(6, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null),
                memory(7, "kevin-mel-wedding", "PENDING", "AUDIO", TIME, null),
                photo(8, "PENDING", "UPLOADED", true), purging, purged);
        UUID kept = memory(9, "kevin-mel-wedding", "KEEP", "TEXT", TIME, null);
        UUID archived = photo(10, "ARCHIVED", "UPLOADED", false);
        login();
        var pending = get("/api/memories");
        assertThat(ids(pending)).containsExactly(photo.toString(), note.toString());
        assertThat(JsonPath.<Number>read(pending.body(), "$.totalCount").longValue()).isEqualTo(2);
        for (UUID id : hidden) {
            var response = get("/api/memories/" + id);
            assertThat(response.statusCode()).isEqualTo(404);
            assertThat(response.body()).doesNotContain(id.toString(), "synthetic markup", "originals/");
        }
        var keptPage = get("/api/memories?reviewStatus=KEEP");
        assertThat(ids(keptPage)).containsExactly(kept.toString());
        assertThat(JsonPath.<Number>read(keptPage.body(), "$.totalCount").longValue()).isEqualTo(1);
        var archivedPage = get("/api/memories?reviewStatus=ARCHIVED");
        assertThat(ids(archivedPage)).containsExactly(archived.toString());
        assertThat(JsonPath.<Number>read(archivedPage.body(), "$.totalCount").longValue()).isEqualTo(1);
        var deletedPage = get("/api/memories?reviewStatus=DELETE");
        assertThat(ids(deletedPage)).containsExactly(recoverable.toString());
        assertThat(JsonPath.<Number>read(deletedPage.body(), "$.totalCount").longValue()).isEqualTo(1);
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


    @Test void persistedReviewsAreAtomicNoOpAndReversibleWithoutExtendingDeletion() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, "Synthetic Guest");
        login();
        var kept = patch(note, "KEEP", 1);
        assertThat(kept.statusCode()).isEqualTo(200);
        assertThat(kept.headers().firstValue("ETag")).contains("\"2\"");
        String updated = JsonPath.read(kept.body(), "$.updatedAt");
        var repeatedKeep = patch(note, "KEEP", 2);
        assertThat(repeatedKeep.statusCode()).isEqualTo(200);
        assertThat((String) JsonPath.read(repeatedKeep.body(), "$.updatedAt")).isEqualTo(updated);
        assertThat(patch(note, "ARCHIVED", 1).statusCode()).isEqualTo(412);

        Instant deletionRequestedAt = Instant.now();
        var deleted = patch(note, "DELETE", 2);
        Instant deletionReturnedAt = Instant.now();
        assertThat(deleted.statusCode()).isEqualTo(200);
        String deadline = JsonPath.read(deleted.body(), "$.deleteAfter");
        assertThat(Instant.parse(deadline)).isBetween(deletionRequestedAt.plusSeconds(30L * 86400).minusMillis(1),
                deletionReturnedAt.plusSeconds(30L * 86400).plusMillis(1));
        var repeatedDelete = patch(note, "DELETE", 3);
        assertThat(repeatedDelete.statusCode()).isEqualTo(200);
        assertThat((String) JsonPath.read(repeatedDelete.body(), "$.deleteAfter")).isEqualTo(deadline);
        assertThat(repeatedDelete.headers().firstValue("ETag")).contains("\"3\"");
        assertThat(ids(get("/api/memories?reviewStatus=DELETE"))).containsExactly(note.toString());
        assertThat(get("/api/memories/" + note).statusCode()).isEqualTo(200);

        var restored = patch(note, "PENDING", 3);
        assertThat(restored.statusCode()).isEqualTo(200);
        assertThat(restored.headers().firstValue("ETag")).contains("\"4\"");
        assertThat((Object) JsonPath.read(restored.body(), "$.deleteAfter")).isNull();
        assertThat(ids(get("/api/memories?reviewStatus=DELETE"))).isEmpty();
        assertThat(ids(get("/api/memories"))).containsExactly(note.toString());
        assertThat(db.sql("SELECT count(*) FROM review_audit WHERE memory_id = :id").param("id", note).query(Integer.class).single()).isEqualTo(3);
        assertThat(db.sql("SELECT actor_account_id FROM review_audit WHERE memory_id = :id").param("id", note).query(UUID.class).list())
                .hasSize(3).containsOnly(accountId);
    }

    @Test void concurrentSameRevisionRequestsHaveOneWinnerAndOneAudit() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "PENDING", "TEXT", TIME, null);
        login();
        var first = client.sendAsync(patchRequest(note, "KEEP", 1), HttpResponse.BodyHandlers.ofString());
        var second = client.sendAsync(patchRequest(note, "ARCHIVED", 1), HttpResponse.BodyHandlers.ofString());
        var one = first.get(30, java.util.concurrent.TimeUnit.SECONDS);
        var two = second.get(30, java.util.concurrent.TimeUnit.SECONDS);
        assertThat(List.of(one.statusCode(), two.statusCode())).containsExactlyInAnyOrder(200, 412);
        assertThat(db.sql("SELECT revision FROM memory WHERE id = :id").param("id", note).query(Integer.class).single()).isEqualTo(2);
        assertThat(db.sql("SELECT count(*) FROM review_audit WHERE memory_id = :id").param("id", note).query(Integer.class).single()).isEqualTo(1);
    }

    @Test void expiredClaimedAndPurgedRowsNeverReturnPrivateContentOrAcceptReview() throws Exception {
        UUID note = memory(1, "kevin-mel-wedding", "DELETE", "TEXT", TIME, null);
        login();
        assertThat(ids(get("/api/memories?reviewStatus=DELETE"))).isEmpty();
        assertThat(get("/api/memories/" + note).statusCode()).isEqualTo(404);
        assertThat(patch(note, "PENDING", 1).statusCode()).isEqualTo(404);
        db.sql("UPDATE memory SET delete_after = CURRENT_TIMESTAMP + INTERVAL '1 day', purge_started_at = CURRENT_TIMESTAMP WHERE id = :id")
                .param("id", note).update();
        assertThat(get("/api/memories/" + note).statusCode()).isEqualTo(404);
        assertThat(patch(note, "KEEP", 1).statusCode()).isEqualTo(404);
        db.sql("UPDATE memory SET purged_at = CURRENT_TIMESTAMP, text_content = NULL, caption = NULL WHERE id = :id").param("id", note).update();
        assertThat(ids(get("/api/memories?reviewStatus=DELETE"))).isEmpty();
        assertThat(patch(note, "PENDING", 1).statusCode()).isEqualTo(404);
        assertThat(db.sql("SELECT count(*) FROM review_audit WHERE memory_id = :id").param("id", note).query(Integer.class).single()).isZero();
    }

    @Test void purgedTextRetainsGuestReceiptIdentityAndCannotRecreateContent() throws Exception {
        String key = UUID.randomUUID().toString();
        String body = "{\"guestName\":\"Synthetic Guest\",\"message\":\"Synthetic text that will be scrubbed\"}";
        var created = postText(key, body);
        assertThat(created.statusCode()).isEqualTo(201);
        UUID contribution = UUID.fromString(JsonPath.read(created.body(), "$.contributionId"));
        UUID note = UUID.fromString(JsonPath.read(created.body(), "$.memories[0].memoryId"));
        contributionIds.add(contribution);
        scrubTombstone(note);
        db.sql("UPDATE contribution SET guest_name = NULL WHERE id = :id").param("id", contribution).update();
        eraseKey(key);

        var replay = postText(key, body);
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat((String) JsonPath.read(replay.body(), "$.memories[0].memoryId")).isEqualTo(note.toString());
        assertThat((String) JsonPath.read(replay.body(), "$.memories[0].reviewStatus")).isEqualTo("DELETE");
        assertThat((String) JsonPath.read(replay.body(), "$.completion")).isEqualTo("COMPLETE");
        assertThat(replay.body()).doesNotContain("Synthetic Guest", "will be scrubbed", "textContent", key);
        assertThat(postText(key, "{\"message\":\"changed\"}").statusCode()).isEqualTo(409);
        assertThat(db.sql("SELECT text_content IS NULL FROM memory WHERE id = :id").param("id", note)
                .query(Boolean.class).single()).isTrue();
        assertThat(db.sql("SELECT count(*) FROM memory WHERE contribution_id = :id").param("id", contribution).query(Integer.class).single()).isEqualTo(1);
    }

    @Test void purgedPhotoPreservesBatchReceiptIdsAndSuccessfulUploadState() {
        String key = UUID.randomUUID().toString();
        var request = photoRequest(2);
        var created = photos.create(request, key);
        UUID contribution = created.receipt().contributionId();
        contributionIds.add(contribution);
        UUID first = created.receipt().memories().getFirst().memoryId();
        UUID sibling = created.receipt().memories().getLast().memoryId();
        db.sql("UPDATE media_asset SET detected_format = declared_content_type, upload_state = 'UPLOADED' WHERE memory_id IN (:first,:sibling)")
                .param("first", first).param("sibling", sibling).update();
        scrubTombstone(first);
        db.sql("DELETE FROM media_asset WHERE memory_id = :id").param("id", first).update();
        eraseKey(key);
        var replay = photos.create(request, key).receipt();
        assertThat(replay.memories()).extracting(com.kevinmel.archive.contribution.ContributionReceipt.MemoryReceipt::memoryId)
                .containsExactly(first, sibling);
        assertThat(replay.memories()).extracting(com.kevinmel.archive.contribution.ContributionReceipt.MemoryReceipt::uploadState)
                .containsExactly("UPLOADED", "UPLOADED");
        assertThat(replay.memories().getFirst().reviewStatus()).isEqualTo("DELETE");
        assertThat(replay.completion()).isEqualTo("COMPLETE");
        assertThat(db.sql("SELECT guest_name FROM contribution WHERE id = :id").param("id", contribution).query(String.class).single())
                .isEqualTo("Synthetic Guest");
        assertThat(db.sql("SELECT count(*) FROM memory WHERE contribution_id = :id").param("id", contribution).query(Integer.class).single()).isEqualTo(2);
    }

    @Test void erasedKeyFromBackupPredatingEnvelopeRejectsFreshTextAndPhotoCreation() {
        for (String key : List.of(UUID.randomUUID().toString(), UUID.randomUUID().toString())) {
            eraseKey(key);
            assertThatThrownBy(() -> contributions.saveTextContribution("kevin-mel-wedding", null, "must not resurrect", key))
                    .isInstanceOf(com.kevinmel.archive.web.ApiException.class)
                    .satisfies(e -> assertThat(((com.kevinmel.archive.web.ApiException)e).status()).isEqualTo(404));
            assertThatThrownBy(() -> photos.create(photoRequest(1), key))
                    .isInstanceOf(com.kevinmel.archive.web.ApiException.class)
                    .satisfies(e -> assertThat(((com.kevinmel.archive.web.ApiException)e).status()).isEqualTo(404));
            assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key = :key").param("key", key).query(Integer.class).single()).isZero();
        }
    }


    @Test void guestPhotoIoAndPlaybackHonorDeletionDeadlineAndPurgeClaim() throws Exception {
        String key = UUID.randomUUID().toString();
        var created = photos.create(photoRequest(1), key).receipt();
        UUID contribution = created.contributionId();
        UUID photo = created.memories().getFirst().memoryId();
        contributionIds.add(contribution);
        db.sql("UPDATE media_asset SET detected_format = declared_content_type, upload_state = 'UPLOADED' WHERE memory_id = :id")
                .param("id", photo).update();
        db.sql("UPDATE memory SET review_status = 'DELETE', delete_after = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE id = :id")
                .param("id", photo).update();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        com.kevinmel.archive.media.PhotoRepository.Asset retainedAsset = transaction.execute(status -> photos.lock(contribution, photo, key));
        assertThat(retainedAsset).isNotNull();
        login();
        assertThat(get("/api/memories/" + photo).statusCode()).isEqualTo(200);
        assertThat(get("/api/memories/" + photo + "/playback").statusCode()).isEqualTo(404);

        db.sql("UPDATE memory SET delete_after = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = :id")
                .param("id", photo).update();
        assertPhotoUnavailable(transaction, contribution, photo, key);
        db.sql("UPDATE memory SET delete_after = CURRENT_TIMESTAMP + INTERVAL '1 day', purge_started_at = CURRENT_TIMESTAMP WHERE id = :id")
                .param("id", photo).update();
        assertPhotoUnavailable(transaction, contribution, photo, key);
        db.sql("UPDATE memory SET purged_at = CURRENT_TIMESTAMP, text_content = NULL, caption = NULL WHERE id = :id")
                .param("id", photo).update();
        assertPhotoUnavailable(transaction, contribution, photo, key);
        assertThat(get("/api/memories/" + photo).statusCode()).isEqualTo(404);
        assertThat(db.sql("SELECT count(*) FROM upload_grant WHERE media_asset_id = (SELECT id FROM media_asset WHERE memory_id = :id)")
                .param("id", photo).query(Integer.class).single()).isZero();
    }

    private void assertPhotoUnavailable(org.springframework.transaction.support.TransactionTemplate transaction,
            UUID contribution, UUID photo, String key) {
        assertThatThrownBy(() -> transaction.execute(status -> photos.lock(contribution, photo, key)))
                .isInstanceOf(com.kevinmel.archive.web.ApiException.class)
                .satisfies(failure -> assertThat(((com.kevinmel.archive.web.ApiException) failure).status()).isEqualTo(404));
    }

    private void scrubTombstone(UUID id) {
        db.sql("""
                UPDATE memory SET review_status = 'DELETE', delete_after = CURRENT_TIMESTAMP - INTERVAL '1 second',
                    purge_started_at = CURRENT_TIMESTAMP, purged_at = CURRENT_TIMESTAMP, text_content = NULL, caption = NULL
                WHERE id = :id
                """).param("id", id).update();
    }
    private void eraseKey(String key) {
        String digest = com.kevinmel.archive.retention.SubmissionKeyDigest.sha256(key);
        erasedDigests.add(digest);
        db.sql("INSERT INTO erased_submission_key(key_digest, erased_at) VALUES (:digest,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING")
                .param("digest", digest).update();
    }
    private static com.kevinmel.archive.media.PhotoRequest photoRequest(int count) {
        var items = new ArrayList<java.util.Map<String,Object>>();
        for (int i=0; i<count; i++) items.add(java.util.Map.of("clientItemId", UUID.randomUUID().toString(),
                "originalFilename", "synthetic.png", "declaredContentType", "image/png", "byteSize", 100,
                "checksumSha256", "a".repeat(64), "caption", "Synthetic caption"));
        return com.kevinmel.archive.media.PhotoRequest.from(java.util.Map.of("memoryType", "PHOTO", "guestName", "Synthetic Guest", "items", items));
    }
    private HttpResponse<String> postText(String key, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/contributions"))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("Content-Type", "application/json")
                .header("Idempotency-Key", key).header("Origin", "http://localhost:" + port)
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> patch(UUID memory, String status, int revision) throws Exception {
        return client.send(patchRequest(memory, status, revision), HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest patchRequest(UUID memory, String status, int revision) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/memories/" + memory + "/review"))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("X-CSRF-Token", csrfToken)
                .header("If-Match", "\"" + revision + "\"").header("Content-Type", "application/json")
                .header("Origin", "http://localhost:" + port)
                .method("PATCH", HttpRequest.BodyPublishers.ofString("{\"reviewStatus\":\"" + status + "\"}")).build();
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
                INSERT INTO memory (id, contribution_id, memory_type, text_content, review_status, created_at, updated_at, delete_after)
                VALUES (:id, :contribution, :type, :text, :status, :created, :created,
                    CASE WHEN CAST(:status AS text) = 'DELETE' THEN CURRENT_TIMESTAMP - INTERVAL '1 second' ELSE NULL END)
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
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        csrfToken = JsonPath.read(response.body(), "$.csrfToken");
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
