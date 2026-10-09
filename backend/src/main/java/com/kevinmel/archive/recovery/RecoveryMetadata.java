package com.kevinmel.archive.recovery;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.kevinmel.archive.retention.DeletionRecord;
import com.kevinmel.archive.retention.SubmissionKeyDigest;
import com.kevinmel.archive.media.MediaTypes;

/** Validate the complete import graph before publishing any original or deletion evidence. */
final class RecoveryMetadata {
    private static final Set<String> STATES = Set.of("PENDING", "KEEP", "ARCHIVED", "DELETE");
    private final int version;
    private final Map<String, List<Map<String, Object>>> tables;
    private final Map<UUID, Map<String, Object>> contributions;
    private final Map<UUID, Map<String, Object>> memories;
    private final Map<UUID, Map<String, Object>> assets;
    private final Map<UUID, Map<String, Object>> assetsByMemory = new HashMap<>();

    RecoveryMetadata(Map<String, List<Map<String, Object>>> tables, Instant at) {
        this(tables, at, 2);
    }

    RecoveryMetadata(Map<String, List<Map<String, Object>>> tables, Instant at, int version) {
        this.tables = tables;
        this.version = version;
        contributions = indexed("contribution", "id"); memories = indexed("memory", "id"); assets = indexed("media_asset", "id");
        for (var asset : assets.values()) if (assetsByMemory.put(uuid(asset, "memory_id"), asset) != null) throw invalid();
        validate(at);
    }

    List<Map<String, Object>> rows(String table) { return tables.get(table); }
    List<Map<String, Object>> uploaded() { return rows("media_asset").stream().filter(a -> "UPLOADED".equals(a.get("upload_state"))).toList(); }
    int contributions() { return contributions.size(); }
    int memories() { return memories.size(); }
    int stateCount(String state) { return (int) rows("media_asset").stream().filter(a -> state.equals(a.get("upload_state"))).count(); }

    List<DeletionRecord> packagedPlans() {
        return rows("deletion_ledger").stream().map(row -> new DeletionRecord(uuid(row, "memory_id"), uuid(row, "contribution_id"),
            uuid(row, "asset_id"), text(row, "submission_key_digest"), instant(row, "delete_after"), instant(row, "recorded_at"))).toList();
    }

    void validatePlans(List<DeletionRecord> plans, Instant now) {
        var memoryIds = new HashSet<UUID>(); var assetIds = new HashSet<UUID>(); var keyOwners = new HashMap<UUID, String>();
        var digestOwners = new HashMap<String, UUID>();
        for (var plan : plans) {
            if (plan == null || now.isBefore(plan.recordedAt()) || !memoryIds.add(plan.memoryId())
                    || (plan.assetId() != null && !assetIds.add(plan.assetId()))) throw invalid();
            String previous = keyOwners.putIfAbsent(plan.contributionId(), plan.submissionKeyDigest());
            if (previous != null && !previous.equals(plan.submissionKeyDigest())) throw invalid();
            UUID priorOwner = digestOwners.putIfAbsent(plan.submissionKeyDigest(), plan.contributionId());
            if (priorOwner != null && !priorOwner.equals(plan.contributionId())) throw invalid();
            var contribution = contributions.get(plan.contributionId());
            if (contribution != null && !SubmissionKeyDigest.sha256(text(contribution, "idempotency_key")).equals(plan.submissionKeyDigest())) throw invalid();
            var memory = memories.get(plan.memoryId());
            if (memory != null) {
                if (!plan.contributionId().equals(uuid(memory, "contribution_id"))
                        || ("TEXT".equals(memory.get("memory_type")) != (plan.assetId() == null))) throw invalid();
                var owned = assetsByMemory.get(plan.memoryId());
                if (owned != null && !uuid(owned, "id").equals(plan.assetId())) throw invalid();
            }
            var asset = assets.get(plan.assetId());
            if (asset != null && !plan.memoryId().equals(uuid(asset, "memory_id"))) throw invalid();
        }
    }

    private void validate(Instant now) {
        var keys = new HashSet<String>();
        for (var c : contributions.values()) {
            if (!"kevin-mel-wedding".equals(c.get("event_key")) || !keys.add(text(c, "idempotency_key"))) throw invalid();
            bounded(c, "event_key", 100, false); bounded(c, "guest_name", 100, true); bounded(c, "idempotency_key", 100, false);
            hash(c, "request_fingerprint", true);
        }
        var clients = new HashSet<String>(); var positions = new HashSet<String>();
        var ownedAssets = new HashSet<UUID>();
        for (var m : memories.values()) {
            UUID contribution = uuid(m, "contribution_id");
            if (!contributions.containsKey(contribution) || !(version == 1 ? Set.of("TEXT", "PHOTO") : Set.of("TEXT", "PHOTO", "AUDIO")).contains(text(m, "memory_type"))
                    || !STATES.contains(text(m, "review_status")) || !"COUPLE_ONLY".equals(m.get("visibility"))
                    || number(m, "revision") < 1 || instant(m, "updated_at").isBefore(instant(m, "created_at"))) throw invalid();
            boolean deleted = "DELETE".equals(m.get("review_status")), purged = m.get("purged_at") != null;
            if (deleted != (m.get("delete_after") != null) || (!deleted && (m.get("purge_started_at") != null || purged))) throw invalid();
            if (purged) {
                if (m.get("text_content") != null || m.get("caption") != null || m.get("purge_started_at") == null
                        || instant(m, "purged_at").isBefore(instant(m, "purge_started_at"))) throw invalid();
            } else if ("TEXT".equals(m.get("memory_type"))) bounded(m, "text_content", 5000, false);
            else if (m.get("text_content") != null) throw invalid();
            bounded(m, "caption", 500, true);
            if (m.get("client_item_id") != null && !clients.add(contribution + ":" + m.get("client_item_id"))) throw invalid();
            if (m.get("item_position") != null && (number(m, "item_position") < 0
                    || number(m, "item_position") > 19 || !positions.add(contribution + ":" + m.get("item_position")))) throw invalid();
        }
        for (var a : assets.values()) {
            UUID id = uuid(a, "id"), owner = uuid(a, "memory_id"); var memory = memories.get(owner);
            boolean audio = memory != null && "AUDIO".equals(memory.get("memory_type"));
            String declared = text(a, "declared_content_type");
            if (memory == null || !Set.of("PHOTO", "AUDIO").contains(text(memory, "memory_type")) || memory.get("purged_at") != null || !ownedAssets.add(owner)
                    || !("originals/" + id).equals(a.get("object_key")) || id.version() != 4
                    || !Set.of("PENDING", "FAILED", "UPLOADED").contains(text(a, "upload_state"))
                    || !MediaTypes.validTypeAndSize(declared, number(a, "byte_size"))
                    || (audio != MediaTypes.AUDIO_TYPES.contains(declared))
                    || a.get("expected_byte_size") == null || number(a, "expected_byte_size") != number(a, "byte_size")
                    || instant(a, "updated_at").isBefore(instant(a, "created_at"))) throw invalid();
            bounded(a, "original_filename", 255, false); hash(a, "checksum_sha256", false); hash(a, "expected_checksum_sha256", false);
            if (!a.get("checksum_sha256").equals(a.get("expected_checksum_sha256"))) throw invalid();
            if ("UPLOADED".equals(a.get("upload_state"))) {
                if (!a.get("declared_content_type").equals(a.get("detected_format"))) throw invalid();
            } else if (!"unverified".equals(a.get("detected_format"))) throw invalid();
            if (!audio) {
                if (a.get("expected_duration_ms") != null || a.get("audio_duration_ms") != null
                    || a.get("audio_codec") != null || a.get("audio_container") != null) throw invalid();
            } else {
                if (a.get("expected_duration_ms") == null || number(a, "expected_duration_ms") < 1
                    || number(a, "expected_duration_ms") > MediaTypes.AUDIO_MAX_DURATION_MS) throw invalid();
                if ("UPLOADED".equals(a.get("upload_state"))) {
                    if (a.get("audio_duration_ms") == null || !MediaTypes.audioMetadataMatches(declared,
                        text(a, "audio_container"), text(a, "audio_codec"), number(a, "audio_duration_ms"))) throw invalid();
                } else if (a.get("audio_duration_ms") != null || a.get("audio_codec") != null || a.get("audio_container") != null) throw invalid();
            }
        }
        for (var m : memories.values()) if (Set.of("PHOTO", "AUDIO").contains(text(m, "memory_type")) && m.get("purged_at") == null
                && !ownedAssets.contains(uuid(m, "id"))) throw invalid();
        var populated = new HashSet<UUID>(); for (var memory : memories.values()) populated.add(uuid(memory, "contribution_id"));
        if (!populated.equals(contributions.keySet())) throw invalid();
        var grants = new HashSet<UUID>();
        for (var g : rows("upload_grant")) {
            UUID id = uuid(g, "id"); Duration lifetime = Duration.between(instant(g, "created_at"), instant(g, "expires_at"));
            if (id.version() != 4 || !grants.add(id) || !assets.containsKey(uuid(g, "media_asset_id"))
                    || !("staging/" + id).equals(g.get("object_key")) || lifetime.isNegative() || lifetime.isZero()
                    || lifetime.compareTo(Duration.ofMinutes(5)) > 0 || instant(g, "expires_at").isAfter(now)) throw invalid();
        }
        var audit = new HashSet<String>();
        for (var row : rows("review_audit")) {
            var memory = memories.get(uuid(row, "memory_id"));
            if (memory == null || !STATES.contains(text(row, "from_status")) || !STATES.contains(text(row, "to_status"))
                    || number(row, "before_revision") < 1 || number(row, "after_revision") <= number(row, "before_revision")
                    || number(row, "after_revision") > number(memory, "revision")
                    || !audit.add(row.get("memory_id") + ":" + row.get("after_revision"))) throw invalid();
        }
        var ledger = packagedPlans(); validatePlans(ledger, now);
        var plans = new HashMap<UUID, DeletionRecord>(); for (var plan : ledger) plans.put(plan.memoryId(), plan);
        for (var memory : memories.values()) if (memory.get("purge_started_at") != null || memory.get("purged_at") != null) {
            var plan = plans.get(uuid(memory, "id"));
            if (plan == null || !plan.deleteAfter().equals(instant(memory, "delete_after"))
                    || !plan.recordedAt().equals(instant(memory, "purge_started_at"))) throw invalid();
        }
        for (var row : rows("deletion_ledger")) {
            hash(row, "submission_key_digest", false);
            if (row.get("purged_at") != null && instant(row, "purged_at").isBefore(instant(row, "recorded_at"))) throw invalid();
            var memory = memories.get(uuid(row, "memory_id"));
            if (memory != null && (!"DELETE".equals(memory.get("review_status"))
                    || !instant(row, "delete_after").equals(instant(memory, "delete_after"))
                    || !instant(row, "recorded_at").equals(instant(memory, "purge_started_at"))
                    || !java.util.Objects.equals(row.get("purged_at"), memory.get("purged_at")))) throw invalid();
        }
        var erased = new HashSet<String>();
        for (var row : rows("erased_submission_key")) { hash(row, "key_digest", false); if (!erased.add(text(row, "key_digest"))) throw invalid(); }
    }

    private Map<UUID, Map<String, Object>> indexed(String table, String field) {
        var result = new HashMap<UUID, Map<String, Object>>();
        for (var row : rows(table)) if (result.put(uuid(row, field), row) != null) throw invalid();
        return result;
    }
    static UUID uuid(Map<String, Object> row, String field) { return (UUID) row.get(field); }
    static String text(Map<String, Object> row, String field) { return (String) row.get(field); }
    static Instant instant(Map<String, Object> row, String field) { return (Instant) row.get(field); }
    static long number(Map<String, Object> row, String field) { return ((Number) row.get(field)).longValue(); }
    private static void bounded(Map<String, Object> row, String field, int max, boolean nullable) {
        String text = text(row, field);
        if (text == null) { if (!nullable) throw invalid(); return; }
        if (text.isBlank() || text.codePointCount(0, text.length()) > max || text.indexOf('\0') >= 0) throw invalid();
    }
    private static void hash(Map<String, Object> row, String field, boolean nullable) {
        String value = text(row, field);
        if (value == null && nullable) return;
        if (value == null || !value.matches("[0-9a-f]{64}")) throw invalid();
    }
    private static RecoveryException invalid() { return RecoverySchema.invalid(); }
    @Override public String toString() { return "RecoveryMetadata[contributions=" + contributions.size() + ", memories=" + memories.size() + "]"; }
}
