package com.kevinmel.archive.web;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriComponentsBuilder;

import com.kevinmel.archive.security.SecurityErrorWriter;

final class StagingAccessFilter extends OncePerRequestFilter {
    private final boolean basicAuthenticationEnabled;
    private final byte[] credentialDigest;
    private final String expectedOrigin;
    private final SecurityErrorWriter errors;

    StagingAccessFilter(boolean basicAuthenticationEnabled, String username, String password, String origin,
            SecurityErrorWriter errors) {
        this.basicAuthenticationEnabled = basicAuthenticationEnabled;
        this.errors = errors;
        credentialDigest = credentialDigest(basicAuthenticationEnabled, username, password);
        expectedOrigin = validatedOrigin(origin);
    }

    private static byte[] credentialDigest(boolean enabled, String username, String password) {
        if (!enabled) {
            return new byte[0];
        }
        if (!validUsername(username) || !validPassword(password)) {
            throw new IllegalStateException("Staging requires a username and a password of 24–256 characters.");
        }
        return digest((username + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    private static boolean validUsername(String username) {
        return username != null && !username.isBlank() && username.length() <= 64
                && !username.contains(":") && username.chars().noneMatch(Character::isISOControl);
    }

    private static boolean validPassword(String password) {
        return password != null && !password.isBlank() && password.length() >= 24 && password.length() <= 256
                && password.chars().noneMatch(Character::isISOControl);
    }

    private static String validatedOrigin(String origin) {
        try {
            URI parsed = URI.create(origin);
            if (!originOnly(parsed)) {
                throw new IllegalArgumentException();
            }
            return origin;
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new IllegalStateException("Staging requires its exact HTTPS origin, without a path or credentials.");
        }
    }

    private static boolean originOnly(URI parsed) {
        return "https".equals(parsed.getScheme()) && parsed.getHost() != null && parsed.getUserInfo() == null
                && parsed.getPort() == -1 && parsed.getQuery() == null && parsed.getFragment() == null
                && (parsed.getPath() == null || parsed.getPath().isEmpty());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.addHeader("Vary", "Authorization");
        if ("GET".equals(request.getMethod()) && "/api/health".equals(request.getRequestURI())) {
            chain.doFilter(request, response);
            return;
        }
        if (!request.isSecure()) {
            errors.write(request, response, 403, "STAGING_HTTPS_REQUIRED", "Open the HTTPS test address.");
            return;
        }
        String actualOrigin = UriComponentsBuilder.fromUriString(request.getRequestURL().toString())
                .replacePath(null).replaceQuery(null).build().toUriString();
        if (!expectedOrigin.equals(actualOrigin)) {
            errors.write(request, response, 403, "STAGING_ORIGIN_INVALID", "Open the approved HTTPS test address.");
            return;
        }
        if (basicAuthenticationEnabled && !authorized(request.getHeader("Authorization"))) {
            response.setHeader("WWW-Authenticate", "Basic realm=\"Memory Archive staging\", charset=\"UTF-8\"");
            errors.write(request, response, 401, "STAGING_AUTH_REQUIRED", "Sign in to this test environment.");
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean authorized(String header) {
        if (header == null || header.length() > 2048 || !header.regionMatches(true, 0, "Basic ", 0, 6)) {
            return false;
        }
        try {
            byte[] candidate = Base64.getDecoder().decode(header.substring(6));
            return MessageDigest.isEqual(credentialDigest, digest(candidate));
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    private static byte[] digest(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("Required credential comparison is unavailable.", unavailable);
        }
    }
}
