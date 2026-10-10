package com.kevinmel.archive.library;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.MemoryDetail;

@Repository
public class TagRepository {
    private static final String MEMBER_FROM=" FROM memory_tag mt JOIN memory m ON m.id=mt.memory_id "+InboxRepository.MEMORY_JOINS;
    private static final String COLUMNS="""
            t.id AS tag_id,t.name AS tag_name,t.visibility AS tag_visibility,t.revision AS tag_revision,
            t.created_at AS tag_created_at,t.updated_at AS tag_updated_at,t.deleted_at AS tag_deleted_at,
            (SELECT count(*)
            """+MEMBER_FROM+" WHERE mt.tag_id=t.id AND "+LibraryRepository.ELIGIBLE+") AS member_count ";
    private static final String TAG_FILTER="""
            t.deleted_at IS NULL AND (CAST(:q AS TEXT) IS NULL OR position(lower(CAST(:q AS TEXT)) IN lower(t.name))>0)
            AND (CAST(:memory AS UUID) IS NULL OR EXISTS(SELECT 1 FROM memory_tag attached WHERE attached.tag_id=t.id AND attached.memory_id=:memory))
            """;
    private final JdbcClient db;
    public TagRepository(JdbcClient db) { this.db=db; }
    /** Live catalogue/attachment anchor and cards, including the original's availability, share one snapshot. */
    public List<ListRow> list(TagQuery query,Instant now) {
        String sql="WITH anchor AS(SELECT t.created_at,t.id FROM tag t WHERE "+TAG_FILTER+" AND t.id=:anchor), original AS(SELECT "
                +"(CAST(:memory AS UUID) IS NULL OR EXISTS(SELECT 1 FROM memory m "+InboxRepository.MEMORY_JOINS+" WHERE m.id=:memory AND "+LibraryRepository.ELIGIBLE+")) AS memory_valid) "
                +"SELECT original.memory_valid,(CAST(:anchor AS UUID) IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS anchor_valid,page.* "
                +"FROM original LEFT JOIN LATERAL(SELECT "+COLUMNS+" FROM tag t WHERE "+TAG_FILTER
                +" AND (CAST(:anchor AS UUID) IS NULL OR (t.created_at,t.id)<(SELECT created_at,id FROM anchor)) "
                +"ORDER BY t.created_at DESC,t.id DESC LIMIT :limit) page ON true ORDER BY page.tag_created_at DESC,page.tag_id DESC";
        return db.sql(sql).param("now",LibraryRepository.time(now)).param("q",query.q()).param("memory",query.memoryId())
                .param("anchor",query.cursor()==null ? null : query.cursor().anchorId()).param("limit",query.limit()+1)
                .query((rs,row)->new ListRow(rs.getBoolean("memory_valid"),rs.getBoolean("anchor_valid"),
                    rs.getObject("tag_id")==null ? null : map(rs,row))).list();
    }
    public Optional<TagDetail> detail(UUID id,Instant now,boolean lock) {
        return db.sql("SELECT "+COLUMNS+" FROM tag t WHERE t.id=:id"+(lock ? " FOR UPDATE OF t" : ""))
                .param("id",id).param("now",LibraryRepository.time(now)).query(TagRepository::map).optional();
    }
    public List<MemberRow> members(UUID id,TagQuery query,Instant now) {
        String sql="WITH anchor AS(SELECT m.created_at,m.id "+MEMBER_FROM+" WHERE mt.tag_id=:id AND m.id=:anchor AND "+LibraryRepository.ELIGIBLE+") "
                +"SELECT "+COLUMNS+",(CAST(:anchor AS UUID) IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS anchor_valid,page.* "
                +"FROM tag t LEFT JOIN LATERAL(SELECT "+InboxRepository.MEMORY_COLUMNS+MEMBER_FROM
                +" WHERE mt.tag_id=t.id AND t.deleted_at IS NULL AND "+LibraryRepository.ELIGIBLE
                +" AND (CAST(:anchor AS UUID) IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM anchor)) "
                +"ORDER BY m.created_at DESC,m.id DESC LIMIT :limit) page ON true WHERE t.id=:id ORDER BY page.created_at DESC,page.memory_id DESC";
        return db.sql(sql).param("id",id).param("now",LibraryRepository.time(now)).param("anchor",query.cursor()==null ? null : query.cursor().anchorId())
                .param("limit",query.limit()+1).query((rs,row)->new MemberRow(map(rs,row),rs.getBoolean("anchor_valid"),
                    rs.getObject("memory_id")==null ? null : InboxRepository.map(rs,row))).list();
    }
    public boolean create(UUID id,String name,Instant at) {
        return db.sql("INSERT INTO tag(id,name,created_at,updated_at) VALUES(:id,:name,:at,:at) ON CONFLICT(id) DO NOTHING")
                .param("id",id).param("name",name).param("at",LibraryRepository.time(at)).update()==1;
    }
    public void rename(UUID id,String name,Instant at) {
        db.sql("UPDATE tag SET name=:name,revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                .param("id",id).param("name",name).param("at",LibraryRepository.time(at)).update();
    }
    public void refresh(UUID id,Instant at) {
        db.sql("UPDATE tag SET revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                .param("id",id).param("at",LibraryRepository.time(at)).update();
    }
    public void delete(UUID id,Instant at) {
        db.sql("DELETE FROM memory_tag WHERE tag_id=:id").param("id",id).update();
        db.sql("UPDATE tag SET name=NULL,deleted_at=GREATEST(updated_at,:at),updated_at=GREATEST(updated_at,:at),revision=gen_random_uuid() WHERE id=:id")
                .param("id",id).param("at",LibraryRepository.time(at)).update();
    }
    public boolean linked(UUID tag,UUID memory) {
        return db.sql("SELECT EXISTS(SELECT 1 FROM memory_tag WHERE tag_id=:tag AND memory_id=:memory)")
                .param("tag",tag).param("memory",memory).query(Boolean.class).single();
    }
    public void add(UUID tag,UUID memory) {
        db.sql("INSERT INTO memory_tag(tag_id,memory_id) VALUES(:tag,:memory)").param("tag",tag).param("memory",memory).update();
    }
    public boolean remove(UUID tag,UUID memory) {
        return db.sql("DELETE FROM memory_tag WHERE tag_id=:tag AND memory_id=:memory").param("tag",tag).param("memory",memory).update()>0;
    }
    private static TagDetail map(ResultSet rs,int row)throws SQLException {
        OffsetDateTime deleted=rs.getObject("tag_deleted_at",OffsetDateTime.class);
        return new TagDetail(rs.getObject("tag_id",UUID.class),rs.getString("tag_name"),rs.getString("tag_visibility"),rs.getObject("tag_revision",UUID.class),
                rs.getLong("member_count"),rs.getObject("tag_created_at",OffsetDateTime.class).toInstant(),rs.getObject("tag_updated_at",OffsetDateTime.class).toInstant(),
                deleted==null ? null : deleted.toInstant());
    }
    public record ListRow(boolean memoryValid,boolean anchorValid,TagDetail tag) { }
    public record MemberRow(TagDetail tag,boolean anchorValid,MemoryDetail memory) { }
}
