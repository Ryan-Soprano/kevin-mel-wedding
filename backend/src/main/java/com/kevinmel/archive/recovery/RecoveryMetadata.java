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
import com.kevinmel.archive.contribution.ContributionRequest;

/**
 * Validate the complete import graph before publishing any original or deletion
 * evidence.
 */
final class RecoveryMetadata {
    private static final String AFTER_REVISION = "after_revision";
    private static final String ARCHIVED = "ARCHIVED";
    private static final String AUDIO = "AUDIO";
    private static final String AUDIO_CODEC = "audio_codec";
    private static final String AUDIO_CONTAINER = "audio_container";
    private static final String AUDIO_DURATION_MS = "audio_duration_ms";
    private static final String CONTRIBUTION_ID = "contribution_id";
    private static final String COUPLE_ONLY = "COUPLE_ONLY";
    private static final String CREATED_AT = "created_at";
    private static final String DATE_PRECISION = "date_precision";
    private static final String DELETE = "DELETE";
    private static final String DELETE_AFTER = "delete_after";
    private static final String DELETED_AT = "deleted_at";
    private static final String DESCRIPTION = "description";
    private static final String EXPECTED_DURATION_MS = "expected_duration_ms";
    private static final String FRIENDS_FAMILY = "FRIENDS_FAMILY";
    private static final String IDEMPOTENCY_KEY = "idempotency_key";
    private static final String ITEM_POSITION = "item_position";
    private static final String MEDIA_ASSET = "media_asset";
    private static final String MEMORY_ID = "memory_id";
    private static final String MEMORY_TYPE = "memory_type";
    private static final String PENDING = "PENDING";
    private static final String PHOTO = "PHOTO";
    private static final String PUBLIC = "PUBLIC";
    private static final String PURGE_STARTED_AT = "purge_started_at";
    private static final String PURGED_AT = "purged_at";
    private static final String RECORDED_AT = "recorded_at";
    private static final String REVIEW_STATUS = "review_status";
    private static final String REVISION = "revision";
    private static final String TEXT_CONTENT = "text_content";
    private static final String TITLE = "title";
    private static final String UNKNOWN = "UNKNOWN";
    private static final String UPDATED_AT = "updated_at";
    private static final String UPLOAD_STATE = "upload_state";
    private static final String UPLOADED = "UPLOADED";
    private static final String VISIBILITY = "visibility";
    private static final Set<String> STATES = Set.of(PENDING, "KEEP", ARCHIVED, DELETE);
    private final int version;
    private final Map<String, List<Map<String, Object>>> tables;
    private final Map<UUID, Map<String, Object>> contributions;
    private final Map<UUID, Map<String, Object>> memories;
    private final Map<UUID, Map<String, Object>> assets;
    private final Map<UUID, Map<String, Object>> assetsByMemory = new HashMap<>();

    RecoveryMetadata(Map<String, List<Map<String, Object>>> tables, Instant at) {
        this(tables, at, 7);
    }

    RecoveryMetadata(
            Map<String, List<Map<String, Object>>> tables,
            Instant at,
            int version) {
        this.tables = tables;
        this.version = version;
        contributions = indexed("contribution", "id");
        memories = indexed("memory", "id");
        assets = indexed(MEDIA_ASSET, "id");
        for (var asset : assets.values()) {
            if (assetsByMemory.put(uuid(asset, MEMORY_ID), asset) != null) {
                throw invalid();
            }
        }
        validate(at);
    }

    List<Map<String, Object>> rows(String table) {
        return tables.get(table);
    }

    List<Map<String, Object>> uploaded() {
        return rows(MEDIA_ASSET).stream()
                .filter(a -> UPLOADED.equals(a.get(UPLOAD_STATE)))
                .toList();
    }

    int contributions() {
        return contributions.size();
    }

    int memories() {
        return memories.size();
    }

    int stateCount(String state) {
        return (int) rows(MEDIA_ASSET).stream()
                .filter(a -> state.equals(a.get(UPLOAD_STATE)))
                .count();
    }

    List<DeletionRecord> packagedPlans() {
        return rows("deletion_ledger").stream()
                .map(row -> new DeletionRecord(
                        uuid(row, MEMORY_ID),
                        uuid(row, CONTRIBUTION_ID),
                        uuid(row, "asset_id"),
                        text(row, "submission_key_digest"),
                        instant(row, DELETE_AFTER),
                        instant(row, RECORDED_AT)))
                .toList();
    }

    void validatePlans(List<DeletionRecord> plans, Instant now) {
        var memoryIds = new HashSet<UUID>();
        var assetIds = new HashSet<UUID>();
        var keyOwners = new HashMap<UUID, String>();
        var digestOwners = new HashMap<String, UUID>();
        for (var plan : plans) {
            validatePlanIdentity(plan, now, memoryIds, assetIds);
            validatePlanDigests(plan, keyOwners, digestOwners);
            validatePlanOwners(plan);
        }
    }

    private void validate(Instant now) {
        validateContributions();
        validateMemories();
        var ownedAssets = validateAssets();
        requireMemoryAssets(ownedAssets);
        if (version >= 4) {
            validateAlbums();
        }
        if (version >= 5) {
            validateTimeline();
        }
        if (version >= 6) {
            validateTags();
        }
        validateContributionPopulation();
        validateGrants(now);
        validateAudit();
        validateDeletionState(now);
        validateErasedKeys();
    }

    private void validateContributions() {
        var keys = new HashSet<String>();
        for (var c : contributions.values()) {
            if (!"kevin-mel-wedding".equals(c.get("event_key")) || !keys.add(text(c, IDEMPOTENCY_KEY))) {
                throw invalid();
            }
            bounded(c, "event_key", 100, false);
            bounded(c, "guest_name", 100, true);
            bounded(c, IDEMPOTENCY_KEY, 100, false);
            hash(c, "request_fingerprint", true);
            validateContributionSource(c);
        }
    }

    private void validateContributionSource(Map<String, Object> contribution) {
        if (version >= 3 && !("GUEST".equals(contribution.get("source"))
                && contribution.get("author_account_id") == null
                || "COUPLE".equals(contribution.get("source"))
                        && contribution.get("author_account_id") instanceof UUID
                        && contribution.get("guest_name") == null
                        && text(contribution, IDEMPOTENCY_KEY).matches("couple:[0-9a-f]{64}"))) {
            throw invalid();
        }
    }

    private void validateMemories() {
        var clients = new HashSet<String>();
        var positions = new HashSet<String>();
        for (var m : memories.values()) {
            UUID contribution = uuid(m, CONTRIBUTION_ID);
            validateMemoryIdentity(m, contribution);
            boolean purged = m.get(PURGED_AT) != null;
            validateMemoryLifecycle(m, purged);
            bounded(m, "caption", 500, true);
            validateMemoryMetadata(m, purged);
            validateMemoryOrdering(m, contribution, clients, positions);
        }
    }

    private Set<UUID> validateAssets() {
        var ownedAssets = new HashSet<UUID>();
        for (var a : assets.values()) {
            validateAsset(a, ownedAssets);
        }
        return ownedAssets;
    }

    private void requireMemoryAssets(Set<UUID> ownedAssets) {
        for (var m : memories.values()) {
            if (Set.of(PHOTO, AUDIO).contains(text(m, MEMORY_TYPE)) && m.get(PURGED_AT) == null
                    && !ownedAssets.contains(uuid(m, "id"))) {
                throw invalid();
            }
        }
    }

    private void validateContributionPopulation() {
        var populated = new HashSet<UUID>();
        for (var memory : memories.values()) {
            populated.add(uuid(memory, CONTRIBUTION_ID));
        }
        if (!populated.equals(contributions.keySet())) {
            throw invalid();
        }
    }

    private void validateGrants(Instant now) {
        var grants = new HashSet<UUID>();
        for (var g : rows("upload_grant")) {
            UUID id = uuid(g, "id");
            Duration lifetime = Duration.between(instant(g, CREATED_AT), instant(g, "expires_at"));
            if (id.version() != 4 || !grants.add(id) || !assets.containsKey(uuid(g, "media_asset_id"))
                    || !("staging/" + id).equals(g.get("object_key")) || lifetime.isNegative() || lifetime.isZero()
                    || lifetime.compareTo(Duration.ofMinutes(5)) > 0 || instant(g, "expires_at").isAfter(now)) {
                throw invalid();
            }
        }
    }

    private void validateAudit() {
        var audit = new HashSet<String>();
        for (var row : rows("review_audit")) {
            validateAuditIdentity(row, audit);
            validateAuditAudience(row);
        }
    }

    private void validateDeletionState(Instant now) {
        var ledger = packagedPlans();
        validatePlans(ledger, now);
        var plans = new HashMap<UUID, DeletionRecord>();
        for (var plan : ledger) {
            plans.put(plan.memoryId(), plan);
        }
        for (var memory : memories.values()) {
            if (memory.get(PURGE_STARTED_AT) != null || memory.get(PURGED_AT) != null) {
                var plan = plans.get(uuid(memory, "id"));
                if (plan == null || !plan.deleteAfter().equals(instant(memory, DELETE_AFTER))
                        || !plan.recordedAt().equals(instant(memory, PURGE_STARTED_AT))) {
                    throw invalid();
                }
            }
        }
        for (var row : rows("deletion_ledger")) {
            validateDeletionRow(row);
        }
    }

    private void validateDeletionRow(Map<String, Object> row) {
        hash(row, "submission_key_digest", false);
        if (row.get(PURGED_AT) != null && instant(row, PURGED_AT).isBefore(instant(row, RECORDED_AT))) {
            throw invalid();
        }
        var memory = memories.get(uuid(row, MEMORY_ID));
        if (memory != null && (!DELETE.equals(memory.get(REVIEW_STATUS))
                || !instant(row, DELETE_AFTER).equals(instant(memory, DELETE_AFTER))
                || !instant(row, RECORDED_AT).equals(instant(memory, PURGE_STARTED_AT))
                || !java.util.Objects.equals(row.get(PURGED_AT), memory.get(PURGED_AT)))) {
            throw invalid();
        }
    }

    private void validateErasedKeys() {
        var erased = new HashSet<String>();
        for (var row : rows("erased_submission_key")) {
            hash(row, "key_digest", false);
            if (!erased.add(text(row, "key_digest"))) {
                throw invalid();
            }
        }
    }

    private void validateAlbums() {
        var albums = indexed("album", "id");
        for (var album : albums.values()) {
            validateNamedOrganization(album);
        }
        var pairs = new HashSet<String>();
        var positions = new HashSet<String>();
        for (var member : rows("album_membership")) {
            validateAlbumMember(member, albums, pairs, positions);
        }
    }

    private void validateTags() {
        var tags = indexed("tag", "id");
        for (var tag : tags.values()) {
            validateNamedOrganization(tag);
        }
        var pairs = new HashSet<String>();
        for (var member : rows("memory_tag")) {
            validateTagMember(member, tags, pairs);
        }
    }

    private void validateTimeline() {
        var events = indexed("timeline_event", "id");
        var states = rows("timeline_state");
        if (events.isEmpty()) {
            if (!states.isEmpty() || !rows("timeline_event_memory").isEmpty()) {
                throw invalid();
            }
            return;
        }
        if (states.size() != 1) {
            throw invalid();
        }
        var state = states.getFirst();
        if (number(state, "id") != 1 || uuid(state, REVISION).version() != 4
                || uuid(state, REVISION).variant() != 2) {
            throw invalid();
        }
        Instant listUpdated = instant(state, UPDATED_AT);
        for (var event : events.values()) {
            validateTimelineEvent(event, listUpdated);
        }
        var pairs = new HashSet<String>();
        for (var member : rows("timeline_event_memory")) {
            validateTimelineMember(member, events, pairs);
        }
    }

    private Map<UUID, Map<String, Object>> indexed(String table, String field) {
        var result = new HashMap<UUID, Map<String, Object>>();
        for (var row : rows(table)) {
            if (result.put(uuid(row, field), row) != null) {
                throw invalid();
            }
        }
        return result;
    }

    static UUID uuid(Map<String, Object> row, String field) {
        return (UUID) row.get(field);
    }

    static String text(Map<String, Object> row, String field) {
        return (String) row.get(field);
    }

    static Instant instant(Map<String, Object> row, String field) {
        return (Instant) row.get(field);
    }

    static long number(Map<String, Object> row, String field) {
        return ((Number) row.get(field)).longValue();
    }

    private static void bounded(
            Map<String, Object> row,
            String field,
            int max,
            boolean nullable) {
        String text = text(row, field);
        if (text == null) {
            if (!nullable) {
                throw invalid();
            }
            return;
        }
        if (text.isBlank() || text.codePointCount(0, text.length()) > max || text.indexOf('\0') >= 0) {
            throw invalid();
        }
    }

    private static void hash(Map<String, Object> row, String field, boolean nullable) {
        String value = text(row, field);
        if (value == null && nullable) {
            return;
        }
        if (value == null || !value.matches("[0-9a-f]{64}")) {
            throw invalid();
        }
    }

    private static void metadataText(Map<String, Object> row, String field, int max) {
        String value = text(row, field);
        if (value == null) {
            return;
        }
        // New metadata follows the live UTF-16 API contract; legacy original fields
        // retain their prior bounds.
        if (value.isEmpty() || value.length() > max || !ContributionRequest.storable(value)
                || !value.equals(ContributionRequest.trim(value))) {
            throw invalid();
        }
    }

    private static void validateDate(Map<String, Object> row) {
        validateDate(row, "memory_date");
    }

    private static void validateDate(Map<String, Object> row, String dateField) {
        String date = text(row, dateField), precision = text(row, DATE_PRECISION);
        try {
            boolean valid = switch (precision == null ? "" : precision) {
                case UNKNOWN -> date == null;
                case "YEAR" -> validYear(date);
                case "MONTH" -> validMonth(date);
                case "DAY" -> validDay(date);
                default -> false;
            };
            if (!valid) {
                throw invalid();
            }
        } catch (RuntimeException failure) {
            throw invalid();
        }
    }

    private static void validatePlanIdentity(DeletionRecord plan, Instant now, Set<UUID> memoryIds, Set<UUID> assetIds) {
        if (plan == null || now.isBefore(plan.recordedAt()) || !memoryIds.add(plan.memoryId())
                || (plan.assetId() != null && !assetIds.add(plan.assetId()))) {
            throw invalid();
        }
    }

    private static void validatePlanDigests(DeletionRecord plan, Map<UUID, String> keyOwners, Map<String, UUID> digestOwners) {
        String previous = keyOwners.putIfAbsent(plan.contributionId(), plan.submissionKeyDigest());
        if (previous != null && !previous.equals(plan.submissionKeyDigest())) {
            throw invalid();
        }
        UUID priorOwner = digestOwners.putIfAbsent(plan.submissionKeyDigest(), plan.contributionId());
        if (priorOwner != null && !priorOwner.equals(plan.contributionId())) {
            throw invalid();
        }
    }

    private void validatePlanOwners(DeletionRecord plan) {
        var contribution = contributions.get(plan.contributionId());
        if (contribution != null
                && !SubmissionKeyDigest.sha256(text(contribution, IDEMPOTENCY_KEY))
                        .equals(plan.submissionKeyDigest())) {
            throw invalid();
        }
        var memory = memories.get(plan.memoryId());
        if (memory != null) {
            if (!plan.contributionId().equals(uuid(memory, CONTRIBUTION_ID))
                    || ("TEXT".equals(memory.get(MEMORY_TYPE)) != (plan.assetId() == null))) {
                throw invalid();
            }
            var owned = assetsByMemory.get(plan.memoryId());
            if (owned != null && !uuid(owned, "id").equals(plan.assetId())) {
                throw invalid();
            }
        }
        var asset = assets.get(plan.assetId());
        if (asset != null && !plan.memoryId().equals(uuid(asset, MEMORY_ID))) {
            throw invalid();
        }
    }

    private void validateMemoryIdentity(Map<String, Object> m, UUID contribution) {
        if (!contributions.containsKey(contribution)
                || !validMemoryType(m)
                || !STATES.contains(text(m, REVIEW_STATUS))
                || !validMemoryVisibility(m)
                || number(m, REVISION) < 1 || instant(m, UPDATED_AT).isBefore(instant(m, CREATED_AT))) {
            throw invalid();
        }
    }

    private boolean validMemoryType(Map<String, Object> m) {
        return (version == 1 ? Set.of("TEXT", PHOTO) : Set.of("TEXT", PHOTO, AUDIO))
                .contains(text(m, MEMORY_TYPE));
    }

    private boolean validMemoryVisibility(Map<String, Object> m) {
        return (version >= 7 ? Set.of(COUPLE_ONLY, FRIENDS_FAMILY, PUBLIC) : Set.of(COUPLE_ONLY))
                .contains(m.get(VISIBILITY))
                && (COUPLE_ONLY.equals(m.get(VISIBILITY)) || "KEEP".equals(m.get(REVIEW_STATUS)));
    }

    private static void validateMemoryLifecycle(Map<String, Object> m, boolean purged) {
        boolean deleted = DELETE.equals(m.get(REVIEW_STATUS));
        if (deleted != (m.get(DELETE_AFTER) != null)
                || (!deleted && (m.get(PURGE_STARTED_AT) != null || purged))) {
            throw invalid();
        }
        if (purged) {
            validatePurgedMemory(m);
        } else if ("TEXT".equals(m.get(MEMORY_TYPE))) {
            bounded(m, TEXT_CONTENT, 5000, false);
        } else if (m.get(TEXT_CONTENT) != null) {
            throw invalid();
        }
    }

    private static void validatePurgedMemory(Map<String, Object> m) {
        if (m.get(TEXT_CONTENT) != null || m.get("caption") != null || m.get(PURGE_STARTED_AT) == null
                || instant(m, PURGED_AT).isBefore(instant(m, PURGE_STARTED_AT))) {
            throw invalid();
        }
    }

    private void validateMemoryMetadata(Map<String, Object> m, boolean purged) {
        if (version >= 3) {
            metadataText(m, TITLE, 200);
            metadataText(m, DESCRIPTION, 2000);
            validateDate(m);
            if (purged && (m.get(TITLE) != null || m.get(DESCRIPTION) != null || m.get("memory_date") != null
                    || !UNKNOWN.equals(m.get(DATE_PRECISION)))) {
                throw invalid();
            }
        }
    }

    private static void validateMemoryOrdering(Map<String, Object> m, UUID contribution, Set<String> clients, Set<String> positions) {
        if (m.get("client_item_id") != null && !clients.add(contribution + ":" + m.get("client_item_id"))) {
            throw invalid();
        }
        if (m.get(ITEM_POSITION) != null && (number(m, ITEM_POSITION) < 0
                || number(m, ITEM_POSITION) > 19
                || !positions.add(contribution + ":" + m.get(ITEM_POSITION)))) {
            throw invalid();
        }
    }

    private void validateAsset(Map<String, Object> a, Set<UUID> ownedAssets) {
        UUID id = uuid(a, "id"), owner = uuid(a, MEMORY_ID);
        var memory = memories.get(owner);
        boolean audio = memory != null && AUDIO.equals(memory.get(MEMORY_TYPE));
        String declared = text(a, "declared_content_type");
        validateAssetOwnership(a, memory, owner, id, ownedAssets);
        validateAssetTuple(a, audio, declared);
        bounded(a, "original_filename", 255, false);
        hash(a, "checksum_sha256", false);
        hash(a, "expected_checksum_sha256", false);
        if (!a.get("checksum_sha256").equals(a.get("expected_checksum_sha256"))) {
            throw invalid();
        }
        if (UPLOADED.equals(a.get(UPLOAD_STATE))) {
            if (!a.get("declared_content_type").equals(a.get("detected_format"))) {
                throw invalid();
            }
        } else if (!"unverified".equals(a.get("detected_format"))) {
            throw invalid();
        }
        validateAssetAudio(a, audio, declared);
    }

    private static void validateAssetOwnership(Map<String, Object> a, Map<String, Object> memory, UUID owner, UUID id, Set<UUID> ownedAssets) {
        if (memory == null || !Set.of(PHOTO, AUDIO).contains(text(memory, MEMORY_TYPE))
                || memory.get(PURGED_AT) != null || !ownedAssets.add(owner)
                || !("originals/" + id).equals(a.get("object_key")) || id.version() != 4) {
            throw invalid();
        }
    }

    private static void validateAssetTuple(Map<String, Object> a, boolean audio, String declared) {
        if (!Set.of(PENDING, "FAILED", UPLOADED).contains(text(a, UPLOAD_STATE))
                || !MediaTypes.validTypeAndSize(declared, number(a, "byte_size"))
                || (audio != MediaTypes.AUDIO_TYPES.contains(declared))
                || a.get("expected_byte_size") == null || number(a, "expected_byte_size") != number(a, "byte_size")
                || instant(a, UPDATED_AT).isBefore(instant(a, CREATED_AT))) {
            throw invalid();
        }
    }

    private static void validateAssetAudio(Map<String, Object> a, boolean audio, String declared) {
        if (!audio) {
            requireAbsentAudioMetadata(a);
        } else {
            validateAudioMetadata(a, declared);
        }
    }

    private static void requireAbsentAudioMetadata(Map<String, Object> asset) {
        if (asset.get(EXPECTED_DURATION_MS) != null || asset.get(AUDIO_DURATION_MS) != null
                || asset.get(AUDIO_CODEC) != null || asset.get(AUDIO_CONTAINER) != null) {
            throw invalid();
        }
    }

    private static void validateAudioMetadata(Map<String, Object> asset, String declared) {
        if (asset.get(EXPECTED_DURATION_MS) == null || number(asset, EXPECTED_DURATION_MS) < 1
                || number(asset, EXPECTED_DURATION_MS) > MediaTypes.AUDIO_MAX_DURATION_MS) {
            throw invalid();
        }
        if (UPLOADED.equals(asset.get(UPLOAD_STATE))) {
            if (asset.get(AUDIO_DURATION_MS) == null || !MediaTypes.audioMetadataMatches(declared,
                    text(asset, AUDIO_CONTAINER), text(asset, AUDIO_CODEC), number(asset, AUDIO_DURATION_MS))) {
                throw invalid();
            }
        } else if (asset.get(AUDIO_DURATION_MS) != null || asset.get(AUDIO_CODEC) != null
                || asset.get(AUDIO_CONTAINER) != null) {
            throw invalid();
        }
    }

    private void validateAuditIdentity(Map<String, Object> row, Set<String> audit) {
        var memory = memories.get(uuid(row, MEMORY_ID));
        if (memory == null || !STATES.contains(text(row, "from_status")) || !STATES.contains(text(row, "to_status"))
                || number(row, "before_revision") < 1
                || number(row, AFTER_REVISION) <= number(row, "before_revision")
                || number(row, AFTER_REVISION) > number(memory, REVISION)
                || !audit.add(row.get(MEMORY_ID) + ":" + row.get(AFTER_REVISION))) {
            throw invalid();
        }
    }

    private void validateAuditAudience(Map<String, Object> row) {
        if (version >= 7
                && (!Set.of(COUPLE_ONLY, FRIENDS_FAMILY, PUBLIC).contains(row.get("before_visibility"))
                        || !Set.of(COUPLE_ONLY, FRIENDS_FAMILY, PUBLIC).contains(row.get("after_visibility"))
                        || !COUPLE_ONLY.equals(row.get("before_visibility"))
                                && !"KEEP".equals(row.get("from_status"))
                        || !COUPLE_ONLY.equals(row.get("after_visibility"))
                                && !"KEEP".equals(row.get("to_status")))) {
            throw invalid();
        }
    }

    private void validateAlbumMember(Map<String, Object> member, Map<UUID, Map<String, Object>> albums, Set<String> pairs, Set<String> positions) {
        UUID albumId = uuid(member, "album_id"), memoryId = uuid(member, MEMORY_ID);
        var album = albums.get(albumId);
        var memory = memories.get(memoryId);
        long position = number(member, "position");
        if (album == null || album.get(DELETED_AT) != null || memory == null || position < 1
                || !pairs.add(albumId + ":" + memoryId) || !positions.add(albumId + ":" + position)
                || !Set.of(PENDING, "KEEP", ARCHIVED).contains(text(memory, REVIEW_STATUS))
                || memory.get(PURGE_STARTED_AT) != null || memory.get(PURGED_AT) != null) {
            throw invalid();
        }
        requireLinkedOriginal(memory, memoryId);
    }

    private static void validateNamedOrganization(Map<String, Object> row) {
        Instant created = instant(row, CREATED_AT),
                updated = instant(row, UPDATED_AT),
                deleted = instant(row, DELETED_AT);
        validateOrganizationIdentity(row, created, updated);
        validateOrganizationDeletion(created, updated, deleted);
        if (deleted != null) {
            if (row.get("name") != null) {
                throw invalid();
            }
        } else {
            if (row.get("name") == null) {
                throw invalid();
            }
            metadataText(row, "name", 200);
        }
    }

    private static void validateOrganizationIdentity(Map<String, Object> row, Instant created, Instant updated) {
        if (uuid(row, "id").version() != 4 || uuid(row, "id").variant() != 2
                || uuid(row, REVISION).version() != 4 || uuid(row, REVISION).variant() != 2
                || !COUPLE_ONLY.equals(row.get(VISIBILITY)) || updated.isBefore(created)) {
            throw invalid();
        }
    }

    private static void validateOrganizationDeletion(Instant created, Instant updated, Instant deleted) {
        if (deleted != null && (deleted.isBefore(created) || updated.isBefore(deleted))) {
            throw invalid();
        }
    }

    private void requireLinkedOriginal(Map<String, Object> memory, UUID memoryId) {
        if (!"TEXT".equals(memory.get(MEMORY_TYPE))) {
            var asset = assetsByMemory.get(memoryId);
            if (asset == null || !UPLOADED.equals(asset.get(UPLOAD_STATE))) {
                throw invalid();
            }
        }
    }

    private void validateTagMember(Map<String, Object> member, Map<UUID, Map<String, Object>> tags, Set<String> pairs) {
        UUID tagId = uuid(member, "tag_id"), memoryId = uuid(member, MEMORY_ID);
        var tag = tags.get(tagId);
        var memory = memories.get(memoryId);
        if (tag == null || tag.get(DELETED_AT) != null || memory == null || !pairs.add(tagId + ":" + memoryId)
                || !Set.of(PENDING, "KEEP", ARCHIVED).contains(text(memory, REVIEW_STATUS))
                || memory.get(PURGE_STARTED_AT) != null || memory.get(PURGED_AT) != null) {
            throw invalid();
        }
        requireLinkedOriginal(memory, memoryId);
    }

    private static void validateTimelineEvent(Map<String, Object> event, Instant listUpdated) {
        Instant created = instant(event, CREATED_AT),
                updated = instant(event, UPDATED_AT),
                deleted = instant(event, DELETED_AT);
        validateOrganizationIdentity(event, created, updated);
        if (listUpdated.isBefore(updated)) {
            throw invalid();
        }
        validateOrganizationDeletion(created, updated, deleted);
        if (deleted != null) {
            if (event.get(TITLE) != null || event.get(DESCRIPTION) != null || event.get("event_date") != null
                    || !UNKNOWN.equals(event.get(DATE_PRECISION))) {
                throw invalid();
            }
        } else {
            if (event.get(TITLE) == null) {
                throw invalid();
            }
            metadataText(event, TITLE, 200);
            metadataText(event, DESCRIPTION, 2000);
        }
        validateDate(event, "event_date");
    }

    private void validateTimelineMember(Map<String, Object> member, Map<UUID, Map<String, Object>> events, Set<String> pairs) {
        UUID eventId = uuid(member, "event_id"), memoryId = uuid(member, MEMORY_ID);
        var event = events.get(eventId);
        var memory = memories.get(memoryId);
        if (event == null || event.get(DELETED_AT) != null || memory == null
                || !pairs.add(eventId + ":" + memoryId)
                || !Set.of(PENDING, "KEEP", ARCHIVED).contains(text(memory, REVIEW_STATUS))
                || memory.get(PURGE_STARTED_AT) != null || memory.get(PURGED_AT) != null) {
            throw invalid();
        }
        requireLinkedOriginal(memory, memoryId);
    }

    private static boolean validYear(String date) {
        return date != null && date.matches("[0-9]{4}") && Integer.parseInt(date) >= 1;
    }

    private static boolean validMonth(String date) {
        return date != null && date.matches("[0-9]{4}-[0-9]{2}")
                && java.time.YearMonth.parse(date).getYear() >= 1;
    }

    private static boolean validDay(String date) {
        return date != null && date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
                && java.time.LocalDate.parse(date).getYear() >= 1;
    }

    private static RecoveryException invalid() {
        return RecoverySchema.invalid();
    }

    @Override
    public String toString() {
        return "RecoveryMetadata[contributions=" + contributions.size() + ", memories=" + memories.size() + "]";
    }
}
