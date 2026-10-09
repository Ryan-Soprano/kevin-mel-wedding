package com.kevinmel.archive.retention;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

/** Reserves erased random submission capabilities without exporting the capability itself. */
public final class SubmissionKeyDigest {
    private SubmissionKeyDigest() { }

    public static String sha256(String key) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("A stored submission key is required.");
        // Current UUID capabilities are case-canonical. Legacy non-UUID reservations remain exact.
        String canonical = key.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
                ? key.toLowerCase(Locale.ROOT) : key;
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 is unavailable."); }
    }
}
