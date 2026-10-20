package com.kevinmel.archive.retention;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;

/**
 * Immutable, content-free write-ahead record kept independently of database
 * backups.
 */
public record DeletionRecord(
        UUID memoryId,
        UUID contributionId,
        UUID assetId,
        String submissionKeyDigest,
        Instant deleteAfter,
        Instant recordedAt) {
    private static final String VERSION_FIELD = "version";
    private static final String ASSET_ID_FIELD = "assetId";

    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();
    public static final int MAX_BYTES = 2048;

    public DeletionRecord {
        if (memoryId == null
                || contributionId == null
                || submissionKeyDigest == null
                || !submissionKeyDigest.matches("[0-9a-f]{64}")
                || deleteAfter == null
                || recordedAt == null
                || recordedAt.isBefore(deleteAfter)) {
            throw new IllegalArgumentException("Invalid deletion record.");
        }
    }

    public byte[] encode() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put(VERSION_FIELD, 1);
        data.put("eventKey", "kevin-mel-wedding");
        data.put("memoryId", memoryId.toString());
        data.put("contributionId", contributionId.toString());
        data.put(ASSET_ID_FIELD, assetId == null ? null : assetId.toString());
        data.put("submissionKeyDigest", submissionKeyDigest);
        data.put("deleteAfter", deleteAfter.toString());
        data.put("recordedAt", recordedAt.toString());
        return JSON.writeValueAsBytes(data);
    }

    public static DeletionRecord decode(byte[] bytes) {
        if (bytes == null
                || bytes.length == 0
                || bytes.length > MAX_BYTES) {
            throw invalid();
        }
        try {
            var data = JSON.readTree(bytes);
            requireEnvelope(data);
            String asset = data.get(ASSET_ID_FIELD).isNull() ? null : text(data.get(ASSET_ID_FIELD));
            return new DeletionRecord(
                    uuid(text(data.get("memoryId"))),
                    uuid(text(data.get("contributionId"))),
                    asset == null ? null : uuid(asset),
                    text(data.get("submissionKeyDigest")),
                    Instant.parse(text(data.get("deleteAfter"))),
                    Instant.parse(text(data.get("recordedAt"))));
        } catch (RuntimeException failure) {
            throw invalid();
        }
    }

    private static void requireEnvelope(tools.jackson.databind.JsonNode data) {
        if (!data.isObject()
                || data.size() != 8
                || !data.has(ASSET_ID_FIELD)
                || !data.path(VERSION_FIELD).isInt()
                || data.path(VERSION_FIELD).intValue() != 1
                || !"kevin-mel-wedding".equals(data.path("eventKey").asString())) {
            throw invalid();
        }
    }

    private static String text(tools.jackson.databind.JsonNode node) {
        if (node == null || !node.isString()) {
            throw invalid();
        }
        return node.asString();
    }

    private static UUID uuid(String text) {
        UUID id = UUID.fromString(text);
        if (!id.toString().equals(text)) {
            throw invalid();
        }
        return id;
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Invalid deletion record.");
    }

    @Override
    public String toString() {
        return "DeletionRecord[memoryId=" + memoryId + "]";
    }
}
