package com.kevinmel.archive.data;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.util.UUID;

import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.MemoryArchiveApplication;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.web.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class ContributionUpgradeRestartTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");

    private ConfigurableApplicationContext start() {
        return new SpringApplicationBuilder(MemoryArchiveApplication.class).run(
                "--server.port=0", "--spring.datasource.hikari.connection-timeout=500", "--spring.datasource.hikari.validation-timeout=250", "--spring.datasource.url=" + postgres.getJdbcUrl(),
                "--spring.datasource.username=" + postgres.getUsername(),
                "--spring.datasource.password=" + postgres.getPassword());
    }

    private HttpResponse<String> request(ConfigurableApplicationContext context, String method, String path, String key, String body) throws Exception {
        int port = ((WebServerApplicationContext) context).getWebServer().getPort();
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("X-Api-Contract", "1").header("Idempotency-Key", key).header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test void populatedV1UpgradePreservesRowsAndReplaySurvivesApplicationRestart() throws Exception {
        Flyway.configure().dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .target("1").load().migrate();
        String legacyKey = UUID.randomUUID().toString();
        UUID legacyId = UUID.randomUUID();
        UUID legacyMemory = UUID.randomUUID();
        String reservedKey = UUID.randomUUID().toString();
        try (var connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
            try (var insert = connection.prepareStatement("INSERT INTO contribution(id, event_key, guest_name, idempotency_key) VALUES (?, 'kevin-mel-wedding', ?, ?)")) {
                insert.setObject(1, legacyId); insert.setString(2, "\u00a0Guest\ufeff"); insert.setString(3, legacyKey); insert.executeUpdate();
            }
            try (var insert = connection.prepareStatement("INSERT INTO memory(id, contribution_id, memory_type, text_content) VALUES (?, ?, 'TEXT', ?)")) {
                insert.setObject(1, legacyMemory); insert.setObject(2, legacyId); insert.setString(3, "\ufefflegacy\u00a0"); insert.executeUpdate();
            }
            try (var insert = connection.prepareStatement("INSERT INTO contribution(event_key, idempotency_key) VALUES ('kevin-mel-wedding', ?)")) {
                insert.setString(1, reservedKey); insert.executeUpdate();
            }
        }
        String key = UUID.randomUUID().toString();
        String savedBody;
        try (var first = start()) {
            var repository = first.getBean(ContributionRepository.class);
            var legacy = request(first, "POST", "/api/contributions", legacyKey, "{\"guestName\":\"Guest\",\"message\":\"legacy\"}");
            assertThat(legacy.statusCode()).isEqualTo(200);
            assertThat((String) JsonPath.read(legacy.body(), "$.contributionId")).isEqualTo(legacyId.toString());
            assertThat((String) JsonPath.read(legacy.body(), "$.memories[0].memoryId")).isEqualTo(legacyMemory.toString());
            assertThatThrownBy(() -> repository.saveTextContribution("kevin-mel-wedding", null, "new", reservedKey))
                    .isInstanceOf(ApiException.class).hasMessageContaining("different content");
            var saved = request(first, "POST", "/api/contributions", key, "{\"message\":\"restart fixture\"}");
            assertThat(saved.statusCode()).isEqualTo(201);
            savedBody = saved.body();
            assertThat(first.getBean(Flyway.class).migrate().migrationsExecuted).isZero();
        }
        try (var restarted = start()) {
            var replay = request(restarted, "POST", "/api/contributions", key, "{\"message\":\"restart fixture\"}");
            assertThat(replay.statusCode()).isEqualTo(200);
            assertThat(replay.body()).isEqualTo(savedBody);
            String id = JsonPath.read(savedBody, "$.contributionId");
            assertThat(request(restarted, "GET", "/api/contributions/" + id + "/receipt", key, null).body()).isEqualTo(savedBody);
            var jdbc = restarted.getBean(org.springframework.jdbc.core.simple.JdbcClient.class);
            assertThat(jdbc.sql("SELECT count(*) FROM contribution WHERE idempotency_key = :key")
                    .param("key", key).query(Long.class).single()).isEqualTo(1);
            assertThat(jdbc.sql("SELECT text_content FROM memory WHERE id = :id")
                    .param("id", legacyMemory).query(String.class).single()).isEqualTo("\ufefflegacy\u00a0");
        }
    }
}
