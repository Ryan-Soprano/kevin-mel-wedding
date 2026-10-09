package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import com.kevinmel.archive.web.ApiException;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

class R2ObjectStorageTest {
    @Test void privateGetHeadsTheExactOriginalBeforeSigningItsScopeMetadataAndActualExpiry() throws Exception {
        var client = mock(S3Client.class);
        var signer = spy(syntheticSigner());
        var observedSigned = new AtomicReference<PresignedGetObjectRequest>();
        doAnswer(invocation -> {
            var signed = (PresignedGetObjectRequest) invocation.callRealMethod();
            observedSigned.set(signed);
            return signed;
        }).when(signer).presignGetObject(any(GetObjectPresignRequest.class));
        UUID id = UUID.randomUUID();
        String key = "originals/" + id;
        when(client.headObject(any(HeadObjectRequest.class))).thenReturn(
                HeadObjectResponse.builder().contentLength(41L).contentType("image/png").build());
        try (var storage = new R2ObjectStorage("private-test", client, signer)) {
            var grant = storage.authorizeRead(key, "image/png", 41, Instant.now().plusSeconds(900));
            var uri = URI.create(grant.url());
            assertThat(uri.getScheme()).isEqualTo("https");
            assertThat(uri.getHost()).isEqualTo("media.example.test");
            assertThat(uri.getRawUserInfo()).isNull();
            assertThat(uri.getPath()).isEqualTo("/private-test/" + key);
            String query = URLDecoder.decode(uri.getRawQuery(), java.nio.charset.StandardCharsets.UTF_8);
            assertThat(query).contains("X-Amz-Expires=300", "X-Amz-SignedHeaders=host", "X-Amz-Signature=",
                    "response-cache-control=no-store", "response-content-type=image/png",
                    "response-content-disposition=inline; filename=\"photo-" + id + ".png\"");
            assertThat(query).doesNotContain("fixture-secret", "staging/", "filename-from-a-guest");
            assertThat(observedSigned.get().httpRequest().method().name()).isEqualTo("GET");
            assertThat(grant.expiresAt()).isEqualTo(observedSigned.get().expiration());
            assertThat(grant.toString()).contains("<redacted>").doesNotContain(
                    grant.url(), "fixture-access", "fixture-secret", "X-Amz", "originals/", id.toString());

            var head = ArgumentCaptor.forClass(HeadObjectRequest.class);
            var presign = ArgumentCaptor.forClass(GetObjectPresignRequest.class);
            var order = inOrder(client, signer);
            order.verify(client).headObject(head.capture());
            order.verify(signer).presignGetObject(presign.capture());
            assertThat(head.getValue().bucket()).isEqualTo("private-test");
            assertThat(head.getValue().key()).isEqualTo(key);
            assertThat(presign.getValue().getObjectRequest().bucket()).isEqualTo("private-test");
            assertThat(presign.getValue().getObjectRequest().key()).isEqualTo(key);
            assertThat(presign.getValue().signatureDuration().getSeconds()).isBetween(1L, 300L);
        }
    }

    @Test void verifiedPhotoTypesUseOnlySafeConstantInlineFilenames() throws Exception {
        for (var type : Map.of("image/jpeg", "jpg", "image/png", "png", "image/webp", "webp").entrySet()) {
            var client = mock(S3Client.class);
            when(client.headObject(any(HeadObjectRequest.class))).thenReturn(
                    HeadObjectResponse.builder().contentLength((long) PhotoRequest.MAX_BYTES).contentType(type.getKey()).build());
            try (var storage = new R2ObjectStorage("private-test", client, syntheticSigner())) {
                UUID id = UUID.randomUUID();
                var grant = storage.authorizeRead("originals/" + id, type.getKey(), PhotoRequest.MAX_BYTES,
                        Instant.now().plusSeconds(120));
                String query = URLDecoder.decode(URI.create(grant.url()).getRawQuery(), java.nio.charset.StandardCharsets.UTF_8);
                assertThat(query).contains("response-content-type=" + type.getKey(),
                        "response-content-disposition=inline; filename=\"photo-" + id + "." + type.getValue() + "\"");
                int seconds = Integer.parseInt(Arrays.stream(query.split("&"))
                        .filter(value -> value.startsWith("X-Amz-Expires=")).findFirst().orElseThrow().split("=")[1]);
                assertThat(seconds).isBetween(1, 120);
            }
        }
    }

    @Test void invalidPrivateScopeMetadataAndExpiredRequestsNeverReachStorageOrSigner() throws Exception {
        var client = mock(S3Client.class);
        var signer = mock(S3Presigner.class);
        String original = "originals/" + UUID.randomUUID();
        try (var storage = new R2ObjectStorage("private-test", client, signer)) {
            for (String key : Arrays.asList(null, "staging/" + UUID.randomUUID(), "../../private",
                    original + "/child", original + "?secret=fixture-secret", original.toUpperCase(Locale.ROOT),
                    "originals/11111111-1111-1111-8111-111111111111")) {
                assertPrivateUnavailable(() -> storage.authorizeRead(key, "image/png", 41, Instant.now().plusSeconds(300)));
            }
            for (String type : Arrays.asList(null, "image/gif", "image/png; charset=utf-8", "audio/webm")) {
                assertPrivateUnavailable(() -> storage.authorizeRead(original, type, 41, Instant.now().plusSeconds(300)));
            }
            for (long size : new long[]{-1, 0, PhotoRequest.MAX_BYTES + 1L}) {
                assertPrivateUnavailable(() -> storage.authorizeRead(original, "image/png", size, Instant.now().plusSeconds(300)));
            }
            assertPrivateUnavailable(() -> storage.authorizeRead(original, "image/png", 41, null));
            assertPrivateUnavailable(() -> storage.authorizeRead(original, "image/png", 41, Instant.now().minusSeconds(1)));
            assertPrivateUnavailable(() -> storage.authorizeRead(original, "image/png", 41, Instant.now().plusMillis(500)));
            verifyNoInteractions(client, signer);
        }
    }

    @Test void missingMismatchedHeadMetadataNeverReceivesAReadGrant() throws Exception {
        for (var response : Arrays.asList(
                HeadObjectResponse.builder().contentLength(42L).contentType("image/png").build(),
                HeadObjectResponse.builder().contentLength(41L).contentType("image/jpeg").build(),
                HeadObjectResponse.builder().contentLength(41L).build(),
                HeadObjectResponse.builder().contentType("image/png").build(), null)) {
            var client = mock(S3Client.class);
            var signer = mock(S3Presigner.class);
            when(client.headObject(any(HeadObjectRequest.class))).thenReturn(response);
            try (var storage = new R2ObjectStorage("private-test", client, signer)) {
                assertPrivateUnavailable(() -> storage.authorizeRead("originals/" + UUID.randomUUID(),
                        "image/png", 41, Instant.now().plusSeconds(300)));
                verify(client).headObject(any(HeadObjectRequest.class));
                verifyNoInteractions(signer);
            }
        }
    }

    @Test void missingDeniedAndUnavailableOriginalsHideSdkDetailsAndDoNotSign() throws Exception {
        for (var failure : List.of(
                S3Exception.builder().statusCode(404).message("fixture-access fixture-secret 404").build(),
                S3Exception.builder().statusCode(403).message("fixture-access fixture-secret 403").build(),
                S3Exception.builder().statusCode(500).message("fixture-access fixture-secret 500").build(),
                SdkClientException.create("fixture-access fixture-secret connection failed"))) {
            var client = mock(S3Client.class);
            var signer = mock(S3Presigner.class);
            when(client.headObject(any(HeadObjectRequest.class))).thenThrow(failure);
            try (var storage = new R2ObjectStorage("private-test", client, signer)) {
                assertPrivateUnavailable(() -> storage.authorizeRead("originals/" + UUID.randomUUID(),
                        "image/png", 41, Instant.now().plusSeconds(300)));
                verifyNoInteractions(signer);
            }
        }
    }

    @Test void failedSigningAndUnsafeSignedUrlsReturnOnlyPrivateMediaUnavailable() throws Exception {
        var client = mock(S3Client.class);
        when(client.headObject(any(HeadObjectRequest.class))).thenReturn(
                HeadObjectResponse.builder().contentLength(41L).contentType("image/png").build());
        var failedSigner = mock(S3Presigner.class);
        when(failedSigner.presignGetObject(any(GetObjectPresignRequest.class)))
                .thenThrow(SdkClientException.create("fixture-access fixture-secret signing failed"));
        try (var storage = new R2ObjectStorage("private-test", client, failedSigner)) {
            assertPrivateUnavailable(() -> storage.authorizeRead("originals/" + UUID.randomUUID(),
                    "image/png", 41, Instant.now().plusSeconds(300)));
        }

        for (String url : List.of("http://media.example.test/private?X-Amz-Signature=fixture-secret",
                "https://fixture-access:fixture-secret@media.example.test/private?X-Amz-Signature=fixture-secret",
                "https:///private?X-Amz-Signature=fixture-secret")) {
            var signer = mock(S3Presigner.class);
            var signed = mock(PresignedGetObjectRequest.class);
            when(signed.url()).thenReturn(URI.create(url).toURL());
            when(signed.expiration()).thenReturn(Instant.now().plusSeconds(300));
            when(signer.presignGetObject(any(GetObjectPresignRequest.class))).thenReturn(signed);
            try (var storage = new R2ObjectStorage("private-test", client, signer)) {
                assertPrivateUnavailable(() -> storage.authorizeRead("originals/" + UUID.randomUUID(),
                        "image/png", 41, Instant.now().plusSeconds(300)));
            }
        }
    }

    @Test void disabledStorageCannotAuthorizePrivateReads() {
        var disabled = new StorageConfiguration().disabledStorage();
        assertPrivateUnavailable(() -> disabled.authorizeRead("originals/" + UUID.randomUUID(),
                "image/png", 41, Instant.now().plusSeconds(300)));
    }

    @Test void signedExpiryMustBeFutureAndWithinBothRequestedAndFiveMinuteLimits() throws Exception {
        record ExpiryBounds(Instant signed, Instant requested) { }
        Instant now = Instant.now();
        for (var bounds : List.of(new ExpiryBounds(now.minusSeconds(1), now.plusSeconds(60)),
                new ExpiryBounds(now.plusSeconds(90), now.plusSeconds(60)),
                new ExpiryBounds(now.plusSeconds(400), now.plusSeconds(900)))) {
            var client = mock(S3Client.class);
            when(client.headObject(any(HeadObjectRequest.class))).thenReturn(
                    HeadObjectResponse.builder().contentLength(41L).contentType("image/png").build());
            var signer = mock(S3Presigner.class);
            var signed = mock(PresignedGetObjectRequest.class);
            when(signed.url()).thenReturn(URI.create("https://media.example.test/private?X-Amz-Signature=fixture-secret").toURL());
            when(signed.expiration()).thenReturn(bounds.signed());
            when(signer.presignGetObject(any(GetObjectPresignRequest.class))).thenReturn(signed);
            try (var storage = new R2ObjectStorage("private-test", client, signer)) {
                assertPrivateUnavailable(() -> storage.authorizeRead("originals/" + UUID.randomUUID(),
                        "image/png", 41, bounds.requested()));
            }
        }
    }

    private static S3Presigner syntheticSigner() {
        return S3Presigner.builder().endpointOverride(URI.create("https://media.example.test"))
                .region(Region.of("auto"))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("fixture-access", "fixture-secret")))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true)
                        .checksumValidationEnabled(false).build()).build();
    }

    private static void assertPrivateUnavailable(ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ApiException.class, failure -> {
            assertThat(failure.status()).isEqualTo(503);
            assertThat(failure.code()).isEqualTo("MEDIA_UNAVAILABLE");
            assertThat(failure.getMessage()).doesNotContain("fixture-access", "fixture-secret", "403", "404", "500", "https://");
            assertThat(failure.getCause()).isNull();
        });
    }

    @Test void signerRestrictsPutToOneStagingKeyContentTypeAndFiveMinutes() throws Exception {
        try (var storage = new R2ObjectStorage(URI.create("https://" + "a".repeat(32) + ".r2.cloudflarestorage.com"), "private-test", "fixture-access", "fixture-secret")) {
            UUID id = UUID.randomUUID();
            var grant = storage.authorize(id, "staging/" + id, "image/png", 41, Instant.now().plusSeconds(300));
            var uri = URI.create(grant.uploadUrl());
            assertThat(uri.getPath()).isEqualTo("/private-test/staging/" + id);
            var query = URLDecoder.decode(uri.getRawQuery(), java.nio.charset.StandardCharsets.UTF_8);
            assertThat(query).contains("X-Amz-Algorithm=AWS4-HMAC-SHA256", "X-Amz-SignedHeaders=content-length;content-type;host", "/auto/s3/aws4_request", "X-Amz-Signature=");
            assertThat(query).doesNotContain("fixture-secret", "checksum", "originals/");
            int seconds = Integer.parseInt(Arrays.stream(query.split("&")).filter(p -> p.startsWith("X-Amz-Expires=")).findFirst().orElseThrow().split("=")[1]);
            assertThat(seconds).isBetween(298, 300);
            assertThat(grant.headers()).isEqualTo(Map.of("Content-Type", "image/png"));
            assertThat(grant.toString()).contains("<redacted>").doesNotContain(
                    grant.uploadUrl(), "fixture-access", "fixture-secret", "X-Amz");
            assertThatThrownBy(() -> storage.authorize(id, "originals/" + id, "image/png", 41, Instant.now().plusSeconds(300))).isInstanceOf(IllegalArgumentException.class);
            for (long size : new long[]{0, -1, PhotoRequest.MAX_BYTES + 1L}) {
                assertThatThrownBy(() -> storage.authorize(id, "staging/" + id, "image/png", size,
                        Instant.now().plusSeconds(300))).isInstanceOf(IllegalArgumentException.class);
            }
        }
    }

    @Test void signedServerIoPreservesExactBytesBoundsReadsAndHidesFailures() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var uploaded = new AtomicReference<byte[]>(); var authorization = new AtomicReference<String>();
        var path = new AtomicReference<String>(); var cacheControl = new AtomicReference<String>();
        byte[] source = new byte[]{3, 1, 4, 1, 5};
        server.createContext("/", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization")); path.set(exchange.getRequestURI().getPath());
            if (exchange.getRequestMethod().equals("PUT")) {
                cacheControl.set(exchange.getRequestHeaders().getFirst("Cache-Control"));
                uploaded.set(exchange.getRequestBody().readAllBytes()); exchange.sendResponseHeaders(200, -1);
            } else {
                boolean missing = exchange.getRequestURI().getQuery() != null;
                int status = exchange.getRequestHeaders().containsKey("x-test") ? 500 : missing ? 404 : 200;
                exchange.sendResponseHeaders(status, source.length); exchange.getResponseBody().write(source);
            }
            exchange.close();
        });
        server.start();
        try (var storage = new R2ObjectStorage(URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "fixture-bucket", "fixture-access", "fixture-secret")) {
            String key = "originals/" + UUID.randomUUID();
            storage.publish(key, source, "image/png");
            assertThat(uploaded.get()).isEqualTo(source); assertThat(path.get()).isEqualTo("/fixture-bucket/" + key);
            assertThat(cacheControl.get()).isEqualTo("no-store");
            assertThat(authorization.get()).startsWith("AWS4-HMAC-SHA256 ").doesNotContain("fixture-secret");
            assertThat(storage.read(key, 10).orElseThrow()).isEqualTo(source);
            assertThat(storage.read(key, 2).orElseThrow()).hasSize(3);
            assertThatThrownBy(() -> storage.read("../../private", 10)).isInstanceOf(IllegalArgumentException.class);
            server.removeContext("/"); server.createContext("/", exchange -> { exchange.sendResponseHeaders(404, -1); exchange.close(); });
            assertThat(storage.read(key, 10)).isEmpty();
            server.removeContext("/"); server.createContext("/", exchange -> { exchange.sendResponseHeaders(403, -1); exchange.close(); });
            assertThatThrownBy(() -> storage.read(key, 10)).isInstanceOf(ApiException.class).satisfies(e -> {
                assertThat(((ApiException)e).status()).isEqualTo(503); assertThat(e.getMessage()).doesNotContain("fixture-access", "fixture-secret", "403");
            });
        } finally { server.stop(0); }
    }
}
