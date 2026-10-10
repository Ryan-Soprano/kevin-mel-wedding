package com.kevinmel.archive.album;

import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Caller holds the memory lock and a transaction. Albums never lock a memory in reverse order. */
@Component
public class AlbumMemberships {
    private final JdbcClient db;
    public AlbumMemberships(JdbcClient db) { this.db = db; }
    public void detach(UUID memoryId, Instant at) { detach(db, memoryId, at); }

    /** Also used by exactly reviewed offline recovery targets that contain album tables. */
    public static void detach(JdbcClient db, UUID memoryId, Instant at) {
        var albums = db.sql("""
                SELECT al.id FROM album al WHERE al.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM album_membership am WHERE am.album_id=al.id AND am.memory_id=:memory)
                ORDER BY al.id FOR UPDATE OF al
                """).param("memory", memoryId).query(UUID.class).list();
        db.sql("DELETE FROM album_membership WHERE memory_id=:memory").param("memory", memoryId).update();
        for (UUID album : albums) db.sql("""
                UPDATE album SET revision=gen_random_uuid(), updated_at=GREATEST(updated_at,:at) WHERE id=:id
                """).param("id", album).param("at", AlbumRepository.time(at)).update();
    }
}
