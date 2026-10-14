-- Guest submissions stay private until a current couple account explicitly shares them.
ALTER TABLE memory DROP CONSTRAINT memory_visibility_private;
ALTER TABLE memory ADD CONSTRAINT memory_visibility_audience
    CHECK (visibility IN ('COUPLE_ONLY', 'FRIENDS_FAMILY', 'PUBLIC'));
ALTER TABLE memory ADD CONSTRAINT memory_shared_requires_keep
    CHECK (visibility = 'COUPLE_ONLY' OR review_status = 'KEEP');

ALTER TABLE review_audit ADD COLUMN before_visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY'
    CHECK (before_visibility IN ('COUPLE_ONLY', 'FRIENDS_FAMILY', 'PUBLIC'));
ALTER TABLE review_audit ADD COLUMN after_visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY'
    CHECK (after_visibility IN ('COUPLE_ONLY', 'FRIENDS_FAMILY', 'PUBLIC'));

-- Only a digest is retained. Capabilities are intentionally excluded from recovery/export bundles.
CREATE TABLE memory_share_link (
    memory_id UUID PRIMARY KEY REFERENCES memory(id) ON DELETE CASCADE,
    token_digest CHAR(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
    issued_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX memory_public_shared_idx ON memory(created_at DESC, id DESC)
    WHERE visibility = 'PUBLIC' AND review_status = 'KEEP'
        AND purge_started_at IS NULL AND purged_at IS NULL;
CREATE INDEX memory_available_library_idx ON memory(created_at DESC, id DESC)
    WHERE review_status IN ('PENDING', 'KEEP', 'ARCHIVED')
        AND purge_started_at IS NULL AND purged_at IS NULL;
