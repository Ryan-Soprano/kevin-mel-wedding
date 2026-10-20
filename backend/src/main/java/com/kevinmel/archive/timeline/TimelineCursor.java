package com.kevinmel.archive.timeline;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

/** Anchors contain opaque identities and filter choices, never private event dates or text. */
public record TimelineCursor(
        UUID revision,
        UUID anchorId,
        UUID eventId,
        String precision,
        Integer fromYear,
        Integer toYear) {
    public static TimelineCursor listing(
            UUID revision,
            UUID lastEvent,
            String precision,
            Integer from,
            Integer to) {
        return new TimelineCursor(
                revision,
                lastEvent,
                null,
                precision,
                from,
                to);
    }

    public static TimelineCursor members(
            UUID event,
            UUID revision,
            UUID lastMemory) {
        return new TimelineCursor(
                revision,
                lastMemory,
                event,
                null,
                null,
                null);
    }

    public String encode() {
        String raw = eventId == null
                ? "1|EVENTS|" + revision + "|" + precision + "|" + year(fromYear) + "|" + year(toYear) + "|" + anchorId
                : "1|MEMORIES|" + eventId + "|" + revision + "|" + anchorId;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    static TimelineCursor decode(
            String encoded,
            UUID eventId,
            String precision,
            Integer from,
            Integer to) {
        if (encoded == null || encoded.isEmpty() || encoded.length() > 256 || !encoded.matches("[A-Za-z0-9_-]+")) {
            throw TimelineRequest.invalidCursor();
        }
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8).split("\\|", -1);
            TimelineCursor cursor = eventId == null
                    ? decodeListing(parts, precision, from, to)
                    : decodeMembers(parts, eventId);
            if (!cursor.encode().equals(encoded)) {
                throw TimelineRequest.invalidCursor();
            }
            return cursor;
        } catch (IllegalArgumentException malformed) {
            throw TimelineRequest.invalidCursor();
        }
    }

    private static TimelineCursor decodeListing(
            String[] parts,
            String precision,
            Integer from,
            Integer to) {
        if (parts.length != 7 || !"1".equals(parts[0]) || !"EVENTS".equals(parts[1]) || !precision.equals(parts[3])
                || !year(from).equals(parts[4]) || !year(to).equals(parts[5])) {
            throw TimelineRequest.invalidCursor();
        }
        return listing(
                uuid(parts[2], true),
                uuid(parts[6], true),
                precision,
                from,
                to);
    }

    private static TimelineCursor decodeMembers(
            String[] parts,
            UUID eventId) {
        if (parts.length != 5 || !"1".equals(parts[0]) || !"MEMORIES".equals(parts[1])
                || !eventId.equals(uuid(parts[2], true))) {
            throw TimelineRequest.invalidCursor();
        }
        return members(eventId, uuid(parts[3], true), uuid(parts[4], false));
    }

    private static UUID uuid(
            String raw,
            boolean v4) {
        UUID value = UUID.fromString(raw);
        if (!value.toString().equals(raw) || v4 && (value.version() != 4 || value.variant() != 2)) {
            throw TimelineRequest.invalidCursor();
        }
        return value;
    }

    private static String year(Integer year) {
        return year == null ? "-" : year.toString();
    }

    @Override
    public String toString() {
        return "TimelineCursor[anchor=<redacted>]";
    }
}
