-- V1/V2 remain immutable. Separate expected claims from verified original metadata.
ALTER TABLE memory ADD COLUMN client_item_id UUID;
ALTER TABLE memory ADD COLUMN caption VARCHAR(500);
ALTER TABLE memory ADD COLUMN item_position INTEGER;
CREATE UNIQUE INDEX memory_client_item_idx ON memory(contribution_id, client_item_id)
    WHERE client_item_id IS NOT NULL;
CREATE UNIQUE INDEX memory_item_position_idx ON memory(contribution_id, item_position)
    WHERE item_position IS NOT NULL;

ALTER TABLE media_asset ADD COLUMN declared_content_type VARCHAR(100);
ALTER TABLE media_asset ADD COLUMN expected_byte_size BIGINT;
ALTER TABLE media_asset ADD COLUMN expected_checksum_sha256 VARCHAR(64);
ALTER TABLE media_asset ADD CONSTRAINT media_expected_size
    CHECK (expected_byte_size IS NULL OR expected_byte_size BETWEEN 1 AND 10000000);
ALTER TABLE media_asset ADD CONSTRAINT media_expected_checksum
    CHECK (expected_checksum_sha256 IS NULL OR expected_checksum_sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE upload_grant (
    id UUID PRIMARY KEY,
    media_asset_id UUID NOT NULL REFERENCES media_asset(id) ON DELETE RESTRICT,
    object_key VARCHAR(1024) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT upload_grant_lifetime CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'
    )
);
CREATE INDEX upload_grant_asset_idx ON upload_grant(media_asset_id);
CREATE INDEX upload_grant_expiry_idx ON upload_grant(expires_at);
