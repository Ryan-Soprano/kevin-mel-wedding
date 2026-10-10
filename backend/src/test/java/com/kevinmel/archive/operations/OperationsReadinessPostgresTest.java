package com.kevinmel.archive.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class OperationsReadinessPostgresTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final String PRIVATE = "synthetic-private-marker-never-reported";
    private String schema;
    private DriverManagerDataSource writable;
    private DataSource observations;
    private JdbcClient db;

    @BeforeEach void isolatedReviewedSchema() {
        schema = "operations_" + UUID.randomUUID().toString().replace("-", "");
        String url = postgres.getJdbcUrl() + (postgres.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=" + schema;
        writable = new DriverManagerDataSource(url, postgres.getUsername(), postgres.getPassword());
        Flyway.configure().dataSource(writable).schemas(schema).defaultSchema(schema).load().migrate();
        observations = new DriverManagerDataSource(ReadinessAdministration.boundedJdbcUrl(url), postgres.getUsername(), postgres.getPassword());
        db = JdbcClient.create(writable);
    }

    @AfterEach void removeOnlyOwnedSchema() throws Exception {
        if (schema == null || !schema.matches("operations_[0-9a-f]{32}")) throw new IllegalStateException("Unsafe fixture schema.");
        try (var connection = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword()).getConnection();
                var statement = connection.createStatement()) { statement.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }

    @Test void aggregatesRetainSoftDeletedFailedAndExpiredGrantReservationsWithoutReadingPrivateContent() throws Exception {
        UUID pending = media(30, "PENDING", null, false);
        UUID failed = media(20, "FAILED", "past", false);
        media(25, "UPLOADED", "future", false);
        UUID purged = media(10, "UPLOADED", "past", true);
        grant(pending, true); grant(pending, false); grant(failed, false); grant(purged, false);
        UUID note = note(true);
        db.sql("""
                INSERT INTO deletion_ledger(memory_id,contribution_id,submission_key_digest,delete_after,recorded_at)
                SELECT id,contribution_id,:digest,delete_after,CURRENT_TIMESTAMP FROM memory WHERE id=:id
                """).param("digest", "b".repeat(64)).param("id", note).update();
        String before = snapshot();
        var result = new OperationsReadiness(observations, gates(100, 100)).inspect();
        assertThat(result.database()).isEqualTo(OperationsReadiness.Database.AVAILABLE);
        assertThat(result.schema()).isEqualTo(OperationsReadiness.Schema.REVIEWED);
        assertThat(result.status()).isEqualTo(OperationsReadiness.Status.ACTION_REQUIRED);
        assertThat(result.totals()).isEqualTo(new OperationsReadiness.Totals(75, 90, 1, 1, 1, 2, 1));
        assertThat(snapshot()).isEqualTo(before);
        var output = new ByteArrayOutputStream();
        ReadinessAdministration.print(result, new PrintStream(output, true, StandardCharsets.UTF_8));
        assertThat(output.toString(StandardCharsets.UTF_8)).contains("ORIGINAL_RESERVATION_BYTES 75 LIMIT 100 STATUS BELOW_WARNING",
                "STAGING_RESERVATION_BYTES 90 LIMIT 100 STATUS REVIEW_REQUIRED", "PENDING_MEDIA 1", "OVERDUE_RETENTION 2");
        assertThat(output.toString(StandardCharsets.UTF_8)).doesNotContain(PRIVATE, pending.toString(), failed.toString(), note.toString(),
                "originals/", "staging/", postgres.getJdbcUrl(), postgres.getPassword(), schema);
    }

    @Test void healthyEmptyDatabaseIsOnlyAnObservedPassAndCapacityBoundariesRemainConservative() {
        var empty = new OperationsReadiness(observations, gates(100, 100)).inspect();
        assertThat(empty.status()).isEqualTo(OperationsReadiness.Status.OBSERVED_CHECKS_PASS);
        assertThat(empty.totals()).isEqualTo(new OperationsReadiness.Totals(0, 0, 0, 0, 0, 0, 0));
        UUID pending = media(80, "PENDING", null, false); grant(pending, false);
        assertThat(new OperationsReadiness(observations, gates(100, 100)).inspect().status()).isEqualTo(OperationsReadiness.Status.ACTION_REQUIRED);
        var full = new OperationsReadiness(observations, gates(80, 80)).inspect();
        assertThat(OperationsReadiness.capacity(full.totals().reservedOriginalBytes(), 80)).isEqualTo(OperationsReadiness.Capacity.AT_LIMIT);
        assertThat(new OperationsReadiness(observations, gates(79, 79)).inspect().status()).isEqualTo(OperationsReadiness.Status.ACTION_REQUIRED);
    }

    @Test void readOnlyTransactionMechanicallyRejectsWritesAndBoundsSlowQueries() throws Exception {
        try (var connection = observations.getConnection()) {
            OperationsReadiness.readOnly(connection);
            assertThat(connection.isReadOnly()).isTrue();
            assertThat(connection.getTransactionIsolation()).isEqualTo(Connection.TRANSACTION_REPEATABLE_READ);
            assertThatThrownBy(() -> {
                try (var statement = OperationsReadiness.statement(connection, "INSERT INTO contribution(event_key,idempotency_key) VALUES('synthetic','synthetic')")) {
                    statement.executeUpdate();
                }
            }).isInstanceOf(SQLException.class);
            connection.rollback();
        }
        assertThat(db.sql("SELECT count(*) FROM contribution").query(Long.class).single()).isZero();
        try (var connection = observations.getConnection()) {
            OperationsReadiness.readOnly(connection);
            Instant start = Instant.now();
            assertThatThrownBy(() -> {
                try (var statement = OperationsReadiness.statement(connection, "SELECT pg_sleep(10)")) { statement.executeQuery(); }
            }).isInstanceOf(SQLException.class);
            assertThat(Duration.between(start, Instant.now())).isLessThan(Duration.ofSeconds(9));
            connection.rollback();
        }
    }

    @Test void repeatableReadKeepsOriginalAndStagingObservationsInOneSnapshotDuringConcurrentAdmission() throws Exception {
        UUID asset = media(40, "PENDING", null, false); grant(asset, false);
        Connection real = observations.getConnection();
        Connection wrapped = mock(Connection.class, delegatesTo(real));
        AtomicBoolean admitted = new AtomicBoolean();
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            PreparedStatement statement = real.prepareStatement(sql);
            if (!sql.contains("FROM media_asset a JOIN memory")) return statement;
            PreparedStatement hooked = mock(PreparedStatement.class, delegatesTo(statement));
            doAnswer(query -> {
                var rows = statement.executeQuery();
                if (admitted.compareAndSet(false, true)) grant(asset, false);
                return rows;
            }).when(hooked).executeQuery();
            return hooked;
        }).when(wrapped).prepareStatement(anyString());
        DataSource source = mock(DataSource.class); when(source.getConnection()).thenReturn(wrapped);
        var report = new OperationsReadiness(source, gates(1000, 1000)).inspect();
        assertThat(admitted).isTrue();
        assertThat(report.status()).isEqualTo(OperationsReadiness.Status.OBSERVED_CHECKS_PASS);
        assertThat(report.totals().reservedOriginalBytes()).isEqualTo(40);
        assertThat(report.totals().reservedStagingBytes()).isEqualTo(40);
        assertThat(db.sql("SELECT count(*) FROM upload_grant").query(Long.class).single()).isEqualTo(2);
    }

    @Test void alteredFailedMissingUnknownAndPhysicalSchemaDriftRejectAllAggregateReadinessClaims() {
        note(false);
        for (String[] change : List.of(
                new String[]{"UPDATE flyway_schema_history SET checksum=checksum+1 WHERE version='1'", "UPDATE flyway_schema_history SET checksum=checksum-1 WHERE version='1'"},
                new String[]{"UPDATE flyway_schema_history SET success=false WHERE version='1'", "UPDATE flyway_schema_history SET success=true WHERE version='1'"},
                new String[]{"UPDATE flyway_schema_history SET script='synthetic-unreviewed.sql' WHERE version='1'", "UPDATE flyway_schema_history SET script='V1__create_memory_archive_schema.sql' WHERE version='1'"},
                new String[]{"UPDATE flyway_schema_history SET version='999999' WHERE version='11'", "UPDATE flyway_schema_history SET version='11' WHERE version='999999'"},
                new String[]{"ALTER TABLE memory ADD COLUMN synthetic_unreviewed TEXT", "ALTER TABLE memory DROP COLUMN synthetic_unreviewed"},
                new String[]{"ALTER TABLE memory ALTER COLUMN memory_date TYPE TEXT", "ALTER TABLE memory ALTER COLUMN memory_date TYPE VARCHAR(10)"},
                new String[]{"ALTER TABLE memory ALTER COLUMN date_precision DROP NOT NULL", "ALTER TABLE memory ALTER COLUMN date_precision SET NOT NULL"},
                new String[]{"ALTER TABLE album ALTER COLUMN name TYPE TEXT", "ALTER TABLE album ALTER COLUMN name TYPE VARCHAR(200)"},
                new String[]{"ALTER TABLE album_membership ALTER COLUMN position TYPE INTEGER", "ALTER TABLE album_membership ALTER COLUMN position TYPE BIGINT"},
                new String[]{"ALTER TABLE contribution ALTER COLUMN event_key DROP NOT NULL", "ALTER TABLE contribution ALTER COLUMN event_key SET NOT NULL"})) {
            db.sql(change[0]).update();
            try { assertUnreviewed(); } finally { db.sql(change[1]).update(); }
            assertThat(new OperationsReadiness(observations, gates(100, 100)).inspect().schema()).isEqualTo(OperationsReadiness.Schema.REVIEWED);
        }
        db.sql("""
                INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,checksum,installed_by,execution_time,success)
                VALUES(999999,'999999','synthetic','SQL','V999999__synthetic.sql',0,'synthetic',0,true)
                """).update();
        try { assertUnreviewed(); } finally { db.sql("DELETE FROM flyway_schema_history WHERE installed_rank=999999").update(); }
        db.sql("DELETE FROM flyway_schema_history WHERE version='11'").update();
        assertUnreviewed();
    }

    private void assertUnreviewed() {
        var result = new OperationsReadiness(observations, gates(100, 100)).inspect();
        assertThat(result.database()).isEqualTo(OperationsReadiness.Database.AVAILABLE);
        assertThat(result.schema()).isEqualTo(OperationsReadiness.Schema.UNCONFIRMED);
        assertThat(result.status()).isEqualTo(OperationsReadiness.Status.UNCONFIRMED);
        assertThat(result.exitCode()).isEqualTo(1); assertThat(result.totals()).isNull();
    }
    private UUID media(int bytes, String state, String deletion, boolean purged) {
        UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID(), asset = UUID.randomUUID();
        contribution(contribution);
        db.sql("""
                INSERT INTO memory(id,contribution_id,memory_type,caption,review_status,delete_after,purged_at)
                VALUES(:id,:contribution,'PHOTO',:caption,:status,
                    CASE WHEN CAST(:deletion AS text)='past' THEN CURRENT_TIMESTAMP-INTERVAL '1 day'
                        WHEN CAST(:deletion AS text)='future' THEN CURRENT_TIMESTAMP+INTERVAL '1 day' ELSE NULL END,
                    CASE WHEN :purged THEN CURRENT_TIMESTAMP ELSE NULL END)
                """).param("id", memory).param("contribution", contribution).param("caption", purged ? null : PRIVATE)
                .param("status", deletion == null ? "PENDING" : "DELETE").param("deletion", deletion).param("purged", purged).update();
        db.sql("""
                INSERT INTO media_asset(id,memory_id,object_key,original_filename,detected_format,byte_size,checksum_sha256,
                    upload_state,declared_content_type,expected_byte_size,expected_checksum_sha256)
                VALUES(:id,:memory,:key,:filename,'image/png',:bytes,:hash,:state,'image/png',:bytes,:hash)
                """).param("id", asset).param("memory", memory).param("key", "originals/" + asset).param("filename", PRIVATE)
                .param("bytes", bytes).param("hash", "a".repeat(64)).param("state", state).update();
        return asset;
    }
    private UUID note(boolean deleted) {
        UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID(); contribution(contribution);
        db.sql("""
                INSERT INTO memory(id,contribution_id,memory_type,text_content,review_status,delete_after)
                VALUES(:id,:contribution,'TEXT',:text,:status,CASE WHEN :deleted THEN CURRENT_TIMESTAMP-INTERVAL '1 day' ELSE NULL END)
                """).param("id", memory).param("contribution", contribution).param("text", PRIVATE)
                .param("status", deleted ? "DELETE" : "PENDING").param("deleted", deleted).update();
        return memory;
    }
    private void contribution(UUID id) {
        db.sql("INSERT INTO contribution(id,event_key,guest_name,idempotency_key) VALUES(:id,'kevin-mel-wedding',:name,:key)")
                .param("id", id).param("name", PRIVATE).param("key", PRIVATE + UUID.randomUUID()).update();
    }
    private void grant(UUID asset, boolean live) {
        UUID id = UUID.randomUUID();
        db.sql("""
                INSERT INTO upload_grant(id,media_asset_id,object_key,created_at,expires_at)
                VALUES(:id,:asset,:key, CURRENT_TIMESTAMP-INTERVAL '4 minutes',
                    CASE WHEN :live THEN CURRENT_TIMESTAMP+INTERVAL '1 minute' ELSE CURRENT_TIMESTAMP-INTERVAL '1 minute' END)
                """).param("id", id).param("asset", asset).param("key", "staging/" + id).param("live", live).update();
    }
    private String snapshot() {
        return db.sql("""
                SELECT md5((SELECT COALESCE(json_agg(t)::text,'[]') FROM (SELECT * FROM contribution ORDER BY id) t)
                    ||(SELECT COALESCE(json_agg(t)::text,'[]') FROM (SELECT * FROM memory ORDER BY id) t)
                    ||(SELECT COALESCE(json_agg(t)::text,'[]') FROM (SELECT * FROM media_asset ORDER BY id) t)
                    ||(SELECT COALESCE(json_agg(t)::text,'[]') FROM (SELECT * FROM upload_grant ORDER BY id) t)
                    ||(SELECT COALESCE(json_agg(t)::text,'[]') FROM (SELECT * FROM deletion_ledger ORDER BY memory_id) t))
                """).query(String.class).single();
    }
    private static OperationsReadiness.Gates gates(long original, long staging) {
        return new OperationsReadiness.Gates(false, false, false, false, false, original, staging, 300_000);
    }
}
