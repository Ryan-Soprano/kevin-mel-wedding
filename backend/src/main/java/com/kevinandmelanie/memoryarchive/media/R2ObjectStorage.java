package com.kevinandmelanie.memoryarchive.media;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/** Privileged credentials stay in the server; only five-minute staging PUT URLs leave it. */
public final class R2ObjectStorage implements ObjectStorage, AutoCloseable {
    private final String bucket;
    private final S3Client s3;
    private final S3Presigner signer;

    R2ObjectStorage(URI endpoint, String bucket, String access, String secret) {
        this.bucket = bucket;
        var credentials = StaticCredentialsProvider.create(AwsBasicCredentials.create(access, secret));
        var configuration = S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build();
        s3 = S3Client.builder().endpointOverride(endpoint).region(Region.of("auto")).credentialsProvider(credentials)
                .serviceConfiguration(configuration)
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3))
                        .socketTimeout(Duration.ofSeconds(10)))
                .overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(15))).build();
        signer = S3Presigner.builder().endpointOverride(endpoint).region(Region.of("auto"))
                .credentialsProvider(credentials).serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(true).checksumValidationEnabled(false).build()).build();
    }

    public void requireAvailable() { /* Configured. Connection health is established by actual IO. */ }

    public UploadGrant authorize(UUID id, String key, String type, Instant expires) {
        if (!key.equals("staging/" + id) || !PhotoRequest.TYPES.contains(type)) throw new IllegalArgumentException("Invalid upload scope.");
        long seconds = Math.min(300, Duration.between(Instant.now(), expires).getSeconds());
        if (seconds < 1) throw StorageConfiguration.unavailable();
        try {
            var signed = signer.presignPutObject(PutObjectPresignRequest.builder()
                    .signatureDuration(Duration.ofSeconds(seconds))
                    .putObjectRequest(PutObjectRequest.builder().bucket(bucket).key(key).contentType(type).build()).build());
            return new UploadGrant(id, "PUT", signed.url().toString(), expires, Map.of("Content-Type", type));
        } catch (SdkException failure) { throw StorageConfiguration.unavailable(); }
    }

    public Optional<byte[]> read(String key, int maxBytes) {
        checkKey(key);
        try (var stream = s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())) {
            byte[] bytes = stream.readNBytes(maxBytes + 1);
            if (bytes.length > maxBytes) stream.abort();
            return Optional.of(bytes);
        } catch (S3Exception failure) {
            if (failure.statusCode() == 404) return Optional.empty();
            throw StorageConfiguration.unavailable();
        } catch (SdkException | IOException failure) { throw StorageConfiguration.unavailable(); }
    }

    public void publish(String key, byte[] bytes, String type) {
        checkKey(key);
        if (!key.startsWith("originals/") || bytes.length > PhotoRequest.MAX_BYTES || !PhotoRequest.TYPES.contains(type)) {
            throw new IllegalArgumentException("Invalid original scope.");
        }
        try {
            s3.putObject(PutObjectRequest.builder().bucket(bucket).key(key).contentType(type)
                    .contentLength((long) bytes.length).build(), RequestBody.fromBytes(bytes));
        } catch (SdkException failure) { throw StorageConfiguration.unavailable(); }
    }

    private static void checkKey(String key) {
        if (!key.matches("(staging|originals)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw new IllegalArgumentException("Invalid object scope.");
        }
    }
    @Override public void close() { signer.close(); s3.close(); }
}
