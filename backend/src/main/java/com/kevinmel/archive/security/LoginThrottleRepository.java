package com.kevinmel.archive.security;

import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Database counters survive session rotation/restarts and serialize concurrent attempts. */
@Repository
public class LoginThrottleRepository {
    private final JdbcClient jdbc;

    public LoginThrottleRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Transactional
    public boolean reserve(List<String> keys) {
        // Reserve the address first: a blocked address cannot create unlimited username rows.
        if (!reserveBucket(keys.get(1), 30)) return false;
        if (!reserveBucket(keys.get(0), 5)) return false;
        jdbc.sql("""
                WITH expired AS (
                    SELECT bucket_key FROM archive_login_throttle
                    WHERE window_started_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
                    ORDER BY window_started_at LIMIT 1000 FOR UPDATE SKIP LOCKED
                )
                DELETE FROM archive_login_throttle bucket USING expired
                WHERE bucket.bucket_key = expired.bucket_key
                """)
                .update();
        return true;
    }

    private boolean reserveBucket(String key, int limit) {
        return jdbc.sql("""
                INSERT INTO archive_login_throttle (bucket_key, window_started_at, attempts)
                VALUES (:key, CURRENT_TIMESTAMP, 1)
                ON CONFLICT (bucket_key) DO UPDATE SET
                    attempts = CASE
                        WHEN archive_login_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                        THEN 1 ELSE archive_login_throttle.attempts + 1 END,
                    window_started_at = CASE
                        WHEN archive_login_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                        THEN CURRENT_TIMESTAMP ELSE archive_login_throttle.window_started_at END
                WHERE archive_login_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                   OR archive_login_throttle.attempts < :limit
                RETURNING bucket_key
                """).param("key", key).param("limit", limit).query(String.class).optional().isPresent();
    }
}
