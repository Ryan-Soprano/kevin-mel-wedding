package com.kevinandmelanie.memoryarchive.media;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import com.kevinandmelanie.memoryarchive.web.ApiException;

class R2ObjectStorageTest {
    @Test void signerRestrictsPutToOneStagingKeyContentTypeAndFiveMinutes() throws Exception {
        try (var storage = new R2ObjectStorage(URI.create("https://" + "a".repeat(32) + ".r2.cloudflarestorage.com"), "private-test", "fixture-access", "fixture-secret")) {
            UUID id = UUID.randomUUID();
            var grant = storage.authorize(id, "staging/" + id, "image/png", Instant.now().plusSeconds(300));
            var uri = URI.create(grant.uploadUrl());
            assertThat(uri.getPath()).isEqualTo("/private-test/staging/" + id);
            var query = URLDecoder.decode(uri.getRawQuery(), java.nio.charset.StandardCharsets.UTF_8);
            assertThat(query).contains("X-Amz-Algorithm=AWS4-HMAC-SHA256", "X-Amz-SignedHeaders=content-type;host", "/auto/s3/aws4_request", "X-Amz-Signature=");
            assertThat(query).doesNotContain("fixture-secret", "checksum", "originals/");
            int seconds = Integer.parseInt(Arrays.stream(query.split("&")).filter(p -> p.startsWith("X-Amz-Expires=")).findFirst().orElseThrow().split("=")[1]);
            assertThat(seconds).isBetween(298, 300);
            assertThat(grant.headers()).isEqualTo(Map.of("Content-Type", "image/png"));
            assertThatThrownBy(() -> storage.authorize(id, "originals/" + id, "image/png", Instant.now().plusSeconds(300))).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void signedServerIoPreservesExactBytesBoundsReadsAndHidesFailures() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var uploaded = new AtomicReference<byte[]>(); var authorization = new AtomicReference<String>();
        var path = new AtomicReference<String>(); byte[] source = new byte[]{3, 1, 4, 1, 5};
        server.createContext("/", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization")); path.set(exchange.getRequestURI().getPath());
            if (exchange.getRequestMethod().equals("PUT")) {
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
