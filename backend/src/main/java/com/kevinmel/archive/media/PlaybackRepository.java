package com.kevinmel.archive.media;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class PlaybackRepository {
    private final JdbcClient db;

    public PlaybackRepository(JdbcClient db) { this.db = db; }

    /** Only MED-01's verified, committed original is eligible. Audio verification is later work. */
    @Transactional(readOnly = true)
    public Optional<PlayableMedia> findPlayable(UUID memoryId) {
        return db.sql("""
                SELECT a.id, a.object_key, a.detected_format, a.byte_size
                FROM memory m
                JOIN contribution c ON c.id = m.contribution_id
                JOIN media_asset a ON a.memory_id = m.id
                WHERE m.id = :memory AND c.event_key = 'kevin-mel-wedding'
                    AND m.visibility = 'COUPLE_ONLY' AND m.memory_type = 'PHOTO'
                    AND m.review_status IN ('PENDING', 'KEEP', 'ARCHIVED')
                    AND a.upload_state = 'UPLOADED'
                    AND a.detected_format IN ('image/jpeg', 'image/png', 'image/webp')
                    AND a.byte_size BETWEEN 1 AND 10000000
                    AND a.expected_byte_size = a.byte_size
                    AND a.expected_checksum_sha256 = a.checksum_sha256
                    AND a.declared_content_type = a.detected_format
                    AND a.object_key = 'originals/' || a.id::text
                """).param("memory", memoryId)
                .query((rs, row) -> new PlayableMedia(rs.getObject("id", UUID.class), rs.getString("object_key"),
                        rs.getString("detected_format"), rs.getLong("byte_size")))
                .optional();
    }

    public record PlayableMedia(UUID assetId, String objectKey, String contentType, long byteSize) {
        @Override public String toString() { return "PlayableMedia[assetId=" + assetId + "]"; }
    }
}
