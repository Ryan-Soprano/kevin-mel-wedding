package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.ServletRequestEvent;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.ForwardedHeaderFilter;

import com.kevinmel.archive.web.ApiException;

class AnonymousThrottleTest {
    private static final String SECRET = "synthetic-anonymous-throttle-secret";
    private final RecordingRepository repository = new RecordingRepository();
    private final AnonymousThrottle throttle = throttle(repository, SECRET);
    private final RequestPeerCapture capture = new RequestPeerCapture();
    private final String key = UUID.randomUUID().toString();

    @Test void canonicalRetryKeysAndStableSecretsSurviveNewThrottleInstances() {
        var request = captured("192.0.2.10");
        throttle.reserve(AnonymousThrottle.Operation.CREATE, key, request);
        throttle(repository, SECRET).reserve(AnonymousThrottle.Operation.CREATE, key.toUpperCase(), request);
        assertThat(repository.reservations.get(0)).isEqualTo(repository.reservations.get(1));
        assertThat(repository.reservations.get(0)).extracting(AnonymousThrottleRepository.Bucket::key)
                .allMatch(value -> value.matches("[0-9a-f]{64}"));
        assertThat(repository.reservations.get(0).toString()).doesNotContain(key, "192.0.2.10", SECRET);
    }

    @Test void operationScopesAreSeparateAndDifferentPeersCannotChangeTheGlobalOrKeyBucket() {
        throttle.reserve(AnonymousThrottle.Operation.CREATE, key, captured("192.0.2.10"));
        throttle.reserve(AnonymousThrottle.Operation.CREATE, key, captured("192.0.2.11"));
        var first = repository.reservations.get(0);
        var second = repository.reservations.get(1);
        assertThat(first.get(0)).isEqualTo(second.get(0));
        assertThat(first.get(1)).isNotEqualTo(second.get(1));
        assertThat(first.get(2)).isEqualTo(second.get(2));
        throttle.reserve(AnonymousThrottle.Operation.GRANT, key, captured("192.0.2.10"));
        assertThat(repository.reservations.get(2)).extracting(AnonymousThrottleRepository.Bucket::key)
                .doesNotContainAnyElementsOf(first.stream().map(AnonymousThrottleRepository.Bucket::key).toList());
    }

    @Test void callerForwardedHeadersCannotRotateTheCapturedPeerBucket() throws Exception {
        for (String header : List.of("X-Forwarded-For", "Forwarded")) {
            for (String forwarded : List.of("198.51.100.10", "203.0.113.20")) {
                var request = captured("192.0.2.10");
                request.addHeader(header, header.equals("Forwarded") ? "for=" + forwarded + ";proto=https" : forwarded);
                new ForwardedHeaderFilter().doFilter(request, new MockHttpServletResponse(), (wrapped, response) -> {
                    assertThat(((HttpServletRequest) wrapped).getRemoteAddr()).isEqualTo(forwarded);
                    throttle.reserve(AnonymousThrottle.Operation.CREATE, key, (HttpServletRequest) wrapped);
                });
            }
        }
        assertThat(repository.reservations).hasSize(4).allMatch(value -> value.equals(repository.reservations.getFirst()));
    }

    @Test void missingCaptureAndInvalidRetryKeysFailBeforeAnyDatabaseReservation() {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");
        request.addHeader("X-Forwarded-For", "198.51.100.10");
        assertThatThrownBy(() -> throttle.reserve(AnonymousThrottle.Operation.CREATE, key, request))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(503);
                    assertThat(failure.getMessage()).doesNotContain("192.0.2.10", "198.51.100.10", key);
                });
        assertThatThrownBy(() -> throttle.reserve(AnonymousThrottle.Operation.CREATE, "not-a-capability", captured("192.0.2.10")))
                .isInstanceOfSatisfying(ApiException.class, failure -> assertThat(failure.status()).isEqualTo(400));
        assertThat(repository.reservations).isEmpty();
    }

    @Test void productionRequiresAtLeastThirtyTwoSecretBytesAndDatabaseRetryAfterIsPreserved() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("production");
        var policy = new ArchiveAccessPolicy("production", false, true, "https://archive.example", environment);
        assertThatThrownBy(() -> new AnonymousThrottle(repository, policy, "short"))
                .isInstanceOf(IllegalArgumentException.class);
        var production = new AnonymousThrottle(repository, policy, "x".repeat(32));
        repository.retryAfter = 37;
        assertThat(production.reserve(AnonymousThrottle.Operation.RECEIPT, key, captured("192.0.2.10"))).isEqualTo(37);
    }

    private MockHttpServletRequest captured(String peer) {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr(peer);
        capture.requestInitialized(new ServletRequestEvent(request.getServletContext(), request));
        return request;
    }

    private static AnonymousThrottle throttle(AnonymousThrottleRepository target, String secret) {
        return new AnonymousThrottle(target,
                new ArchiveAccessPolicy("local", false, false, "", new MockEnvironment()), secret);
    }

    private static final class RecordingRepository extends AnonymousThrottleRepository {
        private final List<List<Bucket>> reservations = new ArrayList<>();
        private long retryAfter;
        private RecordingRepository() { super(null); }
        @Override public long reserve(List<Bucket> buckets) {
            reservations.add(List.copyOf(buckets));
            return retryAfter;
        }
    }
}
