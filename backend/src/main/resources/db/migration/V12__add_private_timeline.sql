CREATE TABLE timeline_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision UUID NOT NULL DEFAULT gen_random_uuid(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT timeline_state_revision_v4 CHECK (revision::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

-- No seed row: a freshly migrated recovery target must remain empty.
CREATE TABLE timeline_event (
    id UUID PRIMARY KEY,
    title VARCHAR(200),
    description VARCHAR(2000),
    event_date VARCHAR(10),
    date_precision VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
    visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY',
    revision UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT timeline_event_id_v4 CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT timeline_event_revision_v4 CHECK (revision::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT timeline_event_visibility_private CHECK (visibility = 'COUPLE_ONLY'),
    CONSTRAINT timeline_event_description_valid CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    CONSTRAINT timeline_event_lifecycle_valid CHECK (
        (deleted_at IS NULL AND title IS NOT NULL AND length(btrim(title)) BETWEEN 1 AND 200)
        OR (deleted_at IS NOT NULL AND title IS NULL AND description IS NULL AND event_date IS NULL AND date_precision = 'UNKNOWN')
    ),
    CONSTRAINT timeline_event_date_valid CHECK (
        (date_precision = 'UNKNOWN' AND event_date IS NULL)
        OR (date_precision = 'YEAR' AND event_date IS NOT NULL AND event_date ~ '^[0-9]{4}$' AND left(event_date, 4) <> '0000')
        OR (date_precision = 'MONTH' AND event_date IS NOT NULL AND event_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND left(event_date, 4) <> '0000')
        OR (date_precision = 'DAY' AND event_date IS NOT NULL AND CASE
            WHEN event_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND left(event_date, 4) <> '0000'
            THEN to_char(event_date::date, 'YYYY-MM-DD') = event_date ELSE FALSE END)
    ),
    CONSTRAINT timeline_event_timestamps_ordered CHECK (
        updated_at >= created_at AND (deleted_at IS NULL OR (deleted_at >= created_at AND deleted_at <= updated_at))
    )
);

CREATE INDEX timeline_event_browse_idx ON timeline_event ((event_date IS NULL), (COALESCE(event_date, '') COLLATE "C"), created_at, id)
    WHERE deleted_at IS NULL;

CREATE TABLE timeline_event_memory (
    event_id UUID NOT NULL REFERENCES timeline_event(id) ON DELETE CASCADE,
    memory_id UUID NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, memory_id)
);
CREATE INDEX timeline_event_memory_reverse_idx ON timeline_event_memory (memory_id, event_id);
