package com.kevinmel.archive.security;

import com.kevinmel.archive.web.ApiException;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/** Reusable service boundary: HTTP routing is not the only way a service can be invoked. */
@Component
public class ArchiveAuthorization {
    private final ArchiveAccountRepository accounts;
    private final ArchiveAccessPolicy policy;

    public ArchiveAuthorization(ArchiveAccountRepository accounts, ArchiveAccessPolicy policy) {
        this.accounts = accounts;
        this.policy = policy;
    }

    public void requireCoupleAccess() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) throw authenticationRequired();
        if (!(authentication.getPrincipal() instanceof ArchivePrincipal principal)) throw unavailable();
        requireCurrentAccount(principal);
        if (principal.isPasswordChangeRequired()) throw passwordChangeRequired();
        if (!policy.allows(authentication)) throw unavailable();
    }

    private void requireCurrentAccount(ArchivePrincipal principal) {
        var account = accounts.findById(principal.getAccountId());
        if (account.isEmpty() || !account.get().enabled()
                || account.get().credentialsVersion() != principal.getCredentialsVersion()
                || account.get().passwordChangeRequired() != principal.isPasswordChangeRequired()
                || !account.get().username().equals(principal.getUsername())
                || principal.getAuthorities().stream().noneMatch(authority ->
                        authority.getAuthority().equals("ROLE_" + account.get().role()))) {
            throw authenticationRequired();
        }
    }

    private static ApiException authenticationRequired() {
        return new ApiException(401, "AUTH_REQUIRED", "Please sign in to access the archive.");
    }

    private static ApiException unavailable() {
        return new ApiException(403, "ARCHIVE_UNAVAILABLE", "Archive access is unavailable.");
    }

    static ApiException passwordChangeRequired() {
        return new ApiException(403, "PASSWORD_CHANGE_REQUIRED", "Change your password before accessing the archive.");
    }
}
