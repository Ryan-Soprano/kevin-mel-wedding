package com.kevinmel.archive.review;

import java.util.Map;
import java.util.Set;

import com.kevinmel.archive.web.ApiException;

/** A single explicit state and an exact current revision; no wildcard overwrite. */
public record ReviewRequest(String reviewStatus, int revision) {
    private static final Set<String> STATUSES = Set.of("PENDING", "KEEP", "ARCHIVED", "DELETE");

    public static ReviewRequest from(Map<String, Object> body, String ifMatch) {
        if (ifMatch == null) throw new ApiException(428, "PRECONDITION_REQUIRED", "Reload this memory before reviewing it.");
        if (!ifMatch.matches("\"[1-9][0-9]{0,9}\"")) throw invalid();
        long revision = Long.parseLong(ifMatch.substring(1, ifMatch.length() - 1));
        if (revision > Integer.MAX_VALUE) throw invalid();
        if (body == null || !body.keySet().equals(Set.of("reviewStatus"))
                || !(body.get("reviewStatus") instanceof String status) || !STATUSES.contains(status)) throw invalid();
        return new ReviewRequest((String) body.get("reviewStatus"), (int) revision);
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_FAILED", "Choose a private review state and use the current memory revision.");
    }
}
