package com.kevinmel.archive.contribution;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.retention.SubmissionKeyDigest;
import com.kevinmel.archive.web.ApiException;

@Repository
public class ContributionRepository {
    private static final String ROW_SOURCE = "source";
    private static final String ROW_AUTHOR = "author";
    private static final String ROW_IDEMPOTENCY_KEY = "idempotencyKey";
    private static final String ROW_MESSAGE = "message";

    private final JdbcClient jdbcClient;

    // JSONB provides deterministic object-key ordering and unambiguous field
    // boundaries.
    // Keep this encoding aligned with V2's legacy-text backfill.
    private static final String FINGERPRINT = """
            encode(sha256(convert_to(jsonb_build_object(
                'eventKey', CAST(:eventKey AS text), 'memoryType', 'TEXT',
                'guestName', CAST(:guestName AS text), 'message', CAST(:message AS text)
            )::text, 'UTF8')), 'hex')
            """;
    private static final String RECEIPT_QUERY = """
            SELECT c.id AS contribution_id, c.event_key, c.created_at,
                   m.id AS memory_id, m.review_status, m.visibility
            FROM contribution c JOIN memory m ON m.contribution_id = c.id
            WHERE c.id = :contributionId AND c.idempotency_key = :idempotencyKey
              AND m.memory_type = 'TEXT'
              AND (SELECT count(*) FROM memory sibling WHERE sibling.contribution_id = c.id) = 1
            """;

    public ContributionRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /**
     * Atomically commits one text submission or replays its original identity.
     * ON CONFLICT waits for a concurrent winner. The separate READ COMMITTED query
     * then sees its committed row. The proxy commits before returning to the
     * service.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public SavedTextContribution saveTextContribution(
            String eventKey,
            String guestName,
            String message,
            String idempotencyKey) {
        return saveTextContribution(
                eventKey,
                guestName,
                message,
                ContributionScope.guest(idempotencyKey));
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public SavedTextContribution saveTextContribution(
            String eventKey,
            String guestName,
            String message,
            ContributionScope scope) {
        String idempotencyKey = scope.key();
        var inserted = jdbcClient
                .sql("""
                        INSERT INTO contribution (event_key, guest_name, idempotency_key, request_fingerprint, source, author_account_id)
                        SELECT :eventKey, :guestName, :idempotencyKey,
                        """
                        + FINGERPRINT + """
                                , :source, :author
                                WHERE NOT EXISTS (SELECT 1 FROM erased_submission_key WHERE key_digest = :digest)
                                ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
                                """)
                .param("eventKey", eventKey)
                .param("guestName", guestName)
                .param(ROW_MESSAGE, message)
                .param(ROW_IDEMPOTENCY_KEY, idempotencyKey)
                .param(ROW_SOURCE, scope.source())
                .param(ROW_AUTHOR, scope.authorId())
                .param("digest", SubmissionKeyDigest.sha256(idempotencyKey))
                .query(UUID.class)
                .optional();
        UUID contributionId;
        if (inserted.isPresent()) {
            contributionId = inserted.get();
            jdbcClient
                    .sql("""
                            INSERT INTO memory (contribution_id, memory_type, text_content, review_status)
                            VALUES (:contributionId, 'TEXT', :message, :review)
                            """)
                    .param("contributionId", contributionId)
                    .param(ROW_MESSAGE, message)
                    .param("review", scope.initialReview())
                    .update();
        } else {
            var existing = jdbcClient
                    .sql("SELECT id, request_fingerprint = " + FINGERPRINT + """
                             AS equivalent FROM contribution WHERE idempotency_key = :idempotencyKey
                                 AND source = :source AND author_account_id IS NOT DISTINCT FROM :author
                            """)
                    .param("eventKey", eventKey)
                    .param("guestName", guestName)
                    .param(ROW_MESSAGE, message)
                    .param(ROW_IDEMPOTENCY_KEY, idempotencyKey)
                    .param(ROW_SOURCE, scope.source())
                    .param(ROW_AUTHOR, scope.authorId())
                    .query((rs, row) -> new Existing(
                            rs.getObject("id", UUID.class),
                            rs.getBoolean("equivalent")))
                    .optional()
                    .orElseThrow(ApiException::notFound);
            // Unbackfillable legacy keys stay reserved, never silently recycled.
            if (!existing.equivalent()) {
                throw ApiException.conflict();
            }
            contributionId = existing.id();
        }
        return load(
                contributionId,
                idempotencyKey,
                inserted.isPresent());
    }

    @Transactional(readOnly = true)
    public ContributionReceipt getGuestReceipt(
            UUID id,
            String key) {
        requireScope(id, ContributionScope.guest(key));
        return getReceipt(id, key);
    }

    public void requireScope(
            UUID id,
            ContributionScope scope) {
        boolean present = jdbcClient
                .sql("""
                        SELECT EXISTS (SELECT 1 FROM contribution WHERE id = :id AND idempotency_key = :key
                            AND source = :source AND author_account_id IS NOT DISTINCT FROM :author)
                        """)
                .param("id", id)
                .param("key", scope.key())
                .param(ROW_SOURCE, scope.source())
                .param(ROW_AUTHOR, scope.authorId())
                .query(Boolean.class)
                .single();
        if (!present) {
            throw ApiException.notFound();
        }
    }

    @Transactional(readOnly = true)
    public ContributionReceipt getReceipt(
            UUID contributionId,
            String idempotencyKey) {
        var envelope = jdbcClient
                .sql("""
                        SELECT event_key, created_at FROM contribution
                        WHERE id = :id AND idempotency_key = :key
                        """)
                .param("id", contributionId)
                .param("key", idempotencyKey)
                .query((rs, row) -> new Envelope(
                        rs.getString("event_key"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()))
                .optional()
                .orElseThrow(ApiException::notFound);
        var memories = jdbcClient
                .sql("""
                        SELECT m.id, m.client_item_id, m.memory_type, m.review_status, m.visibility,
                               CASE WHEN m.purged_at IS NOT NULL AND m.memory_type IN ('PHOTO', 'AUDIO') THEN 'UPLOADED'
                                    ELSE a.upload_state END AS upload_state
                        FROM memory m LEFT JOIN media_asset a ON a.memory_id = m.id
                        WHERE m.contribution_id = :id
                        ORDER BY m.item_position NULLS FIRST, m.created_at, m.id
                        """)
                .param("id", contributionId)
                .query((rs, row) -> new ContributionReceipt.MemoryReceipt(
                        rs.getObject("id", UUID.class),
                        rs.getObject("client_item_id", UUID.class),
                        rs.getString("memory_type"),
                        rs.getString("upload_state"),
                        rs.getString("review_status"),
                        rs.getString("visibility")))
                .list();
        if (memories.isEmpty()) {
            throw ApiException.notFound();
        }
        long complete = memories.stream()
                .filter(m -> m.memoryType().equals("TEXT") || "UPLOADED".equals(m.uploadState()))
                .count();
        String completion = complete == memories.size()
                ? "COMPLETE"
                : complete == 0 ? "PENDING" : "PARTIAL";
        return new ContributionReceipt(
                contributionId,
                envelope.eventKey(),
                envelope.createdAt(),
                completion,
                memories);
    }

    private SavedTextContribution load(
            UUID contributionId,
            String key,
            boolean created) {
        return jdbcClient
                .sql(RECEIPT_QUERY)
                .param("contributionId", contributionId)
                .param(ROW_IDEMPOTENCY_KEY, key)
                .query((rs, row) -> new SavedTextContribution(
                        rs.getObject("contribution_id", UUID.class),
                        rs.getObject("memory_id", UUID.class),
                        rs.getString("review_status"),
                        rs.getString("visibility"),
                        rs.getString("event_key"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                        created))
                .optional()
                .orElseThrow(ApiException::notFound);
    }

    public record SavedTextContribution(
            UUID contributionId,
            UUID memoryId,
            String reviewStatus,
            String visibility,
            String eventKey,
            Instant createdAt,
            boolean created) {
        public ContributionReceipt receipt() {
            return new ContributionReceipt(
                    contributionId,
                    eventKey,
                    createdAt,
                    "COMPLETE",
                    List.of(new ContributionReceipt.MemoryReceipt(
                            memoryId,
                            null,
                            "TEXT",
                            null,
                            reviewStatus,
                            visibility)));
        }
    }

    private record Existing(
            UUID id,
            boolean equivalent) {
    }

    private record Envelope(
            String eventKey,
            Instant createdAt) {
    }
}
