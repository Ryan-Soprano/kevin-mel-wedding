-- Preserve existing memories and prior migrations. Review mutations remain INB-02 work.
ALTER TABLE memory ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memory ADD CONSTRAINT memory_revision_positive CHECK (revision > 0);

CREATE INDEX memory_inbox_order_idx
    ON memory (review_status, created_at DESC, id DESC);
