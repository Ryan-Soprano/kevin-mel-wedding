package com.kevinmel.archive.operations;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;

/** Fixed, content-free observations. Guest identifiers and exception details never enter a snapshot. */
@Component
public final class GuestOperationsSignals {
    public enum Category { GUEST_API_5XX, GUEST_MEDIA_5XX, CLIENT_UPLOAD_UNCONFIRMED }
    private static final int MAX_REPORTED_GRANTS = 8192;
    private final Clock clock;
    private final String bootId = UUID.randomUUID().toString();
    private final Instant startedAt;
    private final EnumMap<Category, Observation> observations = new EnumMap<>(Category.class);
    // Transient, bounded deduplication only; these identifiers are never written or returned.
    private final LinkedHashMap<UUID, Instant> reportedGrants = new LinkedHashMap<>();

    public GuestOperationsSignals(Clock clock) {
        this.clock = clock;
        startedAt = clock.instant();
        for (var category : Category.values()) observations.put(category, new Observation(0, null));
    }

    public synchronized void record(Category category) {
        var previous = observations.get(category);
        observations.put(category, new Observation(
                previous.count() == Long.MAX_VALUE ? Long.MAX_VALUE : previous.count() + 1,
                timestamp(clock.instant())));
    }

    /** Called only after a real, current guest intent/grant is verified read-only. */
    public synchronized void reportUpload(UUID grantId) {
        Instant now = clock.instant();
        reportedGrants.entrySet().removeIf(entry -> !entry.getValue().isAfter(now));
        if (reportedGrants.containsKey(grantId)) return;
        // A full table never silently hides a fault. Saturation retains an alert while bounding memory.
        if (reportedGrants.size() < MAX_REPORTED_GRANTS) reportedGrants.put(grantId, now.plusSeconds(3600));
        record(Category.CLIENT_UPLOAD_UNCONFIRMED);
    }

    public synchronized Snapshot snapshot(String commit) {
        var categories = new LinkedHashMap<String, Observation>();
        for (var category : Category.values()) categories.put(category.name(), observations.get(category));
        return new Snapshot(1, bootId, timestamp(startedAt), timestamp(clock.instant()), commit, Map.copyOf(categories));
    }

    private static String timestamp(Instant instant) {
        // Always three fractional digits, including whole seconds.
        return java.time.format.DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
                .withZone(java.time.ZoneOffset.UTC).format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    public record Observation(long count, String lastObservedAt) {}
    public record Snapshot(int schemaVersion, String bootId, String startedAt, String observedAt,
            String renderCommit, Map<String, Observation> categories) {}
}
