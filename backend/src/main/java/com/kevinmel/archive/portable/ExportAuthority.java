package com.kevinmel.archive.portable;

import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import com.kevinmel.archive.security.ArchiveAccountRepository;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.security.ArchivePrincipal;
import com.kevinmel.archive.web.ApiException;

/** Background work retains only identity/version, never a principal, password or session. */
@Component
public class ExportAuthority {
    private final ArchiveAuthorization authorization;
    private final ArchiveAccountRepository accounts;
    private final ArchiveAccessPolicy policy;
    public ExportAuthority(
            ArchiveAuthorization authorization,
            ArchiveAccountRepository accounts,
            ArchiveAccessPolicy policy) {
        this.authorization = authorization;
        this.accounts = accounts;
        this.policy = policy;
    }

    public Actor current() {
        authorization.requireCoupleAccess();
        var principal = (ArchivePrincipal) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        return new Actor(principal.getAccountId(), principal.getCredentialsVersion());
    }

    public void require(Actor actor) {
        var account = accounts.findById(actor.accountId());
        if (account.isEmpty()
                || !account.get().enabled()
                || account.get().credentialsVersion() != actor.credentialsVersion()) {
            throw new ApiException(401, "AUTH_REQUIRED", "Please sign in to access the archive.");
        }
        if (!policy.allows(account.get())) {
            throw new ApiException(403, "ARCHIVE_UNAVAILABLE", "Archive access is unavailable.");
        }
    }

    public record Actor(
            UUID accountId,
            long credentialsVersion) {
    }
}
