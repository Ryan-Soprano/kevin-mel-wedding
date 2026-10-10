package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class MemoryMetadataRequestTest {
    @Test void canonicalPartialDatesKeepTheirPrecisionWithoutInventingDays() {
        for (var pair : List.of(List.of("0001", "YEAR"), List.of("9999", "YEAR"), List.of("2024-02", "MONTH"),
                List.of("2024-02-29", "DAY"), List.of("2000-02-29", "DAY"))) {
            var value = MemoryMetadataRequest.from(body(null, null, pair.get(0), pair.get(1)), "\"1\"");
            assertThat(value.memoryDate()).isEqualTo(pair.get(0));
            assertThat(value.datePrecision()).isEqualTo(pair.get(1));
        }
        var blank = MemoryMetadataRequest.from(body("\u00a0 Title\u3000", "\t", null, "UNKNOWN"), "\"2\"");
        assertThat(blank.title()).isEqualTo("Title"); assertThat(blank.description()).isNull(); assertThat(blank.memoryDate()).isNull();
    }
    @Test void invalidGregorianDatesPrecisionPairsTypesAndUnicodeAreRejected() {
        for (var pair : List.of(List.of("0000", "YEAR"), List.of("2024-2", "MONTH"), List.of("2024-00", "MONTH"),
                List.of("1900-02-29", "DAY"), List.of("2023-02-29", "DAY"), List.of("2024-04-31", "DAY"),
                List.of("2024", "DAY"), List.of("2024-02", "YEAR"), List.of("2024", "UNKNOWN"))) {
            invalid(body(null, null, pair.get(0), pair.get(1)), "\"1\"");
        }
        invalid(body(null, null, null, "MONTH"), "\"1\"");
        invalid(body(12, null, null, "UNKNOWN"), "\"1\"");
        invalid(body("bad\u0000", null, null, "UNKNOWN"), "\"1\"");
        invalid(body("bad\ud800", null, null, "UNKNOWN"), "\"1\"");
        invalid(body("x".repeat(201), null, null, "UNKNOWN"), "\"1\"");
        invalid(body(null, "x".repeat(2001), null, "UNKNOWN"), "\"1\"");
        var missing = body(null, null, null, "UNKNOWN"); missing.remove("title"); invalid(missing, "\"1\"");
        var extra = body(null, null, null, "UNKNOWN"); extra.put("textContent", "override"); invalid(extra, "\"1\"");
    }
    @Test void revisionsAreRequiredStrictPositiveAndBounded() {
        var body = body(null, null, null, "UNKNOWN");
        assertThatThrownBy(() -> MemoryMetadataRequest.from(body, null)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(428));
        for (String revision : List.of("1", "\"0\"", "\"01\"", "W/\"1\"", "\"2147483648\"", "\"99999999999\"")) invalid(body, revision);
        assertThat(MemoryMetadataRequest.from(body, "\"2147483647\"").revision()).isEqualTo(Integer.MAX_VALUE);
        invalid(null, "\"1\"");
    }
    private static LinkedHashMap<String, Object> body(Object title, Object description, Object date, Object precision) {
        var body = new LinkedHashMap<String, Object>(); body.put("title", title); body.put("description", description);
        body.put("memoryDate", date); body.put("datePrecision", precision); return body;
    }
    private static void invalid(Map<String, Object> body, String revision) {
        assertThatThrownBy(() -> MemoryMetadataRequest.from(body, revision)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status()).isEqualTo(400); assertThat(e.code()).isEqualTo("VALIDATION_FAILED");
        });
    }
}
