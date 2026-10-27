package com.kevinmel.archive.review;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.web.ApiException;

@Repository
public class InboxRepository {
    private static final String REVISION_FIELD = "revision";
    private static final String MEMORY_ID_PARAM = "memoryId";
    private static final String ACTED_AT_PARAM = "acted";

    public static final String MEMORY_COLUMNS = """
            m.id AS memory_id, c.id AS contribution_id, c.guest_name, m.memory_type,
                m.text_content, m.caption, m.review_status, m.visibility, m.revision,
                m.created_at, m.updated_at, m.delete_after, c.source, m.title, m.description, m.memory_date, m.date_precision,
                a.original_filename, a.detected_format, a.byte_size, a.checksum_sha256, a.upload_state, a.audio_duration_ms
            """;
    public static final String MEMORY_JOINS = """
            JOIN contribution c ON c.id = m.contribution_id
            LEFT JOIN media_asset a ON a.memory_id = m.id
            """;
    public static final String AVAILABLE = """
            c.event_key = 'kevin-mel-wedding' AND m.visibility IN ('COUPLE_ONLY', 'FRIENDS_FAMILY', 'PUBLIC')
                AND m.review_status IN ('PENDING', 'KEEP', 'ARCHIVED', 'DELETE')
                AND m.purge_started_at IS NULL AND m.purged_at IS NULL
                AND (m.review_status <> 'DELETE' OR m.delete_after > :now)
                AND (m.memory_type = 'TEXT' OR (m.memory_type IN ('PHOTO', 'AUDIO')
                    AND a.upload_state = 'UPLOADED'
                    AND ((m.memory_type = 'PHOTO' AND a.detected_format IN ('image/jpeg', 'image/png', 'image/webp')
                        AND a.byte_size BETWEEN 1 AND 10000000 AND a.expected_duration_ms IS NULL
                        AND a.audio_duration_ms IS NULL AND a.audio_container IS NULL AND a.audio_codec IS NULL)
                        OR (m.memory_type = 'AUDIO' AND a.byte_size BETWEEN 1 AND 25000000
                            AND a.expected_duration_ms BETWEEN 1 AND 120000 AND a.audio_duration_ms BETWEEN 1 AND 120000
                            AND ((a.detected_format = 'audio/webm' AND a.audio_container = 'webm' AND a.audio_codec = 'opus')
                                OR (a.detected_format = 'audio/ogg' AND a.audio_container = 'ogg' AND a.audio_codec = 'opus')
                                OR (a.detected_format = 'audio/mp4' AND a.audio_container = 'mp4' AND a.audio_codec = 'aac'))))
                    AND a.expected_byte_size = a.byte_size
                    AND a.expected_checksum_sha256 = a.checksum_sha256
                    AND a.declared_content_type = a.detected_format
                    AND a.object_key = 'originals/' || a.id::text))
            """;
    private static final String SELECT = "SELECT " + MEMORY_COLUMNS + " FROM memory m "
            + MEMORY_JOINS + " WHERE " + AVAILABLE;
    private final JdbcClient db;
    private final Clock clock;

    public InboxRepository(
            JdbcClient db,
            Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<MemoryDetail> list(InboxQuery query) {
        return list(query, clock.instant());
    }

    /** Count and cursor page use the same eligible rows and database snapshot. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public InboxRows listPage(InboxQuery query) {
        Instant at = clock.instant();
        List<MemoryDetail> items = list(query, at);
        long totalCount = db.sql("SELECT COUNT(*) FROM memory m " + MEMORY_JOINS
                + " WHERE " + AVAILABLE + " AND m.review_status = :status")
                .param("status", query.reviewStatus())
                .param("now", timestamp(at))
                .query(Long.class)
                .single();
        return new InboxRows(items, totalCount);
    }

    private List<MemoryDetail> list(InboxQuery query, Instant at) {
        String sql = SELECT + " AND m.review_status = :status";
        if (query.cursor() != null) {
            sql += " AND (m.created_at, m.id) < (:createdAt, :memoryId)";
        }
        sql += " ORDER BY m.created_at DESC, m.id DESC LIMIT :fetchLimit";
        var statement = db.sql(sql)
                .param("status", query.reviewStatus())
                .param("fetchLimit", query.limit() + 1)
                .param("now", timestamp(at));
        if (query.cursor() != null) {
            statement = statement
                    .param("createdAt", timestamp(query.cursor().createdAt()))
                    .param(MEMORY_ID_PARAM, query.cursor().memoryId());
        }
        return statement.query(InboxRepository::map)
                .list();
    }

    public record InboxRows(List<MemoryDetail> items, long totalCount) {
        public InboxRows {
            items = List.copyOf(items);
        }

        @Override
        public String toString() {
            return "InboxRows[itemCount=" + items.size() + ", totalCount=" + totalCount + "]";
        }
    }

    @Transactional(readOnly = true)
    public Optional<MemoryDetail> detail(UUID memoryId) {
        return db.sql(SELECT + " AND m.id = :memoryId")
                .param(MEMORY_ID_PARAM, memoryId)
                .param("now", timestamp(clock.instant()))
                .query(InboxRepository::map)
                .optional();
    }

    /** Caller holds one transaction through revision update and audit. Lock memory before any asset lock. */
    public Optional<MemoryDetail> lockDetail(UUID memoryId) {
        return db.sql(SELECT + " AND m.id = :memoryId FOR UPDATE OF m")
                .param(MEMORY_ID_PARAM, memoryId)
                .param("now", timestamp(clock.instant()))
                .query(InboxRepository::map)
                .optional();
    }

    public MemoryDetail changeReview(
            MemoryDetail current,
            String status,
            Instant deleteAfter,
            Instant actedAt) {
        return changeReviewAndVisibility(
                current,
                status,
                current.visibility(),
                deleteAfter,
                actedAt);
    }

    public MemoryDetail changeReviewAndVisibility(
            MemoryDetail current,
            String status,
            String visibility,
            Instant deleteAfter,
            Instant actedAt) {
        int changed = db.sql("""
                UPDATE memory SET review_status = :status, visibility = :visibility, delete_after = :deadline,
                    revision = revision + 1, updated_at = :acted
                WHERE id = :id AND revision = :revision AND purge_started_at IS NULL AND purged_at IS NULL
                """)
                .param("status", status)
                .param("visibility", visibility)
                .param("deadline", timestamp(deleteAfter))
                .param(ACTED_AT_PARAM, timestamp(actedAt))
                .param("id", current.memoryId())
                .param(REVISION_FIELD, current.revision())
                .update();
        if (changed != 1) {
            throw new ApiException(
                    412,
                    "REVIEW_CONFLICT",
                    "This memory changed. Reload it before reviewing it again.");
        }
        return new MemoryDetail(
                current.memoryId(),
                current.contributionId(),
                current.guestName(),
                current.memoryType(),
                current.textContent(),
                current.caption(),
                status,
                visibility,
                current.revision() + 1,
                current.createdAt(),
                actedAt,
                deleteAfter,
                current.media(),
                current.source(),
                current.title(),
                current.description(),
                current.memoryDate(),
                current.datePrecision());
    }

    public void revokeShareLink(UUID memoryId) {
        db.sql("DELETE FROM memory_share_link WHERE memory_id = :id")
                .param("id", memoryId)
                .update();
    }

    public MemoryDetail changeMetadata(
            MemoryDetail current,
            MemoryMetadataRequest request,
            Instant actedAt) {
        int changed = db.sql("""
                UPDATE memory SET title = :title, description = :description, memory_date = :date,
                    date_precision = :precision, revision = revision + 1, updated_at = :acted
                WHERE id = :id AND revision = :revision AND review_status <> 'DELETE'
                    AND purge_started_at IS NULL AND purged_at IS NULL
                """)
                .param("title", request.title())
                .param("description", request.description())
                .param("date", request.memoryDate())
                .param("precision", request.datePrecision())
                .param(ACTED_AT_PARAM, timestamp(actedAt))
                .param("id", current.memoryId())
                .param(REVISION_FIELD, current.revision())
                .update();
        if (changed != 1) {
            throw MemoryMetadataService.conflict();
        }
        return new MemoryDetail(
                current.memoryId(),
                current.contributionId(),
                current.guestName(),
                current.memoryType(),
                current.textContent(),
                current.caption(),
                current.reviewStatus(),
                current.visibility(),
                current.revision() + 1,
                current.createdAt(),
                actedAt,
                current.deleteAfter(),
                current.media(),
                current.source(),
                request.title(),
                request.description(),
                request.memoryDate(),
                request.datePrecision());
    }

    public void auditReview(
            MemoryDetail before,
            MemoryDetail after,
            UUID actorId,
            Instant actedAt) {
        db.sql("""
                INSERT INTO review_audit(memory_id, actor_account_id, from_status, to_status,
                    before_revision, after_revision, acted_at, before_visibility, after_visibility)
                VALUES (:memory, :actor, :before, :after, :oldRevision, :revision, :acted, :beforeVisibility, :afterVisibility)
                """)
                .param("memory", before.memoryId())
                .param("actor", actorId)
                .param("before", before.reviewStatus())
                .param("after", after.reviewStatus())
                .param("oldRevision", before.revision())
                .param(REVISION_FIELD, after.revision())
                .param("beforeVisibility", before.visibility())
                .param("afterVisibility", after.visibility())
                .param(ACTED_AT_PARAM, timestamp(actedAt))
                .update();
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    public static MemoryDetail map(
            ResultSet rs,
            int row) throws SQLException {
        String type = rs.getString("memory_type");
        var durationMs = rs.getObject("audio_duration_ms", Long.class);
        var media = "PHOTO".equals(type) || "AUDIO".equals(type)
                ? new MemoryDetail.PhotoMedia(
                        rs.getString("original_filename"),
                        rs.getString("detected_format"),
                        rs.getLong("byte_size"),
                        rs.getString("checksum_sha256"),
                        durationMs == null ? null : durationMs / 1000d,
                        rs.getString("upload_state"))
                : null;
        var deleteAfter = rs.getObject("delete_after", OffsetDateTime.class);
        return new MemoryDetail(
                rs.getObject("memory_id", UUID.class),
                rs.getObject("contribution_id", UUID.class),
                rs.getString("guest_name"),
                type,
                rs.getString("text_content"),
                "TEXT".equals(type) ? null : rs.getString("caption"),
                rs.getString("review_status"),
                rs.getString("visibility"),
                rs.getInt(REVISION_FIELD),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant(),
                deleteAfter == null ? null : deleteAfter.toInstant(),
                media,
                rs.getString("source"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("memory_date"),
                rs.getString("date_precision"));
    }
}
