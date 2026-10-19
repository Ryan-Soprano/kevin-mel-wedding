package com.kevinmel.archive.data;

import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.media.PlaybackRepository;
import com.kevinmel.archive.security.AccountAdministrationStore;
import com.kevinmel.archive.security.ArchiveAccountRepository;
import com.kevinmel.archive.security.LoginThrottleRepository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
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

    @Autowired ArchiveAccountRepository accounts;
    @Autowired LoginThrottleRepository loginThrottle;
    @Autowired PlaybackRepository playback;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired PlatformTransactionManager transactionManager;

    private AccountAdministrationStore administrator(boolean revealed) {
        return new AccountAdministrationStore(jdbcClient, passwordEncoder, transactionManager,
                AccountAdministrationStore.EnvironmentMode.LOCAL, revealed);
    }

    @Test
    void accountAdministrationStoresHashesAndRevokesEveryPriorCredentialVersion() {
        String username = "synthetic-" + UUID.randomUUID();
        var admin = administrator(true);
        String initialPassword = "synthetic-initial-passphrase";
        admin.create(username, "Synthetic Couple", AccountAdministrationStore.Role.COUPLE,
                initialPassword.toCharArray());
        var created = accounts.findByUsername(username).orElseThrow();
        assertThat(created.enabled()).isFalse();
        assertThat(created.credentialsVersion()).isZero();
        assertThat(created.passwordHash()).isNotEqualTo(initialPassword);
        assertThat(passwordEncoder.matches(initialPassword, created.passwordHash())).isTrue();
        assertThat(created.toString()).doesNotContain(initialPassword, created.passwordHash(), username);
        admin.setEnabled(username, true);
        assertThat(accounts.findById(created.id()).orElseThrow().credentialsVersion()).isEqualTo(1);
        admin.setEnabled(username, true);
        assertThat(accounts.findById(created.id()).orElseThrow().credentialsVersion()).isEqualTo(2);
        String recoveredPassword = "synthetic-recovered-passphrase";
        admin.resetPassword(username, recoveredPassword.toCharArray());
        var recovered = accounts.findById(created.id()).orElseThrow();
        assertThat(recovered.credentialsVersion()).isEqualTo(3);
        assertThat(passwordEncoder.matches(initialPassword, recovered.passwordHash())).isFalse();
        assertThat(passwordEncoder.matches(recoveredPassword, recovered.passwordHash())).isTrue();
        // Closing reveal still permits emergency disable.
        administrator(false).setEnabled(username, false);
        var disabled = accounts.findById(created.id()).orElseThrow();
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.credentialsVersion()).isEqualTo(4);
    }

    @Test
    void closedRevealNeverCreatesACoupleAccount() {
        String username = "synthetic-" + UUID.randomUUID();
        assertThatThrownBy(() -> administrator(false).create(username, "Synthetic Couple",
                AccountAdministrationStore.Role.COUPLE, "synthetic-only-passphrase".toCharArray()))
                .isInstanceOf(AccountAdministrationStore.RejectedOperation.class);
        assertThat(accounts.findByUsername(username)).isEmpty();
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentLoginAttemptsCannotExceedAccountLimit() throws Exception {
        String accountKey = UUID.randomUUID().toString().replace("-", "").repeat(2);
        String peerKey = UUID.randomUUID().toString().replace("-", "").repeat(2);
        try (var executor = Executors.newFixedThreadPool(8)) {
            var attempts = java.util.stream.IntStream.range(0, 24)
                    .mapToObj(index -> (Callable<Boolean>) () -> loginThrottle.reserve(List.of(accountKey, peerKey)))
                    .toList();
            var results = executor.invokeAll(attempts, 20, TimeUnit.SECONDS);
            long admitted = 0;
            for (var result : results) if (result.get()) admitted++;
            assertThat(admitted).isEqualTo(5);
            assertThat(throttleAttempts(accountKey)).isEqualTo(5);
            assertThat(throttleAttempts(peerKey)).isEqualTo(24);
        } finally {
            jdbcClient.sql("DELETE FROM archive_login_throttle WHERE bucket_key IN (:account, :peer)")
                    .param("account", accountKey).param("peer", peerKey).update();
        }
    }

    @Test
    void blockedPeerCannotCreateUsernameBucketsAndExpiredWindowsReopen() {
        String accountKey = "a".repeat(64);
        String peerKey = "b".repeat(64);
        jdbcClient.sql("INSERT INTO archive_login_throttle (bucket_key, attempts) VALUES (:peer, 30)")
                .param("peer", peerKey).update();
        assertThat(loginThrottle.reserve(List.of(accountKey, peerKey))).isFalse();
        assertThat(jdbcClient.sql("SELECT count(*) FROM archive_login_throttle WHERE bucket_key = :account")
                .param("account", accountKey).query(Long.class).single()).isZero();
        jdbcClient.sql("UPDATE archive_login_throttle SET window_started_at = CURRENT_TIMESTAMP - INTERVAL '16 minutes' WHERE bucket_key = :peer")
                .param("peer", peerKey).update();
        assertThat(loginThrottle.reserve(List.of(accountKey, peerKey))).isTrue();
        assertThat(throttleAttempts(peerKey)).isEqualTo(1);
        assertThat(throttleAttempts(accountKey)).isEqualTo(1);
    }

    @Test
    void deniedPeerReservationsPruneAtMostOneThousandExpiredBucketsAndPreserveCurrentLimits() {
        String accountKey = "a".repeat(64);
        String peerKey = "b".repeat(64);
        String freshKey = "c".repeat(64);
        String expiredPrefix = "d".repeat(32);
        jdbcClient.sql("""
                INSERT INTO archive_login_throttle (bucket_key, attempts)
                VALUES (:peer, 30), (:fresh, 7)
                """)
                .param("peer", peerKey)
                .param("fresh", freshKey)
                .update();
        jdbcClient.sql("""
                INSERT INTO archive_login_throttle (bucket_key, window_started_at, attempts)
                SELECT :prefix || lpad(to_hex(value), 32, '0'),
                    CURRENT_TIMESTAMP - INTERVAL '2 days', 1
                FROM generate_series(1, 1005) value
                """)
                .param("prefix", expiredPrefix)
                .update();

        assertThat(loginThrottle.reserve(List.of(accountKey, peerKey))).isFalse();
        assertThat(jdbcClient.sql("""
                SELECT count(*)
                FROM archive_login_throttle
                WHERE bucket_key LIKE :prefix
                """)
                .param("prefix", expiredPrefix + "%")
                .query(Long.class)
                .single()).isEqualTo(5);
        assertThat(jdbcClient.sql("""
                SELECT count(*)
                FROM archive_login_throttle
                WHERE bucket_key = :account
                """)
                .param("account", accountKey)
                .query(Long.class)
                .single()).isZero();
        assertThat(throttleAttempts(peerKey)).isEqualTo(30);
        assertThat(throttleAttempts(freshKey)).isEqualTo(7);

        assertThat(loginThrottle.reserve(List.of(accountKey, peerKey))).isFalse();
        assertThat(jdbcClient.sql("""
                SELECT count(*)
                FROM archive_login_throttle
                WHERE bucket_key LIKE :prefix
                """)
                .param("prefix", expiredPrefix + "%")
                .query(Long.class)
                .single()).isZero();
        assertThat(jdbcClient.sql("""
                SELECT count(*)
                FROM archive_login_throttle
                WHERE bucket_key = :account
                """)
                .param("account", accountKey)
                .query(Long.class)
                .single()).isZero();
        assertThat(throttleAttempts(peerKey)).isEqualTo(30);
        assertThat(throttleAttempts(freshKey)).isEqualTo(7);
    }

    @Test
    void deniedAccountReservationsPruneExpiredBucketsWithoutResettingPeerOrAccountCounts() {
        String accountKey = "a".repeat(64);
        String peerKey = "b".repeat(64);
        String freshKey = "c".repeat(64);
        String expiredKey = "d".repeat(64);
        jdbcClient.sql("""
                INSERT INTO archive_login_throttle (bucket_key, attempts)
                VALUES (:account, 5), (:peer, 2), (:fresh, 7)
                """)
                .param("account", accountKey)
                .param("peer", peerKey)
                .param("fresh", freshKey)
                .update();
        jdbcClient.sql("""
                INSERT INTO archive_login_throttle (bucket_key, window_started_at, attempts)
                VALUES (:expired, CURRENT_TIMESTAMP - INTERVAL '2 days', 1)
                """)
                .param("expired", expiredKey)
                .update();

        assertThat(loginThrottle.reserve(List.of(accountKey, peerKey))).isFalse();
        assertThat(jdbcClient.sql("""
                SELECT count(*)
                FROM archive_login_throttle
                WHERE bucket_key = :expired
                """)
                .param("expired", expiredKey)
                .query(Long.class)
                .single()).isZero();
        assertThat(throttleAttempts(peerKey)).isEqualTo(3);
        assertThat(throttleAttempts(accountKey)).isEqualTo(5);
        assertThat(throttleAttempts(freshKey)).isEqualTo(7);
    }

    private int throttleAttempts(String key) {
        return jdbcClient.sql("SELECT attempts FROM archive_login_throttle WHERE bucket_key = :key")
                .param("key", key).query(Integer.class).single();
    }

    @Test
    void playbackReadsOnlyVerifiedPrivateOriginalsForThisEvent() {
        UUID contributionId = jdbcClient.sql("INSERT INTO contribution (event_key, idempotency_key) VALUES ('kevin-mel-wedding', :key) RETURNING id")
                .param("key", "synthetic-" + UUID.randomUUID()).query(UUID.class).single();
        UUID memoryId = jdbcClient.sql("INSERT INTO memory (contribution_id, memory_type) VALUES (:contribution, 'PHOTO') RETURNING id")
                .param("contribution", contributionId).query(UUID.class).single();
        UUID assetId = UUID.randomUUID();
        jdbcClient.sql("""
                INSERT INTO media_asset (id, memory_id, object_key, original_filename, detected_format,
                    byte_size, checksum_sha256, upload_state, declared_content_type, expected_byte_size, expected_checksum_sha256)
                VALUES (:asset, :memory, :key, 'synthetic.png', 'image/png', 100, :checksum,
                    'UPLOADED', 'image/png', 100, :checksum)
                """).param("asset", assetId).param("memory", memoryId).param("key", "originals/" + assetId)
                .param("checksum", "c".repeat(64)).update();
        for (String review : List.of("PENDING", "KEEP", "ARCHIVED")) {
            jdbcClient.sql("UPDATE memory SET review_status = :review WHERE id = :memory")
                    .param("review", review).param("memory", memoryId).update();
            assertThat(playback.findPlayable(memoryId).orElseThrow().assetId()).isEqualTo(assetId);
        }
        jdbcClient.sql("UPDATE memory SET review_status = 'DELETE', delete_after = CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE id = :memory").param("memory", memoryId).update();
        assertThat(playback.findPlayable(memoryId)).isEmpty();
        jdbcClient.sql("UPDATE memory SET review_status = 'PENDING', delete_after = NULL WHERE id = :memory").param("memory", memoryId).update();
        for (String change : List.of("upload_state = 'PENDING'", "expected_byte_size = 99",
                "expected_checksum_sha256 = '" + "d".repeat(64) + "'", "declared_content_type = 'image/jpeg'",
                "object_key = 'incoming/synthetic'")) {
            jdbcClient.sql("UPDATE media_asset SET " + change + " WHERE id = :asset").param("asset", assetId).update();
            assertThat(playback.findPlayable(memoryId)).isEmpty();
            jdbcClient.sql("""
                    UPDATE media_asset SET upload_state = 'UPLOADED', expected_byte_size = 100,
                        expected_checksum_sha256 = :checksum, declared_content_type = 'image/png', object_key = :key
                    WHERE id = :asset
                    """).param("checksum", "c".repeat(64)).param("key", "originals/" + assetId).param("asset", assetId).update();
        }
        jdbcClient.sql("UPDATE contribution SET event_key = 'other-synthetic-event' WHERE id = :contribution")
                .param("contribution", contributionId).update();
        assertThat(playback.findPlayable(memoryId)).isEmpty();
        assertThat(playback.findPlayable(UUID.randomUUID())).isEmpty();
    }

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

            assertThat(migrationsBefore).isEqualTo(14);
            assertThat(migrationsAfter).isEqualTo(migrationsBefore);
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
