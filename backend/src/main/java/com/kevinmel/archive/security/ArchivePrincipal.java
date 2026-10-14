package com.kevinmel.archive.security;

import java.util.List;
import java.util.UUID;

import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

/**
 * Inherits User's username equality and hash code to remain symmetric with Spring Security users.
 * Equality does not establish archive access: ArchiveAuthorization separately checks the current
 * account, credential version and authority.
 */
public final class ArchivePrincipal extends User {

    private static final long serialVersionUID = 1L;

    private final UUID accountId;
    private final String displayName;
    private final long credentialsVersion;

    public ArchivePrincipal(ArchiveAccount account) {
        super(
                account.username(),
                account.passwordHash(),
                account.enabled(),
                true, // Account has not expired
                true, // Credentials have not expired
                true, // Account is not locked
                List.of(new SimpleGrantedAuthority("ROLE_" + account.role())));
        this.accountId = account.id();
        this.displayName = account.displayName();
        this.credentialsVersion = account.credentialsVersion();
    }

    public UUID getAccountId() {
        return accountId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public long getCredentialsVersion() {
        return credentialsVersion;
    }
}
