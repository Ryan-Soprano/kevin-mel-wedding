package com.kevinmel.archive.data;

import com.kevinmel.archive.contribution.ContributionRepository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.flywaydb.core.Flyway;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.dao.DataIntegrityViolationException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Transactional
class DatabaseMigrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");

    @Autowired
    JdbcClient jdbcClient;

    @Autowired
    ContributionRepository contributionRepository;

    @Autowired
    Flyway flyway;

    @Test
    void migrationAppliesAndSuppliesSecureDefaults() {
        Long appliedMigrations = jdbcClient.sql("""
                SELECT count(*)
                FROM flyway_schema_history
                WHERE version = '1'
                  AND success
                """)
                .query(Long.class)
                .single();

        UUID contributionId = jdbcClient.sql("""
                INSERT INTO contribution (
                    event_key,
                    idempotency_key
                )
                VALUES (
                    :eventKey,
                    :idempotencyKey
                )
                RETURNING id
                """)
                .param("eventKey", "kevin-mel-wedding")
                .param("idempotencyKey", "test-" + UUID.randomUUID())
                .query(UUID.class)
                .single();

        MemoryDefaults defaults = jdbcClient.sql("""
                INSERT INTO memory (
                    contribution_id,
                    memory_type,
                    text_content
                )
                VALUES (
                    :contributionId,
                    'TEXT',
                    'Automated test memory'
                )
                RETURNING review_status, visibility
                """)
                .param("contributionId", contributionId)
                .query((resultSet, rowNumber) -> new MemoryDefaults(
                        resultSet.getString("review_status"),
                        resultSet.getString("visibility")))
                .single();

        assertThat(appliedMigrations).isEqualTo(1);
        assertThat(defaults.reviewStatus()).isEqualTo("PENDING");
        assertThat(defaults.visibility()).isEqualTo("COUPLE_ONLY");
    }

    @Test
    void duplicateIdempotencyKeyIsRejected() {
        String idempotencyKey = "duplicate-" + UUID.randomUUID();

        jdbcClient.sql("""
                INSERT INTO contribution (
                    event_key,
                    idempotency_key
                )
                VALUES (
                    :eventKey,
                    :idempotencyKey
                )
                """)
                .param("eventKey", "kevin-mel-wedding")
                .param("idempotencyKey", idempotencyKey)
                .update();

        assertThatThrownBy(() -> jdbcClient.sql("""
                INSERT INTO contribution (
                    event_key,
                    idempotency_key
                )
                VALUES (
                    :eventKey,
                    :idempotencyKey
                )
                """)
                .param("eventKey", "kevin-mel-wedding")
                .param("idempotencyKey", idempotencyKey)
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(
                        "contribution_idempotency_key_unique");
    }

    @Test
    void memoryWithoutContributionIsRejected() {
        UUID missingContributionId = UUID.randomUUID();

        assertThatThrownBy(() -> jdbcClient.sql("""
                INSERT INTO memory (
                    contribution_id,
                    memory_type,
                    text_content
                )
                VALUES (
                    :contributionId,
                    'TEXT',
                    'Invalid relationship test'
                )
                """)
                .param("contributionId", missingContributionId)
                .update())
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("memory_contribution_fk");
    }

    @Test
    void repositorySavesContributionAndTextMemory() {
        String idempotencyKey = "repository-" + UUID.randomUUID();

        ContributionRepository.SavedTextContribution saved = contributionRepository.saveTextContribution(
                "kevin-mel-wedding",
                null,
                "Saved through the repository",
                idempotencyKey);

        StoredTextMemory stored = jdbcClient.sql("""
                SELECT
                    c.guest_name,
                    m.id AS memory_id,
                    m.text_content,
                    m.review_status,
                    m.visibility
                FROM contribution c
                JOIN memory m ON m.contribution_id = c.id
                WHERE c.id = :contributionId
                """)
                .param("contributionId", saved.contributionId())
                .query((resultSet, rowNumber) -> new StoredTextMemory(
                        resultSet.getString("guest_name"),
                        resultSet.getObject("memory_id", UUID.class),
                        resultSet.getString("text_content"),
                        resultSet.getString("review_status"),
                        resultSet.getString("visibility")))
                .single();

        assertThat(saved.contributionId()).isNotNull();
        assertThat(saved.memoryId()).isEqualTo(stored.memoryId());
        assertThat(saved.reviewStatus()).isEqualTo("PENDING");
        assertThat(saved.visibility()).isEqualTo("COUPLE_ONLY");

        assertThat(stored.guestName()).isNull();
        assertThat(stored.textContent())
                .isEqualTo("Saved through the repository");
        assertThat(stored.reviewStatus()).isEqualTo("PENDING");
        assertThat(stored.visibility()).isEqualTo("COUPLE_ONLY");
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void repositoryRollsBackContributionWhenMemoryInsertFails() {
        String idempotencyKey = "rollback-" + UUID.randomUUID();

        assertThatThrownBy(() -> contributionRepository.saveTextContribution(
                "kevin-mel-wedding",
                null,
                "",
                idempotencyKey))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("memory_content_matches_type");

        Long rowsRemaining = jdbcClient.sql("""
                SELECT count(*)
                FROM contribution
                WHERE idempotency_key = :idempotencyKey
                """)
                .param("idempotencyKey", idempotencyKey)
                .query(Long.class)
                .single();

        assertThat(rowsRemaining).isZero();
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void rerunningFlywayPreservesExistingFixtureData() {
        String idempotencyKey = "fixture-" + UUID.randomUUID();

        ContributionRepository.SavedTextContribution saved = contributionRepository.saveTextContribution(
                "kevin-mel-wedding",
                "Fixture Guest",
                "Existing fixture memory",
                idempotencyKey);

        try {
            Long migrationsBefore = jdbcClient.sql("""
                    SELECT count(*)
                    FROM flyway_schema_history
                    WHERE success
                    """)
                    .query(Long.class)
                    .single();

            flyway.migrate();

            Long migrationsAfter = jdbcClient.sql("""
                    SELECT count(*)
                    FROM flyway_schema_history
                    WHERE success
                    """)
                    .query(Long.class)
                    .single();

            String storedMessage = jdbcClient.sql("""
                    SELECT text_content
                    FROM memory
                    WHERE id = :memoryId
                    """)
                    .param("memoryId", saved.memoryId())
                    .query(String.class)
                    .single();

            assertThat(migrationsBefore).isEqualTo(5);
            assertThat(migrationsAfter).isEqualTo(5);
            assertThat(storedMessage)
                    .isEqualTo("Existing fixture memory");
        } finally {
            jdbcClient.sql("""
                    DELETE FROM memory
                    WHERE contribution_id = :contributionId
                    """)
                    .param("contributionId", saved.contributionId())
                    .update();

            jdbcClient.sql("""
                    DELETE FROM contribution
                    WHERE id = :contributionId
                    """)
                    .param("contributionId", saved.contributionId())
                    .update();
        }
    }

    private record StoredTextMemory(
            String guestName,
            UUID memoryId,
            String textContent,
            String reviewStatus,
            String visibility) {
    }

    private record MemoryDefaults(
            String reviewStatus,
            String visibility) {
    }
}
