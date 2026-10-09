package com.kevinmel.archive.retention;

import java.time.Clock;
import java.util.HashSet;

import org.springframework.stereotype.Service;

/** Only enforces expired couple decisions. It cannot select new moderation states. */
@Service
public class RetentionService {
    private final RetentionRepository db;
    private final DeletionStorage storage;
    private final Clock clock;

    public RetentionService(RetentionRepository db, DeletionStorage storage, Clock clock) {
        this.db = db; this.storage = storage; this.clock = clock;
    }

    public Batch purgeBatch(int limit) {
        var plans = db.claim(limit, clock.instant());
        int purged = 0, failed = 0;
        for (var plan : plans) {
            try {
                db.validate(plan);
                storage.record(plan); // Independent durable evidence must precede every irreversible erase.
                eraseObjects(plan);
                if (db.finish(plan, clock.instant())) purged++;
            } catch (RuntimeException failure) { failed++; } // No sensitive IO/SQL errors in logs.
        }
        return new Batch(purged, failed);
    }

    /** Offline-only recovery step: fail closed, never reopen traffic after an incomplete replay. */
    public int replayLedger() {
        String cursor = null;
        var seen = new HashSet<String>();
        int applied = 0;
        do {
            var page = storage.ledger(cursor, 100);
            if (page.records().size() > 100) throw new IllegalStateException("Invalid ledger page.");
            for (var plan : page.records()) {
                eraseObjects(plan);
                db.finish(plan, clock.instant());
                applied++;
            }
            cursor = page.nextCursor();
            if (cursor != null && (cursor.isBlank() || !seen.add(cursor) || seen.size() > 10_000)) {
                throw new IllegalStateException("Invalid ledger continuation.");
            }
        } while (cursor != null);
        return applied;
    }

    private void eraseObjects(DeletionRecord plan) {
        if (clock.instant().isBefore(plan.recordedAt())) throw new IllegalStateException("Deletion evidence is not yet applicable.");
        db.validate(plan);
        var grants = db.grants(plan); // Validate every staging scope before erasing the original.
        if (plan.assetId() != null) storage.deleteOriginal(plan.assetId());
        for (var grant : grants) storage.deleteStaging(grant);
    }
    public record Batch(int purged, int failed) { }
}
