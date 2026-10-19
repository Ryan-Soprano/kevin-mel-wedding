package com.kevinmel.archive.media;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiException.FieldError;

public record AudioRequest(
        String guestName,
        PhotoRequest.Item item,
        long expectedDurationMs) {
    private static final Set<String> ITEM_FIELDS = Set.of(
            "clientItemId",
            "originalFilename",
            "declaredContentType",
            "byteSize",
            "checksumSha256",
            "caption",
            "durationSeconds");

    public static AudioRequest from(Map<String, Object> body) {
        if (!Set.of("guestName", "memoryType", "items").containsAll(body.keySet())
                || !"AUDIO".equals(body.get("memoryType"))) {
            throw invalid("Supply audio metadata only.");
        }
        if (!(body.get("items") instanceof List<?> values) || values.size() != 1
                || !(values.getFirst() instanceof Map<?, ?> item) || !ITEM_FIELDS.containsAll(item.keySet())) {
            throw invalid("Supply one voice memory with supported metadata fields.");
        }
        var errors = new ArrayList<FieldError>();
        Object name = body.get("guestName");
        if (name != null
                && (!(name instanceof String text)
                        || text.length() > 100
                        || !ContributionRequest.storable(text))) {
            add(errors, "guestName", "Your name must be 100 characters or fewer.");
        }
        UUID id = null;
        Object rawId = item.get("clientItemId");
        if (rawId instanceof String text
                && text.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            id = UUID.fromString(text);
        }
        if (id == null) {
            add(errors, "items[0].clientItemId", "The voice memory needs a UUID.");
        }
        Object filename = item.get("originalFilename");
        if (!(filename instanceof String text)
                || text.length() > 255
                || ContributionRequest.trim(text).isEmpty()
                || !ContributionRequest.storable(text)
                || text.chars().anyMatch(c -> c < 32 || c == 127 || c == '/' || c == '\\')) {
            add(errors, "items[0].originalFilename", "Use a filename of 1–255 characters without paths or controls.");
        }
        Object type = item.get("declaredContentType");
        if (!(type instanceof String) || !MediaTypes.AUDIO_TYPES.contains(type)) {
            add(errors, "items[0].declaredContentType", "Choose an Opus WebM/Ogg or AAC MP4 voice memory.");
        }
        Object size = item.get("byteSize");
        long bytes = size instanceof Integer n ? n.longValue() : size instanceof Long n ? n : -1;
        if (bytes < 1 || bytes > MediaTypes.AUDIO_MAX_BYTES) {
            add(errors, "items[0].byteSize", "Voice memories must be non-empty and at most 25 MB.");
        }
        Object checksum = item.get("checksumSha256");
        if (!(checksum instanceof String text) || !text.matches("[0-9a-f]{64}")) {
            add(errors, "items[0].checksumSha256", "Supply the original voice memory's SHA-256 checksum.");
        }
        Object caption = item.get("caption");
        if (caption != null
                && (!(caption instanceof String text)
                        || text.length() > 500
                        || !ContributionRequest.storable(text))) {
            add(errors, "items[0].caption", "Captions must be 500 characters or fewer.");
        }
        Object duration = item.get("durationSeconds");
        double seconds = duration instanceof Number number ? number.doubleValue() : Double.NaN;
        if (!Double.isFinite(seconds) || seconds <= 0 || seconds > 120) {
            add(errors, "items[0].durationSeconds", "Voice memories must be over zero and at most 120 seconds.");
        }
        if (!errors.isEmpty()) {
            throw new ApiException(
                    400,
                    "VALIDATION_FAILED",
                    "Please check the voice memory details.",
                    errors);
        }
        String normalizedName = name == null ? "" : ContributionRequest.trim((String) name);
        String normalizedCaption = caption == null ? "" : ContributionRequest.trim((String) caption);
        return new AudioRequest(
                normalizedName.isEmpty() ? null : normalizedName,
                new PhotoRequest.Item(
                        id,
                        (String) filename,
                        (String) type,
                        bytes,
                        (String) checksum,
                        normalizedCaption.isEmpty() ? null : normalizedCaption),
                Math.max(1, Math.round(seconds * 1000)));
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
        if (value == null) {
            data.writeInt(-1);
            return;
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        data.writeInt(bytes.length);
        data.write(bytes);
    }

    private static void add(List<FieldError> errors, String field, String message) {
        errors.add(new FieldError(field, "INVALID_MEDIA", message));
    }

    private static ApiException invalid(String message) {
        return new ApiException(400, "VALIDATION_FAILED", message);
    }
}
