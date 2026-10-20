package com.kevinmel.archive.timeline;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.review.MemoryMetadataRequest;
import com.kevinmel.archive.web.ApiException;

public record TimelineRequest(
        String title,
        String description,
        String eventDate,
        String datePrecision) {
    private static final String EVENT_DATE = "eventDate";

    public static TimelineRequest from(Map<String, Object> body) {
        if (body == null || !body.keySet().equals(Set.of("title", "description", EVENT_DATE, "datePrecision"))) {
            throw invalid();
        }
        if (!(body.get("title") instanceof String raw) || raw.length() > 200 || !ContributionRequest.storable(raw)
                || ContributionRequest.trim(raw).isEmpty()) {
            throw invalid();
        }
        // Reuse the existing exact partial-date, Gregorian, Unicode and raw UTF-16 metadata contract.
        var metadata = new java.util.HashMap<>(body);
        metadata.remove(EVENT_DATE);
        metadata.put("memoryDate", body.get(EVENT_DATE));
        var valid = MemoryMetadataRequest.from(metadata, "\"1\"");
        return new TimelineRequest(
                valid.title(),
                valid.description(),
                valid.memoryDate(),
                valid.datePrecision());
    }

    public boolean matches(TimelineEvent event) {
        return java.util.Objects.equals(title, event.title()) && java.util.Objects.equals(description, event.description())
                && java.util.Objects.equals(eventDate, event.eventDate()) && datePrecision.equals(event.datePrecision());
    }

    public static UUID id(UUID value) {
        if (value == null || value.version() != 4 || value.variant() != 2) {
            throw invalid();
        }
        return value;
    }

    public static UUID revision(String supplied) {
        if (supplied == null) {
            throw required();
        }
        if (!supplied.matches("\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"")) {
            throw invalid();
        }
        return UUID.fromString(supplied.substring(1, supplied.length() - 1));
    }

    public static void createCondition(String supplied) {
        if (supplied == null) {
            throw required();
        }
        if (!"*".equals(supplied)) {
            throw invalid();
        }
    }

    public static ApiException conflict() {
        return new ApiException(
                412,
                "TIMELINE_CONFLICT",
                "This timeline changed. Reload it before trying again.");
    }

    public static ApiException invalidCursor() {
        return new ApiException(
                400,
                "INVALID_CURSOR",
                "Reload this timeline page before trying again.");
    }

    public static ApiException invalid() {
        return new ApiException(
                400,
                "VALIDATION_FAILED",
                "Use a title up to 200 characters, description up to 2,000, and a matching unknown, year, month or day date.");
    }

    private static ApiException required() {
        return new ApiException(
                428,
                "PRECONDITION_REQUIRED",
                "Supply the current timeline condition before changing it.");
    }

    @Override
    public String toString() {
        return "TimelineRequest[metadata=<redacted>]";
    }
}
