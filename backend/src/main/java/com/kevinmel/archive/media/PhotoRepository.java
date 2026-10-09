package com.kevinmel.archive.media;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.contribution.ContributionReceipt;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.retention.SubmissionKeyDigest;

@Repository
public class PhotoRepository {
    private final JdbcClient db;
    private final ContributionRepository contributions;
    private final Clock clock;
    private final PhotoAdmissionPolicy admission;
    public PhotoRepository(JdbcClient db, ContributionRepository contributions, Clock clock, PhotoAdmissionPolicy admission) {
        this.db = db;
        this.contributions = contributions;
        this.clock = clock;
        this.admission = admission;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Saved create(PhotoRequest request, String key) {
        String fingerprint = request.fingerprint();
        // Serialize all photo reservations across processes, not only within one JVM.
        // Read committed sees the previous holder's committed intent after obtaining this lock.
        db.sql("SELECT pg_advisory_xact_lock(1263350093, 1)").query((rs, row) -> true).single();
        var replay = db.sql("SELECT id, request_fingerprint FROM contribution WHERE idempotency_key = :key")
                .param("key", key).query((rs, row) -> new Existing(rs.getObject("id", UUID.class), rs.getString("request_fingerprint")))
                .optional();
        if (replay.isPresent()) {
            if (!fingerprint.equals(replay.get().fingerprint())) throw ApiException.conflict();
            return new Saved(contributions.getReceipt(replay.get().id(), key), false);
        }
        admission.requireNewUpload();
        long reserved = db.sql("""
                SELECT COALESCE(SUM(COALESCE(a.expected_byte_size, a.byte_size)), 0)::bigint
                FROM media_asset a JOIN memory m ON m.id = a.memory_id
                WHERE m.purged_at IS NULL
                """).query(Long.class).single();
        long requested = request.items().stream().mapToLong(PhotoRequest.Item::byteSize).sum();
        admission.requireCapacity(reserved, requested);
        var inserted = db.sql("""
                INSERT INTO contribution(event_key, guest_name, idempotency_key, request_fingerprint)
                SELECT 'kevin-mel-wedding', :name, :key, :fingerprint
                WHERE NOT EXISTS (SELECT 1 FROM erased_submission_key WHERE key_digest = :digest)
                ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
                """).param("name", request.guestName()).param("key", key).param("fingerprint", fingerprint)
                .param("digest", SubmissionKeyDigest.sha256(key)).query(UUID.class).optional();
        UUID id;
        if (inserted.isPresent()) {
            id = inserted.get();
            int position = 0;
            for (PhotoRequest.Item item : request.items()) {
                UUID memoryId = db.sql("""
                        INSERT INTO memory(contribution_id, memory_type, client_item_id, caption, item_position)
                        VALUES (:id, 'PHOTO', :client, :caption, :position) RETURNING id
                        """).param("id", id).param("client", item.clientItemId()).param("caption", item.caption())
                        .param("position", position++).query(UUID.class).single();
                UUID assetId = UUID.randomUUID();
                db.sql("""
                        INSERT INTO media_asset(id, memory_id, object_key, original_filename, detected_format,
                            byte_size, checksum_sha256, declared_content_type, expected_byte_size, expected_checksum_sha256)
                        VALUES (:asset, :memory, :object, :filename, 'unverified',
                            :size, :checksum, :type, :size, :checksum)
                        """).param("asset", assetId).param("memory", memoryId)
                        .param("object", "originals/" + assetId).param("filename", item.originalFilename())
                        .param("size", item.byteSize()).param("checksum", item.checksumSha256())
                        .param("type", item.declaredContentType()).update();
            }
        } else {
            var existing = db.sql("SELECT id, request_fingerprint FROM contribution WHERE idempotency_key = :key")
                    .param("key", key).query((rs, row) -> new Existing(rs.getObject("id", UUID.class), rs.getString("request_fingerprint")))
                    .optional().orElseThrow(ApiException::notFound);
            if (!fingerprint.equals(existing.fingerprint())) throw ApiException.conflict();
            id = existing.id();
        }
        return new Saved(contributions.getReceipt(id, key), inserted.isPresent());
    }

    public void requireNewUpload() { admission.requireNewUpload(); }

    public java.util.Optional<ActiveGrant> activeGrant(UUID assetId, Instant now) {
        return db.sql("""
                SELECT id, object_key, expires_at FROM upload_grant
                WHERE media_asset_id = :asset AND expires_at > :now
                ORDER BY created_at DESC, id DESC LIMIT 1
                """).param("asset", assetId).param("now", OffsetDateTime.ofInstant(now, java.time.ZoneOffset.UTC))
                .query((rs, row) -> new ActiveGrant(rs.getObject("id", UUID.class), rs.getString("object_key"),
                        rs.getObject("expires_at", OffsetDateTime.class).toInstant())).optional();
    }

    public void requireStagingCapacity(long requestedBytes) {
        db.sql("SELECT pg_advisory_xact_lock(1263350093, 1)").query((rs, row) -> true).single();
        // Conservatively retain every grant reservation until its object is confirmed removed.
        // A lifecycle expiry alone cannot prove physical deletion, so age never releases this budget.
        long reserved = db.sql("""
                SELECT COALESCE(SUM(COALESCE(a.expected_byte_size, a.byte_size)), 0)::bigint
                FROM upload_grant g JOIN media_asset a ON a.id = g.media_asset_id
                """).query(Long.class).single();
        admission.requireStagingCapacity(reserved, requestedBytes);
    }

    // Called inside the service/finalizer transaction. Locking serializes grants/finalization for an item.
    public Asset lock(UUID contributionId, UUID memoryId, String key) {
        // All lifecycle and upload work takes the memory lock first, then the asset lock.
        var memory = db.sql("""
                SELECT m.review_status, m.delete_after
                FROM contribution c JOIN memory m ON m.contribution_id = c.id
                WHERE c.id = :contribution AND m.id = :memory AND c.idempotency_key = :key
                    AND c.event_key = 'kevin-mel-wedding' AND m.memory_type = 'PHOTO'
                    AND m.purge_started_at IS NULL AND m.purged_at IS NULL
                FOR UPDATE OF m
                """).param("contribution", contributionId).param("memory", memoryId).param("key", key)
                .query((rs, row) -> new GuestMemory(rs.getString("review_status"),
                        rs.getObject("delete_after", OffsetDateTime.class)))
                .optional().orElseThrow(ApiException::notFound);
        if ("DELETE".equals(memory.reviewStatus()) && !clock.instant().isBefore(memory.deleteAfter().toInstant())) {
            throw ApiException.notFound();
        }
        return db.sql("""
                SELECT a.id, a.object_key, a.declared_content_type, a.expected_byte_size,
                    a.expected_checksum_sha256, a.upload_state
                FROM contribution c JOIN memory m ON m.contribution_id = c.id
                    JOIN media_asset a ON a.memory_id = m.id
                WHERE c.id = :contribution AND m.id = :memory AND c.idempotency_key = :key
                    AND m.memory_type = 'PHOTO' AND a.expected_byte_size IS NOT NULL
                FOR UPDATE OF a
                """).param("contribution", contributionId).param("memory", memoryId).param("key", key)
                .query((rs, row) -> new Asset(rs.getObject("id", UUID.class), rs.getString("object_key"),
                        rs.getString("declared_content_type"), rs.getLong("expected_byte_size"),
                        rs.getString("expected_checksum_sha256"), rs.getString("upload_state")))
                .optional().orElseThrow(ApiException::notFound);
    }

    public void addGrant(UUID id, Asset asset, String stagingKey, Instant createdAt, Instant expiresAt) {
        db.sql("""
                INSERT INTO upload_grant(id, media_asset_id, object_key, created_at, expires_at)
                VALUES (:id, :asset, :key, :created, :expires)
                """).param("id", id).param("asset", asset.id()).param("key", stagingKey)
                .param("created", OffsetDateTime.ofInstant(createdAt, java.time.ZoneOffset.UTC))
                .param("expires", OffsetDateTime.ofInstant(expiresAt, java.time.ZoneOffset.UTC)).update();
    }

    public Grant grant(UUID grantId, UUID assetId) {
        return db.sql("SELECT object_key, expires_at FROM upload_grant WHERE id = :id AND media_asset_id = :asset")
                .param("id", grantId).param("asset", assetId)
                .query((rs, row) -> new Grant(rs.getString("object_key"),
                        rs.getObject("expires_at", OffsetDateTime.class).toInstant()))
                .optional().orElseThrow(ApiException::notFound);
    }

    public void uploaded(Asset asset, String format) {
        db.sql("""
                UPDATE media_asset SET detected_format = :format, upload_state = 'UPLOADED',
                    updated_at = CURRENT_TIMESTAMP WHERE id = :id
                """).param("format", format).param("id", asset.id()).update();
    }

    public void failed(Asset asset) {
        db.sql("UPDATE media_asset SET upload_state = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                .param("id", asset.id()).update();
    }
    public record Saved(ContributionReceipt receipt, boolean created) {}
    public record Asset(UUID id, String originalKey, String contentType, long byteSize, String checksum, String state) {}
    public record Grant(String stagingKey, Instant expiresAt) {}
    public record ActiveGrant(UUID id, String stagingKey, Instant expiresAt) {}
    private record Existing(UUID id, String fingerprint) {}
    private record GuestMemory(String reviewStatus, OffsetDateTime deleteAfter) {}
}
