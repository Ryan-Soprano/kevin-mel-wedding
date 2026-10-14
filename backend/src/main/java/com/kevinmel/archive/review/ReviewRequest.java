package com.kevinmel.archive.review;

import java.util.Map;
import java.util.Set;

import com.kevinmel.archive.web.ApiException;

/** A single explicit state and an exact current revision; no wildcard overwrite. */
public record ReviewRequest(String reviewStatus, int revision, String visibility) {
    private static final Set<String> STATUSES = Set.of("PENDING", "KEEP", "ARCHIVED", "DELETE");
    private static final Set<String> AUDIENCES = Set.of("COUPLE_ONLY", "FRIENDS_FAMILY", "PUBLIC");

    public ReviewRequest(String reviewStatus, int revision) { this(reviewStatus, revision, null); }

    public static ReviewRequest from(Map<String, Object> body, String ifMatch) {
        if (ifMatch == null) throw new ApiException(428, "PRECONDITION_REQUIRED", "Reload this memory before reviewing it.");
        if (!ifMatch.matches("\"[1-9][0-9]{0,9}\"")) throw invalid();
        long revision = Long.parseLong(ifMatch.substring(1, ifMatch.length() - 1));
        if (revision > Integer.MAX_VALUE) throw invalid();
        if (body == null || !(body.keySet().equals(Set.of("reviewStatus"))
                    || body.keySet().equals(Set.of("reviewStatus", "visibility")))
                || !(body.get("reviewStatus") instanceof String status) || !STATUSES.contains(status)) throw invalid();
        String visibility = null;
        if (body.containsKey("visibility")) {
            if (!(body.get("visibility") instanceof String audience) || !AUDIENCES.contains(audience)
                    || !"COUPLE_ONLY".equals(audience) && !"KEEP".equals(status)) throw invalid();
            visibility = audience;
        }
        return new ReviewRequest(status, (int) revision, visibility);
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_FAILED", "Choose a memory audience and use the current memory revision.");
    }
}
