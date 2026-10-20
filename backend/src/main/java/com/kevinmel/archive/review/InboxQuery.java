package com.kevinmel.archive.review;

import java.util.Set;

import com.kevinmel.archive.web.ApiException;

public record InboxQuery(
        String reviewStatus,
        int limit,
        InboxCursor cursor) {
    private static final Set<String> STATUSES = Set.of("PENDING", "KEEP", "ARCHIVED", "DELETE");

    public static InboxQuery from(
            String suppliedStatus,
            String suppliedLimit,
            String suppliedCursor) {
        String status = suppliedStatus == null ? "PENDING" : suppliedStatus;
        if (!STATUSES.contains(status)) {
            throw invalid("Use a pending, kept, archived, or deleted inbox filter.");
        }
        int limit = 20;
        if (suppliedLimit != null) {
            if (!suppliedLimit.matches("[0-9]{1,3}")) {
                throw invalid("Use a page size between 1 and 100.");
            }
            limit = Integer.parseInt(suppliedLimit);
        }
        if (limit < 1 || limit > 100) {
            throw invalid("Use a page size between 1 and 100.");
        }
        return new InboxQuery(
                status,
                limit,
                suppliedCursor == null ? null : InboxCursor.decode(suppliedCursor, status));
    }

    private static ApiException invalid(String message) {
        return new ApiException(400, "VALIDATION_FAILED", message);
    }
}
