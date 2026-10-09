package com.kevinmel.archive.security;

import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** PostgreSQL time and row locks keep guest reservations durable across application instances. */
@Repository
public class AnonymousThrottleRepository {
    public record Bucket(String key, int limit) {
        public Bucket {
            if (key == null || !key.matches("[0-9a-f]{64}") || limit < 1) {
                throw new IllegalArgumentException("A digest and positive bucket limit are required.");
            }
        }
        @Override public String toString() { return "Bucket[limit=" + limit + "]"; }
    }

    private final JdbcClient jdbc;

    public AnonymousThrottleRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Transactional
    public long reserve(List<Bucket> buckets) {
        if (buckets.size() != 3) throw new IllegalArgumentException("Global, peer and retry-key buckets are required.");
        long retryAfter = 0;
        // Consume admitted higher scopes even when a lower scope is denied. A blocked peer/key
        // cannot manufacture unlimited database rows by changing a caller-controlled UUID.
        for (Bucket bucket : buckets) {
            retryAfter = reserveBucket(bucket);
            if (retryAfter > 0) break;
        }
        // Bounded maintenance on admitted and denied requests; raw identities are never stored.
        jdbc.sql("""
                WITH expired AS (
                    SELECT bucket_key FROM archive_anonymous_throttle
                    WHERE window_started_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
                    ORDER BY window_started_at LIMIT 1000 FOR UPDATE SKIP LOCKED
                )
                DELETE FROM archive_anonymous_throttle bucket USING expired
                WHERE bucket.bucket_key = expired.bucket_key
                """).update();
        return retryAfter;
    }

    private long reserveBucket(Bucket bucket) {
        boolean admitted = jdbc.sql("""
                INSERT INTO archive_anonymous_throttle(bucket_key, window_started_at, attempts)
                VALUES (:key, CURRENT_TIMESTAMP, 1)
                ON CONFLICT (bucket_key) DO UPDATE SET
                    attempts = CASE
                        WHEN archive_anonymous_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                        THEN 1 ELSE archive_anonymous_throttle.attempts + 1 END,
                    window_started_at = CASE
                        WHEN archive_anonymous_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                        THEN CURRENT_TIMESTAMP ELSE archive_anonymous_throttle.window_started_at END
                WHERE archive_anonymous_throttle.window_started_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                   OR archive_anonymous_throttle.attempts < :limit
                RETURNING bucket_key
                """).param("key", bucket.key()).param("limit", bucket.limit())
                .query(String.class).optional().isPresent();
        if (admitted) return 0;
        return jdbc.sql("""
                SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                    (window_started_at + INTERVAL '15 minutes' - CURRENT_TIMESTAMP))))::bigint
                FROM archive_anonymous_throttle WHERE bucket_key = :key
                """).param("key", bucket.key()).query(Long.class).single();
    }
}
