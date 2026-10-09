package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AudioGateHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    final HttpClient client = HttpClient.newHttpClient();

    HttpResponse<String> create(String key, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/contributions"))
                .header("Content-Type", "application/json").header("X-Api-Contract", "1").header("Idempotency-Key", key)
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test void defaultGateRejectsValidNewAudioSafelyAfterValidationAndNotesRemainAvailable() throws Exception {
        String key = UUID.randomUUID().toString();
        String valid = "{\"memoryType\":\"AUDIO\",\"items\":[{\"clientItemId\":\"" + UUID.randomUUID()
                + "\",\"originalFilename\":\"voice.webm\",\"declaredContentType\":\"audio/webm\",\"byteSize\":1,\"checksumSha256\":\""
                + "0".repeat(64) + "\",\"durationSeconds\":1}]}";
        var disabled = create(key, valid);
        assertThat(disabled.statusCode()).isEqualTo(503); assertThat(disabled.body()).contains("MEDIA_UNAVAILABLE").doesNotContain(key);
        assertThat(disabled.headers().firstValue("Retry-After")).contains("60");
        assertThat(disabled.headers().firstValue("Cache-Control")).contains("no-store");
        assertThat(create(key, valid.replace("audio/webm", "video/webm")).statusCode()).isEqualTo(400);
        assertThat(create(key, valid.replace("\"durationSeconds\":1", "\"durationSeconds\":121")).statusCode()).isEqualTo(400);
        assertThat(db.sql("SELECT count(*) FROM contribution WHERE idempotency_key=:key").param("key", key).query(Long.class).single()).isZero();
        assertThat(create(key, "{\"message\":\"Synthetic note remains available\"}").statusCode()).isEqualTo(201);
    }
}
