package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.transaction.TransactionSystemException;

class MediaServiceAdmissionTest {
    private final PhotoFinalizer finalizer = mock(PhotoFinalizer.class);
    private final MediaService service = new MediaService(null, finalizer, null, Clock.systemUTC(), 1);
    private final UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID(), grant = UUID.randomUUID();
    private final String key = UUID.randomUUID().toString();

    @Test void overlappingItemsAreRejectedBeforeAnyFinalizationAndRetryAfterCompletion() throws Exception {
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(finalizer.finalizePhoto(any(), any(), anyString(), any())).thenAnswer(invocation -> {
            entered.countDown();
            assertThat(finish.await(10, TimeUnit.SECONDS)).isTrue();
            return new PhotoFinalizer.Result(null, null);
        });
        try (var executor = Executors.newSingleThreadExecutor()) {
            var first = executor.submit(this::finalizeUpload);
            try {
                assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> service.finalizeUpload(contribution, UUID.randomUUID(), key,
                        Map.of("grantId", grant.toString())))
                        .isInstanceOfSatisfying(ApiException.class, failure -> {
                            assertThat(failure.status()).isEqualTo(503);
                            assertThat(failure.code()).isEqualTo("MEDIA_UNAVAILABLE");
                        });
                verify(finalizer, times(1)).finalizePhoto(any(), any(), anyString(), any());
            } finally { finish.countDown(); }
            first.get(10, TimeUnit.SECONDS);
        }
        finalizeUpload();
        verify(finalizer, times(2)).finalizePhoto(any(), any(), anyString(), any());
    }

    @Test void invalidImageStorageAndCommitFailuresReleaseThePermit() {
        var invalid = new ApiException(422, "INVALID_MEDIA", "Invalid test image.");
        when(finalizer.finalizePhoto(any(), any(), anyString(), any()))
                .thenReturn(new PhotoFinalizer.Result(null, invalid))
                .thenThrow(new ApiException(503, "MEDIA_UNAVAILABLE", "Storage test failure."))
                .thenThrow(new TransactionSystemException("Synthetic commit failure"))
                .thenThrow(new DataAccessResourceFailureException("Synthetic database failure"))
                .thenReturn(new PhotoFinalizer.Result(null, null));
        for (int i = 0; i < 4; i++) assertThatThrownBy(this::finalizeUpload).isInstanceOf(RuntimeException.class);
        finalizeUpload();
        verify(finalizer, times(5)).finalizePhoto(any(), any(), anyString(), any());
    }

    @Test void malformedGrantDoesNotEnterFinalization() {
        assertThatThrownBy(() -> service.finalizeUpload(contribution, memory, key, Map.of("grantId", "invalid")))
                .isInstanceOfSatisfying(ApiException.class, failure -> assertThat(failure.status()).isEqualTo(400));
        verifyNoInteractions(finalizer);
    }

    private Object finalizeUpload() {
        return service.finalizeUpload(contribution, memory, key, Map.of("grantId", grant.toString()));
    }
}
