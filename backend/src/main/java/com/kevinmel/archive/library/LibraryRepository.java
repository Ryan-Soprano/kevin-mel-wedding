package com.kevinmel.archive.library;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.MemoryDetail;

@Repository
public class LibraryRepository {
    public static final String ELIGIBLE = InboxRepository.AVAILABLE + " AND m.review_status<>'DELETE' ";
    private static final String FILTERS = """
            AND (:type='ALL' OR m.memory_type=:type) AND (:status='ALL' OR m.review_status=:status)
            AND (:precision='ALL' OR m.date_precision=:precision)
            AND (CAST(:fromYear AS INTEGER) IS NULL OR left(m.memory_date,4)::integer>=:fromYear)
            AND (CAST(:toYear AS INTEGER) IS NULL OR left(m.memory_date,4)::integer<=:toYear)
            AND (CAST(:tag AS UUID) IS NULL OR EXISTS(SELECT 1 FROM memory_tag mt JOIN tag t ON t.id=mt.tag_id
                WHERE mt.memory_id=m.id AND mt.tag_id=:tag AND t.deleted_at IS NULL))
            AND (CAST(:q AS TEXT) IS NULL OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(m.title,'')))>0 OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(m.description,'')))>0 OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(m.text_content,'')))>0 OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(m.caption,'')))>0 OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(c.guest_name,'')))>0 OR
                position(lower(CAST(:q AS TEXT)) IN lower(COALESCE(a.original_filename,'')))>0)
            """;
    private final JdbcClient db;

    public LibraryRepository(JdbcClient db) {
        this.db = db;
    }

    /**
     * Anchor, chosen-tag availability and all cards use the same PostgreSQL
     * statement snapshot.
     */
    public List<Row> list(
            LibraryQuery query,
            Instant now) {
        String from = " FROM memory m " + InboxRepository.MEMORY_JOINS + " WHERE " + ELIGIBLE + FILTERS;
        String sql = "WITH anchor AS(SELECT m.created_at,m.id " + from + " AND m.id=:anchor), selected AS(SELECT "
                + "(CAST(:tag AS UUID) IS NULL OR EXISTS(SELECT 1 FROM tag WHERE id=:tag AND deleted_at IS NULL)) AS tag_valid) "
                + "SELECT selected.tag_valid,(CAST(:anchor AS UUID) IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS anchor_valid,page.* "
                + "FROM selected LEFT JOIN LATERAL(SELECT " + InboxRepository.MEMORY_COLUMNS + from
                + " AND (CAST(:anchor AS UUID) IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM anchor)) "
                + "ORDER BY m.created_at DESC,m.id DESC LIMIT :limit) page ON true ORDER BY page.created_at DESC,page.memory_id DESC";
        return db.sql(sql)
                .param("now", time(now))
                .param("type", query.memoryType())
                .param("status", query.reviewStatus())
                .param("precision", query.datePrecision())
                .param("fromYear", query.fromYear())
                .param("toYear", query.toYear())
                .param("tag", query.tagId())
                .param("q", query.q())
                .param("anchor", query.cursor() == null ? null : query.cursor().anchorId())
                .param("limit", query.limit() + 1)
                .query((rs, row) -> new Row(
                        rs.getBoolean("tag_valid"),
                        rs.getBoolean("anchor_valid"),
                        rs.getObject("memory_id") == null ? null : InboxRepository.map(rs, row)))
                .list();
    }

    static OffsetDateTime time(Instant at) {
        return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
    }

    public record Row(
            boolean tagValid,
            boolean anchorValid,
            MemoryDetail memory) {
    }
}
