package com.kevinmel.archive.contribution;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContributionHttpTest {
    @Container @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;
    private final HttpClient client = HttpClient.newHttpClient();

    private HttpResponse<String> post(String key, String body) throws Exception {
        return send("POST", "/api/contributions", key, body);
    }

    private HttpResponse<String> send(String method, String path, String key, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(15)).header("X-Api-Contract", "1").header("Idempotency-Key", key)
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String value(HttpResponse<String> response, String path) {
        return JsonPath.read(response.body(), path);
    }

    private record StoredName(String name) {}

    private long count(String key) {
        return jdbc.sql("SELECT count(*) FROM contribution c JOIN memory m ON c.id = m.contribution_id WHERE c.idempotency_key = :key")
                .param("key", key).query(Long.class).single();
    }

    @Test void namedAndAnonymousReceiptsArePrivateAndCommitted() throws Exception {
        for (String name : List.of("null", "\" \u00a0\ufeff \"", "\" Guest \"")) {
            String key = UUID.randomUUID().toString();
            var created = post(key, "{\"guestName\":" + name + ",\"message\":\" \u00a0hello\ufeff \"}");
            assertThat(created.statusCode()).isEqualTo(201);
            assertThat(created.headers().firstValue("Cache-Control")).contains("no-store");
            assertThat(value(created, "$.createdAt")).endsWith("Z");
            assertThat(value(created, "$.completion")).isEqualTo("COMPLETE");
            assertThat(value(created, "$.memories[0].reviewStatus")).isEqualTo("PENDING");
            assertThat(value(created, "$.memories[0].visibility")).isEqualTo("COUPLE_ONLY");
            assertThat((Object) JsonPath.read(created.body(), "$.memories[0].clientItemId")).isNull();
            assertThat((Object) JsonPath.read(created.body(), "$.memories[0].uploadState")).isNull();
            assertThat(created.body()).doesNotContain("guestName", "hello", "idempotency", "fingerprint", "textContent");
            assertThat(count(key)).isEqualTo(1); // Independent connection after the HTTP response.
            StoredName storedName = jdbc.sql("SELECT guest_name FROM contribution WHERE idempotency_key = :key")
                    .param("key", key).query((rs, row) -> new StoredName(rs.getString(1))).single();
            assertThat(storedName.name()).isEqualTo(name.contains("Guest") ? "Guest" : null);
        }
    }

    @Test void disabledPhotoStorageCreatesNoIntentAndDoesNotDisableText() throws Exception {
        String key = UUID.randomUUID().toString();
        var photo = post(key, "{\"memoryType\":\"PHOTO\",\"items\":[{\"clientItemId\":\"" + UUID.randomUUID()
                + "\",\"originalFilename\":\"fixture.png\",\"declaredContentType\":\"image/png\",\"byteSize\":1,\"checksumSha256\":\"" + "0".repeat(64) + "\"}]}");
        assertThat(photo.statusCode()).isEqualTo(503);
        assertThat(value(photo, "$.error.code")).isEqualTo("MEDIA_UNAVAILABLE");
        assertThat(jdbc.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", key).query(Long.class).single()).isZero();
        assertThat(post(key, "{\"message\":\"text still works\"}").statusCode()).isEqualTo(201);
    }

    @Test void equivalentReplayLostResponseConflictAndCurrentStates() throws Exception {
        String key = UUID.randomUUID().toString();
        var original = post(key, "{\"message\":\"hello\"}"); // Treat response as lost; replay unchanged intent.
        var replay = post(key.toUpperCase(), "{\"message\":\" hello \",\"guestName\":null}");
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat(replay.body()).isEqualTo(original.body());
        var conflict = post(key, "{\"message\":\"changed\"}");
        assertThat(conflict.statusCode()).isEqualTo(409);
        assertThat(value(conflict, "$.error.code")).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(count(key)).isEqualTo(1);
        String id = value(original, "$.contributionId");
        jdbc.sql("UPDATE memory SET review_status = 'KEEP', text_content = 'edited later' WHERE contribution_id = :id")
                .param("id", UUID.fromString(id)).update();
        assertThat(value(post(key, "{\"message\":\"hello\"}"), "$.memories[0].reviewStatus")).isEqualTo("KEEP");
        var receipt = send("GET", "/api/contributions/" + id + "/receipt", key, null);
        assertThat(receipt.statusCode()).isEqualTo(200);
        assertThat(value(receipt, "$.memories[0].visibility")).isEqualTo("COUPLE_ONLY");
        for (String path : List.of(id, UUID.randomUUID().toString(), "not-an-id")) {
            var denied = send("GET", "/api/contributions/" + path + "/receipt", UUID.randomUUID().toString(), null);
            assertThat(denied.statusCode()).isEqualTo(404);
            assertThat(value(denied, "$.error.code")).isEqualTo("NOT_FOUND");
            assertThat(value(denied, "$.error.message")).isEqualTo("That receipt is unavailable.");
        }
    }

    @Test void concurrentSameKeyConvergesAndChangedPayloadRaceConflicts() throws Exception {
        for (boolean changed : List.of(false, true)) {
            String key = UUID.randomUUID().toString();
            int workers = changed ? 2 : 8;
            CountDownLatch ready = new CountDownLatch(workers);
            CountDownLatch start = new CountDownLatch(1);
            try (var executor = Executors.newFixedThreadPool(workers)) {
                var tasks = new ArrayList<java.util.concurrent.Future<HttpResponse<String>>>();
                for (int i = 0; i < workers; i++) {
                    String message = changed && i == 1 ? "different" : "same";
                    tasks.add(executor.submit(() -> {
                        ready.countDown();
                        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start timed out");
                        return post(key, "{\"message\":\"" + message + "\"}");
                    }));
                }
                assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                start.countDown();
                var results = new ArrayList<HttpResponse<String>>();
                for (var task : tasks) results.add(task.get(20, TimeUnit.SECONDS));
                assertThat(results.stream().filter(r -> r.statusCode() == 201).count()).isEqualTo(1);
                assertThat(count(key)).isEqualTo(1);
                if (changed) {
                    assertThat(results.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(201, 409);
                } else {
                    assertThat(results.stream().filter(r -> r.statusCode() == 200).count()).isEqualTo(7);
                    assertThat(results.stream().map(HttpResponse::body).distinct().count()).isEqualTo(1);
                }
            }
        }
    }

    @Test void contenderCanCreateAfterUncommittedWinnerRollsBack() throws Exception {
        String key = UUID.randomUUID().toString();
        try (var connection = java.sql.DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             var executor = Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var insert = connection.prepareStatement("INSERT INTO contribution(event_key, idempotency_key) VALUES ('kevin-mel-wedding', ?)")) {
                insert.setString(1, key);
                insert.executeUpdate();
            }
            CountDownLatch started = new CountDownLatch(1);
            var contender = executor.submit(() -> {
                started.countDown();
                return post(key, "{\"message\":\"recovered\"}");
            });
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            boolean waiting = false;
            while (System.nanoTime() < deadline && !waiting) {
                waiting = jdbc.sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO contribution (event_key, guest_name, idempotency_key, request_fingerprint)%'")
                        .query(Long.class).single() > 0;
                if (!waiting) Thread.sleep(25);
            }
            assertThat(waiting).as("Contender waits for the uncommitted key").isTrue();
            connection.rollback();
            assertThat(contender.get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(201);
            assertThat(count(key)).isEqualTo(1);
        }
    }

    @Test void insertAndCommitFailuresRollBackAndReturnSafeErrors() throws Exception {
        jdbc.sql("""
                CREATE FUNCTION reject_test_message() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.text_content IN ('insert-failure', 'commit-failure') THEN
                  RAISE EXCEPTION 'synthetic private SQL diagnostic'; END IF; RETURN NEW; END $$
                """).update();
        try {
            for (boolean commit : List.of(false, true)) {
                jdbc.sql("CREATE " + (commit ? "CONSTRAINT " : "") + "TRIGGER reject_test_message AFTER INSERT ON memory "
                        + (commit ? "DEFERRABLE INITIALLY DEFERRED " : "")
                        + "FOR EACH ROW EXECUTE FUNCTION reject_test_message()").update();
                String key = UUID.randomUUID().toString();
                var failure = post(key, "{\"message\":\"" + (commit ? "commit-failure" : "insert-failure") + "\"}");
                assertThat(failure.statusCode()).isEqualTo(503);
                assertThat(value(failure, "$.error.code")).isEqualTo("SERVICE_UNAVAILABLE");
                assertThat(failure.body()).doesNotContain("synthetic private", "INSERT", key, "commit-failure", "insert-failure");
                assertThat(failure.headers().firstValue("X-Request-ID")).contains(value(failure, "$.error.requestId"));
                assertThat(count(key)).isZero();
                assertThat(jdbc.sql("SELECT count(*) FROM contribution WHERE idempotency_key = :key")
                        .param("key", key).query(Long.class).single()).isZero();
                jdbc.sql("DROP TRIGGER reject_test_message ON memory").update();
                assertThat(post(key, "{\"message\":\"recovered\"}").statusCode()).isEqualTo(201);
            }
        } finally {
            jdbc.sql("DROP TRIGGER IF EXISTS reject_test_message ON memory").update();
            jdbc.sql("DROP FUNCTION reject_test_message()").update();
        }
    }

    @Test void rawLengthTypesWhitespaceAndServerOwnedFieldsAreValidated() throws Exception {
        for (String body : List.of("{}", "{\"message\":null}", "{\"message\":3}", "{\"message\":true}",
                "{\"message\":[]}", "{\"message\":\" \u00a0\ufeff\u2000 \"}",
                "{\"guestName\":false,\"message\":\"x\"}", "[]", "null", "{broken",
                "{\"message\":\"" + " ".repeat(5000) + "x\"}",
                "{\"guestName\":\"" + " ".repeat(101) + "\",\"message\":\"x\"}")) {
            String key = UUID.randomUUID().toString();
            assertThat(post(key, body).statusCode()).as("Invalid synthetic request").isEqualTo(400);
            assertThat(count(key)).isZero();
        }
        for (String field : List.of("eventKey", "reviewStatus", "visibility", "memoryType", "items", "id")) {
            assertThat(post(UUID.randomUUID().toString(), "{\"message\":\"x\",\"" + field + "\":\"override\"}").statusCode()).isEqualTo(400);
        }
        for (String message : List.of("x".repeat(5000), "\ud83d\ude00".repeat(2500), "a  b\nc", "\u0085", "\u200b")) {
            String encoded = message.replace(Character.toString(10), Character.toString(92) + "n");
            assertThat(post(UUID.randomUUID().toString(), "{\"guestName\":\"" + "g".repeat(100)
                    + "\",\"message\":\"" + encoded + "\"}").statusCode()).as("length " + message.length() + " first " + (int)message.charAt(0)).isEqualTo(201);
        }
        assertThat(post(UUID.randomUUID().toString(), "{\"message\":\"" + "\ud83d\ude00".repeat(2501) + "\"}").statusCode()).isEqualTo(400);
    }

    @Test void nonrepresentableDatabaseTextIsAValidationError() throws Exception {
        String slash = Character.toString(92);
        for (String unicode : List.of("u0000", "ud800", "udc00")) {
            for (String field : List.of("guestName", "message")) {
                String body = field.equals("message") ? "{\"message\":\"" + slash + unicode + "\"}"
                        : "{\"message\":\"ok\",\"guestName\":\"" + slash + unicode + "\"}";
                String key = UUID.randomUUID().toString();
                var response = post(key, body);
                assertThat(response.statusCode()).isEqualTo(400);
                assertThat(count(key)).isZero();
            }
        }
    }

    @Test void requiredHeadersAndOriginCannotFallBackToEcho() throws Exception {
        for (String version : List.of("", "2")) {
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/contributions"))
                    .header("Content-Type", "application/json").header("Idempotency-Key", UUID.randomUUID().toString());
            if (!version.isEmpty()) request.header("X-Api-Contract", version);
            var response = client.send(request.POST(HttpRequest.BodyPublishers.ofString("{\"message\":\"x\"}")).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(400);
            assertThat(value(response, "$.error.code")).isEqualTo("UNSUPPORTED_CONTRACT");
        }
        for (String key : List.of("bad", "11111111-1111-1111-8111-111111111111")) {
            assertThat(post(key, "{\"message\":\"x\"}").statusCode()).isEqualTo(400);
        }
        var crossSite = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/contributions"))
                .header("X-Api-Contract", "1").header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Content-Type", "application/json").header("Origin", "https://other.example")
                .POST(HttpRequest.BodyPublishers.ofString("{\"message\":\"x\"}")).build();
        assertThat(client.send(crossSite, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        var sameSite = HttpRequest.newBuilder(crossSite.uri())
                .header("X-Api-Contract", "1").header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Content-Type", "application/json").header("Origin", "http://localhost:" + port)
                .POST(HttpRequest.BodyPublishers.ofString("{\"message\":\"x\"}")).build();
        assertThat(client.send(sameSite, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(201);
    }
}
