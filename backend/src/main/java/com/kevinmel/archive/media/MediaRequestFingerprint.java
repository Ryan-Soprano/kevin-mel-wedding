package com.kevinmel.archive.media;

import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Shared retry-identity framing; callers retain their own marker, field order and error diagnostic. */
final class MediaRequestFingerprint {
    private MediaRequestFingerprint() {
    }

    static void write(DataOutputStream data, String value) throws IOException {
        if (value == null) {
            data.writeInt(-1);
            return;
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        data.writeInt(bytes.length);
        data.write(bytes);
    }
}
