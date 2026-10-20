package com.kevinmel.archive.album;

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
public class AlbumRepository {
    private static final String ALBUM_PARAM = "album";
    private static final String MEMORY_PARAM = "memory";
    private static final String POSITION_FIELD = "position";

    private static final String ELIGIBLE = InboxRepository.AVAILABLE + " AND m.review_status <> 'DELETE' ";
    private static final String MEMBER_FROM = " FROM album_membership am JOIN memory m ON m.id=am.memory_id "
            + InboxRepository.MEMORY_JOINS;
    private static final String COLUMNS = """
                        al.id AS album_id, al.name AS album_name, al.visibility AS album_visibility,
                        al.revision AS album_revision, al.created_at AS album_created_at,
                        al.updated_at AS album_updated_at, al.deleted_at AS album_deleted_at,
                        (SELECT count(*)
                        """ + MEMBER_FROM + " WHERE am.album_id=al.id AND " + ELIGIBLE + ") AS member_count ";
    private static final String SELECT_ALBUM = "SELECT " + COLUMNS;
    private final JdbcClient db;

    public AlbumRepository(JdbcClient db) {
        this.db = db;
    }

    public List<AlbumDetail> list(AlbumQuery query, Instant now) {
        String sql = SELECT_ALBUM + " FROM album al WHERE al.deleted_at IS NULL ";
        if (query.cursor() != null) {
            sql += " AND (al.created_at,al.id)<(:created,:id) ";
        }
        sql += " ORDER BY al.created_at DESC,al.id DESC LIMIT :limit";
        var statement = db.sql(sql)
                .param("now", time(now))
                .param("limit", query.limit() + 1);
        if (query.cursor() != null) {
            statement = statement.param("created", time(query.cursor().createdAt()))
                    .param("id", query.cursor().albumId());
        }
        return statement.query(AlbumRepository::map)
                .list();
    }

    public Optional<AlbumDetail> detail(
            UUID id,
            Instant now,
            boolean lock) {
        return db.sql(SELECT_ALBUM + " FROM album al WHERE al.id=:id"
                + (lock ? " FOR UPDATE OF al" : ""))
                .param("id", id)
                .param("now", time(now))
                .query(AlbumRepository::map)
                .optional();
    }

    /**
     * Album token, count and memory cards come from one PostgreSQL statement
     * snapshot.
     */
    public List<MemberRow> members(UUID id, AlbumQuery query, Instant now) {
        String neighbor = " EXISTS (SELECT 1 FROM album_membership neighbor JOIN memory m ON m.id=neighbor.memory_id "
                + InboxRepository.MEMORY_JOINS + " WHERE neighbor.album_id=al.id AND " + ELIGIBLE;
        String sql = SELECT_ALBUM + ", page.* FROM album al LEFT JOIN LATERAL (SELECT "
                + InboxRepository.MEMORY_COLUMNS + ",am.position,"
                + neighbor + " AND neighbor.position<am.position) AS can_move_earlier,"
                + neighbor + " AND neighbor.position>am.position) AS can_move_later "
                + MEMBER_FROM + " WHERE am.album_id=al.id AND al.deleted_at IS NULL AND " + ELIGIBLE
                + " AND am.position>:position ORDER BY am.position LIMIT :limit) page ON true WHERE al.id=:id ORDER BY page.position NULLS LAST";
        return db.sql(sql)
                .param("id", id)
                .param("now", time(now))
                .param("limit", query.limit() + 1)
                .param(POSITION_FIELD, query.cursor() == null ? 0L : query.cursor().position())
                .query((rs, row) -> new MemberRow(
                        map(rs, row),
                        rs.getObject("memory_id") == null ? null : InboxRepository.map(rs, row),
                        rs.getLong(POSITION_FIELD),
                        rs.getBoolean("can_move_earlier"),
                        rs.getBoolean("can_move_later")))
                .list();
    }

    public boolean create(UUID id, String name, Instant at) {
        return db.sql("""
                                INSERT INTO album(id,name,created_at,updated_at) VALUES(:id,:name,:at,:at)
                                ON CONFLICT(id) DO NOTHING
                                """)
                .param("id", id)
                .param("name", name)
                .param("at", time(at))
                .update() == 1;
    }

    public void rename(UUID id, String name, Instant at) {
        db.sql("UPDATE album SET name=:name,revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                .param("id", id)
                .param("name", name)
                .param("at", time(at))
                .update();
    }

    public void refresh(UUID id, Instant at) {
        db.sql("UPDATE album SET revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                .param("id", id)
                .param("at", time(at))
                .update();
    }

    public void delete(UUID id, Instant at) {
        db.sql("DELETE FROM album_membership WHERE album_id=:id")
                .param("id", id)
                .update();
        db.sql("""
                                UPDATE album SET name=NULL,deleted_at=GREATEST(updated_at,:at),updated_at=GREATEST(updated_at,:at),
                                    revision=gen_random_uuid() WHERE id=:id
                                """)
                .param("id", id)
                .param("at", time(at))
                .update();
    }

    public Optional<Long> position(UUID album, UUID memory) {
        return db.sql("SELECT position FROM album_membership WHERE album_id=:album AND memory_id=:memory")
                .param(ALBUM_PARAM, album)
                .param(MEMORY_PARAM, memory)
                .query(Long.class)
                .optional();
    }

    public void add(UUID album, UUID memory) {
        long max = db.sql("SELECT COALESCE(max(position),0) FROM album_membership WHERE album_id=:album")
                .param(ALBUM_PARAM, album)
                .query(Long.class)
                .single();
        if (max == Long.MAX_VALUE) {
            // Deferrable uniqueness permits compaction without transient collisions or an
            // overflow wall.
            db.sql("""
                                        WITH positions AS (SELECT memory_id,row_number() OVER(ORDER BY position) AS position
                                            FROM album_membership WHERE album_id=:album)
                                        UPDATE album_membership am SET position=p.position FROM positions p
                                        WHERE am.album_id=:album AND am.memory_id=p.memory_id
                                        """)
                    .param(ALBUM_PARAM, album)
                    .update();
            max = db.sql("SELECT count(*) FROM album_membership WHERE album_id=:album")
                    .param(ALBUM_PARAM, album)
                    .query(Long.class)
                    .single();
        }
        db.sql("INSERT INTO album_membership(album_id,memory_id,position) VALUES(:album,:memory,:position)")
                .param(ALBUM_PARAM, album)
                .param(MEMORY_PARAM, memory)
                .param(POSITION_FIELD, max + 1)
                .update();
    }

    public boolean remove(UUID album, UUID memory) {
        return db.sql("DELETE FROM album_membership WHERE album_id=:album AND memory_id=:memory")
                .param(ALBUM_PARAM, album)
                .param(MEMORY_PARAM, memory)
                .update() > 0;
    }

    public boolean move(
            UUID album,
            UUID memory,
            String direction,
            Instant now) {
        var current = position(album, memory);
        if (current.isEmpty()) {
            return false;
        }

        boolean earlier = "EARLIER".equals(direction);
        var next = db.sql("SELECT am.memory_id,am.position " + MEMBER_FROM + " WHERE am.album_id=:album AND "
                + ELIGIBLE
                + " AND am.position" + (earlier ? "<" : ">") + ":position ORDER BY am.position "
                + (earlier ? "DESC" : "ASC") + " LIMIT 1")
                .param(ALBUM_PARAM, album)
                .param(POSITION_FIELD, current.get())
                .param("now", time(now))
                .query((rs, row) -> new Position(
                        rs.getObject("memory_id", UUID.class),
                        rs.getLong(POSITION_FIELD)))
                .optional();
        if (next.isEmpty()) {
            return false;
        }
        db.sql("""
                                UPDATE album_membership SET position=CASE WHEN memory_id=:memory THEN :otherPosition ELSE :position END
                                WHERE album_id=:album AND memory_id IN (:memory,:other)
                                """)
                .param(ALBUM_PARAM, album)
                .param(MEMORY_PARAM, memory)
                .param("other", next.get().memoryId())
                .param(POSITION_FIELD, current.get())
                .param("otherPosition", next.get().position())
                .update();
        return true;
    }

    public boolean eligibleMember(
            UUID album,
            UUID memory,
            Instant now) {
        return db.sql("SELECT EXISTS(SELECT 1 " + MEMBER_FROM
                + " WHERE am.album_id=:album AND m.id=:memory AND " + ELIGIBLE + ")")
                .param(ALBUM_PARAM, album)
                .param(MEMORY_PARAM, memory)
                .param("now", time(now))
                .query(Boolean.class)
                .single();
    }

    private static AlbumDetail map(ResultSet rs, int row) throws SQLException {
        var deleted = rs.getObject("album_deleted_at", OffsetDateTime.class);
        return new AlbumDetail(
                rs.getObject("album_id", UUID.class),
                rs.getString("album_name"),
                rs.getString("album_visibility"),
                rs.getObject("album_revision", UUID.class),
                rs.getLong("member_count"),
                rs.getObject("album_created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("album_updated_at", OffsetDateTime.class).toInstant(),
                deleted == null ? null : deleted.toInstant());
    }

    public static OffsetDateTime time(Instant at) {
        return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
    }

    public record MemberRow(
            AlbumDetail album,
            MemoryDetail memory,
            long position,
            boolean canMoveEarlier,
            boolean canMoveLater) {
    }

    private record Position(
            UUID memoryId,
            long position) {
    }
}
