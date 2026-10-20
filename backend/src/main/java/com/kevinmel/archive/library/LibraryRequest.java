package com.kevinmel.archive.library;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.web.ApiException;

public final class LibraryRequest {
    private LibraryRequest() {
    }

    public static UUID tagId(UUID value) {
        if (value == null || value.version() != 4 || value.variant() != 2)
            throw invalid();
        return value;
    }

    public static String name(Map<String, Object> body) {
        if (body == null || !body.keySet().equals(Set.of("name")) || !(body.get("name") instanceof String raw))
            throw invalid();
        String value = query(raw);
        if (value == null)
            throw invalid();
        return value;
    }

    public static String query(String raw) {
        if (raw == null)
            return null;
        if (raw.length() > 200 || !ContributionRequest.storable(raw))
            throw invalid();
        String value = ContributionRequest.trim(raw);
        return value.isEmpty() ? null : value;
    }

    public static UUID revision(String condition) {
        if (condition == null)
            throw required();
        if (!condition.matches("\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\""))
            throw invalid();
        return UUID.fromString(condition.substring(1, condition.length() - 1));
    }

    public static void createCondition(String condition) {
        if (condition == null)
            throw required();
        if (!"*".equals(condition))
            throw invalid();
    }

    public static void parameters(Map<String, String[]> actual, Set<String> allowed) {
        if (!allowed.containsAll(actual.keySet()) || actual.values().stream().anyMatch(values -> values.length != 1))
            throw invalid();
    }

    public static int limit(String supplied) {
        if (supplied == null)
            return 20;
        if (!supplied.matches("[0-9]{1,3}"))
            throw invalid();
        int size = Integer.parseInt(supplied);
        if (size < 1 || size > 50)
            throw invalid();
        return size;
    }

    public static ApiException invalid() {
        return new ApiException(400, "VALIDATION_FAILED",
                "Use valid private library filters, a name up to 200 characters and the current tag condition.");
    }

    public static ApiException cursor() {
        return new ApiException(400, "INVALID_CURSOR", "Use the next page from these same library filters.");
    }

    public static ApiException tagConflict() {
        return new ApiException(412, "TAG_CONFLICT", "This tag page changed. Reload it before trying again.");
    }

    public static ApiException libraryConflict() {
        return new ApiException(412, "LIBRARY_CONFLICT", "This library page changed. Reload it before trying again.");
    }

    public static ApiException missing() {
        return new ApiException(404, "NOT_FOUND", "That tag or memory is unavailable.");
    }

    private static ApiException required() {
        return new ApiException(428, "PRECONDITION_REQUIRED", "Supply the current tag condition before changing it.");
    }
}
