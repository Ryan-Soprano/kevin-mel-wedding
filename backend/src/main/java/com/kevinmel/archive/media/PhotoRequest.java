package com.kevinmel.archive.media;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
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
    private static final String ORIGINAL_FILENAME = "originalFilename";
    private static final String DECLARED_CONTENT_TYPE = "declaredContentType";

    public static final int MAX_BYTES = 10_000_000;
    public static final Set<String> TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    private static final String GUEST_NAME = "guestName";
    private static final Set<String> ITEM_FIELDS = Set.of(
            "clientItemId",
            ORIGINAL_FILENAME,
            DECLARED_CONTENT_TYPE,
            "byteSize",
            "checksumSha256",
            "caption");

    public static PhotoRequest from(Map<String, Object> body) {
        var errors = new ArrayList<FieldError>();
        if (!Set.of(GUEST_NAME, "memoryType", "items").containsAll(body.keySet())
                || !"PHOTO".equals(body.get("memoryType"))) {
            throw invalid("Only photo metadata is supported by this media endpoint.");
        }
        Object name = body.get(GUEST_NAME);
        if (!validGuestName(name)) {
            errors.add(new FieldError(GUEST_NAME, "SIZE", "Your name must be 100 characters or fewer."));
        }
        List<Item> items = items(body.get("items"), errors);
        if (!errors.isEmpty()) {
            throw new ApiException(
                    400,
                    "VALIDATION_FAILED",
                    "Please check the photo details.",
                    errors);
        }
        return new PhotoRequest(normalizedText(name), List.copyOf(items));
    }

    private static List<Item> items(Object supplied, List<FieldError> errors) {
        if (!(supplied instanceof List<?> values) || values.isEmpty() || values.size() > 5) {
            throw invalid("Supply one to five photos.");
        }
        var ids = new HashSet<UUID>();
        var items = new ArrayList<Item>();
        for (int index = 0; index < values.size(); index++) {
            String field = "items[" + index + "]";
            if (!(values.get(index) instanceof Map<?, ?> item) || !ITEM_FIELDS.containsAll(item.keySet())) {
                throw invalid("Each photo must contain only supported metadata fields.");
            }
            Item validated = item(item, field, ids, errors);
            if (validated != null) {
                items.add(validated);
            }
        }
        return items;
    }

    private static Item item(Map<?, ?> item, String field, Set<UUID> ids, List<FieldError> errors) {
        UUID id = clientItemId(item.get("clientItemId"));
        if (id == null || !ids.add(id)) {
            add(errors, field + ".clientItemId", "Each photo needs a unique UUID.");
        }
        FileMetadata file = validateFile(item, field, errors);
        Object checksum = item.get("checksumSha256");
        if (!validChecksum(checksum)) {
            add(errors, field + ".checksumSha256", "Supply the original photo's SHA-256 checksum.");
        }
        Object caption = item.get("caption");
        if (!validCaption(caption)) {
            add(errors, field + ".caption", "Captions must be 500 characters or fewer.");
        }
        // Construct only after validating the entire request: casts never coerce JSON types.
        if (!errors.isEmpty()) {
            return null;
        }
        return new Item(id, (String) file.filename(), (String) file.contentType(),
                file.byteSize(), (String) checksum, normalizedText(caption));
    }

    private static FileMetadata validateFile(Map<?, ?> item, String field, List<FieldError> errors) {
        Object filename = item.get(ORIGINAL_FILENAME);
        if (!validFilename(filename)) {
            add(errors, field + ".originalFilename", "Use a filename of 1–255 characters without paths or controls.");
        }
        Object type = item.get(DECLARED_CONTENT_TYPE);
        if (!(type instanceof String) || !TYPES.contains(type)) {
            add(errors, field + ".declaredContentType", "Choose a JPEG, PNG, or WebP photo.");
        }
        long bytes = byteSize(item.get("byteSize"));
        if (bytes < 1 || bytes > MAX_BYTES) {
            add(errors, field + ".byteSize", "Photos must be non-empty and at most 10 MB.");
        }
        return new FileMetadata(filename, type, bytes);
    }

    record FileMetadata(Object filename, Object contentType, long byteSize) {
    }

    static boolean validGuestName(Object value) {
        return value == null || value instanceof String text && text.length() <= 100 && ContributionRequest.storable(text);
    }

    static UUID clientItemId(Object value) {
        return value instanceof String text
                && text.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
                ? UUID.fromString(text) : null;
    }

    static boolean validFilename(Object value) {
        return value instanceof String text && text.length() <= 255 && !ContributionRequest.trim(text).isEmpty()
                && ContributionRequest.storable(text)
                && text.chars().noneMatch(c -> c < 32 || c == 127 || c == '/' || c == '\\');
    }

    static long byteSize(Object value) {
        return value instanceof Integer number ? number.longValue() : value instanceof Long number ? number : -1;
    }

    static boolean validChecksum(Object value) {
        return value instanceof String text && text.matches("[0-9a-f]{64}");
    }

    static boolean validCaption(Object value) {
        return value == null || value instanceof String text && text.length() <= 500 && ContributionRequest.storable(text);
    }

    static String normalizedText(Object value) {
        String normalized = value == null ? "" : ContributionRequest.trim((String) value);
        return normalized.isEmpty() ? null : normalized;
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
        MediaRequestFingerprint.write(data, value);
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
