package com.kevinmel.archive.security;

import java.net.URI;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.RequestOrigin;

/** Couples own archive access; infrastructure and development roles do not. */
@Component
public class ArchiveAccessPolicy {
    private static final String PRODUCTION_PROFILE = "production";

    private final boolean production;
    private final boolean revealed;
    private final boolean secureCookie;
    private final String publicOrigin;

    public ArchiveAccessPolicy(
            @Value("${archive.environment:local}") String environment,
            @Value("${archive.revealed:false}") boolean revealed,
            @Value("${server.servlet.session.cookie.secure:false}") boolean secureCookie,
            @Value("${archive.public-origin:}") String publicOrigin,
            Environment springEnvironment) {
        if (!Set.of("local", "staging", PRODUCTION_PROFILE).contains(environment)) {
            throw new IllegalArgumentException("Use a documented archive environment.");
        }
        this.production = PRODUCTION_PROFILE.equals(environment);
        if (production != springEnvironment.acceptsProfiles(Profiles.of(PRODUCTION_PROFILE))) {
            throw new IllegalArgumentException("Production profile and archive environment must agree.");
        }
        this.revealed = revealed;
        this.secureCookie = secureCookie;
        this.publicOrigin = publicOrigin;
        requirePublicOrigin(publicOrigin);
        if (production && (!secureCookie || publicOrigin.isEmpty())) {
            throw new IllegalArgumentException("Production requires secure cookies and an explicit HTTPS public origin.");
        }
    }

    private static void requirePublicOrigin(String publicOrigin) {
        if (publicOrigin.isEmpty()) {
            return;
        }
        URI origin = URI.create(publicOrigin);
        if (!"https".equals(origin.getScheme()) || origin.getHost() == null
                || origin.getRawUserInfo() != null || origin.getRawQuery() != null
                || origin.getRawFragment() != null || !origin.getRawPath().isEmpty()) {
            throw new IllegalArgumentException("Archive public origin must be an HTTPS origin without a path.");
        }
    }

    public boolean allows(ArchivePrincipal principal) {
        return revealed && principal.getAuthorities().stream()
                .anyMatch(authority -> "ROLE_COUPLE".equals(authority.getAuthority()))
                && (!production || Set.of("kevin", "melanie").contains(principal.getUsername()));
    }

    /** Fresh background authority uses the current account, without retaining a principal. */
    public boolean allows(ArchiveAccount account) {
        return revealed && "COUPLE".equals(account.role())
                && (!production || Set.of("kevin", "melanie").contains(account.username()));
    }

    public boolean secureCookie() { return secureCookie; }
    public boolean production() { return production; }

    public void requireSameOrigin(HttpServletRequest request) {
        if (publicOrigin.isEmpty()) {
            RequestOrigin.requireSameOrigin(request);
        } else {
            String origin = request.getHeader("Origin");
            if ((origin != null && !publicOrigin.equals(origin))
                    || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
                throw new ApiException(403, "ORIGIN_INVALID", "Please use this website to manage your session.");
            }
        }
    }
}
