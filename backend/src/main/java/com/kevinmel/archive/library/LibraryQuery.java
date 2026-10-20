package com.kevinmel.archive.library;

import java.util.Set;
import java.util.UUID;

public record LibraryQuery(
        int limit,
        String q,
        String memoryType,
        String reviewStatus,
        String datePrecision,
        Integer fromYear,
        Integer toYear,
        UUID tagId,
        String fingerprint,
        LibraryCursor cursor) {
    public static LibraryQuery from(
            String limit,
            String cursor,
            String q,
            String type,
            String status,
            String precision,
            String from,
            String to,
            String tag) {
        String query = LibraryRequest.query(q);
        String kind = type == null ? "ALL" : type;
        String review = status == null ? "ALL" : status;
        String date = precision == null ? "ALL" : precision;
        Integer lower = year(from);
        Integer upper = year(to);
        requireFilters(kind, review, date, lower, upper);
        UUID tagId = tag(tag);
        String binding = LibraryCursor.fingerprint(
                query,
                kind,
                review,
                date,
                lower == null ? null : lower.toString(),
                upper == null ? null : upper.toString(),
                tagId == null ? null : tagId.toString());
        return new LibraryQuery(
                LibraryRequest.limit(limit),
                query,
                kind,
                review,
                date,
                lower,
                upper,
                tagId,
                binding,
                cursor == null ? null : LibraryCursor.decode(cursor, "LIBRARY", binding, null));
    }

    private static void requireFilters(
            String kind,
            String review,
            String date,
            Integer lower,
            Integer upper) {
        if (!Set.of("ALL", "TEXT", "PHOTO", "AUDIO").contains(kind)
                || !Set.of("ALL", "PENDING", "KEEP", "ARCHIVED").contains(review)
                || !Set.of("ALL", "UNKNOWN", "YEAR", "MONTH", "DAY").contains(date)) {
            throw LibraryRequest.invalid();
        }
        if (lower != null && upper != null && lower > upper
                || "UNKNOWN".equals(date) && (lower != null || upper != null)) {
            throw LibraryRequest.invalid();
        }
    }

    private static UUID tag(String supplied) {
        if (supplied == null) {
            return null;
        }
        try {
            UUID tagId = LibraryRequest.tagId(UUID.fromString(supplied));
            if (!tagId.toString().equals(supplied)) {
                throw LibraryRequest.invalid();
            }
            return tagId;
        } catch (IllegalArgumentException invalid) {
            throw LibraryRequest.invalid();
        }
    }

    private static Integer year(String supplied) {
        if (supplied == null) {
            return null;
        }
        if (!supplied.matches("[0-9]{1,4}")) {
            throw LibraryRequest.invalid();
        }
        int year = Integer.parseInt(supplied);
        if (year < 1 || year > 9999) {
            throw LibraryRequest.invalid();
        }
        return year;
    }

    @Override
    public String toString() {
        return "LibraryQuery[limit=" + limit + "]";
    }
}
