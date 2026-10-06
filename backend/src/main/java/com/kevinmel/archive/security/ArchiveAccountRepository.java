package com.kevinmel.archive.security;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ArchiveAccountRepository {

    private final JdbcClient jdbcClient;

    public ArchiveAccountRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Transactional(readOnly = true)
    public Optional<ArchiveAccount> findByUsername(String username) {
        return jdbcClient.sql("""
                SELECT id, username, display_name, password_hash, role, enabled, credentials_version
                FROM archive_account
                WHERE username = :username
                """)
            .param("username", username)
            .query((rs, rowNumber) -> new ArchiveAccount(
                rs.getObject("id", UUID.class),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("password_hash"),
                rs.getString("role"),
                rs.getBoolean("enabled"),
                rs.getLong("credentials_version")))
            .optional();
    }

    @Transactional(readOnly = true)
    public Optional<ArchiveAccount> findById(UUID id) {
        return jdbcClient.sql("""
                SELECT id, username, display_name, password_hash, role, enabled, credentials_version
                FROM archive_account WHERE id = :id
                """).param("id", id)
                .query((rs, rowNumber) -> new ArchiveAccount(
                        rs.getObject("id", UUID.class), rs.getString("username"),
                        rs.getString("display_name"), rs.getString("password_hash"),
                        rs.getString("role"), rs.getBoolean("enabled"), rs.getLong("credentials_version")))
                .optional();
    }
}
