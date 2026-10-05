package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class PhotoValidationTest {
    Map<String, Object> item() {
        return new HashMap<>(Map.of("clientItemId", UUID.randomUUID().toString(), "originalFilename", "photo.png",
                "declaredContentType", "image/png", "byteSize", 1, "checksumSha256", "0".repeat(64), "caption", " caption "));
    }
    Map<String, Object> body(Map<String, Object> item) { return new HashMap<>(Map.of("memoryType", "PHOTO", "items", List.of(item))); }
    void rejects(Map<String, Object> body) { assertThatThrownBy(() -> PhotoRequest.from(body)).isInstanceOf(ApiException.class).satisfies(e -> assertThat(((ApiException)e).status()).isEqualTo(400)); }

    @Test void rawLengthsScalarsFilenamePathsAndStrictNumbers() {
        for (Object size : List.of(0, -1, 10_000_001, 1.0, true, "1")) { var item = item(); item.put("byteSize", size); rejects(body(item)); }
        for (String filename : List.of("", " ", "../photo.png", "C:\\photo.png", "a\t.png", "a\u007f.png", "a\u0000.png", "\ud800", "p".repeat(256))) {
            var item = item(); item.put("originalFilename", filename); rejects(body(item));
        }
        for (String field : List.of("guestName", "caption")) {
            for (Object value : List.of(true, "\u0000", "\ud800", "\udc00", " ".repeat(field.equals("guestName") ? 101 : 501))) {
                var item = item(); var body = body(item);
                if (field.equals("guestName")) body.put(field, value); else item.put(field, value);
                rejects(body);
            }
        }
        var item = item(); item.put("byteSize", 10_000_000); item.put("caption", "😀".repeat(250));
        var body = body(item); body.put("guestName", "g".repeat(100));
        assertThat(PhotoRequest.from(body).items().getFirst().byteSize()).isEqualTo(10_000_000);
    }

    @Test void normalizationFingerprintIncludesEveryClaimAndOrder() {
        var first = item(); var body = body(first); body.put("guestName", " \u00a0\ufeff ");
        var normalized = PhotoRequest.from(body);
        assertThat(normalized.guestName()).isNull(); assertThat(normalized.items().getFirst().caption()).isEqualTo("caption");
        body.put("guestName", null); first.put("caption", "caption"); first.put("clientItemId", first.get("clientItemId").toString().toUpperCase());
        assertThat(PhotoRequest.from(body).fingerprint()).isEqualTo(normalized.fingerprint());
        for (var entry : Map.of("originalFilename", "other.png", "caption", "other", "byteSize", 2,
                "checksumSha256", "1".repeat(64), "declaredContentType", "image/jpeg", "clientItemId", UUID.randomUUID().toString()).entrySet()) {
            var changed = new HashMap<>(first); changed.put(entry.getKey(), entry.getValue());
            assertThat(PhotoRequest.from(body(changed)).fingerprint()).isNotEqualTo(normalized.fingerprint());
        }
        var second = item(); body.put("items", List.of(first, second)); String ordered = PhotoRequest.from(body).fingerprint();
        body.put("items", List.of(second, first)); assertThat(PhotoRequest.from(body).fingerprint()).isNotEqualTo(ordered);
        second.put("clientItemId", first.get("clientItemId").toString().toLowerCase()); rejects(body);
        body.put("items", Collections.nCopies(6, first)); rejects(body);
        body.put("items", List.of()); rejects(body);
        body.put("items", List.of(first)); body.put("visibility", "PUBLIC"); rejects(body);
    }

    @Test void actualPngJpegAndWebpDecodeWithHashSizeAndTypeChecks() throws Exception {
        var verifier = new PhotoVerifier();
        for (String format : List.of("png", "jpeg", "webp")) {
            byte[] bytes;
            if (format.equals("webp")) bytes = Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
            else { var output = new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB), format, output); bytes = output.toByteArray(); }
            String mime = "image/" + format;
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            var expected = new PhotoRepository.Asset(UUID.randomUUID(), "unused", mime, bytes.length, hash, "PENDING");
            assertThat(verifier.verify(bytes, expected)).isEqualTo(mime);
            assertThatThrownBy(() -> verifier.verify(Arrays.copyOf(bytes, bytes.length - 1), expected)).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> verifier.verify(bytes, new PhotoRepository.Asset(expected.id(), "unused", "image/invalid", bytes.length, hash, "PENDING"))).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> verifier.verify(bytes, new PhotoRepository.Asset(expected.id(), "unused", mime, bytes.length, "0".repeat(64), "PENDING"))).isInstanceOf(ApiException.class);
        }
    }

    @Test void claimedHashCannotMakeCorruptOrOversizedImageValid() throws Exception {
        var output = new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", output);
        byte[] png = output.toByteArray();
        for (byte[] bytes : List.of(new byte[]{1, 2, 3}, Arrays.copyOf(png, 40), hugeDimensions(png))) {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            assertThatThrownBy(() -> new PhotoVerifier().verify(bytes, new PhotoRepository.Asset(UUID.randomUUID(), "unused", "image/png", bytes.length, hash, "PENDING")))
                .isInstanceOf(ApiException.class).satisfies(e -> assertThat(((ApiException)e).status()).isEqualTo(422));
        }
    }
    byte[] hugeDimensions(byte[] png) {
        byte[] bytes = png.clone(); java.nio.ByteBuffer.wrap(bytes, 16, 8).putInt(20_001).putInt(20_001); return bytes;
    }
}
