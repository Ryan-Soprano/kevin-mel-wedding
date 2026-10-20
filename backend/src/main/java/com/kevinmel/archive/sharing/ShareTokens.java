package com.kevinmel.archive.sharing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

final class ShareTokens {
    private static final SecureRandom RANDOM = new SecureRandom();

    private ShareTokens() {
    }

    static String create() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(bytes);
    }

    static String digest(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) {
            return null;
        }
        try {
            if (!Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(Base64.getUrlDecoder().decode(token))
                    .equals(token)) {
                return null;
            }
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
