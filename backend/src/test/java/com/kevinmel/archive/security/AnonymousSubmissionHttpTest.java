package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Actual servlet registration, body wrapping and durable filter admission with disposable PostgreSQL. */
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AnonymousSubmissionHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach void clearOnlyDisposableAdmissionCounters() {
        db.sql("DELETE FROM archive_anonymous_throttle").update();
    }

    @Test void realSameKeyReplaysReachTheLimitThenReturnSafeRetryAfterWithoutDuplicatingTheNote() throws Exception {
        String key = UUID.randomUUID().toString();
        String body = "{\"message\":\"Synthetic retained private note\"}";
        for (int attempt = 0; attempt < 12; attempt++) {
            var response = post("/api/contributions", key, HttpRequest.BodyPublishers.ofString(body));
            assertThat(response.statusCode()).isEqualTo(attempt == 0 ? 201 : 200);
        }
        var denied = post("/api/contributions", key.toUpperCase(), HttpRequest.BodyPublishers.ofString(body));
        assertThat(denied.statusCode()).isEqualTo(429);
        assertThat(Long.parseLong(denied.headers().firstValue("Retry-After").orElseThrow())).isBetween(1L, 900L);
        assertThat(denied.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(denied.headers().firstValue("X-Request-ID")).isPresent();
        assertThat(denied.body()).contains("RATE_LIMITED").doesNotContain(key, "Synthetic retained private note", "SQL");
        assertThat(db.sql("SELECT COUNT(*) FROM contribution WHERE idempotency_key = :key")
                .param("key", key).query(Integer.class).single()).isEqualTo(1);
    }

    @Test void knownAndChunkedOversizedBodiesAreRejectedBeforeMvcAndLeaveNoContribution() throws Exception {
        byte[] bytes = new byte[AnonymousSubmissionFilter.MAX_CONTRIBUTION_BYTES + 1];
        for (boolean chunked : new boolean[]{false, true}) {
            String key = UUID.randomUUID().toString();
            var publisher = chunked ? HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(bytes))
                    : HttpRequest.BodyPublishers.ofByteArray(bytes);
            var response = post("/api/contributions", key, publisher);
            assertThat(response.statusCode()).isEqualTo(413);
            assertThat(response.body()).contains("PAYLOAD_TOO_LARGE").doesNotContain(key);
            assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");
            assertThat(db.sql("SELECT COUNT(*) FROM contribution WHERE idempotency_key = :key")
                    .param("key", key).query(Integer.class).single()).isZero();
        }
    }

    @Test void exactlyBoundedJsonStillReachesTheRealControllerForKnownAndChunkedBodies() throws Exception {
        String prefix = "{\"message\":\"Synthetic boundary note\"}";
        byte[] bytes = (prefix + " ".repeat(AnonymousSubmissionFilter.MAX_CONTRIBUTION_BYTES - prefix.length()))
                .getBytes(StandardCharsets.UTF_8);
        for (boolean chunked : new boolean[]{false, true}) {
            String key = UUID.randomUUID().toString();
            var publisher = chunked ? HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(bytes))
                    : HttpRequest.BodyPublishers.ofByteArray(bytes);
            assertThat(post("/api/contributions", key, publisher).statusCode()).isEqualTo(201);
        }
    }

    private HttpResponse<String> post(String path, String key, HttpRequest.BodyPublisher body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(20)).header("X-Api-Contract", "1").header("Idempotency-Key", key)
                .header("Content-Type", "application/json").POST(body).build(), HttpResponse.BodyHandlers.ofString());
    }
}
