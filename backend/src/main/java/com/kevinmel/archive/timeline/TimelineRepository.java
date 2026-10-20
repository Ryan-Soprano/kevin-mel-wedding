package com.kevinmel.archive.timeline;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.MemoryDetail;

@Repository
public class TimelineRepository {
    public static final UUID EMPTY_REVISION = UUID.fromString("00000000-0000-4000-8000-000000000000");
    private static final String EVENT_PARAMETER = "event";
    private static final String MEMORY_PARAMETER = "memory";
    private static final String PRECISION_PARAMETER = "precision";
    private static final String ELIGIBLE = InboxRepository.AVAILABLE + " AND m.review_status <> 'DELETE' ";
    private static final String MEMBER_FROM = " FROM timeline_event_memory tm JOIN memory m ON m.id=tm.memory_id "
            + InboxRepository.MEMORY_JOINS;
    private static final String COLUMNS = """
            te.id AS event_id,te.title AS event_title,te.description AS event_description,te.event_date,
            te.date_precision AS event_date_precision,te.visibility AS event_visibility,
            te.revision AS event_revision,te.created_at AS event_created_at,te.updated_at AS event_updated_at,
            te.deleted_at AS event_deleted_at,(SELECT count(*)
            """ + MEMBER_FROM + " WHERE tm.event_id=te.id AND " + ELIGIBLE + ") AS member_count ";
    private static final String FILTER = """
             AND (:precision='ALL' OR te.date_precision=:precision)
             AND (CAST(:fromYear AS INTEGER) IS NULL OR left(te.event_date,4)::INTEGER>=CAST(:fromYear AS INTEGER))
             AND (CAST(:toYear AS INTEGER) IS NULL OR left(te.event_date,4)::INTEGER<=CAST(:toYear AS INTEGER))
            """;
    private final JdbcClient db;

    public TimelineRepository(JdbcClient db) {
        this.db = db;
    }

    /** Catalogue token, anchor, counts and page share exactly one PostgreSQL statement snapshot. */
    public List<ListRow> list(
            TimelineQuery query,
            Instant now) {
        String sql = """
                WITH catalogue AS (SELECT COALESCE((SELECT revision FROM timeline_state WHERE id=1),CAST(:baseline AS UUID)) AS listing_revision),
                anchor AS (SELECT te.id,te.event_date IS NULL AS undated,COALESCE(te.event_date,'') COLLATE "C" AS sort_date,te.created_at
                    FROM timeline_event te WHERE te.id=:anchor AND te.deleted_at IS NULL
                """ + FILTER + """
                ) SELECT catalogue.listing_revision,anchor.id IS NOT NULL AS anchor_valid,page.*
                FROM catalogue LEFT JOIN anchor ON true LEFT JOIN LATERAL (SELECT
                """ + COLUMNS + """
                ,te.event_date IS NULL AS undated,COALESCE(te.event_date,'') COLLATE "C" AS sort_date
                FROM timeline_event te WHERE te.deleted_at IS NULL
                """ + FILTER + """
                AND (:hasCursor=false OR (anchor.id IS NOT NULL AND
                    (te.event_date IS NULL,COALESCE(te.event_date,'') COLLATE "C",te.created_at,te.id)>
                    (anchor.undated,anchor.sort_date,anchor.created_at,anchor.id)))
                ORDER BY te.event_date IS NULL,COALESCE(te.event_date,'') COLLATE "C",te.created_at,te.id LIMIT :limit
                ) page ON true ORDER BY page.undated,page.sort_date COLLATE "C",page.event_created_at,page.event_id
                """;
        return db.sql(sql)
                .param("baseline", EMPTY_REVISION)
                .param("anchor", query.cursor() == null ? null : query.cursor().anchorId())
                .param("hasCursor", query.cursor() != null)
                .param(PRECISION_PARAMETER, query.datePrecision())
                .param("fromYear", query.fromYear())
                .param("toYear", query.toYear())
                .param("limit", query.limit() + 1)
                .param("now", time(now))
                .query((rs, row) -> new ListRow(
                        rs.getObject("listing_revision", UUID.class),
                        rs.getBoolean("anchor_valid"),
                        rs.getObject("event_id") == null ? null : map(rs, row)))
                .list();
    }

    public Optional<TimelineEvent> detail(
            UUID id,
            Instant now,
            boolean lock) {
        return db.sql("SELECT " + COLUMNS + " FROM timeline_event te WHERE te.id=:id"
                + (lock ? " FOR UPDATE OF te" : ""))
                .param("id", id)
                .param("now", time(now))
                .query(TimelineRepository::map)
                .optional();
    }

    /** Event token, anchor, eligible count and full memory cards share one statement snapshot. */
    public List<MemberRow> members(
            UUID id,
            TimelineQuery query,
            Instant now) {
        String sql = "WITH anchor AS (SELECT m.id,m.created_at " + MEMBER_FROM
                + " WHERE tm.event_id=:id AND m.id=:anchor AND " + ELIGIBLE
                + ") SELECT " + COLUMNS + ",anchor.id IS NOT NULL AS anchor_valid,page.* FROM timeline_event te LEFT JOIN anchor ON true "
                + " LEFT JOIN LATERAL (SELECT " + InboxRepository.MEMORY_COLUMNS + MEMBER_FROM
                + " WHERE tm.event_id=te.id AND te.deleted_at IS NULL AND " + ELIGIBLE
                + " AND (:hasCursor=false OR (anchor.id IS NOT NULL AND (m.created_at,m.id)>(anchor.created_at,anchor.id))) "
                + " ORDER BY m.created_at,m.id LIMIT :limit) page ON true WHERE te.id=:id ORDER BY page.created_at,page.memory_id";
        return db.sql(sql)
                .param("id", id)
                .param("anchor", query.cursor() == null ? null : query.cursor().anchorId())
                .param("hasCursor", query.cursor() != null)
                .param("limit", query.limit() + 1)
                .param("now", time(now))
                .query((rs, row) -> new MemberRow(
                        map(rs, row),
                        rs.getBoolean("anchor_valid"),
                        rs.getObject("memory_id") == null ? null : InboxRepository.map(rs, row)))
                .list();
    }

    /** Every timeline writer obtains this lock before an event lock; create is the sole lazy initializer. */
    public Optional<State> lockState(
            Instant at,
            boolean initialize) {
        if (initialize) {
            db.sql("INSERT INTO timeline_state(id,updated_at) VALUES(1,:at) ON CONFLICT(id) DO NOTHING")
                    .param("at", time(at))
                    .update();
        }
        return db.sql("SELECT revision,updated_at FROM timeline_state WHERE id=1 FOR UPDATE")
                .query((rs, row) -> new State(
                        rs.getObject("revision", UUID.class),
                        rs.getObject("updated_at", OffsetDateTime.class).toInstant()))
                .optional();
    }

    public boolean create(
            UUID id,
            TimelineRequest request,
            Instant at) {
        return db.sql("""
                INSERT INTO timeline_event(id,title,description,event_date,date_precision,created_at,updated_at)
                VALUES(:id,:title,:description,:date,:precision,:at,:at) ON CONFLICT(id) DO NOTHING
                """)
                .param("id", id)
                .param("title", request.title())
                .param("description", request.description())
                .param("date", request.eventDate())
                .param(PRECISION_PARAMETER, request.datePrecision())
                .param("at", time(at))
                .update() == 1;
    }

    public void edit(
            UUID id,
            TimelineRequest request,
            Instant at) {
        db.sql("""
                UPDATE timeline_event SET title=:title,description=:description,event_date=:date,date_precision=:precision,
                    revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id
                """)
                .param("id", id)
                .param("title", request.title())
                .param("description", request.description())
                .param("date", request.eventDate())
                .param(PRECISION_PARAMETER, request.datePrecision())
                .param("at", time(at))
                .update();
    }

    public void refreshEvent(
            UUID id,
            Instant at) {
        db.sql("UPDATE timeline_event SET revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                .param("id", id)
                .param("at", time(at))
                .update();
    }

    public void refreshState(Instant at) {
        refreshState(db, at);
    }

    static void refreshState(
            JdbcClient db,
            Instant at) {
        db.sql("""
                UPDATE timeline_state SET revision=gen_random_uuid(),
                    updated_at=GREATEST(updated_at,:at) WHERE id=1
                """)
                .param("at", time(at))
                .update();
    }

    public void delete(
            UUID id,
            Instant at) {
        db.sql("DELETE FROM timeline_event_memory WHERE event_id=:id")
                .param("id", id)
                .update();
        db.sql("""
                UPDATE timeline_event SET title=NULL,description=NULL,event_date=NULL,date_precision='UNKNOWN',
                    revision=gen_random_uuid(),deleted_at=GREATEST(updated_at,:at),updated_at=GREATEST(updated_at,:at) WHERE id=:id
                """)
                .param("id", id)
                .param("at", time(at))
                .update();
    }

    public boolean linked(
            UUID event,
            UUID memory) {
        return db.sql("SELECT EXISTS(SELECT 1 FROM timeline_event_memory WHERE event_id=:event AND memory_id=:memory)")
                .param(EVENT_PARAMETER, event)
                .param(MEMORY_PARAMETER, memory)
                .query(Boolean.class)
                .single();
    }

    public void add(
            UUID event,
            UUID memory) {
        db.sql("INSERT INTO timeline_event_memory(event_id,memory_id) VALUES(:event,:memory)")
                .param(EVENT_PARAMETER, event)
                .param(MEMORY_PARAMETER, memory)
                .update();
    }

    public boolean remove(
            UUID event,
            UUID memory) {
        return db.sql("DELETE FROM timeline_event_memory WHERE event_id=:event AND memory_id=:memory")
                .param(EVENT_PARAMETER, event)
                .param(MEMORY_PARAMETER, memory)
                .update() > 0;
    }

    private static TimelineEvent map(
            ResultSet rs,
            int row) throws SQLException {
        var deleted = rs.getObject("event_deleted_at", OffsetDateTime.class);
        return new TimelineEvent(
                rs.getObject("event_id", UUID.class),
                rs.getString("event_title"),
                rs.getString("event_description"),
                rs.getString("event_date"),
                rs.getString("event_date_precision"),
                rs.getString("event_visibility"),
                rs.getObject("event_revision", UUID.class),
                rs.getLong("member_count"),
                rs.getObject("event_created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("event_updated_at", OffsetDateTime.class).toInstant(),
                deleted == null ? null : deleted.toInstant());
    }

    static OffsetDateTime time(Instant at) {
        return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
    }

    public record State(
            UUID revision,
            Instant updatedAt) {
    }

    public record ListRow(
            UUID revision,
            boolean anchorValid,
            TimelineEvent event) {
    }

    public record MemberRow(
            TimelineEvent event,
            boolean anchorValid,
            MemoryDetail memory) {
    }
}
