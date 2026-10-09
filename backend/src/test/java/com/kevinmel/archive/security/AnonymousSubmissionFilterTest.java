package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

class AnonymousSubmissionFilterTest {
    private final AnonymousThrottle throttle = mock(AnonymousThrottle.class);
    private final AnonymousSubmissionFilter filter = new AnonymousSubmissionFilter(throttle,
            new SecurityErrorWriter(JsonMapper.builder().build()));
    private final String key = UUID.randomUUID().toString();

    @Test void admittedBodyAndCanonicalRetryKeyReachTheControllerUnchanged() throws Exception {
        String body = "{\"message\":\"Unicode 🥂 and <script>literal text</script>\"}";
        var request = request("POST", "/api/contributions", body.getBytes(StandardCharsets.UTF_8), false);
        request.removeHeader("Idempotency-Key");
        request.addHeader("Idempotency-Key", key.toUpperCase());
        var reached = new AtomicBoolean();
        filter.doFilter(request, new MockHttpServletResponse(), (wrapped, response) -> {
            assertThat(wrapped.getInputStream().readAllBytes()).isEqualTo(body.getBytes(StandardCharsets.UTF_8));
            assertThat(wrapped.getContentLengthLong()).isEqualTo(body.getBytes(StandardCharsets.UTF_8).length);
            reached.set(true);
        });
        assertThat(reached).isTrue();
        verify(throttle).reserve(eq(AnonymousThrottle.Operation.CREATE), eq(key), same(request));
    }

    @Test void knownAndChunkedOversizedBodiesNeverReachMvc() throws Exception {
        for (boolean chunked : List.of(false, true)) {
            for (String path : List.of("/api/contributions", "/api/contributions/a/memories/b/finalize")) {
                int limit = path.endsWith("finalize") ? AnonymousSubmissionFilter.MAX_FINALIZE_BYTES
                        : AnonymousSubmissionFilter.MAX_CONTRIBUTION_BYTES;
                var response = invoke(request("POST", path, new byte[limit + 1], chunked), false);
                assertThat(response.getStatus()).isEqualTo(413);
                assertThat(response.getContentAsString()).contains("PAYLOAD_TOO_LARGE").doesNotContain(key);
                assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
            }
        }
    }

    @Test void exactBodyBoundariesCanBeReadAfterAdmission() throws Exception {
        for (boolean chunked : List.of(false, true)) {
            for (String path : List.of("/api/contributions", "/api/contributions/a/memories/b/finalize")) {
                int limit = path.endsWith("finalize") ? AnonymousSubmissionFilter.MAX_FINALIZE_BYTES
                        : AnonymousSubmissionFilter.MAX_CONTRIBUTION_BYTES;
                byte[] bytes = new byte[limit];
                var reached = new AtomicBoolean();
                filter.doFilter(request("POST", path, bytes, chunked), new MockHttpServletResponse(), (wrapped, response) -> {
                    assertThat(wrapped.getInputStream().readAllBytes()).hasSize(limit);
                    reached.set(true);
                });
                assertThat(reached).isTrue();
            }
        }
    }

    @Test void bodylessRoutesRejectKnownAndChunkedRequestBodies() throws Exception {
        for (boolean chunked : List.of(false, true)) {
            for (String path : List.of("/api/contributions/a/receipt", "/api/contributions/a/memories/b/upload-grants")) {
                var response = invoke(request(path.endsWith("receipt") ? "GET" : "POST", path, new byte[]{1}, chunked), false);
                assertThat(response.getStatus()).isEqualTo(400);
                assertThat(response.getContentAsString()).contains("VALIDATION_FAILED");
            }
        }
    }

    @Test void everyAnonymousRouteReturnsRetryAfterWithoutInvokingTheController() throws Exception {
        when(throttle.reserve(any(), anyString(), any())).thenReturn(17L);
        for (String path : List.of("/api/contributions", "/api/contributions/a/receipt",
                "/api/contributions/a/memories/b/upload-grants", "/api/contributions/a/memories/b/finalize")) {
            var response = invoke(request(path.endsWith("receipt") ? "GET" : "POST", path, new byte[0], false), false);
            assertThat(response.getStatus()).isEqualTo(429);
            assertThat(response.getHeader("Retry-After")).isEqualTo("17");
            assertThat(response.getHeader("X-Request-ID")).isNotBlank();
            assertThat(response.getContentAsString()).contains("RATE_LIMITED").doesNotContain(key, "staging/", "originals/");
        }
    }

    @Test void databaseFailureClosesAdmissionAndRedactsDiagnostics() throws Exception {
        when(throttle.reserve(any(), anyString(), any())).thenThrow(
                new DataAccessResourceFailureException("SQL with private name and key " + key));
        var response = invoke(request("POST", "/api/contributions", new byte[0], false), false);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("SERVICE_UNAVAILABLE").doesNotContain("SQL", "private name", key);
    }

    @Test void invalidCapabilitiesAndCrossSiteRequestsCannotReserveOrReachMvc() throws Exception {
        var wrongKey = request("POST", "/api/contributions", new byte[0], false);
        wrongKey.removeHeader("Idempotency-Key");
        wrongKey.addHeader("Idempotency-Key", "private-invalid-key");
        assertThat(invoke(wrongKey, false).getStatus()).isEqualTo(400);
        var crossSite = request("POST", "/api/contributions", new byte[0], false);
        crossSite.addHeader("Origin", "https://other.example");
        assertThat(invoke(crossSite, false).getStatus()).isEqualTo(403);
        verifyNoInteractions(throttle);
    }

    @Test void encodedGuestPathsAreClassifiedAndPrivatePathsKeepTheirOwnAuthorization() throws Exception {
        var encoded = request("POST", "/api/%63ontributions", new byte[0], false);
        assertThat(AnonymousSubmissionFilter.operation(encoded)).isEqualTo(AnonymousThrottle.Operation.CREATE);
        for (String path : List.of("/api/health", "/api/session", "/api/memories", "/assets/app.js")) {
            invoke(request("GET", path, new byte[0], false), true);
        }
        verifyNoInteractions(throttle);
    }

    private MockHttpServletRequest request(String method, String path, byte[] bytes, boolean chunked) {
        var request = chunked ? new MockHttpServletRequest(method, path) {
            @Override public long getContentLengthLong() { return -1; }
            @Override public int getContentLength() { return -1; }
        } : new MockHttpServletRequest(method, path);
        request.addHeader("X-Api-Contract", "1");
        request.addHeader("Idempotency-Key", key);
        request.setContentType("application/json");
        request.setContent(bytes);
        return request;
    }

    private MockHttpServletResponse invoke(HttpServletRequest request, boolean expectedController) throws Exception {
        var response = new MockHttpServletResponse();
        var reached = new AtomicBoolean();
        filter.doFilter(request, response, (wrapped, result) -> reached.set(true));
        assertThat(reached.get()).isEqualTo(expectedController);
        return response;
    }
}
