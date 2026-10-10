package com.kevinmel.archive.timeline;

import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public class TimelineMemberships {
    private final JdbcClient db;
    public TimelineMemberships(JdbcClient db) { this.db=db; }
    public void detach(UUID memory,Instant at) { detach(db,memory,at); }
    /** Caller holds memory first (and any affected album locks), then state, then sorted event locks. */
    public static void detach(JdbcClient db,UUID memory,Instant at) {
        // Avoid initializing catalogue state during an unrelated purge or an empty legacy import.
        if (!db.sql("SELECT EXISTS(SELECT 1 FROM timeline_event_memory WHERE memory_id=:memory)")
                .param("memory",memory).query(Boolean.class).single()) return;
        if (db.sql("SELECT id FROM timeline_state WHERE id=1 FOR UPDATE").query(Integer.class).optional().isEmpty()) {
            throw new IllegalStateException("Timeline state is unavailable.");
        }
        var events=db.sql("""
                SELECT te.id FROM timeline_event te WHERE te.deleted_at IS NULL
                    AND EXISTS(SELECT 1 FROM timeline_event_memory tm WHERE tm.event_id=te.id AND tm.memory_id=:memory)
                ORDER BY te.id FOR UPDATE OF te
                """).param("memory",memory).query(UUID.class).list();
        int removed=db.sql("DELETE FROM timeline_event_memory WHERE memory_id=:memory").param("memory",memory).update();
        for (UUID event:events) db.sql("""
                UPDATE timeline_event SET revision=gen_random_uuid(),updated_at=GREATEST(updated_at,:at) WHERE id=:id
                """).param("id",event).param("at",TimelineRepository.time(at)).update();
        if (removed>0) TimelineRepository.refreshState(db,at);
    }
}
