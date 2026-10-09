-- Applied V1-V6 remain immutable. Deletion retains identity without retaining guest content.
ALTER TABLE memory ADD COLUMN delete_after TIMESTAMPTZ;
ALTER TABLE memory ADD COLUMN purge_started_at TIMESTAMPTZ;
ALTER TABLE memory ADD COLUMN purged_at TIMESTAMPTZ;
UPDATE memory SET delete_after = updated_at + INTERVAL '30 days' WHERE review_status = 'DELETE';

ALTER TABLE memory ADD CONSTRAINT memory_delete_deadline_matches_status
    CHECK ((review_status = 'DELETE') = (delete_after IS NOT NULL));
ALTER TABLE memory ADD CONSTRAINT memory_purge_requires_delete
    CHECK ((purge_started_at IS NULL OR review_status = 'DELETE')
        AND (purged_at IS NULL OR (review_status = 'DELETE' AND text_content IS NULL AND caption IS NULL)));
ALTER TABLE memory DROP CONSTRAINT memory_content_matches_type;
ALTER TABLE memory ADD CONSTRAINT memory_content_matches_type
    CHECK ((purged_at IS NOT NULL AND review_status = 'DELETE' AND text_content IS NULL)
        OR (purged_at IS NULL AND
            ((memory_type = 'TEXT' AND text_content IS NOT NULL AND length(btrim(text_content)) BETWEEN 1 AND 5000)
            OR (memory_type IN ('PHOTO', 'AUDIO') AND text_content IS NULL))));
CREATE INDEX memory_retention_due_idx ON memory(delete_after, id)
    WHERE review_status = 'DELETE' AND purged_at IS NULL;

CREATE TABLE erased_submission_key (
    key_digest CHAR(64) PRIMARY KEY CHECK (key_digest ~ '^[0-9a-f]{64}$'),
    erased_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE deletion_ledger (
    memory_id UUID PRIMARY KEY,
    contribution_id UUID NOT NULL,
    asset_id UUID,
    submission_key_digest CHAR(64) NOT NULL CHECK (submission_key_digest ~ '^[0-9a-f]{64}$'),
    delete_after TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    purged_at TIMESTAMPTZ
);
CREATE TABLE review_audit (
    memory_id UUID NOT NULL,
    actor_account_id UUID NOT NULL,
    from_status VARCHAR(20) NOT NULL CHECK (from_status IN ('PENDING', 'KEEP', 'ARCHIVED', 'DELETE')),
    to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('PENDING', 'KEEP', 'ARCHIVED', 'DELETE')),
    before_revision INTEGER NOT NULL CHECK (before_revision > 0),
    after_revision INTEGER NOT NULL CHECK (after_revision > before_revision),
    acted_at TIMESTAMPTZ NOT NULL,
    UNIQUE (memory_id, after_revision)
);
