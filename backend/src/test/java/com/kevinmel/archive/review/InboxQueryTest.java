package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.Test;

class InboxQueryTest {
    private static final Instant TIME = Instant.parse("2026-10-09T12:34:56.123456Z");
    private static final UUID ID = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    @Test void defaultsAndSupportedLimitsFilters() {
        assertThat(InboxQuery.from(null, null, null)).isEqualTo(new InboxQuery("PENDING", 20, null));
        for (String status : List.of("PENDING", "KEEP", "ARCHIVED")) {
            for (String limit : List.of("1", "20", "100")) {
                var query = InboxQuery.from(status, limit, null);
                assertThat(query.reviewStatus()).isEqualTo(status);
                assertThat(query.limit()).isEqualTo(Integer.parseInt(limit));
            }
        }
    }

    @Test void invalidQueriesHaveSafeValidationErrors() {
        for (String status : List.of("", "pending", "DELETE", "PUBLIC", "PENDING,KEEP")) {
            rejects(() -> InboxQuery.from(status, "20", null), "VALIDATION_FAILED");
        }
        for (String limit : List.of("", "0", "101", "-1", "1.5", " 20", "20 ", "1000", "20,20", "true")) {
            rejects(() -> InboxQuery.from("PENDING", limit, null), "VALIDATION_FAILED");
        }
    }

    @Test void cursorRoundTripsPositionAndBindsItsFilter() {
        var original = new InboxCursor("PENDING", TIME, ID);
        String cursor = original.encode();
        assertThat(InboxCursor.decode(cursor, "PENDING")).isEqualTo(original);
        assertThat(InboxQuery.from("PENDING", "1", cursor).cursor()).isEqualTo(original);
        rejects(() -> InboxCursor.decode(cursor, "KEEP"), "INVALID_CURSOR");
    }

    @Test void malformedUnboundedAndNoncanonicalCursorsAreRejected() {
        for (String cursor : List.of("", "x".repeat(257), "++//", "YQ==", "a", "bad-cursor",
                encoded("2|PENDING|" + TIME + "|" + ID),
                encoded("1|PENDING|not-a-time|" + ID),
                encoded("1|PENDING|" + TIME + "|1-1-1-1-1"),
                encoded("1|PENDING|" + TIME + "|" + ID.toString().toUpperCase()),
                encoded("1|PENDING|" + TIME + "|" + ID + "|extra"),
                encoded("1|PENDING|2026-10-09T12:34:56.123456001Z|" + ID),
                encoded("1|PENDING|2026-10-09T12:34:56.123456+00:00|" + ID),
                encoded("1|PENDING|+10000-10-09T12:34:56Z|" + ID))) {
            rejects(() -> InboxCursor.decode(cursor, "PENDING"), "INVALID_CURSOR");
        }
        rejects(() -> InboxCursor.decode(null, "PENDING"), "INVALID_CURSOR");
    }

    @Test void cursorDiagnosticsDoNotSerializeItsPosition() {
        String diagnostic = new InboxCursor("PENDING", TIME, ID).toString();
        assertThat(diagnostic).doesNotContain(TIME.toString(), ID.toString());
    }

    private static String encoded(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static void rejects(Runnable operation, String code) {
        assertThatThrownBy(operation::run).isInstanceOf(ApiException.class).satisfies(failure -> {
            assertThat(((ApiException) failure).status()).isEqualTo(400);
            assertThat(((ApiException) failure).code()).isEqualTo(code);
        });
    }
}
