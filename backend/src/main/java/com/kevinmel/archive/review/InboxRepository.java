package com.kevinmel.archive.review;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class InboxRepository {
    private static final String SELECT = """
            SELECT m.id AS memory_id, c.id AS contribution_id, c.guest_name, m.memory_type,
                m.text_content, m.caption, m.review_status, m.visibility, m.revision,
                m.created_at, m.updated_at,
                a.original_filename, a.detected_format, a.byte_size, a.checksum_sha256, a.upload_state
            FROM memory m
            JOIN contribution c ON c.id = m.contribution_id
            LEFT JOIN media_asset a ON a.memory_id = m.id
            WHERE c.event_key = 'kevin-mel-wedding' AND m.visibility = 'COUPLE_ONLY'
                AND m.review_status IN ('PENDING', 'KEEP', 'ARCHIVED')
                AND (m.memory_type = 'TEXT' OR (m.memory_type = 'PHOTO'
                    AND a.upload_state = 'UPLOADED'
                    AND a.detected_format IN ('image/jpeg', 'image/png', 'image/webp')
                    AND a.byte_size BETWEEN 1 AND 10000000
                    AND a.expected_byte_size = a.byte_size
                    AND a.expected_checksum_sha256 = a.checksum_sha256
                    AND a.declared_content_type = a.detected_format
                    AND a.object_key = 'originals/' || a.id::text))
            """;
    private final JdbcClient db;

    public InboxRepository(JdbcClient db) { this.db = db; }

    @Transactional(readOnly = true)
    public List<MemoryDetail> list(InboxQuery query) {
        String sql = SELECT + " AND m.review_status = :status";
        if (query.cursor() != null) sql += " AND (m.created_at, m.id) < (:createdAt, :memoryId)";
        sql += " ORDER BY m.created_at DESC, m.id DESC LIMIT :fetchLimit";
        var statement = db.sql(sql).param("status", query.reviewStatus()).param("fetchLimit", query.limit() + 1);
        if (query.cursor() != null) {
            statement = statement.param("createdAt", OffsetDateTime.ofInstant(query.cursor().createdAt(), ZoneOffset.UTC))
                    .param("memoryId", query.cursor().memoryId());
        }
        return statement.query(InboxRepository::map).list();
    }

    @Transactional(readOnly = true)
    public Optional<MemoryDetail> detail(UUID memoryId) {
        return db.sql(SELECT + " AND m.id = :memoryId").param("memoryId", memoryId)
                .query(InboxRepository::map).optional();
    }

    private static MemoryDetail map(ResultSet rs, int row) throws SQLException {
        String type = rs.getString("memory_type");
        var media = "PHOTO".equals(type) ? new MemoryDetail.PhotoMedia(
                rs.getString("original_filename"), rs.getString("detected_format"), rs.getLong("byte_size"),
                rs.getString("checksum_sha256"), null, rs.getString("upload_state")) : null;
        return new MemoryDetail(rs.getObject("memory_id", UUID.class), rs.getObject("contribution_id", UUID.class),
                rs.getString("guest_name"), type, rs.getString("text_content"), "PHOTO".equals(type) ? rs.getString("caption") : null,
                rs.getString("review_status"), rs.getString("visibility"), rs.getInt("revision"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant(), null, media);
    }
}
