package com.kevinmel.archive.review;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Map;
import java.util.Set;

import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.web.ApiException;

public record MemoryMetadataRequest(
        String title,
        String description,
        String memoryDate,
        String datePrecision,
        int revision) {
    public static MemoryMetadataRequest from(
            Map<String, Object> body,
            String ifMatch) {
        if (ifMatch == null) {
            throw new ApiException(
                    428,
                    "PRECONDITION_REQUIRED",
                    "Reload this memory before editing it.");
        }
        if (!ifMatch.matches("\"[1-9][0-9]{0,9}\"")) {
            throw invalid();
        }
        long revision = Long.parseLong(ifMatch.substring(1, ifMatch.length() - 1));
        if (revision > Integer.MAX_VALUE || body == null
                || !body.keySet().equals(Set.of("title", "description", "memoryDate", "datePrecision"))) {
            throw invalid();
        }
        String title = text(body.get("title"), 200);
        String description = text(body.get("description"), 2000);
        if (!(body.get("datePrecision") instanceof String precision)
                || !Set.of("UNKNOWN", "YEAR", "MONTH", "DAY").contains(precision)) {
            throw invalid();
        }
        Object rawDate = body.get("memoryDate");
        String date = rawDate instanceof String value ? value : null;
        if ("UNKNOWN".equals(precision)) {
            if (rawDate != null) {
                throw invalid();
            }
        } else {
            if (date == null
                    || date.length() < 4
                    || !date.substring(0, 4).matches("[0-9]{4}")
                    || date.startsWith("0000")) {
                throw invalid();
            }
            try {
                switch (precision) {
                    case "YEAR" -> {
                        if (!date.matches("[0-9]{4}")) {
                            throw invalid();
                        }
                    }
                    case "MONTH" -> {
                        if (!date.matches("[0-9]{4}-[0-9]{2}")) {
                            throw invalid();
                        }
                        YearMonth.parse(date);
                    }
                    case "DAY" -> {
                        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) {
                            throw invalid();
                        }
                        LocalDate.parse(date);
                    }
                    default -> throw invalid();
                }
            } catch (DateTimeException failure) {
                throw invalid();
            }
        }
        return new MemoryMetadataRequest(
                title,
                description,
                date,
                precision,
                (int) revision);
    }

    private static String text(
            Object value,
            int limit) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String raw) || raw.length() > limit || !ContributionRequest.storable(raw)) {
            throw invalid();
        }
        String normalized = ContributionRequest.trim(raw);
        return normalized.isEmpty() ? null : normalized;
    }

    public static ApiException invalid() {
        return new ApiException(
                400,
                "VALIDATION_FAILED",
                "Use a title up to 200 characters, description up to 2,000, and a matching unknown, year, month or day date.");
    }
}
