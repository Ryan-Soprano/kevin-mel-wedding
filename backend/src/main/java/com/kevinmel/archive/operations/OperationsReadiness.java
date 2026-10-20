package com.kevinmel.archive.operations;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

import javax.sql.DataSource;

/** Bounded, consistent database observations. No provider clients, mutations or application startup. */
public final class OperationsReadiness {

    static final int QUERY_TIMEOUT_SECONDS = 5;
    static final int NETWORK_TIMEOUT_MILLIS = 10_000;
    private final DataSource source;
    private final Gates gates;

    public OperationsReadiness(
            DataSource source,
            Gates gates) {
        this.source = java.util.Objects.requireNonNull(source);
        this.gates = java.util.Objects.requireNonNull(gates);
    }

    public Report inspect() {
        boolean connected = false;
        boolean reviewed = false;
        try (var connection = source.getConnection()) {
            connected = true;
            readOnly(connection);
            OperationsSchema.requireCurrent(connection, OperationsSchema.bundled());
            reviewed = true;
            long original;
            long pending;
            long failed;
            long staging;
            long live;
            long overdue;
            long plans;
            try (var statement = statement(
                    connection,
                    """
                    SELECT COALESCE(SUM(COALESCE(a.expected_byte_size,a.byte_size)),0) AS bytes,
                        COUNT(*) FILTER (WHERE a.upload_state='PENDING') AS pending,
                        COUNT(*) FILTER (WHERE a.upload_state='FAILED') AS failed
                    FROM media_asset a JOIN memory m ON m.id=a.memory_id WHERE m.purged_at IS NULL
                    """);
                    var rows = statement.executeQuery()) {
                if (!rows.next()) {
                    throw OperationsSchema.rejected();
                }
                original = rows.getBigDecimal("bytes").longValueExact();
                pending = rows.getLong("pending");
                failed = rows.getLong("failed");
            }
            try (var statement = statement(
                    connection,
                    """
                    SELECT COALESCE(SUM(COALESCE(a.expected_byte_size,a.byte_size)),0) AS bytes,
                        COUNT(*) FILTER (WHERE g.expires_at>CURRENT_TIMESTAMP) AS live
                    FROM upload_grant g JOIN media_asset a ON a.id=g.media_asset_id
                    """);
                    var rows = statement.executeQuery()) {
                if (!rows.next()) {
                    throw OperationsSchema.rejected();
                }
                staging = rows.getBigDecimal("bytes").longValueExact();
                live = rows.getLong("live");
            }
            try (var statement = statement(
                    connection,
                    """
                    SELECT (SELECT COUNT(*) FROM memory m JOIN contribution c ON c.id=m.contribution_id
                        WHERE c.event_key='kevin-mel-wedding' AND m.visibility='COUPLE_ONLY'
                            AND m.review_status='DELETE' AND m.purged_at IS NULL
                            AND m.delete_after<=CURRENT_TIMESTAMP) AS overdue,
                        (SELECT COUNT(*) FROM deletion_ledger WHERE purged_at IS NULL) AS plans
                    """);
                    var rows = statement.executeQuery()) {
                if (!rows.next()) {
                    throw OperationsSchema.rejected();
                }
                overdue = rows.getLong("overdue");
                plans = rows.getLong("plans");
            }
            var totals = new Totals(original, staging, pending, failed, live, overdue, plans);
            connection.rollback();
            boolean action = capacity(original, gates.maxOriginalBytes()) != Capacity.BELOW_WARNING
                    || capacity(staging, gates.maxStagingBytes()) != Capacity.BELOW_WARNING
                    || failed > 0
                    || overdue > 0
                    || plans > 0
                    || (gates.retentionEnabled() && !gates.storageEnabled());
            return new Report(
                    Database.AVAILABLE,
                    Schema.REVIEWED,
                    action ? Status.ACTION_REQUIRED : Status.OBSERVED_CHECKS_PASS,
                    gates,
                    totals);
        } catch (Exception failure) {
            // No exception messages, SQL, identifiers, URLs or credentials enter the report.
            return new Report(
                    connected ? Database.AVAILABLE : Database.UNAVAILABLE,
                    reviewed ? Schema.REVIEWED : Schema.UNCONFIRMED,
                    Status.UNCONFIRMED,
                    gates,
                    null);
        }
    }

    static void readOnly(Connection connection) throws SQLException {
        connection.setNetworkTimeout(Runnable::run, NETWORK_TIMEOUT_MILLIS);
        connection.setReadOnly(true);
        connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        connection.setAutoCommit(false);
        try (var statement = statement(
                connection,
                """
                SELECT current_setting('transaction_read_only') AS readonly,
                    current_setting('transaction_isolation') AS isolation
                """);
                var rows = statement.executeQuery()) {
            if (!rows.next()
                    || !"on".equals(rows.getString("readonly"))
                    || !"repeatable read".equals(rows.getString("isolation"))) {
                throw OperationsSchema.rejected();
            }
        }
    }

    static PreparedStatement statement(
            Connection connection,
            String sql) throws SQLException {
        var statement = connection.prepareStatement(sql);
        statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
        return statement;
    }

    static Capacity capacity(
            long reserved,
            long limit) {
        if (reserved < 0 || limit < 1) {
            throw new IllegalArgumentException("Invalid capacity observation.");
        }
        if (reserved > limit) {
            return Capacity.OVER_LIMIT;
        }
        if (reserved == limit) {
            return Capacity.AT_LIMIT;
        }
        long warning = (limit / 5) * 4 + ((limit % 5) * 4 + 4) / 5;
        return reserved >= warning ? Capacity.REVIEW_REQUIRED : Capacity.BELOW_WARNING;
    }

    public enum Database {
        AVAILABLE,
        UNAVAILABLE
    }

    public enum Schema {
        REVIEWED,
        UNCONFIRMED
    }

    public enum Status {
        OBSERVED_CHECKS_PASS,
        ACTION_REQUIRED,
        UNCONFIRMED
    }

    public enum Capacity {
        BELOW_WARNING,
        REVIEW_REQUIRED,
        AT_LIMIT,
        OVER_LIMIT
    }

    public record Gates(
            boolean uploadsPaused,
            boolean revealed,
            boolean audioEnabled,
            boolean storageEnabled,
            boolean retentionEnabled,
            long maxOriginalBytes,
            long maxStagingBytes,
            long retentionIntervalMillis) {
        public Gates {
            if (maxOriginalBytes < 1
                    || maxStagingBytes < 1
                    || retentionIntervalMillis < 60_000
                    || retentionIntervalMillis > 86_400_000) {
                throw new IllegalArgumentException("Operations settings are invalid.");
            }
        }
    }

    public record Totals(
            long reservedOriginalBytes,
            long reservedStagingBytes,
            long pendingMedia,
            long failedMedia,
            long liveGrants,
            long overdueRetention,
            long unfinishedDeletionPlans) {
        public Totals {
            if (reservedOriginalBytes < 0
                    || reservedStagingBytes < 0
                    || pendingMedia < 0
                    || failedMedia < 0
                    || liveGrants < 0
                    || overdueRetention < 0
                    || unfinishedDeletionPlans < 0) {
                throw OperationsSchema.rejected();
            }
        }
    }

    public record Report(
            Database database,
            Schema schema,
            Status status,
            Gates gates,
            Totals totals) {
        public int exitCode() {
            return status == Status.OBSERVED_CHECKS_PASS ? 0 : 1;
        }
    }
}
