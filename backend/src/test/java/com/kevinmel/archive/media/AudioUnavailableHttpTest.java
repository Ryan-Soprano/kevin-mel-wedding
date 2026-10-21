package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "archive.audio.enabled=true", "archive.audio.ffmpeg=synthetic-missing-audio-runtime-ffmpeg",
        "archive.audio.ffprobe=synthetic-missing-audio-runtime-ffprobe"})
@Import(AudioHttpTest.Fixtures.class)
class AudioUnavailableHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired AudioHttpTest.FakeStorage storage;
    final HttpClient client = HttpClient.newHttpClient();
    HttpResponse<String> post(String path, String key, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").header("X-Api-Contract", "1").header("Idempotency-Key", key)
                .POST(body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test void missingRuntimeNeverCommitsFailedOrPublishesAndKeepsTheRetryableIntent() throws Exception {
        byte[] bytes = AudioFixtures.audio("audio/webm", .25); String key = UUID.randomUUID().toString();
        var created = post("/api/contributions", key, JsonMapper.builder().build().writeValueAsString(AudioHttpTest.metadata(bytes, "audio/webm", .25)));
        assertThat(created.statusCode()).isEqualTo(201);
        String contribution = JsonPath.read(created.body(), "$.contributionId"), memory = JsonPath.read(created.body(), "$.memories[0].memoryId");
        String path = "/api/contributions/" + contribution + "/memories/" + memory;
        var granted = post(path + "/upload-grants", key, null); assertThat(granted.statusCode()).isEqualTo(201);
        String grant = JsonPath.read(granted.body(), "$.grantId"); storage.objects.put("staging/" + grant, bytes);
        for (int retry = 0; retry < 2; retry++) {
            var failure = post(path + "/finalize", key, "{\"grantId\":\"" + grant + "\"}");
            assertThat(failure.statusCode()).isEqualTo(503); assertThat(failure.body()).contains("MEDIA_UNAVAILABLE")
                    .doesNotContain("synthetic-missing", "staging/", "originals/", key);
        }
        assertThat(db.sql("SELECT upload_state FROM media_asset WHERE memory_id=:memory").param("memory", UUID.fromString(memory)).query(String.class).single()).isEqualTo("PENDING");
        assertThat(db.sql("SELECT count(*) FROM media_asset WHERE memory_id=:memory AND audio_duration_ms IS NOT NULL")
                .param("memory", UUID.fromString(memory)).query(Long.class).single()).isZero();
        assertThat(storage.objects.keySet()).noneMatch(k -> k.startsWith("originals/"));
    }
}
