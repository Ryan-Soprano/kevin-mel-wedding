package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.servlet.ServletRequestEvent;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Real PostgreSQL windows, counters and transactions; synthetic peers and no guest/provider data. */
@Testcontainers
class AnonymousThrottlePostgresTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final String SECRET = "synthetic-postgres-guest-throttle-secret";
    private HikariDataSource source;
    private String schema;
    private JdbcClient db;
    private TransactionTemplate tx;
    private AnonymousThrottleRepository repository;

    @BeforeEach void disposableSchema() {
        schema = "anonymous_" + UUID.randomUUID().toString().replace("-", "");
        source = new HikariDataSource();
        source.setJdbcUrl(postgres.getJdbcUrl() + (postgres.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=" + schema);
        source.setUsername(postgres.getUsername());
        source.setPassword(postgres.getPassword());
        source.setMaximumPoolSize(16);
        source.setMinimumIdle(0);
        Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).load().migrate();
        db = JdbcClient.create(source);
        tx = new TransactionTemplate(new JdbcTransactionManager(source));
        repository = new AnonymousThrottleRepository(db);
    }

    @AfterEach void removeOnlyDisposableSchema() throws Exception {
        if (source != null) source.close();
        if (schema == null) return;
        if (!schema.matches("anonymous_[0-9a-f]{32}")) throw new IllegalStateException("Unsafe fixture schema.");
        try (var connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
                var statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test void oneHundredGuestsOnOneNetworkCanSaveOneNoteAndFivePhotosWithRecovery() {
        var throttle = throttle();
        var request = captured("192.0.2.50");
        for (int guest = 0; guest < 100; guest++) {
            String noteKey = UUID.randomUUID().toString();
            String photoKey = UUID.randomUUID().toString();
            assertAdmitted(throttle, AnonymousThrottle.Operation.CREATE, noteKey, request);
            assertAdmitted(throttle, AnonymousThrottle.Operation.CREATE, photoKey, request);
            // A lost creation response replays the same batch, and each photo can be retried once.
            assertAdmitted(throttle, AnonymousThrottle.Operation.CREATE, photoKey, request);
            for (int photo = 0; photo < 5; photo++) {
                for (int attempt = 0; attempt < 2; attempt++) {
                    assertAdmitted(throttle, AnonymousThrottle.Operation.GRANT, photoKey, request);
                    assertAdmitted(throttle, AnonymousThrottle.Operation.FINALIZE, photoKey, request);
                }
            }
            for (int receipt = 0; receipt < 3; receipt++) {
                assertAdmitted(throttle, AnonymousThrottle.Operation.RECEIPT, photoKey, request);
            }
            assertAdmitted(throttle, AnonymousThrottle.Operation.RECEIPT, noteKey, request);
        }
        // The shared-peer boundary, rather than the fresh attacker-chosen UUID, stops more grants.
        assertThat(reserve(throttle, AnonymousThrottle.Operation.GRANT, UUID.randomUUID().toString(), request)).isBetween(1L, 900L);
        assertThat(db.sql("SELECT MAX(attempts) FROM archive_anonymous_throttle").query(Integer.class).single()).isEqualTo(1001);
    }

    @Test void countersSurviveReconstructionAndLowerScopeDenialStillConsumesHigherScopes() {
        String key = UUID.randomUUID().toString();
        var request = captured("192.0.2.10");
        for (int attempt = 0; attempt < 12; attempt++) assertAdmitted(throttle(), AnonymousThrottle.Operation.CREATE, key, request);
        assertThat(reserve(throttle(), AnonymousThrottle.Operation.CREATE, key.toUpperCase(), request)).isBetween(1L, 900L);
        assertAdmitted(throttle(), AnonymousThrottle.Operation.CREATE, UUID.randomUUID().toString(), request);
        assertThat(db.sql("SELECT attempts FROM archive_anonymous_throttle ORDER BY attempts DESC")
                .query(Integer.class).list()).containsExactly(14, 14, 12, 1);
    }

    @Test void saturatedGlobalAndPeerScopesCannotManufactureMoreRetryKeyRows() {
        String global = "a".repeat(64);
        String peer = "b".repeat(64);
        String key = "c".repeat(64);
        for (int attempt = 0; attempt < 2; attempt++) assertThat(reserve(buckets(global, 4, peer, 2, key, 9))).isZero();
        assertThat(reserve(buckets(global, 4, peer, 2, "d".repeat(64), 9))).isBetween(1L, 900L);
        assertThat(count()).isEqualTo(3);
        assertThat(attempts(global)).isEqualTo(3);
        assertThat(attempts(peer)).isEqualTo(2);
        assertThat(reserve(buckets(global, 4, "e".repeat(64), 2, "f".repeat(64), 9))).isZero();
        assertThat(count()).isEqualTo(5);
        assertThat(reserve(buckets(global, 4, "1".repeat(64), 2, "2".repeat(64), 9))).isBetween(1L, 900L);
        assertThat(count()).isEqualTo(5);
        assertThat(attempts(global)).isEqualTo(4);
    }

    @Test void concurrentTransactionsAdmitExactlyTheRetryKeyLimit() throws Exception {
        var throttle = throttle();
        String key = UUID.randomUUID().toString();
        var ready = new CountDownLatch(24);
        var start = new CountDownLatch(1);
        var futures = new ArrayList<Future<Long>>();
        try (var workers = Executors.newFixedThreadPool(24)) {
            for (int attempt = 0; attempt < 24; attempt++) {
                futures.add(workers.submit(() -> {
                    var request = captured("192.0.2.20");
                    ready.countDown();
                    if (!start.await(30, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent fixture did not start.");
                    return reserve(throttle, AnonymousThrottle.Operation.CREATE, key, request);
                }));
            }
            assertThat(ready.await(30, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            var results = new ArrayList<Long>();
            for (Future<Long> future : futures) results.add(future.get(30, TimeUnit.SECONDS));
            assertThat(results.stream().filter(value -> value == 0).count()).isEqualTo(12);
            assertThat(results.stream().filter(value -> value > 0).count()).isEqualTo(12);
            assertThat(db.sql("SELECT attempts FROM archive_anonymous_throttle ORDER BY attempts DESC")
                    .query(Integer.class).list()).containsExactly(24, 24, 12);
        } finally {
            start.countDown();
        }
    }

    @Test void databaseTimeReturnsRemainingRetryAfterAndExpiredWindowsResetInclusively() {
        var buckets = buckets("a".repeat(64), 9, "b".repeat(64), 9, "c".repeat(64), 1);
        assertThat(reserve(buckets)).isZero();
        db.sql("UPDATE archive_anonymous_throttle SET window_started_at = CURRENT_TIMESTAMP - INTERVAL '810 seconds'").update();
        assertThat(reserve(buckets)).isBetween(85L, 90L);
        db.sql("UPDATE archive_anonymous_throttle SET window_started_at = CURRENT_TIMESTAMP - INTERVAL '15 minutes'").update();
        assertThat(reserve(buckets)).isZero();
        assertThat(db.sql("SELECT attempts FROM archive_anonymous_throttle").query(Integer.class).list()).containsOnly(1);
    }

    @Test void expiredRowPruningIsBoundedAndRunsForDeniedRequestsToo() {
        db.sql("""
                INSERT INTO archive_anonymous_throttle(bucket_key, window_started_at, attempts)
                SELECT lpad(to_hex(value), 64, '0'), CURRENT_TIMESTAMP - INTERVAL '2 days', 1
                FROM generate_series(1, 1005) value
                """).update();
        var buckets = buckets("a".repeat(64), 1, "b".repeat(64), 1, "c".repeat(64), 1);
        assertThat(reserve(buckets)).isZero();
        assertThat(count()).isEqualTo(8);
        assertThat(reserve(buckets)).isBetween(1L, 900L);
        assertThat(count()).isEqualTo(3);
    }

    @Test void actualDatabaseFailureClosesTheFilterBeforeBodyParsingWithSafeJson() throws Exception {
        db.sql("DROP TABLE archive_anonymous_throttle").update();
        var request = captured("192.0.2.30");
        String key = UUID.randomUUID().toString();
        request.setMethod("POST");
        request.setRequestURI("/api/contributions");
        request.addHeader("X-Api-Contract", "1");
        request.addHeader("Idempotency-Key", key);
        request.setContentType("application/json");
        request.setContent("{\"message\":\"Synthetic private note\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var response = new MockHttpServletResponse();
        var transactionalRepository = new AnonymousThrottleRepository(db) {
            @Override public long reserve(List<Bucket> buckets) {
                return tx.execute(ignored -> super.reserve(buckets));
            }
        };
        var throttle = new AnonymousThrottle(transactionalRepository, policy(), SECRET);
        var filter = new AnonymousSubmissionFilter(throttle, new SecurityErrorWriter(JsonMapper.builder().build()));
        filter.doFilter(request, response, (wrapped, result) -> { throw new AssertionError("Database failure reached MVC."); });
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(response.getContentAsString()).contains("SERVICE_UNAVAILABLE")
                .doesNotContain(key, "Synthetic private note", "archive_anonymous_throttle", "192.0.2.30", "SQL");
    }

    private long reserve(List<AnonymousThrottleRepository.Bucket> buckets) {
        return tx.execute(ignored -> repository.reserve(buckets));
    }

    private long reserve(AnonymousThrottle throttle, AnonymousThrottle.Operation operation, String key, MockHttpServletRequest request) {
        return tx.execute(ignored -> throttle.reserve(operation, key, request));
    }

    private void assertAdmitted(AnonymousThrottle throttle, AnonymousThrottle.Operation operation, String key, MockHttpServletRequest request) {
        assertThat(reserve(throttle, operation, key, request)).isZero();
    }

    private AnonymousThrottle throttle() { return new AnonymousThrottle(repository, policy(), SECRET); }

    private ArchiveAccessPolicy policy() {
        return new ArchiveAccessPolicy("local", false, false, "", "", new MockEnvironment());
    }

    private MockHttpServletRequest captured(String peer) {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr(peer);
        new RequestPeerCapture().requestInitialized(new ServletRequestEvent(request.getServletContext(), request));
        return request;
    }

    private List<AnonymousThrottleRepository.Bucket> buckets(String global, int globalLimit, String peer, int peerLimit, String key, int keyLimit) {
        return List.of(new AnonymousThrottleRepository.Bucket(global, globalLimit),
                new AnonymousThrottleRepository.Bucket(peer, peerLimit), new AnonymousThrottleRepository.Bucket(key, keyLimit));
    }

    private int count() { return db.sql("SELECT COUNT(*) FROM archive_anonymous_throttle").query(Integer.class).single(); }

    private int attempts(String key) {
        return db.sql("SELECT attempts FROM archive_anonymous_throttle WHERE bucket_key = :key").param("key", key).query(Integer.class).single();
    }
}
