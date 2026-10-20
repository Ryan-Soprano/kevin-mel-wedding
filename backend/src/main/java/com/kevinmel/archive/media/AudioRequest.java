package com.kevinmel.archive.media;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiException.FieldError;

public record AudioRequest(
        String guestName,
        PhotoRequest.Item item,
        long expectedDurationMs) {
    private static final String ORIGINAL_FILENAME = "originalFilename";
    private static final String DECLARED_CONTENT_TYPE = "declaredContentType";

    private static final String GUEST_NAME = "guestName";
    private static final Set<String> ITEM_FIELDS = Set.of(
            "clientItemId",
            ORIGINAL_FILENAME,
            DECLARED_CONTENT_TYPE,
            "byteSize",
            "checksumSha256",
            "caption",
            "durationSeconds");

    public static AudioRequest from(Map<String, Object> body) {
        if (!Set.of(GUEST_NAME, "memoryType", "items").containsAll(body.keySet())
                || !"AUDIO".equals(body.get("memoryType"))) {
            throw invalid("Supply audio metadata only.");
        }
        if (!(body.get("items") instanceof List<?> values) || values.size() != 1
                || !(values.getFirst() instanceof Map<?, ?> item) || !ITEM_FIELDS.containsAll(item.keySet())) {
            throw invalid("Supply one voice memory with supported metadata fields.");
        }
        var errors = new ArrayList<FieldError>();
        Object name = body.get(GUEST_NAME);
        if (!PhotoRequest.validGuestName(name)) {
            add(errors, GUEST_NAME, "Your name must be 100 characters or fewer.");
        }
        ParsedItem parsed = item(item, errors);
        if (!errors.isEmpty()) {
            throw new ApiException(
                    400,
                    "VALIDATION_FAILED",
                    "Please check the voice memory details.",
                    errors);
        }
        return new AudioRequest(PhotoRequest.normalizedText(name), parsed.item(),
                Math.max(1, Math.round(parsed.seconds() * 1000)));
    }

    private static ParsedItem item(Map<?, ?> item, List<FieldError> errors) {
        UUID id = PhotoRequest.clientItemId(item.get("clientItemId"));
        if (id == null) {
            add(errors, "items[0].clientItemId", "The voice memory needs a UUID.");
        }
        PhotoRequest.FileMetadata file = validateFile(item, errors);
        Object checksum = item.get("checksumSha256");
        if (!PhotoRequest.validChecksum(checksum)) {
            add(errors, "items[0].checksumSha256", "Supply the original voice memory's SHA-256 checksum.");
        }
        Object caption = item.get("caption");
        if (!PhotoRequest.validCaption(caption)) {
            add(errors, "items[0].caption", "Captions must be 500 characters or fewer.");
        }
        double seconds = duration(item.get("durationSeconds"), errors);
        if (!errors.isEmpty()) {
            return null;
        }
        return new ParsedItem(
                new PhotoRequest.Item(
                        id,
                        (String) file.filename(),
                        (String) file.contentType(),
                        file.byteSize(),
                        (String) checksum,
                        PhotoRequest.normalizedText(caption)),
                seconds);
    }

    private record ParsedItem(PhotoRequest.Item item, double seconds) {
    }

    private static PhotoRequest.FileMetadata validateFile(Map<?, ?> item, List<FieldError> errors) {
        Object filename = item.get(ORIGINAL_FILENAME);
        if (!PhotoRequest.validFilename(filename)) {
            add(errors, "items[0].originalFilename", "Use a filename of 1–255 characters without paths or controls.");
        }
        Object type = item.get(DECLARED_CONTENT_TYPE);
        if (!(type instanceof String) || !MediaTypes.AUDIO_TYPES.contains(type)) {
            add(errors, "items[0].declaredContentType", "Choose an Opus WebM/Ogg or AAC MP4 voice memory.");
        }
        long bytes = PhotoRequest.byteSize(item.get("byteSize"));
        if (bytes < 1 || bytes > MediaTypes.AUDIO_MAX_BYTES) {
            add(errors, "items[0].byteSize", "Voice memories must be non-empty and at most 25 MB.");
        }
        return new PhotoRequest.FileMetadata(filename, type, bytes);
    }

    private static double duration(Object value, List<FieldError> errors) {
        double seconds = value instanceof Number number ? number.doubleValue() : Double.NaN;
        if (!Double.isFinite(seconds) || seconds <= 0 || seconds > 120) {
            add(errors, "items[0].durationSeconds", "Voice memories must be over zero and at most 120 seconds.");
        }
        return seconds;
    }

    /** Preserve the normalized claim in the retry identity; verification persists its own measured duration. */
    public String fingerprint() {
        try {
            var buffer = new ByteArrayOutputStream();
            try (var data = new DataOutputStream(buffer)) {
                write(data, "kevin-mel-wedding:AUDIO:v1");
                write(data, guestName);
                write(data, item.clientItemId().toString());
                write(data, item.originalFilename());
                write(data, item.declaredContentType());
                data.writeLong(item.byteSize());
                write(data, item.checksumSha256());
                write(data, item.caption());
                data.writeLong(expectedDurationMs);
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(buffer.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("Audio fingerprint could not be generated.");
        }
    }

    private static void write(DataOutputStream data, String value) throws IOException {
        MediaRequestFingerprint.write(data, value);
    }

    private static void add(List<FieldError> errors, String field, String message) {
        errors.add(new FieldError(field, "INVALID_MEDIA", message));
    }

    private static ApiException invalid(String message) {
        return new ApiException(400, "VALIDATION_FAILED", message);
    }
}
