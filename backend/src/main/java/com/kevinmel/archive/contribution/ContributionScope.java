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
    public ContributionScope {
        if (!("GUEST".equals(source)
                && authorId == null
                && key != null
                && !key.isBlank()
                && key.length() <= 100
                && !key.startsWith("couple:")
                || "COUPLE".equals(source)
                && authorId != null
                && key != null
                && key.matches("couple:[0-9a-f]{64}"))) {
            throw new IllegalArgumentException("Use a server-validated contribution scope.");
        }
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
                "COUPLE",
                author,
                "couple:" + SubmissionKeyDigest.sha256(author + ":" + key));
    }

    public void recheck(ArchiveAuthorization authorization) {
        if (!"COUPLE".equals(source)) {
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
        return "COUPLE".equals(source) ? "KEEP" : "PENDING";
    }

    @Override
    public String toString() {
        return "ContributionScope[source=" + source + "]";
    }
}
