package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class AudioRequestTest {
    Map<String, Object> item() {
        return new HashMap<>(Map.of("clientItemId", UUID.randomUUID().toString(), "originalFilename", "voice.webm",
                "declaredContentType", "audio/webm", "byteSize", 1, "checksumSha256", "0".repeat(64),
                "caption", " caption ", "durationSeconds", 1.25));
    }
    Map<String, Object> body(Map<String, Object> item) { return new HashMap<>(Map.of("memoryType", "AUDIO", "items", List.of(item))); }
    void rejects(Map<String, Object> body) {
        assertThatThrownBy(() -> AudioRequest.from(body)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(400));
    }

    @Test void strictFieldsSizesDurationsAndOneOriginalOnly() {
        for (Object size : List.of(0, -1, 25_000_001, 1.0, true, "1")) { var item = item(); item.put("byteSize", size); rejects(body(item)); }
        for (Object duration : List.of(0, -1, 120.001, Double.NaN, Double.POSITIVE_INFINITY, true, "1")) {
            var item = item(); item.put("durationSeconds", duration); rejects(body(item));
        }
        for (String type : List.of("audio/wav", "video/webm", "audio/webm;codecs=opus", "image/png", "audio/mpeg")) {
            var item = item(); item.put("declaredContentType", type); rejects(body(item));
        }
        var item = item(); var body = body(item);
        body.put("items", List.of(item, item)); rejects(body);
        body.put("items", List.of()); rejects(body);
        body.put("items", List.of(item)); body.put("objectKey", "override"); rejects(body);
        body.remove("objectKey"); item.put("audio_codec", "opus"); rejects(body);
        item.remove("audio_codec"); item.remove("durationSeconds"); rejects(body);
        var maximum = item(); maximum.put("durationSeconds", 120); maximum.put("byteSize", 25_000_000);
        assertThat(AudioRequest.from(body(maximum)).expectedDurationMs()).isEqualTo(120_000);
        maximum.put("durationSeconds", 0.0001);
        assertThat(AudioRequest.from(body(maximum)).expectedDurationMs()).isEqualTo(1);
    }

    @Test void rawStringsAndUntrustedFilenamesAreBounded() {
        for (String filename : List.of("", " ", "../voice.webm", "C:\\voice.webm", "a\t.webm", "a\u0000.webm", "\ud800", "p".repeat(256))) {
            var item = item(); item.put("originalFilename", filename); rejects(body(item));
        }
        for (String field : List.of("guestName", "caption")) {
            for (Object value : List.of(true, "\u0000", "\ud800", " ".repeat(field.equals("guestName") ? 101 : 501))) {
                var item = item(); var body = body(item); if (field.equals("guestName")) body.put(field, value); else item.put(field, value); rejects(body);
            }
        }
    }

    @Test void normalizedFingerprintContainsEveryClaimWithoutChangingPhotoIdentity() {
        var item = item(); var body = body(item); body.put("guestName", " \u00a0\ufeff ");
        var normalized = AudioRequest.from(body);
        assertThat(normalized.guestName()).isNull(); assertThat(normalized.item().caption()).isEqualTo("caption");
        body.put("guestName", null); item.put("caption", "caption"); item.put("clientItemId", item.get("clientItemId").toString().toUpperCase());
        assertThat(AudioRequest.from(body).fingerprint()).isEqualTo(normalized.fingerprint());
        for (var claim : Map.of("originalFilename", "other.webm", "caption", "other", "byteSize", 2,
                "checksumSha256", "1".repeat(64), "declaredContentType", "audio/ogg", "clientItemId", UUID.randomUUID().toString(),
                "durationSeconds", 1.5).entrySet()) {
            var changed = new HashMap<>(item); changed.put(claim.getKey(), claim.getValue());
            assertThat(AudioRequest.from(body(changed)).fingerprint()).isNotEqualTo(normalized.fingerprint());
        }
        assertThat(new PhotoRequest(normalized.guestName(), List.of(normalized.item())).fingerprint()).isNotEqualTo(normalized.fingerprint());
    }
}
