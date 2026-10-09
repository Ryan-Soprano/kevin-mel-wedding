package com.kevinmel.archive.retention;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Independent durable ledger and private-object fixture; never calls an external provider. */
final class InMemoryDeletionStorage implements DeletionStorage {
    final Map<UUID, DeletionRecord> records = new LinkedHashMap<>();
    final Set<UUID> originals = new LinkedHashSet<>();
    final Set<UUID> staging = new LinkedHashSet<>();
    final List<String> operations = new ArrayList<>();
    int failRecords;
    int loseRecordResponses;
    int failOriginals;

    @Override public void record(DeletionRecord record) {
        operations.add("record:" + record.memoryId());
        if (failRecords > 0) { failRecords--; throw new IllegalStateException("synthetic unavailable ledger"); }
        var existing = records.putIfAbsent(record.memoryId(), record);
        if (existing != null && !existing.equals(record)) throw new IllegalStateException("synthetic immutable record conflict");
        if (loseRecordResponses > 0) { loseRecordResponses--; throw new IllegalStateException("synthetic lost ledger response"); }
    }

    @Override public Page ledger(String cursor, int limit) {
        operations.add("ledger");
        int offset = cursor == null ? 0 : Integer.parseInt(cursor);
        var values = List.copyOf(records.values());
        int end = Math.min(values.size(), offset + limit);
        return new Page(values.subList(offset, end), end == values.size() ? null : Integer.toString(end));
    }

    @Override public void deleteOriginal(UUID id) {
        operations.add("original:" + id);
        if (failOriginals > 0) { failOriginals--; throw new IllegalStateException("synthetic unconfirmed original erase"); }
        originals.remove(id);
    }

    @Override public void deleteStaging(UUID id) {
        operations.add("staging:" + id);
        staging.remove(id);
    }
}
