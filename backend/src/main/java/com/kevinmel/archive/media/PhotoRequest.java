package com.kevinmel.archive.media;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.kevinmel.archive.contribution.ContributionRequest;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiException.FieldError;

public record PhotoRequest(
        String guestName,
        List<Item> items) {
    public static final int MAX_BYTES = 10_000_000;
    public static final Set<String> TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    private static final Set<String> ITEM_FIELDS = Set.of(
            "clientItemId",
            "originalFilename",
            "declaredContentType",
            "byteSize",
            "checksumSha256",
            "caption");

    public static PhotoRequest from(Map<String, Object> body) {
        var errors = new ArrayList<FieldError>();
        if (!Set.of("guestName", "memoryType", "items").containsAll(body.keySet())
                || !"PHOTO".equals(body.get("memoryType"))) {
            throw invalid("Only photo metadata is supported by this media endpoint.");
        }
        Object name = body.get("guestName");
        if (name != null && (!(name instanceof String text) || text.length() > 100
                || !ContributionRequest.storable(text))) {
            errors.add(new FieldError("guestName", "SIZE", "Your name must be 100 characters or fewer."));
        }
        if (!(body.get("items") instanceof List<?> values) || values.isEmpty() || values.size() > 5) {
            throw invalid("Supply one to five photos.");
        }
        var ids = new HashSet<UUID>();
        var items = new ArrayList<Item>();
        for (int index = 0; index < values.size(); index++) {
            String field = "items[" + index + "]";
            if (!(values.get(index) instanceof Map<?, ?> item) || !ITEM_FIELDS.containsAll(item.keySet())) {
                throw invalid("Each photo must contain only supported metadata fields.");
            }
            UUID id = null;
            Object rawId = item.get("clientItemId");
            if (rawId instanceof String text
                    && text.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
                id = UUID.fromString(text);
            }
            if (id == null || !ids.add(id)) {
                add(errors, field + ".clientItemId", "Each photo needs a unique UUID.");
            }
            Object filename = item.get("originalFilename");
            if (!(filename instanceof String text)
                    || text.length() > 255
                    || ContributionRequest.trim(text).isEmpty()
                    || !ContributionRequest.storable(text)
                    || text.chars().anyMatch(c -> c < 32 || c == 127 || c == '/' || c == '\\')) {
                add(errors, field + ".originalFilename", "Use a filename of 1–255 characters without paths or controls.");
            }
            Object type = item.get("declaredContentType");
            if (!(type instanceof String) || !TYPES.contains(type)) {
                add(errors, field + ".declaredContentType", "Choose a JPEG, PNG, or WebP photo.");
            }
            Object size = item.get("byteSize");
            long bytes = size instanceof Integer n ? n.longValue() : size instanceof Long n ? n : -1;
            if (bytes < 1 || bytes > MAX_BYTES) {
                add(errors, field + ".byteSize", "Photos must be non-empty and at most 10 MB.");
            }
            Object checksum = item.get("checksumSha256");
            if (!(checksum instanceof String text) || !text.matches("[0-9a-f]{64}")) {
                add(errors, field + ".checksumSha256", "Supply the original photo's SHA-256 checksum.");
            }
            Object caption = item.get("caption");
            if (caption != null
                    && (!(caption instanceof String text)
                            || text.length() > 500
                            || !ContributionRequest.storable(text))) {
                add(errors, field + ".caption", "Captions must be 500 characters or fewer.");
            }
            // Construct only after validating the entire request: casts never coerce JSON types.
            if (errors.isEmpty()) {
                String normalizedCaption = caption == null ? "" : ContributionRequest.trim((String) caption);
                items.add(new Item(
                        id,
                        (String) filename,
                        (String) type,
                        bytes,
                        (String) checksum,
                        normalizedCaption.isEmpty() ? null : normalizedCaption));
            }
        }
        if (!errors.isEmpty()) {
            throw new ApiException(
                    400,
                    "VALIDATION_FAILED",
                    "Please check the photo details.",
                    errors);
        }
        String normalizedName = name == null ? "" : ContributionRequest.trim((String) name);
        return new PhotoRequest(
                normalizedName.isEmpty() ? null : normalizedName,
                List.copyOf(items));
    }

    /** Length-prefixed fields and ordered items avoid ambiguous concatenation. */
    public String fingerprint() {
        try {
            var buffer = new ByteArrayOutputStream();
            try (var data = new DataOutputStream(buffer)) {
                write(data, "kevin-mel-wedding:PHOTO:v1");
                write(data, guestName);
                data.writeInt(items.size());
                for (Item item : items) {
                    write(data, item.clientItemId().toString());
                    write(data, item.originalFilename());
                    write(data, item.declaredContentType());
                    data.writeLong(item.byteSize());
                    write(data, item.checksumSha256());
                    write(data, item.caption());
                }
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(buffer.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("Photo fingerprint could not be generated.");
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

    public record Item(
            UUID clientItemId,
            String originalFilename,
            String declaredContentType,
            long byteSize,
            String checksumSha256,
            String caption) {
    }
}
