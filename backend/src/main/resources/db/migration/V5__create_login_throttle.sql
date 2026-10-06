CREATE TABLE archive_login_throttle (
    bucket_key CHAR(64) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0)
);

CREATE INDEX archive_login_throttle_window_idx
    ON archive_login_throttle (window_started_at);
