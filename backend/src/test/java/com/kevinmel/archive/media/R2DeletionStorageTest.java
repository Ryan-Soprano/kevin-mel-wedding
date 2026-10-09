package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import com.kevinmel.archive.retention.DeletionRecord;
import com.kevinmel.archive.retention.SubmissionKeyDigest;
import com.kevinmel.archive.web.ApiException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class R2DeletionStorageTest {
    private final S3Client client = mock(S3Client.class);
    private final S3Presigner signer = mock(S3Presigner.class);
    private final R2ObjectStorage storage = new R2ObjectStorage("private-test", client, signer);
    private final DeletionRecord record = record();

    @Test void writeAheadUsesOnePrivateConditionalPutAndNeverSignsOrOverwritesARecord() throws Exception {
        storage.recordDeletion(record);
        var request = ArgumentCaptor.forClass(PutObjectRequest.class);
        var body = ArgumentCaptor.forClass(RequestBody.class);
        verify(client).putObject(request.capture(), body.capture());
        assertThat(request.getValue().bucket()).isEqualTo("private-test");
        assertThat(request.getValue().key()).isEqualTo(key(record));
        assertThat(request.getValue().ifNoneMatch()).isEqualTo("*");
        assertThat(request.getValue().contentType()).isEqualTo("application/json");
        assertThat(request.getValue().cacheControl()).isEqualTo("no-store");
        try (var input = body.getValue().contentStreamProvider().newStream()) {
            byte[] bytes = input.readAllBytes();
            assertThat(request.getValue().contentLength()).isEqualTo((long) bytes.length);
            assertThat(DeletionRecord.decode(bytes)).isEqualTo(record);
        }
        verifyNoMoreInteractions(client);
        verifyNoInteractions(signer);
    }

    @Test void conditionalConflictSucceedsOnlyWhenTheCompleteExistingRecordIsIdentical() {
        when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class))).thenThrow(s3(412, "PreconditionFailed"));
        when(client.getObject(any(GetObjectRequest.class))).thenAnswer(ignored -> stream(record.encode()));
        storage.recordDeletion(record);
        var get = ArgumentCaptor.forClass(GetObjectRequest.class);
        var order = inOrder(client);
        order.verify(client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        order.verify(client).getObject(get.capture());
        assertThat(get.getValue().bucket()).isEqualTo("private-test");
        assertThat(get.getValue().key()).isEqualTo(key(record));
        order.verifyNoMoreInteractions();
        verifyNoInteractions(signer);
    }

    @Test void conflictingOrUnreadableExistingEvidenceNeverGetsOverwritten() {
        when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class))).thenThrow(s3(412, "PreconditionFailed"));
        var conflicting = new DeletionRecord(record.memoryId(), record.contributionId(), record.assetId(),
                record.submissionKeyDigest(), record.deleteAfter(), record.recordedAt().plusSeconds(1));
        when(client.getObject(any(GetObjectRequest.class))).thenAnswer(ignored -> stream(conflicting.encode()));
        unavailable(() -> storage.recordDeletion(record));
        verify(client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        verify(client, never()).deleteObject(any(DeleteObjectRequest.class));

        doThrow(s3(403, "AccessDenied")).when(client).getObject(any(GetObjectRequest.class));
        unavailable(() -> storage.recordDeletion(record));
        verify(client, times(2)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        verifyNoInteractions(signer);
    }

    @Test void nonConflictAndTransportFailuresRemainUnconfirmedWithoutReadingOrErasingAnything() {
        for (RuntimeException failure : List.of(s3(403, "AccessDenied"), s3(500, "InternalError"),
                SdkClientException.create("fixture-secret credential failure"))) {
            reset(client);
            when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class))).thenThrow(failure);
            unavailable(() -> storage.recordDeletion(record));
            verify(client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
            verifyNoMoreInteractions(client);
        }
        verifyNoInteractions(signer);
    }

    @Test void ledgerListingIsServerOnlyPrefixBoundedAndReadsExactMatchingIdentities() {
        var second = record();
        when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder()
                .contents(object(key(record)), object(key(second))).isTruncated(true).nextContinuationToken("next-fixture").build());
        when(client.getObject(any(GetObjectRequest.class))).thenAnswer(call -> {
            GetObjectRequest request = call.getArgument(0);
            return stream(request.key().equals(key(record)) ? record.encode() : second.encode());
        });
        var page = storage.deletionLedger("current-fixture", 2);
        assertThat(page.records()).containsExactly(record, second);
        assertThat(page.nextCursor()).isEqualTo("next-fixture");
        var list = ArgumentCaptor.forClass(ListObjectsV2Request.class);
        verify(client).listObjectsV2(list.capture());
        assertThat(list.getValue().bucket()).isEqualTo("private-test");
        assertThat(list.getValue().prefix()).isEqualTo("deletions/v1/");
        assertThat(list.getValue().maxKeys()).isEqualTo(2);
        assertThat(list.getValue().continuationToken()).isEqualTo("current-fixture");
        verify(client, times(2)).getObject(any(GetObjectRequest.class));
        verify(client, never()).deleteObject(any(DeleteObjectRequest.class));
        verifyNoInteractions(signer);
    }

    @Test void unsafePageRequestsNeverReachTheSdk() {
        for (int limit : new int[] { -1, 0, 101, Integer.MAX_VALUE }) {
            assertThatThrownBy(() -> storage.deletionLedger(null, limit)).isInstanceOf(IllegalArgumentException.class);
        }
        for (String cursor : new String[] { "", " ", "x".repeat(4097) }) {
            assertThatThrownBy(() -> storage.deletionLedger(cursor, 1)).isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(client, signer);
    }

    @Test void excessiveItemsAndMalformedObjectKeysAreRejectedBeforeAnyBodyRead() {
        when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder()
                .contents(Collections.nCopies(2, object(key(record)))).build());
        unavailable(() -> storage.deletionLedger(null, 1));
        for (String key : List.of("originals/" + record.assetId(), "deletions/v1/../../originals/private.json",
                "deletions/v1/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.json", "deletions/v1/nested/record.json")) {
            when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder().contents(object(key)).build());
            unavailable(() -> storage.deletionLedger(null, 1));
        }
        verify(client, never()).getObject(any(GetObjectRequest.class));
        verify(client, never()).deleteObject(any(DeleteObjectRequest.class));
    }

    @Test void incompleteRepeatedOrOversizedContinuationTokensCannotPretendReplayFinished() {
        for (String next : new String[] { null, "", " ", "current-fixture", "x".repeat(4097) }) {
            when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder()
                    .isTruncated(true).nextContinuationToken(next).build());
            unavailable(() -> storage.deletionLedger("current-fixture", 1));
        }
        verify(client, never()).getObject(any(GetObjectRequest.class));
        verifyNoInteractions(signer);
    }

    @Test void mismatchedBodyIdentityAndStrictParserFailuresPreventAnyErasure() {
        when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder().contents(object(key(record))).build());
        when(client.getObject(any(GetObjectRequest.class))).thenAnswer(ignored -> stream(record().encode()));
        unavailable(() -> storage.deletionLedger(null, 1));
        String valid = new String(record.encode(), StandardCharsets.UTF_8);
        for (String invalid : List.of(valid + " {}", valid.replace("\"version\":1", "\"version\":1,\"version\":1"), "{\"private\":\"fixture-secret\"}")) {
            when(client.getObject(any(GetObjectRequest.class))).thenAnswer(ignored -> stream(invalid.getBytes(StandardCharsets.UTF_8)));
            unavailable(() -> storage.deletionLedger(null, 1));
        }
        verify(client, never()).deleteObject(any(DeleteObjectRequest.class));
    }

    @Test void oversizedBodiesReadAtMostTheBoundPlusOneAndAbortTheRemainingStream() throws IOException {
        var input = new CountingInputStream(new byte[DeletionRecord.MAX_BYTES + 10_000]);
        var response = spy(new ResponseInputStream<>(GetObjectResponse.builder().build(), AbortableInputStream.create(input)));
        when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder().contents(object(key(record))).build());
        when(client.getObject(any(GetObjectRequest.class))).thenReturn(response);
        unavailable(() -> storage.deletionLedger(null, 1));
        assertThat(input.count).isEqualTo(DeletionRecord.MAX_BYTES + 1);
        verify(response).abort();
        verify(response).close();
    }

    @Test void unreadableLedgerBodiesAndListErrorsHaveSafeErrorsWithoutPrivateDiagnostics() {
        when(client.listObjectsV2(any(ListObjectsV2Request.class))).thenThrow(s3(403, "AccessDenied"));
        unavailable(() -> storage.deletionLedger(null, 1));
        doReturn(ListObjectsV2Response.builder().contents(object(key(record))).build()).when(client).listObjectsV2(any(ListObjectsV2Request.class));
        InputStream failing = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("fixture-secret private body failure"); }
        };
        when(client.getObject(any(GetObjectRequest.class))).thenReturn(new ResponseInputStream<>(GetObjectResponse.builder().build(), AbortableInputStream.create(failing)));
        unavailable(() -> storage.deletionLedger(null, 1));
    }

    @Test void objectDeletesCanOnlyDeriveOneOriginalOrStagingKeyAndNeverTouchTheLedger() {
        UUID grant = UUID.randomUUID();
        storage.deleteRetainedOriginal(record.assetId());
        storage.deleteRetainedStaging(grant);
        var requests = ArgumentCaptor.forClass(DeleteObjectRequest.class);
        verify(client, times(2)).deleteObject(requests.capture());
        assertThat(requests.getAllValues()).extracting(DeleteObjectRequest::key)
                .containsExactly("originals/" + record.assetId(), "staging/" + grant);
        assertThat(requests.getAllValues()).extracting(DeleteObjectRequest::bucket).containsOnly("private-test");
        verifyNoMoreInteractions(client);
        verifyNoInteractions(signer);
    }

    @Test void onlyAnExplicitMissingObjectIsAnIdempotentSuccess() {
        when(client.deleteObject(any(DeleteObjectRequest.class))).thenThrow(s3(404, "NoSuchKey"));
        storage.deleteRetainedOriginal(record.assetId());
        for (RuntimeException failure : List.of(s3(404, "NoSuchBucket"), s3(403, "AccessDenied"), s3(500, "InternalError"),
                SdkClientException.create("fixture-secret private credential failure"))) {
            doThrow(failure).when(client).deleteObject(any(DeleteObjectRequest.class));
            unavailable(() -> storage.deleteRetainedOriginal(record.assetId()));
        }
        verify(client, never()).getObject(any(GetObjectRequest.class));
        verifyNoInteractions(signer);
    }

    private static void unavailable(ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOf(ApiException.class).hasNoCause()
                .hasMessage("Retention maintenance could not be confirmed. No successful purge is reported.")
                .satisfies(failure -> {
                    assertThat(((ApiException) failure).status()).isEqualTo(503);
                    assertThat(((ApiException) failure).code()).isEqualTo("RETENTION_UNAVAILABLE");
                });
    }
    private static DeletionRecord record() {
        Instant now = Instant.parse("2026-10-09T12:00:00.123456Z");
        return new DeletionRecord(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                SubmissionKeyDigest.sha256(UUID.randomUUID().toString()), now.minusSeconds(1), now);
    }
    private static String key(DeletionRecord record) { return "deletions/v1/" + record.memoryId() + ".json"; }
    private static S3Object object(String key) { return S3Object.builder().key(key).build(); }
    private static ResponseInputStream<GetObjectResponse> stream(byte[] bytes) {
        return new ResponseInputStream<>(GetObjectResponse.builder().build(), AbortableInputStream.create(new ByteArrayInputStream(bytes)));
    }
    private static S3Exception s3(int status, String code) {
        S3Exception.Builder builder = S3Exception.builder();
        builder.statusCode(status).message("fixture-secret private provider failure")
                .awsErrorDetails(AwsErrorDetails.builder().errorCode(code).build());
        return (S3Exception) builder.build();
    }
    private static final class CountingInputStream extends ByteArrayInputStream {
        int count;
        CountingInputStream(byte[] bytes) { super(bytes); }
        @Override public synchronized int read(byte[] bytes, int offset, int length) {
            int read = super.read(bytes, offset, length);
            if (read > 0) count += read;
            return read;
        }
    }
}
