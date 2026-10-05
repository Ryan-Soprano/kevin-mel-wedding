package com.kevinmel.archive.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import java.util.List;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;

import com.kevinmel.archive.web.ApiException;

@Component
public class LoginThrottle {
    private final LoginThrottleRepository repository;
    private final byte[] key;
    public LoginThrottle(LoginThrottleRepository repository, ArchiveAccessPolicy policy,
            @Value("${archive.login-throttle-secret:}") String configuredSecret) {
        this.repository = repository;
        if (policy.production() && configuredSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("Production login throttling requires a secret of at least 32 bytes.");
        }
        // This fallback is for local synthetic exercises; production always requires an operator-supplied secret.
        this.key = (configuredSecret.isEmpty() ? "local-auth-throttle-key-for-synthetic-use-only" : configuredSecret)
                .getBytes(StandardCharsets.UTF_8);
    }

    public void reserve(String username, HttpServletRequest request, HttpServletResponse response) {
        // Capture before forwarding filters; request.getRemoteAddr() may already reflect caller headers.
        String connectionPeer = RequestPeerCapture.requirePeer(request);
        if (!repository.reserve(List.of(digest("username:" + username), digest("address:" + connectionPeer)))) {
            response.setHeader("Retry-After", "900");
            throw new ApiException(429, "RATE_LIMITED", "Please wait before trying to sign in again.");
        }
    }

    private String digest(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException("Required digest unavailable.", impossible);
        }
    }
}
