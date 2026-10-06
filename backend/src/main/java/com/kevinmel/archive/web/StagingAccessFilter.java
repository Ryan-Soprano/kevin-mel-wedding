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

final class StagingAccessFilter extends OncePerRequestFilter {
    private final byte[] credentialDigest;
    private final String expectedOrigin;

    StagingAccessFilter(String username, String password, String origin) {
        if (username == null || username.isBlank() || username.length() > 64
                || username.contains(":") || username.chars().anyMatch(Character::isISOControl)
                || password == null || password.isBlank() || password.length() < 24 || password.length() > 256
                || password.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalStateException("Staging requires a username and a password of 24–256 characters.");
        }
        credentialDigest = digest((username + ":" + password).getBytes(StandardCharsets.UTF_8));
        try {
            URI parsed = URI.create(origin);
            if (!"https".equals(parsed.getScheme()) || parsed.getHost() == null || parsed.getUserInfo() != null
                    || parsed.getPort() != -1 || parsed.getQuery() != null || parsed.getFragment() != null
                    || (parsed.getPath() != null && !parsed.getPath().isEmpty())) throw new IllegalArgumentException();
            expectedOrigin = origin;
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new IllegalStateException("Staging requires its exact HTTPS origin, without a path or credentials.");
        }
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
            reject(response, 403, "STAGING_HTTPS_REQUIRED", "Open the HTTPS test address.");
            return;
        }
        String actualOrigin = UriComponentsBuilder.fromUriString(request.getRequestURL().toString())
                .replacePath(null).replaceQuery(null).build().toUriString();
        if (!expectedOrigin.equals(actualOrigin)) {
            reject(response, 403, "STAGING_ORIGIN_INVALID", "Open the approved HTTPS test address.");
            return;
        }
        String authorization = request.getHeader("Authorization");
        if (!authorized(authorization)) {
            response.setHeader("WWW-Authenticate", "Basic realm=\"Memory Archive staging\", charset=\"UTF-8\"");
            reject(response, 401, "STAGING_AUTH_REQUIRED", "Sign in to this test environment.");
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean authorized(String header) {
        if (header == null || header.length() > 2048 || !header.regionMatches(true, 0, "Basic ", 0, 6)) return false;
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

    private static void reject(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}}");
    }
}
