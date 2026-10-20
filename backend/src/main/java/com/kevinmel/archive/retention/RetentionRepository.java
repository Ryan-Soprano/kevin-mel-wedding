package com.kevinmel.archive.retention;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.kevinmel.archive.album.AlbumMemberships;
import com.kevinmel.archive.library.TagMemberships;
import com.kevinmel.archive.timeline.TimelineMemberships;

/** Database claims freeze the plan; external IO happens after claim commit and before scrubbing. */
@Repository
public class RetentionRepository {
    private static final String CONTRIBUTION_ID_COLUMN = "contribution_id";

    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final boolean scrubArchiveMetadata;
    private final boolean detachAlbumMemberships;
    private final boolean detachTimelineMemberships;
    private final boolean detachTagMemberships;

    @Autowired
    public RetentionRepository(
            JdbcClient db,
            PlatformTransactionManager manager) {
        this(db, manager, true, true, true, true);
    }

    /** Offline recovery alone selects false for an exactly reviewed pre-archive schema. */
    public RetentionRepository(
            JdbcClient db,
            PlatformTransactionManager manager,
            boolean scrubArchiveMetadata) {
        this(db, manager, scrubArchiveMetadata, false);
    }

    /**
     * Offline recovery passes capabilities of an exactly reviewed target schema,
     * never ambient configuration.
     */
    public RetentionRepository(
            JdbcClient db,
            PlatformTransactionManager manager,
            boolean scrubArchiveMetadata,
            boolean detachAlbumMemberships) {
        this(db, manager, scrubArchiveMetadata, detachAlbumMemberships, false);
    }

    /**
     * Timeline cleanup is enabled only for the normal current schema or an
     * exactly reviewed V12 recovery target.
     */
    public RetentionRepository(
            JdbcClient db,
            PlatformTransactionManager manager,
            boolean scrubArchiveMetadata,
            boolean detachAlbumMemberships,
            boolean detachTimelineMemberships) {
        this(
                db,
                manager,
                scrubArchiveMetadata,
                detachAlbumMemberships,
                detachTimelineMemberships,
                false);
    }

    /**
     * Tag cleanup is enabled only for the normal current schema or an exactly
     * reviewed V13 recovery target.
     */
    public RetentionRepository(
            JdbcClient db,
            PlatformTransactionManager manager,
            boolean scrubArchiveMetadata,
            boolean detachAlbumMemberships,
            boolean detachTimelineMemberships,
            boolean detachTagMemberships) {
        this.db = db;
        this.tx = new TransactionTemplate(manager);
        this.scrubArchiveMetadata = scrubArchiveMetadata;
        this.detachAlbumMemberships = detachAlbumMemberships;
        this.detachTimelineMemberships = detachTimelineMemberships;
        this.detachTagMemberships = detachTagMemberships;
    }

    public List<DeletionRecord> claim(
            int limit,
            Instant now) {
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException("Invalid retention batch size.");
        }
        Instant at = now.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        return tx.execute(ignored -> {
            var candidates = db.sql("""
                    SELECT m.id, c.id AS contribution_id, c.idempotency_key, a.id AS asset_id,
                        m.delete_after
                    FROM memory m JOIN contribution c ON c.id = m.contribution_id
                    LEFT JOIN media_asset a ON a.memory_id = m.id
                    WHERE c.event_key = 'kevin-mel-wedding' AND m.visibility = 'COUPLE_ONLY'
                        AND m.review_status = 'DELETE' AND m.purged_at IS NULL AND m.delete_after <= :now
                        AND (m.memory_type = 'TEXT' OR (m.memory_type IN ('PHOTO', 'AUDIO')
                            AND a.upload_state = 'UPLOADED'
                            AND ((m.memory_type = 'PHOTO'
                                AND a.detected_format IN ('image/jpeg', 'image/png', 'image/webp')
                                AND a.byte_size BETWEEN 1 AND 10000000
                                AND a.expected_duration_ms IS NULL AND a.audio_duration_ms IS NULL
                                AND a.audio_codec IS NULL AND a.audio_container IS NULL)
                                OR (m.memory_type = 'AUDIO' AND a.byte_size BETWEEN 1 AND 25000000
                                    AND a.expected_duration_ms BETWEEN 1 AND 120000
                                    AND a.audio_duration_ms BETWEEN 1 AND 120000
                                    AND ((a.detected_format = 'audio/webm' AND a.audio_container = 'webm' AND a.audio_codec = 'opus')
                                        OR (a.detected_format = 'audio/ogg' AND a.audio_container = 'ogg' AND a.audio_codec = 'opus')
                                        OR (a.detected_format = 'audio/mp4' AND a.audio_container = 'mp4' AND a.audio_codec = 'aac'))))
                            AND a.expected_byte_size = a.byte_size
                            AND a.expected_checksum_sha256 = a.checksum_sha256
                            AND a.declared_content_type = a.detected_format
                            AND a.object_key = 'originals/' || a.id::text))
                    ORDER BY m.delete_after, m.id LIMIT :limit FOR UPDATE OF m SKIP LOCKED
                    """)
                    .param("now", time(at))
                    .param("limit", limit)
                    .query((rs, row) -> new DeletionRecord(
                            rs.getObject("id", UUID.class),
                            rs.getObject(CONTRIBUTION_ID_COLUMN, UUID.class),
                            rs.getObject("asset_id", UUID.class),
                            SubmissionKeyDigest.sha256(rs.getString("idempotency_key")),
                            rs.getObject("delete_after", OffsetDateTime.class).toInstant(),
                            at))
                    .list();
            return candidates.stream()
                    .map(record -> {
                        insertPlan(record, false);
                        db.sql("UPDATE memory SET purge_started_at = COALESCE(purge_started_at, :now) WHERE id = :id")
                                .param("now", time(at))
                                .param("id", record.memoryId())
                                .update();
                        // Use PostgreSQL's persisted timestamp precision on every external retry.
                        return db.sql("SELECT * FROM deletion_ledger WHERE memory_id = :id")
                                .param("id", record.memoryId())
                                .query(RetentionRepository::map)
                                .single();
                    })
                    .toList();
        });
    }

    public List<UUID> grants(DeletionRecord record) {
        if (record.assetId() == null) {
            return List.of();
        }
        return db.sql("SELECT id, object_key FROM upload_grant WHERE media_asset_id = :id ORDER BY id")
                .param("id", record.assetId())
                .query((rs, row) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    if (!("staging/" + id).equals(rs.getString("object_key"))) {
                        throw invalidPlan();
                    }
                    return id;
                })
                .list();
    }

    /** Validate all current ownership before deleting any remote object, including during offline replay. */
    public void validate(DeletionRecord record) {
        validate(record, false);
    }

    private void validate(
            DeletionRecord record,
            boolean lock) {
        var memory = db.sql("""
                SELECT m.contribution_id, m.memory_type, c.event_key, c.idempotency_key
                FROM memory m JOIN contribution c ON c.id = m.contribution_id
                WHERE m.id = :id
                """ + (lock ? " FOR UPDATE OF m" : ""))
                .param("id", record.memoryId())
                .query((rs, row) -> new Existing(
                        rs.getObject(CONTRIBUTION_ID_COLUMN, UUID.class),
                        rs.getString("event_key"),
                        SubmissionKeyDigest.sha256(rs.getString("idempotency_key")),
                        rs.getString("memory_type")))
                .optional();
        if (memory.isPresent()) {
            requireMemoryIdentity(record, memory.get());
            requireMemoryAsset(record);
        }
        if (record.assetId() != null) {
            var owner = db.sql("SELECT memory_id FROM media_asset WHERE id = :id")
                    .param("id", record.assetId())
                    .query(UUID.class)
                    .optional();
            if (owner.isPresent() && !owner.get().equals(record.memoryId())) {
                throw invalidPlan();
            }
        }
    }

    private static void requireMemoryIdentity(DeletionRecord record, Existing existing) {
        if (!record.contributionId().equals(existing.contributionId())
                || !"kevin-mel-wedding".equals(existing.eventKey())
                || !record.submissionKeyDigest().equals(existing.keyDigest())
                || ("TEXT".equals(existing.memoryType()) && record.assetId() != null)
                || (List.of("PHOTO", "AUDIO").contains(existing.memoryType()) && record.assetId() == null)
                || !List.of("TEXT", "PHOTO", "AUDIO").contains(existing.memoryType())) {
            throw invalidPlan();
        }
    }

    private void requireMemoryAsset(DeletionRecord record) {
        var asset = db.sql("SELECT id, object_key FROM media_asset WHERE memory_id = :id")
                .param("id", record.memoryId())
                .query((rs, row) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    if (!("originals/" + id).equals(rs.getString("object_key"))) {
                        throw invalidPlan();
                    }
                    return id;
                })
                .optional();
        if (asset.isPresent() && !asset.get().equals(record.assetId())) {
            throw invalidPlan();
        }
    }

    /** Replaying an independent tombstone also reserves keys absent from the restored backup. */
    public boolean finish(
            DeletionRecord record,
            Instant now) {
        if (now.isBefore(record.recordedAt())) {
            throw invalidPlan();
        }
        return Boolean.TRUE.equals(tx.execute(ignored -> {
            validate(record, true);
            if (detachAlbumMemberships) {
                AlbumMemberships.detach(db, record.memoryId(), now);
            }
            if (detachTimelineMemberships) {
                TimelineMemberships.detach(db, record.memoryId(), now);
            }
            if (detachTagMemberships) {
                TagMemberships.detach(db, record.memoryId(), now);
            }
            insertPlan(record, true);
            db.sql("""
                    INSERT INTO erased_submission_key (key_digest, erased_at) VALUES (:digest, :now)
                    ON CONFLICT (key_digest) DO NOTHING
                    """)
                    .param("digest", record.submissionKeyDigest())
                    .param("now", time(now))
                    .update();
            if (record.assetId() != null) {
                db.sql("DELETE FROM upload_grant WHERE media_asset_id = :id")
                        .param("id", record.assetId())
                        .update();
                db.sql("DELETE FROM media_asset WHERE id = :id")
                        .param("id", record.assetId())
                        .update();
            }
            String metadataScrub = scrubArchiveMetadata
                    ? "title = NULL, description = NULL, memory_date = NULL, date_precision = 'UNKNOWN', "
                    : "";
            int changed = db.sql("""
                    UPDATE memory SET review_status = 'DELETE', visibility = 'COUPLE_ONLY', delete_after = :deadline,
                        purge_started_at = COALESCE(purge_started_at, :recorded), purged_at = :now,
                        text_content = NULL, caption = NULL,
                    """ + metadataScrub + """
                        revision = revision + 1,
                        updated_at = GREATEST(updated_at, :now)
                    WHERE id = :id AND purged_at IS NULL
                    """)
                    .param("id", record.memoryId())
                    .param("deadline", time(record.deleteAfter()))
                    .param("recorded", time(record.recordedAt()))
                    .param("now", time(now))
                    .update();
            // Serialize sibling cleanup even when the erased key was reserved earlier.
            // The next statement gets a fresh snapshot after any contribution-lock wait.
            db.sql("SELECT id FROM contribution WHERE id = :id FOR UPDATE")
                    .param("id", record.contributionId())
                    .query(UUID.class)
                    .optional();
            db.sql("""
                    UPDATE contribution SET guest_name = NULL WHERE id = :id
                    AND NOT EXISTS (SELECT 1 FROM memory WHERE contribution_id = :id AND purged_at IS NULL)
                    """)
                    .param("id", record.contributionId())
                    .update();
            db.sql("UPDATE deletion_ledger SET purged_at = COALESCE(purged_at, :now) WHERE memory_id = :id")
                    .param("now", time(now))
                    .param("id", record.memoryId())
                    .update();
            return changed > 0;
        }));
    }

    private void insertPlan(
            DeletionRecord record,
            boolean replay) {
        String conflict = replay ? """
                DO UPDATE SET contribution_id = EXCLUDED.contribution_id, asset_id = EXCLUDED.asset_id,
                    submission_key_digest = EXCLUDED.submission_key_digest,
                    delete_after = EXCLUDED.delete_after, recorded_at = EXCLUDED.recorded_at
                """
                : "DO NOTHING";
        db.sql("""
                INSERT INTO deletion_ledger (memory_id, contribution_id, asset_id,
                    submission_key_digest, delete_after, recorded_at)
                VALUES (:memory, :contribution, :asset, :digest, :deadline, :recorded)
                ON CONFLICT (memory_id)
                """ + conflict)
                .param("memory", record.memoryId())
                .param("contribution", record.contributionId())
                .param("asset", record.assetId())
                .param("digest", record.submissionKeyDigest())
                .param("deadline", time(record.deleteAfter()))
                .param("recorded", time(record.recordedAt()))
                .update();
    }

    private static DeletionRecord map(
            java.sql.ResultSet rs,
            int row) throws java.sql.SQLException {
        return new DeletionRecord(
                rs.getObject("memory_id", UUID.class),
                rs.getObject(CONTRIBUTION_ID_COLUMN, UUID.class),
                rs.getObject("asset_id", UUID.class),
                rs.getString("submission_key_digest"),
                rs.getObject("delete_after", OffsetDateTime.class).toInstant(),
                rs.getObject("recorded_at", OffsetDateTime.class).toInstant());
    }

    private static OffsetDateTime time(Instant now) {
        return OffsetDateTime.ofInstant(now, ZoneOffset.UTC);
    }

    private static IllegalStateException invalidPlan() {
        return new IllegalStateException("Retention plan identity is invalid.");
    }

    private record Existing(
            UUID contributionId,
            String eventKey,
            String keyDigest,
            String memoryType) {
    }
}
