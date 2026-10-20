package com.kevinmel.archive.retention;

import java.util.List;
import java.util.UUID;

/** Server-only ledger and exact-object deletion; never exposed through guest or operator HTTP roles. */
public interface DeletionStorage {
    void record(DeletionRecord record);

    Page ledger(
            String cursor,
            int limit);

    void deleteOriginal(UUID assetId);

    void deleteStaging(UUID grantId);

    record Page(
            List<DeletionRecord> records,
            String nextCursor) {
        public Page {
            records = List.copyOf(records);
        }

        @Override
        public String toString() {
            return "DeletionPage[count=" + records.size() + "]";
        }
    }
}
