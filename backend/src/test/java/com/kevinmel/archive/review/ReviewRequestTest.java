package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.Test;

class ReviewRequestTest {
    @Test void acceptsOnlyExactCurrentRevisionAndPrivateStatuses() {
        for (String status : List.of("PENDING", "KEEP", "ARCHIVED", "DELETE")) {
            assertThat(ReviewRequest.from(Map.of("reviewStatus", status), "\"1\"")).isEqualTo(new ReviewRequest(status, 1));
        }
        assertThat(ReviewRequest.from(Map.of("reviewStatus", "KEEP"), "\"2147483647\"").revision()).isEqualTo(Integer.MAX_VALUE);
    }
    @Test void missingAndMalformedPreconditionsCannotOverwrite() {
        rejects(() -> ReviewRequest.from(Map.of("reviewStatus", "KEEP"), null), 428, "PRECONDITION_REQUIRED");
        for (String header : List.of("", "1", "\"0\"", "\"01\"", "W/\"1\"", "*", "\"1\", \"2\"",
                " \"1\"", "\"1\" ", "\"-1\"", "\"2147483648\"", "\"99999999999\"")) {
            rejects(() -> ReviewRequest.from(Map.of("reviewStatus", "KEEP"), header), 400, "VALIDATION_FAILED");
        }
    }
    @Test void malformedOrAdditionalBodyFieldsAreRejected() {
        var nullState = new HashMap<String, Object>(); nullState.put("reviewStatus", null);
        for (Map<String, Object> body : List.of(Map.<String,Object>of(), Map.<String,Object>of("reviewStatus", "PUBLIC"),
                Map.<String,Object>of("reviewStatus", "keep"), Map.<String,Object>of("reviewStatus", 1),
                Map.<String,Object>of("reviewStatus", "ARCHIVED", "visibility", "PUBLIC"),
                Map.<String,Object>of("reviewStatus", "KEEP", "visibility", "UNKNOWN"), nullState)) {
            rejects(() -> ReviewRequest.from(body, "\"1\""), 400, "VALIDATION_FAILED");
        }
        rejects(() -> ReviewRequest.from(null, "\"1\""), 400, "VALIDATION_FAILED");
    }
    @Test void deliberateSharingRequiresKeepAndAnExplicitRecognizedAudience() {
        for (String audience : List.of("COUPLE_ONLY", "FRIENDS_FAMILY", "PUBLIC")) {
            assertThat(ReviewRequest.from(Map.of("reviewStatus", "KEEP", "visibility", audience), "\"3\""))
                    .isEqualTo(new ReviewRequest("KEEP", 3, audience));
        }
        for (String status : List.of("PENDING", "ARCHIVED", "DELETE")) {
            rejects(() -> ReviewRequest.from(Map.of("reviewStatus", status, "visibility", "PUBLIC"), "\"3\""), 400, "VALIDATION_FAILED");
        }
    }
    private static void rejects(Runnable operation, int status, String code) {
        assertThatThrownBy(operation::run).isInstanceOf(ApiException.class).satisfies(failure -> {
            assertThat(((ApiException) failure).status()).isEqualTo(status);
            assertThat(((ApiException) failure).code()).isEqualTo(code);
        });
    }
}
