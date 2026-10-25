package com.kevinmel.archive.security;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ArchiveAccountRepository {
    private static final String USERNAME_COLUMN = "username";


    private final JdbcClient jdbcClient;

    public ArchiveAccountRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Transactional(readOnly = true)
    public Optional<ArchiveAccount> findByUsername(String username) {
        return jdbcClient.sql("""
                SELECT id, username, display_name, password_hash, role, enabled, credentials_version, password_change_required
                FROM archive_account
                WHERE username = :username
                """)
            .param(USERNAME_COLUMN, username)
            .query((rs, rowNumber) -> new ArchiveAccount(
                rs.getObject("id", UUID.class),
                rs.getString(USERNAME_COLUMN),
                rs.getString("display_name"),
                rs.getString("password_hash"),
                rs.getString("role"),
                rs.getBoolean("enabled"),
                rs.getLong("credentials_version"), rs.getBoolean("password_change_required")))
            .optional();
    }

    @Transactional(readOnly = true)
    public Optional<ArchiveAccount> findById(UUID id) {
        return jdbcClient.sql("""
                SELECT id, username, display_name, password_hash, role, enabled, credentials_version, password_change_required
                FROM archive_account WHERE id = :id
                """).param("id", id)
                .query((rs, rowNumber) -> new ArchiveAccount(
                        rs.getObject("id", UUID.class), rs.getString(USERNAME_COLUMN),
                        rs.getString("display_name"), rs.getString("password_hash"),
                        rs.getString("role"), rs.getBoolean("enabled"), rs.getLong("credentials_version"),
                        rs.getBoolean("password_change_required")))
                .optional();
    }

    // Called only inside AccountPasswordService's transaction; the lock spans verification and CAS.
    public Optional<ArchiveAccount> findByIdForUpdate(UUID id) {
        return jdbcClient.sql("""
                SELECT id, username, display_name, password_hash, role, enabled, credentials_version, password_change_required
                FROM archive_account WHERE id = :id FOR UPDATE
                """).param("id", id)
                .query((rs, rowNumber) -> new ArchiveAccount(
                        rs.getObject("id", UUID.class), rs.getString(USERNAME_COLUMN),
                        rs.getString("display_name"), rs.getString("password_hash"),
                        rs.getString("role"), rs.getBoolean("enabled"), rs.getLong("credentials_version"),
                        rs.getBoolean("password_change_required")))
                .optional();
    }

    public boolean replacePassword(UUID id, long expectedVersion, String passwordHash) {
        return jdbcClient.sql("""
                UPDATE archive_account
                SET password_hash = :hash, password_change_required = FALSE,
                    credentials_version = credentials_version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = :id AND enabled AND credentials_version = :version
                """).param("id", id).param("version", expectedVersion).param("hash", passwordHash).update() == 1;
    }
}
