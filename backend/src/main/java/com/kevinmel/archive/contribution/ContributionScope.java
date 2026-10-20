package com.kevinmel.archive.contribution;

import java.util.UUID;

import org.springframework.security.core.context.SecurityContextHolder;

import com.kevinmel.archive.retention.SubmissionKeyDigest;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.security.ArchivePrincipal;
import com.kevinmel.archive.web.ApiException;

/**
 * A server-created boundary, never an authority accepted from a request body.
 */
public record ContributionScope(
        String source,
        UUID authorId,
        String key) {
    private static final String COUPLE_SOURCE = "COUPLE";

    public ContributionScope {
        if (!validGuest(source, authorId, key) && !validCouple(source, authorId, key)) {
            throw new IllegalArgumentException("Use a server-validated contribution scope.");
        }
    }

    private static boolean validGuest(String source, UUID authorId, String key) {
        return "GUEST".equals(source) && authorId == null && key != null && !key.isBlank()
                && key.length() <= 100 && !key.startsWith("couple:");
    }

    private static boolean validCouple(String source, UUID authorId, String key) {
        return COUPLE_SOURCE.equals(source) && authorId != null && key != null
                && key.matches("couple:[0-9a-f]{64}");
    }

    public static ContributionScope guest(String key) {
        return new ContributionScope(
                "GUEST",
                null,
                key);
    }

    public static ContributionScope couple(
            String key,
            ArchiveAuthorization authorization) {
        authorization.requireCoupleAccess();
        var principal = (ArchivePrincipal) SecurityContextHolder.getContext()
                .getAuthentication()
                .getPrincipal();
        UUID author = principal.getAccountId();
        return new ContributionScope(
                COUPLE_SOURCE,
                author,
                "couple:" + SubmissionKeyDigest.sha256(author + ":" + key));
    }

    public void recheck(ArchiveAuthorization authorization) {
        if (!COUPLE_SOURCE.equals(source)) {
            return;
        }
        authorization.requireCoupleAccess();
        var principal = (ArchivePrincipal) SecurityContextHolder.getContext()
                .getAuthentication()
                .getPrincipal();
        if (!authorId.equals(principal.getAccountId())) {
            throw ApiException.notFound();
        }
    }

    public String initialReview() {
        return COUPLE_SOURCE.equals(source) ? "KEEP" : "PENDING";
    }

    @Override
    public String toString() {
        return "ContributionScope[source=" + source + "]";
    }
}
