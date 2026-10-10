CREATE TABLE tag (
    id UUID PRIMARY KEY,
    name VARCHAR(200),
    visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY',
    revision UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT tag_id_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT tag_revision_v4 CHECK (revision::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT tag_visibility_private CHECK (visibility = 'COUPLE_ONLY'),
    CONSTRAINT tag_name_lifecycle_valid CHECK (
        (deleted_at IS NULL AND name IS NOT NULL AND length(btrim(name)) BETWEEN 1 AND 200)
        OR (deleted_at IS NOT NULL AND name IS NULL)
    ),
    CONSTRAINT tag_timestamps_ordered CHECK (
        updated_at >= created_at AND (deleted_at IS NULL OR (deleted_at >= created_at AND deleted_at <= updated_at))
    )
);
CREATE INDEX tag_browse_idx ON tag(created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE memory_tag (
    tag_id UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    memory_id UUID NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, memory_id)
);
CREATE INDEX memory_tag_reverse_idx ON memory_tag(memory_id, tag_id);
CREATE INDEX memory_library_order_idx ON memory(created_at DESC, id DESC)
    WHERE visibility = 'COUPLE_ONLY' AND review_status IN ('PENDING', 'KEEP', 'ARCHIVED')
        AND purge_started_at IS NULL AND purged_at IS NULL;
