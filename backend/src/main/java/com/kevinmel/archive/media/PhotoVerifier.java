package com.kevinmel.archive.media;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;

import org.springframework.stereotype.Component;
import com.kevinmel.archive.web.ApiException;

@Component
public class PhotoVerifier {
    /** Bounds decoded work independently of the compressed-byte limit. */
    public static final long MAX_PIXELS = 50_000_000;
    public String verify(byte[] bytes, PhotoRepository.Asset expected) {
        if (bytes.length != expected.byteSize() || bytes.length > PhotoRequest.MAX_BYTES) throw invalid();
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (!MessageDigest.isEqual(hash.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    expected.checksum().getBytes(java.nio.charset.StandardCharsets.US_ASCII))) throw invalid();
            try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw invalid();
                var reader = readers.next();
                try {
                    reader.setInput(input);
                    String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                    String type = switch (format) {
                        case "jpeg", "jpg" -> "image/jpeg";
                        case "png" -> "image/png";
                        case "webp" -> "image/webp";
                        default -> throw invalid();
                    };
                    if (!type.equals(expected.contentType())) throw invalid();
                    int width = reader.getWidth(0), height = reader.getHeight(0);
                    if (width < 1 || height < 1 || width > 20_000 || height > 20_000
                            || (long) width * height > MAX_PIXELS) throw invalid();
                    var warning = new AtomicBoolean();
                    reader.addIIOReadWarningListener((source, message) -> warning.set(true));
                    ImageReadParam options = reader.getDefaultReadParam();
                    int sample = Math.max(1, Math.max(width, height) / 2048);
                    options.setSourceSubsampling(sample, sample, 0, 0);
                    if (reader.read(0, options) == null || warning.get()) throw invalid();
                    return type;
                } finally { reader.dispose(); }
            }
        } catch (IOException | NoSuchAlgorithmException | IllegalArgumentException failure) {
            throw invalid();
        }
    }
    static ApiException invalid() {
        return new ApiException(422, "INVALID_MEDIA", "The uploaded photo could not be verified. Choose a valid photo and try again.");
    }
}
