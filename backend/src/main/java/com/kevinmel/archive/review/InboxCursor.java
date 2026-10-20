package com.kevinmel.archive.review;

import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;

import com.kevinmel.archive.web.ApiException;

/** An opaque position, not an access capability. Authorization is checked for every page. */
public record InboxCursor(
        String reviewStatus,
        Instant createdAt,
        UUID memoryId) {
    private static final int MAX_ENCODED_LENGTH = 256;

    public String encode() {
        String value = "1|" + reviewStatus + "|" + createdAt + "|" + memoryId;
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    public static InboxCursor decode(
            String encoded,
            String expectedStatus) {
        if (encoded == null || encoded.isEmpty() || encoded.length() > MAX_ENCODED_LENGTH
                || !encoded.matches("[A-Za-z0-9_-]+")) {
            throw invalid();
        }
        try {
            String value = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            String[] fields = value.split("\\|", -1);
            var cursor = position(fields, expectedStatus);
            if (!cursor.encode().equals(encoded)) {
                throw invalid();
            }
            return cursor;
        } catch (IllegalArgumentException | DateTimeException malformed) {
            throw invalid();
        }
    }

    private static InboxCursor position(String[] fields, String expectedStatus) {
        if (fields.length != 4 || !"1".equals(fields[0]) || !expectedStatus.equals(fields[1])) {
            throw invalid();
        }
        Instant createdAt = Instant.parse(fields[2]);
        int year = createdAt.atOffset(ZoneOffset.UTC).getYear();
        if (year < 1 || year > 9999 || createdAt.getNano() % 1000 != 0
                || !fields[3].matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw invalid();
        }
        return new InboxCursor(expectedStatus, createdAt, UUID.fromString(fields[3]));
    }

    private static ApiException invalid() {
        return new ApiException(400, "INVALID_CURSOR", "Reload this inbox page before trying again.");
    }

    @Override
    public String toString() {
        return "InboxCursor[position=<redacted>]";
    }
}
