package com.kevinmel.archive.timeline;

import java.util.Set;
import java.util.UUID;
import java.util.Map;

public record TimelineQuery(
        int limit,
        Integer fromYear,
        Integer toYear,
        String datePrecision,
        TimelineCursor cursor) {
    public static void requireParameters(
            Map<String, String[]> parameters,
            Set<String> allowed) {
        if (!allowed.containsAll(parameters.keySet()) || parameters.values().stream().anyMatch(values -> values.length != 1)) {
            throw TimelineRequest.invalid();
        }
    }

    public static TimelineQuery listing(
            String limit,
            String cursor,
            String from,
            String to,
            String precision) {
        int size = size(limit);
        Integer lower = year(from);
        Integer upper = year(to);
        String filter = precision == null ? "ALL" : precision;
        if (!Set.of("ALL", "UNKNOWN", "YEAR", "MONTH", "DAY").contains(filter)
                || lower != null && upper != null && lower > upper
                || "UNKNOWN".equals(filter) && (lower != null || upper != null)) {
            throw TimelineRequest.invalid();
        }
        return new TimelineQuery(
                size,
                lower,
                upper,
                filter,
                cursor == null ? null : TimelineCursor.decode(cursor, null, filter, lower, upper));
    }

    public static TimelineQuery members(
            UUID event,
            String limit,
            String cursor) {
        return new TimelineQuery(
                size(limit),
                null,
                null,
                null,
                cursor == null ? null : TimelineCursor.decode(cursor, event, null, null, null));
    }

    private static int size(String supplied) {
        if (supplied == null) {
            return 20;
        }
        if (!supplied.matches("[0-9]{1,3}")) {
            throw TimelineRequest.invalid();
        }
        int value = Integer.parseInt(supplied);
        if (value < 1 || value > 50) {
            throw TimelineRequest.invalid();
        }
        return value;
    }

    private static Integer year(String supplied) {
        if (supplied == null) {
            return null;
        }
        if (!supplied.matches("[0-9]{1,4}")) {
            throw TimelineRequest.invalid();
        }
        int value = Integer.parseInt(supplied);
        if (value < 1 || value > 9999) {
            throw TimelineRequest.invalid();
        }
        return value;
    }
}
