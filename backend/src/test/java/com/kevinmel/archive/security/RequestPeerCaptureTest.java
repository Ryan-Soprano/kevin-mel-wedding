package com.kevinmel.archive.security;

import java.util.ArrayList;
import java.util.List;
import jakarta.servlet.ServletRequestEvent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.ForwardedHeaderFilter;
import com.kevinmel.archive.web.ApiException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RequestPeerCaptureTest {
    private final RequestPeerCapture listener = new RequestPeerCapture();
    private final RecordingRepository repository = new RecordingRepository();
    private final LoginThrottle throttle = new LoginThrottle(repository,
            new ArchiveAccessPolicy("local", false, false, "", new MockEnvironment()),
            "synthetic-peer-capture-test-secret");

    @Test
    void xForwardedForCannotChangeTheConnectionPeerBucket() throws Exception {
        forwardedAttempt("192.0.2.10", "X-Forwarded-For", "198.51.100.10", "198.51.100.10");
        forwardedAttempt("192.0.2.10", "X-Forwarded-For", "203.0.113.20", "203.0.113.20");
        assertThat(repository.reservations.get(0)).isEqualTo(repository.reservations.get(1));
        assertThat(repository.reservations.get(0)).allMatch(key -> key.matches("[0-9a-f]{64}"));
    }

    @Test
    void standardForwardedCannotChangeTheConnectionPeerBucket() throws Exception {
        forwardedAttempt("192.0.2.10", "Forwarded", "for=198.51.100.10;proto=https", "198.51.100.10");
        forwardedAttempt("192.0.2.10", "Forwarded", "for=203.0.113.20;proto=https", "203.0.113.20");
        assertThat(repository.reservations.get(0)).isEqualTo(repository.reservations.get(1));
    }

    @Test
    void differentConnectionPeersKeepDistinctBucketsDespiteMatchingForwardedAddresses() throws Exception {
        forwardedAttempt("192.0.2.10", "X-Forwarded-For", "198.51.100.10", "198.51.100.10");
        forwardedAttempt("192.0.2.11", "X-Forwarded-For", "198.51.100.10", "198.51.100.10");
        assertThat(repository.reservations.get(0).get(0)).isEqualTo(repository.reservations.get(1).get(0));
        assertThat(repository.reservations.get(0).get(1)).isNotEqualTo(repository.reservations.get(1).get(1));
    }

    @Test
    void missingOrInvalidCaptureFailsClosedWithoutReservingOrTrustingAForwardedAddress() throws Exception {
        var missing = new MockHttpServletRequest();
        missing.setRemoteAddr("192.0.2.10");
        missing.addHeader("X-Forwarded-For", "198.51.100.10");
        new ForwardedHeaderFilter().doFilter(missing, new MockHttpServletResponse(), (request, response) ->
                denied((HttpServletRequest) request));

        var invalid = new MockHttpServletRequest();
        invalid.setRemoteAddr("");
        listener.requestInitialized(event(invalid));
        denied(invalid);
        assertThat(repository.reservations).isEmpty();
    }

    @Test
    void captureIsRemovedWhenTheRequestFinishes() {
        var request = new MockHttpServletRequest();
        listener.requestInitialized(event(request));
        throttle.reserve("synthetic-couple", request, new MockHttpServletResponse());
        listener.requestDestroyed(event(request));
        denied(request);
        assertThat(repository.reservations).hasSize(1);
    }

    private void forwardedAttempt(String connectionPeer, String header, String value, String effectiveAddress) throws Exception {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr(connectionPeer);
        request.addHeader(header, value);
        listener.requestInitialized(event(request));
        new ForwardedHeaderFilter().doFilter(request, new MockHttpServletResponse(), (wrapped, response) -> {
            var forwarded = (HttpServletRequest) wrapped;
            assertThat(forwarded.getRemoteAddr()).isEqualTo(effectiveAddress);
            throttle.reserve("synthetic-couple", forwarded, (HttpServletResponse) response);
        });
        listener.requestDestroyed(event(request));
    }

    private void denied(HttpServletRequest request) {
        assertThatThrownBy(() -> throttle.reserve("synthetic-couple", request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(503);
                    assertThat(failure.code()).isEqualTo("SERVICE_UNAVAILABLE");
                    assertThat(failure.getMessage()).doesNotContain("192.0.2.", "198.51.100.", "203.0.113.");
                });
    }

    private ServletRequestEvent event(MockHttpServletRequest request) {
        return new ServletRequestEvent(request.getServletContext(), request);
    }

    private static final class RecordingRepository extends LoginThrottleRepository {
        private final List<List<String>> reservations = new ArrayList<>();
        RecordingRepository() { super(null); }
        @Override public boolean reserve(List<String> keys) {
            reservations.add(List.copyOf(keys));
            return true;
        }
    }
}
