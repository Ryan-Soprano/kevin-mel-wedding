package com.kevinmel.archive.retention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

class RetentionServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-09T12:00:00.123456Z");
    private final RetentionRepository db = mock(RetentionRepository.class);
    private final DeletionStorage storage = mock(DeletionStorage.class);
    private final RetentionService service = new RetentionService(db, storage, Clock.fixed(NOW, ZoneOffset.UTC));
    private final DeletionRecord plan = plan(NOW);

    @Test void independentlyConfirmedEvidencePrecedesObjectErasureAndTransactionalScrubbing() {
        UUID grant = UUID.randomUUID();
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        when(db.grants(plan)).thenReturn(List.of(grant));
        when(db.finish(plan, NOW)).thenReturn(true);

        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        var ordered = inOrder(db, storage);
        ordered.verify(db).claim(20, NOW);
        ordered.verify(db).validate(plan);
        ordered.verify(storage).record(plan);
        ordered.verify(db).validate(plan);
        ordered.verify(db).grants(plan);
        ordered.verify(storage).deleteOriginal(plan.assetId());
        ordered.verify(storage).deleteStaging(grant);
        ordered.verify(db).finish(plan, NOW);
        ordered.verifyNoMoreInteractions();
    }

    @Test void failedWriteAheadEvidenceCannotEraseAnObjectOrScrubTheDatabase() {
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        doThrow(new IllegalStateException("synthetic private provider failure")).when(storage).record(plan);
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        verify(storage).record(plan);
        verifyNoMoreInteractions(storage);
        verify(db, never()).grants(any());
        verify(db, never()).finish(any(), any());
    }

    @Test void invalidOwnershipIsRejectedEvenBeforeWritingIndependentEvidence() {
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        doThrow(new IllegalStateException("Retention plan identity is invalid.")).when(db).validate(plan);
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        verifyNoInteractions(storage);
        verify(db, never()).finish(any(), any());
    }

    @Test void allStagingScopesAreValidatedBeforeTheFirstOriginalIsErased() {
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        when(db.grants(plan)).thenThrow(new IllegalStateException("Retention plan identity is invalid."));
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        verify(storage).record(plan);
        verifyNoMoreInteractions(storage);
        verify(db, never()).finish(any(), any());
    }

    @Test void originalOrStagingFailureRetainsAllDatabaseMetadataForRetry() {
        UUID grant = UUID.randomUUID();
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        when(db.grants(plan)).thenReturn(List.of(grant));
        doThrow(new IllegalStateException("unconfirmed erase")).when(storage).deleteOriginal(plan.assetId());
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        verify(storage, never()).deleteStaging(any());
        verify(db, never()).finish(any(), any());

        doNothing().when(storage).deleteOriginal(plan.assetId());
        doThrow(new IllegalStateException("unconfirmed staging erase")).when(storage).deleteStaging(grant);
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        verify(db, never()).finish(any(), any());
    }

    @Test void databaseFailureRetriesTheSameImmutableEvidenceAndIdempotentObjectDeletes() {
        when(db.claim(20, NOW)).thenReturn(List.of(plan));
        when(db.grants(plan)).thenReturn(List.of());
        when(db.finish(plan, NOW)).thenThrow(new IllegalStateException("synthetic transaction failure")).thenReturn(true);
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        verify(storage, times(2)).record(plan);
        verify(storage, times(2)).deleteOriginal(plan.assetId());
        verify(db, times(2)).finish(plan, NOW);
    }

    @Test void oneFailedItemDoesNotPretendSuccessOrPreventOtherExpiredItemsFromFinishing() {
        var other = plan(NOW.minusSeconds(1));
        when(db.claim(20, NOW)).thenReturn(List.of(plan, other));
        doThrow(new IllegalStateException("failed first item")).when(storage).record(plan);
        when(db.grants(other)).thenReturn(List.of());
        when(db.finish(other, NOW)).thenReturn(true);
        assertThat(service.purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 1));
        verify(db, never()).finish(eq(plan), any());
        verify(db).finish(other, NOW);
    }

    @Test void replayReadsAllBoundedPagesAndNeverRewritesIndependentEvidence() {
        var other = plan(NOW.minusSeconds(1));
        when(storage.ledger(null, 100)).thenReturn(new DeletionStorage.Page(List.of(plan), "page-2"));
        when(storage.ledger("page-2", 100)).thenReturn(new DeletionStorage.Page(List.of(other), null));
        when(db.grants(any())).thenReturn(List.of());
        assertThat(service.replayLedger()).isEqualTo(2);
        verify(storage, never()).record(any());
        verify(storage).deleteOriginal(plan.assetId());
        verify(storage).deleteOriginal(other.assetId());
        verify(db).finish(plan, NOW);
        verify(db).finish(other, NOW);
    }

    @Test void oversizedPagesAndRepeatedContinuationCyclesFailClosed() {
        when(storage.ledger(null, 100)).thenReturn(new DeletionStorage.Page(Collections.nCopies(101, plan), null));
        assertThatThrownBy(service::replayLedger).isInstanceOf(IllegalStateException.class).hasMessage("Invalid ledger page.");
        verifyNoInteractions(db);
        verify(storage, never()).deleteOriginal(any());

        when(storage.ledger(null, 100)).thenReturn(new DeletionStorage.Page(List.of(), "a"));
        when(storage.ledger("a", 100)).thenReturn(new DeletionStorage.Page(List.of(), "b"));
        when(storage.ledger("b", 100)).thenReturn(new DeletionStorage.Page(List.of(), "a"));
        assertThatThrownBy(service::replayLedger).isInstanceOf(IllegalStateException.class).hasMessage("Invalid ledger continuation.");
        verify(storage, times(1)).ledger("a", 100);
        verify(storage, times(1)).ledger("b", 100);
        verifyNoInteractions(db);
    }

    @Test void replayRejectsFutureEvidenceAndWrongOwnershipBeforeAnyObjectIo() {
        var future = plan(NOW.plusSeconds(1));
        when(storage.ledger(null, 100)).thenReturn(new DeletionStorage.Page(List.of(future), null));
        assertThatThrownBy(service::replayLedger).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(db);
        verify(storage, never()).deleteOriginal(any());

        when(storage.ledger(null, 100)).thenReturn(new DeletionStorage.Page(List.of(plan), null));
        doThrow(new IllegalStateException("Retention plan identity is invalid.")).when(db).validate(plan);
        assertThatThrownBy(service::replayLedger).isInstanceOf(IllegalStateException.class).hasMessage("Retention plan identity is invalid.");
        verify(db, never()).finish(any(), any());
        verify(storage, never()).deleteOriginal(any());
        verify(storage, never()).deleteStaging(any());
    }

    @Test void repositoryRejectsUnsafeBatchSizesBeforeOpeningATransaction() {
        var jdbc = mock(JdbcClient.class);
        var manager = mock(PlatformTransactionManager.class);
        var repository = new RetentionRepository(jdbc, manager);
        for (int size : new int[] { -1, 0, 101, Integer.MAX_VALUE }) {
            assertThatThrownBy(() -> repository.claim(size, NOW)).isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(jdbc, manager);
    }

    private static DeletionRecord plan(Instant recorded) {
        return new DeletionRecord(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                SubmissionKeyDigest.sha256(UUID.randomUUID().toString()), recorded.minusSeconds(1), recorded);
    }
}
