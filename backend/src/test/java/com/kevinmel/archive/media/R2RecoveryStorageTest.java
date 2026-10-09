package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.io.ByteArrayInputStream;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.kevinmel.archive.web.ApiException;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class R2RecoveryStorageTest {
    private static final byte[] ORIGINAL = { 1, 2, 3, 4 };

    @Test void isolatedCopyUsesConditionalPutWithExactOriginalScopeAndMetadata() {
        var client = mock(S3Client.class);
        String key = "originals/" + UUID.randomUUID();
        try (var storage = new R2ObjectStorage("isolated", client, mock(S3Presigner.class))) {
            storage.publishRecovered(key, ORIGINAL, "image/png");
            var request = ArgumentCaptor.forClass(PutObjectRequest.class);
            var body = ArgumentCaptor.forClass(RequestBody.class);
            verify(client).putObject(request.capture(), body.capture());
            assertThat(request.getValue().bucket()).isEqualTo("isolated");
            assertThat(request.getValue().key()).isEqualTo(key);
            assertThat(request.getValue().ifNoneMatch()).isEqualTo("*");
            assertThat(request.getValue().contentLength()).isEqualTo((long) ORIGINAL.length);
            assertThat(request.getValue().contentType()).isEqualTo("image/png");
            assertThat(request.getValue().cacheControl()).isEqualTo("no-store");
            verifyNoMoreInteractions(client);
        }
    }

    @Test void conditionalConflictAcceptsOnlyByteIdenticalSizeAndMimeAndNeverOverwrites() {
        var client = conflictClient(ORIGINAL, "image/png", ORIGINAL.length);
        try (var storage = new R2ObjectStorage("isolated", client, mock(S3Presigner.class))) {
            String key = "originals/" + UUID.randomUUID();
            storage.publishRecovered(key, ORIGINAL, "image/png");
            var order = inOrder(client);
            order.verify(client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
            order.verify(client).headObject(any(HeadObjectRequest.class));
            order.verify(client).getObject(any(GetObjectRequest.class));
            verify(client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        }
    }

    @Test void conflictingBytesSizeOrMimeAndUnavailableCopiesFailWithoutSdkDetails() {
        for (var client : java.util.List.of(conflictClient(new byte[] { 1, 2, 3, 9 }, "image/png", 4),
                conflictClient(ORIGINAL, "image/jpeg", 4), conflictClient(ORIGINAL, "image/png", 5))) {
            try (var storage = new R2ObjectStorage("isolated", client, mock(S3Presigner.class))) {
                assertSafeFailure(() -> storage.publishRecovered("originals/" + UUID.randomUUID(), ORIGINAL, "image/png"));
                verify(client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
            }
        }
        var client = mock(S3Client.class);
        when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenThrow(S3Exception.builder().statusCode(503).message("fixture-secret provider detail").build());
        try (var storage = new R2ObjectStorage("isolated", client, mock(S3Presigner.class))) {
            assertSafeFailure(() -> storage.publishRecovered("originals/" + UUID.randomUUID(), ORIGINAL, "image/png"));
            verify(client, never()).getObject(any(GetObjectRequest.class));
        }
    }

    @Test void stagingKeysAndInvalidMetadataNeverReachStorage() {
        var client = mock(S3Client.class);
        try (var storage = new R2ObjectStorage("isolated", client, mock(S3Presigner.class))) {
            assertThatThrownBy(() -> storage.publishRecovered("staging/" + UUID.randomUUID(), ORIGINAL, "image/png"))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> storage.publishRecovered("originals/" + UUID.randomUUID(), new byte[0], "image/png"))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> storage.publishRecovered("originals/" + UUID.randomUUID(), ORIGINAL, "audio/mpeg"))
                    .isInstanceOf(IllegalArgumentException.class);
            verifyNoInteractions(client);
        }
    }

    private static S3Client conflictClient(byte[] bytes, String mime, long size) {
        var client = mock(S3Client.class);
        when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenThrow(S3Exception.builder().statusCode(412).message("fixture-secret conflict").build());
        when(client.headObject(any(HeadObjectRequest.class))).thenReturn(
                HeadObjectResponse.builder().contentLength(size).contentType(mime).build());
        when(client.getObject(any(GetObjectRequest.class))).thenAnswer(ignored -> new ResponseInputStream<>(
                GetObjectResponse.builder().contentLength((long) bytes.length).contentType(mime).build(),
                AbortableInputStream.create(new ByteArrayInputStream(bytes))));
        return client;
    }

    private static void assertSafeFailure(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ApiException.class, failure -> {
            assertThat(failure.status()).isEqualTo(503);
            assertThat(failure.code()).isEqualTo("RECOVERY_STORAGE_UNAVAILABLE");
            assertThat(failure.getMessage()).doesNotContain("fixture-secret", "provider detail", "conflict");
        });
    }
}
