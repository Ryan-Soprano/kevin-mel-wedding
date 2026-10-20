package com.kevinmel.archive.portable;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Explicit portable allowlist. Live validation tokens are never part of archiveData(). */
public final class PortableSnapshot {
    public static final int MAX_METADATA_BYTES = 16_777_216;
    public static final int MAX_ROWS = 100_000;
    public static final int MAX_ORIGINALS = 10_000;
    public static final long MAX_ORIGINAL_BYTES = 7_500_000_000L;
    private final Instant capturedAt;
    private final List<Memory> memories;
    private final List<Original> originals;
    private final List<Album> albums;
    private final List<Event> events;
    private final List<Tag> tags;
    private final Map<String, Long> excludedCounts;
    private final Map<String, Map<UUID, String>> validation;

    PortableSnapshot(
            Instant capturedAt,
            List<Memory> memories,
            List<Original> originals,
            List<Album> albums,
            List<Event> events,
            List<Tag> tags,
            Map<String, Long> excludedCounts,
            Map<String, Map<UUID, String>> validation) {
        this.capturedAt = capturedAt;
        this.memories = List.copyOf(memories);
        this.originals = List.copyOf(originals);
        this.albums = List.copyOf(albums);
        this.events = List.copyOf(events);
        this.tags = List.copyOf(tags);
        this.excludedCounts = Map.copyOf(excludedCounts);
        this.validation = validation.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
                Map.Entry::getKey,
                entry -> Map.copyOf(entry.getValue())));
    }

    public Instant capturedAt() {
        return capturedAt;
    }

    public List<Memory> memories() {
        return memories;
    }

    public List<Original> originals() {
        return originals;
    }

    public List<Album> albums() {
        return albums;
    }

    public List<Event> events() {
        return events;
    }

    public List<Tag> tags() {
        return tags;
    }

    public Map<String, Long> excludedCounts() {
        return excludedCounts;
    }

    Map<String, Map<UUID, String>> validation() {
        return validation;
    }

    public int originalPartCount() {
        return PortablePartWriter.planParts(originals).size();
    }

    public long originalBytes() {
        return originals.stream().mapToLong(Original::byteSize).sum();
    }

    public Map<String, Object> archiveData() {
        return Map.of(
                "format", "kevin-mel-portable-archive",
                "version", 1,
                "capturedAt", capturedAt,
                "memories", memories,
                "originals", originals,
                "albums", albums,
                "events", events,
                "tags", tags,
                "excludedCounts", excludedCounts);
    }
    public record Memory(
            UUID memoryId,
            UUID contributionId,
            Integer itemPosition,
            String memoryType,
            String source,
            String guestName,
            String reviewStatus,
            String text,
            String caption,
            String title,
            String description,
            String memoryDate,
            String datePrecision,
            Instant createdAt,
            Instant updatedAt,
            UUID assetId,
            String visibility) {
        public Memory(
                UUID memoryId,
                UUID contributionId,
                Integer itemPosition,
                String memoryType,
                String source,
                String guestName,
                String reviewStatus,
                String text,
                String caption,
                String title,
                String description,
                String memoryDate,
                String datePrecision,
                Instant createdAt,
                Instant updatedAt,
                UUID assetId) {
            this(
                    memoryId,
                    contributionId,
                    itemPosition,
                    memoryType,
                    source,
                    guestName,
                    reviewStatus,
                    text,
                    caption,
                    title,
                    description,
                    memoryDate,
                    datePrecision,
                    createdAt,
                    updatedAt,
                    assetId,
                    "COUPLE_ONLY");
        }
    }

    public record Original(
            UUID memoryId,
            UUID assetId,
            String path,
            String contentType,
            long byteSize,
            String sha256,
            Long durationMs,
            String audioContainer,
            String audioCodec,
            String originalFilename) {
    }

    public record Album(
            UUID id,
            String name,
            Instant createdAt,
            Instant updatedAt,
            List<AlbumMember> members) {
        public Album {
            members = List.copyOf(members);
        }
    }

    /** Decimal string preserves every PostgreSQL BIGINT position in other languages. */
    public record AlbumMember(
            UUID memoryId,
            String position) {
    }

    public record Event(
            UUID id,
            String title,
            String description,
            String eventDate,
            String datePrecision,
            Instant createdAt,
            Instant updatedAt,
            List<UUID> memoryIds) {
        public Event {
            memoryIds = List.copyOf(memoryIds);
        }
    }

    public record Tag(
            UUID id,
            String name,
            Instant createdAt,
            Instant updatedAt,
            List<UUID> memoryIds) {
        public Tag {
            memoryIds = List.copyOf(memoryIds);
        }
    }

    @Override
    public String toString() {
        return "PortableSnapshot[contents=<private>]";
    }
}
