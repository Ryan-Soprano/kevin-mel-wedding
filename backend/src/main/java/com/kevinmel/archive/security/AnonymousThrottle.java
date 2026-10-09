package com.kevinmel.archive.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import java.util.List;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.kevinmel.archive.contribution.ContributionService;

/** Guest limits tolerate a shared wedding network without trusting caller forwarding headers. */
@Component
public class AnonymousThrottle {
    public enum Operation {
        CREATE(800, 400, 12), GRANT(1500, 1000, 40), FINALIZE(2000, 1500, 60), RECEIPT(3000, 2000, 100);

        private final int globalLimit;
        private final int peerLimit;
        private final int keyLimit;

        Operation(int globalLimit, int peerLimit, int keyLimit) {
            this.globalLimit = globalLimit;
            this.peerLimit = peerLimit;
            this.keyLimit = keyLimit;
        }

        int globalLimit() { return globalLimit; }
        int peerLimit() { return peerLimit; }
        int keyLimit() { return keyLimit; }
    }

    private final AnonymousThrottleRepository repository;
    private final byte[] secret;

    public AnonymousThrottle(AnonymousThrottleRepository repository, ArchiveAccessPolicy policy,
            @Value("${archive.login-throttle-secret:}") String configuredSecret) {
        this.repository = repository;
        if (policy.production() && configuredSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("Production guest throttling requires a secret of at least 32 bytes.");
        }
        secret = (configuredSecret.isEmpty() ? "local-auth-throttle-key-for-synthetic-use-only" : configuredSecret)
                .getBytes(StandardCharsets.UTF_8);
    }

    /** Zero admits the request; a positive value is the database window's remaining Retry-After seconds. */
    public long reserve(Operation operation, String retryKey, HttpServletRequest request) {
        String canonicalKey = ContributionService.validateHeaders("1", retryKey);
        String peer = RequestPeerCapture.requirePeer(request);
        String domain = "anonymous:v1:" + operation.name() + ":";
        return repository.reserve(List.of(
                new AnonymousThrottleRepository.Bucket(digest(domain + "global"), operation.globalLimit()),
                new AnonymousThrottleRepository.Bucket(digest(domain + "peer:" + peer), operation.peerLimit()),
                new AnonymousThrottleRepository.Bucket(digest(domain + "key:" + canonicalKey), operation.keyLimit())));
    }

    private String digest(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException("Required digest unavailable.", impossible);
        }
    }
}
