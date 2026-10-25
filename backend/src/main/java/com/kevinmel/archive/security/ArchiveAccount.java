package com.kevinmel.archive.security;

import java.util.UUID;

//Internal authentication data; never return this in an API response.
public record ArchiveAccount(
    UUID id,
    String username,
    String displayName,
    String passwordHash,
    String role,
    boolean enabled,
    long credentialsVersion,
    boolean passwordChangeRequired) {

    public ArchiveAccount(UUID id, String username, String displayName, String passwordHash,
            String role, boolean enabled, long credentialsVersion) {
        this(id, username, displayName, passwordHash, role, enabled, credentialsVersion, false);
    }

    @Override
    public String toString() {
        return "ArchiveAccount[id=" + id + "]";
    }
}
