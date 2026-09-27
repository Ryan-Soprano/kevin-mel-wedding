CREATE TABLE contribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key VARCHAR(100) NOT NULL,
    guest_name VARCHAR(100),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT contribution_event_key_not_blank
        CHECK (length(btrim(event_key)) > 0),
    CONSTRAINT contribution_guest_name_not_blank
        CHECK (guest_name IS NULL OR length(btrim(guest_name)) > 0),
    CONSTRAINT contribution_idempotency_key_not_blank
        CHECK (length(btrim(idempotency_key)) > 0),
    CONSTRAINT contribution_idempotency_key_unique
        UNIQUE (idempotency_key)
);

CREATE TABLE memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contribution_id UUID NOT NULL,
    memory_type VARCHAR(20) NOT NULL,
    text_content TEXT,
    review_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    visibility VARCHAR(20) NOT NULL DEFAULT 'COUPLE_ONLY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT memory_contribution_fk
        FOREIGN KEY (contribution_id)
        REFERENCES contribution (id)
        ON DELETE RESTRICT,
    CONSTRAINT memory_type_valid
        CHECK (memory_type IN ('TEXT', 'PHOTO', 'AUDIO')),
    CONSTRAINT memory_content_matches_type
        CHECK (
            (
                memory_type = 'TEXT'
                AND text_content IS NOT NULL
                AND length(btrim(text_content)) BETWEEN 1 AND 5000
            )
            OR
            (
                memory_type IN ('PHOTO', 'AUDIO')
                AND text_content IS NULL
            )
        ),
    CONSTRAINT memory_review_status_valid
        CHECK (review_status IN ('PENDING', 'KEEP', 'ARCHIVED', 'DELETE')),
    CONSTRAINT memory_visibility_private
        CHECK (visibility = 'COUPLE_ONLY'),
    CONSTRAINT memory_timestamps_ordered
        CHECK (updated_at >= created_at)
);

CREATE TABLE media_asset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    object_key VARCHAR(1024) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    detected_format VARCHAR(100) NOT NULL,
    byte_size BIGINT NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    upload_state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT media_asset_memory_fk
        FOREIGN KEY (memory_id)
        REFERENCES memory (id)
        ON DELETE RESTRICT,
    CONSTRAINT media_asset_memory_unique
        UNIQUE (memory_id),
    CONSTRAINT media_asset_object_key_unique
        UNIQUE (object_key),
    CONSTRAINT media_asset_object_key_not_blank
        CHECK (length(btrim(object_key)) > 0),
    CONSTRAINT media_asset_original_filename_not_blank
        CHECK (length(btrim(original_filename)) > 0),
    CONSTRAINT media_asset_detected_format_not_blank
        CHECK (length(btrim(detected_format)) > 0),
    CONSTRAINT media_asset_byte_size_positive
        CHECK (byte_size > 0),
    CONSTRAINT media_asset_checksum_sha256_valid
        CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_asset_upload_state_valid
        CHECK (upload_state IN ('PENDING', 'UPLOADED', 'FAILED')),
    CONSTRAINT media_asset_timestamps_ordered
        CHECK (updated_at >= created_at)
);

CREATE INDEX memory_contribution_id_idx
    ON memory (contribution_id);

CREATE INDEX memory_review_queue_idx
    ON memory (review_status, created_at);

CREATE INDEX media_asset_upload_queue_idx
    ON media_asset (upload_state, created_at);
