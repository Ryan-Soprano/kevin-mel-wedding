package com.kevinmel.archive.sharing;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.kevinmel.archive.review.InboxCursor;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.MemoryDetail;

@Repository
public class SharingRepository {
    private static final String ELIGIBLE = InboxRepository.AVAILABLE.replace(":now", "CURRENT_TIMESTAMP")
            + " AND m.review_status = 'KEEP'";
    private static final String SELECT = "SELECT " + InboxRepository.MEMORY_COLUMNS + " FROM memory m "
            + InboxRepository.MEMORY_JOINS + " WHERE " + ELIGIBLE;
    private static final String ACCESS = """
             AND (m.visibility = 'PUBLIC' OR (m.visibility = 'FRIENDS_FAMILY' AND EXISTS
                (SELECT 1 FROM memory_share_link s WHERE s.memory_id = m.id AND s.token_digest = :digest)))
            """;
    private final JdbcClient db;

    public SharingRepository(JdbcClient db) {
        this.db = db;
    }

    public List<SharedMemory> publicMemories(
            int limit,
            InboxCursor cursor) {
        String sql = SELECT + " AND m.visibility = 'PUBLIC'";
        if (cursor != null) {
            sql += " AND (m.created_at, m.id) < (:at, :id)";
        }
        var query = db.sql(sql + " ORDER BY m.created_at DESC, m.id DESC LIMIT :limit")
                .param("limit", limit + 1);
        if (cursor != null) {
            query = query.param("at", timestamp(cursor.createdAt()))
                    .param("id", cursor.memoryId());
        }
        return query.query((rs, row) -> SharedMemory.from(InboxRepository.map(rs, row)))
                .list();
    }

    public Optional<SharedMemory> accessible(
            UUID memoryId,
            String digest) {
        return accessibleDetail(memoryId, digest, false)
                .map(SharedMemory::from);
    }

    /** Signing holds a memory lock, so a completed revocation cannot race a fresh grant. */
    public Optional<MemoryDetail> accessibleDetail(
            UUID memoryId,
            String digest,
            boolean lock) {
        // Take the lock before beginning the capability query. A statement that waited on a
        // rotating writer could otherwise still use its earlier snapshot of the link table.
        if (lock && db.sql("SELECT id FROM memory WHERE id = :id FOR SHARE")
                .param("id", memoryId)
                .query(UUID.class)
                .optional()
                .isEmpty()) {
            return Optional.empty();
        }
        return db.sql(SELECT + " AND m.id = :id" + ACCESS)
                .param("id", memoryId)
                .param("digest", digest)
                .query(InboxRepository::map)
                .optional();
    }

    public void issue(
            UUID memoryId,
            String digest,
            Instant issuedAt) {
        db.sql("""
                INSERT INTO memory_share_link(memory_id, token_digest, issued_at) VALUES (:id, :digest, :at)
                ON CONFLICT(memory_id) DO UPDATE SET token_digest = EXCLUDED.token_digest, issued_at = EXCLUDED.issued_at
                """)
                .param("id", memoryId)
                .param("digest", digest)
                .param("at", timestamp(issuedAt))
                .update();
    }

    private static OffsetDateTime timestamp(Instant at) {
        return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
    }
}
