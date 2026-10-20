package com.kevinmel.archive.library;

import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public class TagMemberships {
    private final JdbcClient db;

    public TagMemberships(JdbcClient db) {
        this.db = db;
    }

    public void detach(
            UUID memory,
            Instant at) {
        detach(db, memory, at);
    }

    /**
     * Caller owns memory, then affected albums and timeline locks. Tags are always
     * acquired in UUID order.
     */
    public static void detach(
            JdbcClient db,
            UUID memory,
            Instant at) {
        var ids = db.sql(
                "SELECT t.id FROM tag t WHERE t.deleted_at IS NULL AND EXISTS(SELECT 1 FROM memory_tag mt WHERE mt.tag_id=t.id AND mt.memory_id=:memory) ORDER BY t.id FOR UPDATE OF t")
                .param("memory", memory)
                .query(UUID.class)
                .list();
        // Defensive cleanup also removes any invalid restored edge pointing at a tag
        // tombstone.
        db.sql("DELETE FROM memory_tag WHERE memory_id=:memory")
                .param("memory", memory)
                .update();
        for (UUID id : ids) {
            db.sql("UPDATE tag SET revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id")
                    .param("id", id)
                    .param("at", LibraryRepository.time(at))
                    .update();
        }
    }
}
