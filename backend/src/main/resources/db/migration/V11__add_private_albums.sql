CREATE TABLE album (
    id UUID PRIMARY KEY,
    name VARCHAR(200),
    visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY',
    revision UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT album_id_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT album_revision_v4 CHECK (revision::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT album_visibility_private CHECK (visibility = 'COUPLE_ONLY'),
    CONSTRAINT album_name_lifecycle_valid CHECK (
        (deleted_at IS NULL AND name IS NOT NULL AND length(btrim(name)) BETWEEN 1 AND 200)
        OR (deleted_at IS NOT NULL AND name IS NULL)
    ),
    CONSTRAINT album_timestamps_ordered CHECK (
        updated_at >= created_at AND (deleted_at IS NULL OR (deleted_at >= created_at AND deleted_at <= updated_at))
    )
);

CREATE INDEX album_browse_idx ON album(created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE album_membership (
    album_id UUID NOT NULL REFERENCES album(id) ON DELETE CASCADE,
    memory_id UUID NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    position BIGINT NOT NULL CHECK (position > 0),
    PRIMARY KEY (album_id, memory_id),
    CONSTRAINT album_membership_position_unique UNIQUE (album_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX album_membership_memory_idx ON album_membership(memory_id, album_id);
