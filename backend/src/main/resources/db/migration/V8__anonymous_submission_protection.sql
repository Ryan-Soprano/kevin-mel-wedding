-- Applied V1-V7 remain immutable. Only HMAC digests are retained for guest abuse counters.
CREATE TABLE archive_anonymous_throttle (
    bucket_key VARCHAR(64) PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX archive_anonymous_throttle_expiry_idx ON archive_anonymous_throttle(window_started_at);
