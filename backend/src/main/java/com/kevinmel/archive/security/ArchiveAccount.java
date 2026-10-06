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
    long credentialsVersion) {

    @Override
    public String toString() {
        return "ArchiveAccount[id=" + id + "]";
    }
}
