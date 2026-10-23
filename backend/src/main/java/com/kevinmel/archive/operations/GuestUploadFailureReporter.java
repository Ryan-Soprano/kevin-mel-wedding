package com.kevinmel.archive.operations;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.web.ApiException;

/** A guest can signal only an issued grant for their own unchanged retry capability. */
@Service
public class GuestUploadFailureReporter {
    private final JdbcClient db;
    private final Clock clock;
    private final GuestOperationsSignals signals;

    public GuestUploadFailureReporter(JdbcClient db, Clock clock, GuestOperationsSignals signals) {
        this.db = db;
        this.clock = clock;
        this.signals = signals;
    }

    @Transactional(readOnly = true)
    public void report(UUID contributionId, UUID memoryId, String key, Map<String, Object> body) {
        if (body == null || !body.keySet().equals(Set.of("grantId"))
                || !(body.get("grantId") instanceof String raw)
                || !raw.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw new ApiException(400, "VALIDATION_FAILED", "Supply the upload grant ID.");
        }
        UUID grantId = UUID.fromString(raw);
        var now = clock.instant();
        String state = db.sql("""
                SELECT a.upload_state FROM contribution c
                    JOIN memory m ON m.contribution_id=c.id
                    JOIN media_asset a ON a.memory_id=m.id
                    JOIN upload_grant g ON g.media_asset_id=a.id
                WHERE c.id=:contribution AND m.id=:memory AND g.id=:grant AND c.idempotency_key=:key
                    AND c.source='GUEST' AND c.author_account_id IS NULL AND c.event_key='kevin-mel-wedding'
                    AND m.memory_type IN ('PHOTO','AUDIO') AND m.purge_started_at IS NULL AND m.purged_at IS NULL
                    AND (m.review_status<>'DELETE' OR m.delete_after>:now)
                    AND g.created_at>=:earliest AND g.created_at<=:now
                """)
                .param("contribution", contributionId).param("memory", memoryId).param("grant", grantId)
                .param("key", key).param("now", OffsetDateTime.ofInstant(now, ZoneOffset.UTC))
                .param("earliest", OffsetDateTime.ofInstant(now.minusSeconds(3600), ZoneOffset.UTC))
                .query(String.class).optional().orElseThrow(ApiException::notFound);
        // A late browser failure cannot turn an already committed original into an operator fault.
        if (!"UPLOADED".equals(state)) signals.reportUpload(grantId);
    }
}
