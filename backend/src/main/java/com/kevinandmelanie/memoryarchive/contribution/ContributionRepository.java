package com.kevinandmelanie.memoryarchive.contribution;

import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ContributionRepository {

    private final JdbcClient jdbcClient;

    public ContributionRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /**
     * Stores a contribution envelope and its linked text memory in one transaction.
     *
     * <p>The database supplies the review status and visibility. Any constraint failure,
     * including a duplicate idempotency key, rolls back both inserts.</p>
     *
     * @param eventKey the event that owns the contribution
     * @param guestName the optional contributor name
     * @param message the text memory to store
     * @param idempotencyKey the caller-supplied key used to reject duplicate submissions
     * @return the durable identifiers and server-controlled lifecycle values
     */
    @Transactional
    public SavedTextContribution saveTextContribution(
            String eventKey,
            String guestName,
            String message,
            String idempotencyKey) {

        UUID contributionId = jdbcClient.sql("""
                INSERT INTO contribution (
                    event_key,
                    guest_name,
                    idempotency_key
                )
                VALUES (
                    :eventKey,
                    :guestName,
                    :idempotencyKey
                )
                RETURNING id
                """)
                .param("eventKey", eventKey)
                .param("guestName", guestName)
                .param("idempotencyKey", idempotencyKey)
                .query(UUID.class)
                .single();

        SavedMemory memory = jdbcClient.sql("""
                INSERT INTO memory (
                    contribution_id,
                    memory_type,
                    text_content
                )
                VALUES (
                    :contributionId,
                    'TEXT',
                    :message
                )
                RETURNING id, review_status, visibility
                """)
                .param("contributionId", contributionId)
                .param("message", message)
                .query((resultSet, rowNumber) -> new SavedMemory(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("review_status"),
                        resultSet.getString("visibility")))
                .single();

        return new SavedTextContribution(
                contributionId,
                memory.id(),
                memory.reviewStatus(),
                memory.visibility());
    }

    public record SavedTextContribution(
            UUID contributionId,
            UUID memoryId,
            String reviewStatus,
            String visibility) {
    }

    private record SavedMemory(
            UUID id,
            String reviewStatus,
            String visibility) {
    }
}
