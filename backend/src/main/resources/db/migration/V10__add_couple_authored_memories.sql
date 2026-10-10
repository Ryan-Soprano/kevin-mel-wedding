ALTER TABLE contribution
    ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'GUEST',
    ADD COLUMN author_account_id UUID,
    ADD CONSTRAINT contribution_source_author_valid CHECK (
        (source = 'GUEST' AND author_account_id IS NULL)
        OR (source = 'COUPLE' AND author_account_id IS NOT NULL AND guest_name IS NULL
            AND idempotency_key ~ '^couple:[0-9a-f]{64}$')
    );

ALTER TABLE memory
    ADD COLUMN title VARCHAR(200),
    ADD COLUMN description VARCHAR(2000),
    ADD COLUMN memory_date VARCHAR(10),
    ADD COLUMN date_precision VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
    ADD CONSTRAINT memory_title_valid CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200),
    ADD CONSTRAINT memory_description_valid CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    ADD CONSTRAINT memory_date_valid CHECK (
        (date_precision = 'UNKNOWN' AND memory_date IS NULL)
        OR (date_precision = 'YEAR' AND memory_date IS NOT NULL AND memory_date ~ '^[0-9]{4}$' AND left(memory_date, 4) <> '0000')
        OR (date_precision = 'MONTH' AND memory_date IS NOT NULL AND memory_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND left(memory_date, 4) <> '0000')
        OR (date_precision = 'DAY' AND memory_date IS NOT NULL AND CASE
            WHEN memory_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND left(memory_date, 4) <> '0000'
            THEN to_char(memory_date::date, 'YYYY-MM-DD') = memory_date ELSE FALSE END)
    ),
    ADD CONSTRAINT memory_purged_metadata_empty CHECK (
        purged_at IS NULL OR (title IS NULL AND description IS NULL AND memory_date IS NULL AND date_precision = 'UNKNOWN')
    );
