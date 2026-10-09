package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.*;
import java.util.*;
import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.Test;

class AudioFinalizationFailureTest {
    private final PhotoRepository photos = mock(PhotoRepository.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final AudioVerifier verifier = mock(AudioVerifier.class);
    private final Instant now = Instant.parse("2026-10-09T12:00:00Z");
    private final PhotoFinalizer finalizer = new PhotoFinalizer(photos, mock(ContributionRepository.class), storage,
            new PhotoVerifier(), verifier, Clock.fixed(now, ZoneOffset.UTC));
    private final UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID(), grantId = UUID.randomUUID();
    private final String key = UUID.randomUUID().toString();
    private final PhotoRepository.Asset asset = new PhotoRepository.Asset(UUID.randomUUID(), "originals/fixture", "audio/webm",
            3, "0".repeat(64), "PENDING", "AUDIO", 1000L);

    void pending() {
        when(photos.lock(contribution, memory, key)).thenReturn(asset);
        when(photos.grant(grantId, asset.id())).thenReturn(new PhotoRepository.Grant("staging/fixture", now.plusSeconds(300)));
        when(storage.read("staging/fixture", MediaTypes.AUDIO_MAX_BYTES)).thenReturn(Optional.of(new byte[]{1, 2, 3}));
    }
    @Test void missingDecoderFailsBeforeReadingBytesAndKeepsPending() {
        pending(); doThrow(new ApiException(503, "MEDIA_UNAVAILABLE", "Audio verification unavailable.")).when(verifier).requireAvailable();
        assertThatThrownBy(() -> finalizer.finalizePhoto(contribution, memory, key, grantId)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        verify(photos, never()).failed(any()); verifyNoInteractions(storage);
    }
    @Test void transientDecodeTimeoutDoesNotCommitFailedButRejectionDoes() {
        pending(); when(verifier.verify(any(), eq(asset))).thenThrow(new ApiException(503, "MEDIA_UNAVAILABLE", "Try again."));
        assertThatThrownBy(() -> finalizer.finalizePhoto(contribution, memory, key, grantId)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        verify(photos, never()).failed(any()); verify(storage, never()).publish(anyString(), any(), anyString());
        var invalid = new ApiException(422, "INVALID_MEDIA", "Invalid voice memory.");
        when(verifier.verify(any(), eq(asset))).thenThrow(invalid);
        assertThat(finalizer.finalizePhoto(contribution, memory, key, grantId).failure()).isSameAs(invalid);
        verify(photos).failed(asset); verify(storage, never()).publish(anyString(), any(), anyString());
    }
}
