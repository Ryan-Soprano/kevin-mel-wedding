ALTER TABLE archive_account
    ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT FALSE;
