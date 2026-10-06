package com.kevinmel.archive.media;

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

@Repository
public class PhotoRepository {
    private final JdbcClient db;
    private final ContributionRepository contributions;
    public PhotoRepository(JdbcClient db, ContributionRepository contributions) {
        this.db = db;
        this.contributions = contributions;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Saved create(PhotoRequest request, String key) {
        String fingerprint = request.fingerprint();
        var inserted = db.sql("""
                INSERT INTO contribution(event_key, guest_name, idempotency_key, request_fingerprint)
                VALUES ('kevin-mel-wedding', :name, :key, :fingerprint)
                ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
                """).param("name", request.guestName()).param("key", key).param("fingerprint", fingerprint)
                .query(UUID.class).optional();
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
                    .single();
            if (!fingerprint.equals(existing.fingerprint())) throw ApiException.conflict();
            id = existing.id();
        }
        return new Saved(contributions.getReceipt(id, key), inserted.isPresent());
    }

    // Called inside the service/finalizer transaction. Locking serializes grants/finalization for an item.
    public Asset lock(UUID contributionId, UUID memoryId, String key) {
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
    private record Existing(UUID id, String fingerprint) {}
}
