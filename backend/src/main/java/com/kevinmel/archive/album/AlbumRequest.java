package com.kevinmel.archive.album;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.web.ApiException;

public final class AlbumRequest {
    private AlbumRequest() {
    }

    public static UUID id(UUID value) {
        if (value == null || value.version() != 4 || value.variant() != 2) {
            throw invalid();
        }
        return value;
    }

    public static String name(Map<String, Object> body) {
        if (body == null || !body.keySet().equals(Set.of("name")) || !(body.get("name") instanceof String raw)
                || raw.length() > 200 || !ContributionRequest.storable(raw)) {
            throw invalid();
        }
        String name = ContributionRequest.trim(raw);
        if (name.isEmpty()) {
            throw invalid();
        }
        return name;
    }

    public static UUID revision(String ifMatch) {
        if (ifMatch == null) {
            throw required();
        }
        if (!ifMatch.matches("\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"")) {
            throw invalid();
        }
        return UUID.fromString(ifMatch.substring(1, ifMatch.length() - 1));
    }

    public static void createCondition(String condition) {
        if (condition == null) {
            throw required();
        }
        if (!"*".equals(condition)) {
            throw invalid();
        }
    }

    public static String direction(Map<String, Object> body) {
        if (body == null || !body.keySet().equals(Set.of("direction"))
                || !(body.get("direction") instanceof String direction)
                || !Set.of("EARLIER", "LATER").contains(direction)) {
            throw invalid();
        }
        return direction;
    }

    public static ApiException conflict() {
        return new ApiException(412, "ALBUM_CONFLICT", "This album changed. Reload it before trying again.");
    }

    private static ApiException required() {
        return new ApiException(428, "PRECONDITION_REQUIRED", "Supply the current album condition before changing it.");
    }

    private static ApiException invalid() {
        return new ApiException(400, "VALIDATION_FAILED",
                "Use a nonblank album name up to 200 characters and the current album condition.");
    }
}
