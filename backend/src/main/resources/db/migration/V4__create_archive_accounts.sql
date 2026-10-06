CREATE TABLE archive_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(512) NOT NULL,
    role VARCHAR(20) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    credentials_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT archive_account_username_valid
        CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),

    CONSTRAINT archive_account_display_name_not_blank
        CHECK (length(btrim(display_name)) > 0),

    CONSTRAINT archive_account_password_hash_not_blank
        CHECK (length(btrim(password_hash)) > 0),

    CONSTRAINT archive_account_role_valid
        CHECK (role IN ('COUPLE', 'OPERATOR', 'DEVELOPER')),

    CONSTRAINT archive_account_credentials_version_valid
        CHECK (credentials_version >= 0)
);