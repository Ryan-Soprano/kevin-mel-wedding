package com.kevinmel.archive.media;

import java.util.Set;

/** Canonical types for verified originals; browser codec parameters never broaden this scope. */
public final class MediaTypes {
    public static final int PHOTO_MAX_BYTES = 10_000_000;
    public static final int AUDIO_MAX_BYTES = 25_000_000;
    public static final long AUDIO_MAX_DURATION_MS = 120_000;
    public static final Set<String> PHOTO_TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    public static final Set<String> AUDIO_TYPES = Set.of("audio/webm", "audio/ogg", "audio/mp4");

    private MediaTypes() {
    }

    public static boolean validTypeAndSize(String type, long size) {
        return type != null
                && size > 0
                && (PHOTO_TYPES.contains(type) && size <= PHOTO_MAX_BYTES
                        || AUDIO_TYPES.contains(type) && size <= AUDIO_MAX_BYTES);
    }

    public static int maxBytesForMemoryType(String memoryType) {
        return switch (memoryType) {
            case "PHOTO" -> PHOTO_MAX_BYTES;
            case "AUDIO" -> AUDIO_MAX_BYTES;
            default -> throw new IllegalArgumentException("Unsupported media type.");
        };
    }

    public static boolean audioMetadataMatches(String type, String container, String codec, long durationMs) {
        if (durationMs < 1 || durationMs > AUDIO_MAX_DURATION_MS || type == null) {
            return false;
        }
        return switch (type) {
            case "audio/webm" -> "webm".equals(container) && "opus".equals(codec);
            case "audio/ogg" -> "ogg".equals(container) && "opus".equals(codec);
            case "audio/mp4" -> "mp4".equals(container) && "aac".equals(codec);
            default -> false;
        };
    }
}
