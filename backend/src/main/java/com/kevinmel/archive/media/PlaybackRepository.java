package com.kevinmel.archive.media;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class PlaybackRepository {
    private final JdbcClient db;

    public PlaybackRepository(JdbcClient db) {
        this.db = db;
    }

    /** Only verified, committed private originals are eligible. */
    @Transactional(readOnly = true)
    public Optional<PlayableMedia> findPlayable(UUID memoryId) {
        return db.sql("""
                SELECT a.id, a.object_key, a.detected_format, a.byte_size, m.memory_type,
                    a.audio_duration_ms, a.audio_container, a.audio_codec
                FROM memory m
                JOIN contribution c ON c.id = m.contribution_id
                JOIN media_asset a ON a.memory_id = m.id
                WHERE m.id = :memory AND c.event_key = 'kevin-mel-wedding'
                    AND m.visibility IN ('COUPLE_ONLY', 'FRIENDS_FAMILY', 'PUBLIC') AND m.memory_type IN ('PHOTO', 'AUDIO')
                    AND m.review_status IN ('PENDING', 'KEEP', 'ARCHIVED')
                    AND m.purge_started_at IS NULL AND m.purged_at IS NULL
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
                    AND a.object_key = 'originals/' || a.id::text
                """)
                .param("memory", memoryId)
                .query((rs, row) -> new PlayableMedia(
                        rs.getObject("id", UUID.class),
                        rs.getString("object_key"),
                        rs.getString("detected_format"),
                        rs.getLong("byte_size"),
                        rs.getString("memory_type"),
                        rs.getObject("audio_duration_ms", Long.class),
                        rs.getString("audio_container"),
                        rs.getString("audio_codec")))
                .optional();
    }

    public record PlayableMedia(
            UUID assetId,
            String objectKey,
            String contentType,
            long byteSize,
            String memoryType,
            Long durationMs,
            String container,
            String codec) {
        public PlayableMedia(
                UUID assetId,
                String objectKey,
                String contentType,
                long byteSize) {
            this(
                    assetId,
                    objectKey,
                    contentType,
                    byteSize,
                    "PHOTO",
                    null,
                    null,
                    null);
        }

        @Override
        public String toString() {
            return "PlayableMedia[assetId=" + assetId + "]";
        }
    }
}
