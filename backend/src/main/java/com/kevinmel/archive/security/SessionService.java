package com.kevinmel.archive.security;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseCookie;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.stereotype.Service;

import com.kevinmel.archive.web.ApiException;

@Service
public class SessionService {
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository contexts;
    private final SessionAuthenticationStrategy sessionStrategy;
    private final ArchiveAccessPolicy policy;
    private final LoginThrottle throttle;

    public SessionService(AuthenticationManager authenticationManager, SecurityContextRepository contexts,
            SessionAuthenticationStrategy sessionStrategy, ArchiveAccessPolicy policy, LoginThrottle throttle) {
        this.authenticationManager = authenticationManager;
        this.contexts = contexts;
        this.sessionStrategy = sessionStrategy;
        this.policy = policy;
        this.throttle = throttle;
    }

    public static void requireContract(String version) {
        if (!"1".equals(version)) throw new ApiException(400, "UNSUPPORTED_CONTRACT", "Use API contract version 1.");
    }

    public SessionResponse current(HttpServletRequest request) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        SessionUser user = null;
        if (authentication != null && authentication.getPrincipal() instanceof ArchivePrincipal principal) {
            if (!policy.allows(principal)) throw unavailable();
            user = new SessionUser(principal.getDisplayName(), List.of("COUPLE"));
        }
        var token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return new SessionResponse(user != null, user, token.getToken());
    }

    public SessionResponse login(Map<String, Object> body, HttpServletRequest request, HttpServletResponse response) {
        policy.requireSameOrigin(request);
        if (body == null || !body.keySet().equals(Set.of("username", "password"))
                || !(body.get("username") instanceof String suppliedUsername)
                || !(body.get("password") instanceof String suppliedPassword)) {
            throw new ApiException(400, "VALIDATION_FAILED", "Supply a username and password.");
        }
        String username = normalizedUsername(suppliedUsername, suppliedPassword);
        throttle.reserve(username, request, response);
        var input = UsernamePasswordAuthenticationToken.unauthenticated(username, suppliedPassword);
        try {
            var authenticated = authenticationManager.authenticate(input);
            if (!(authenticated.getPrincipal() instanceof ArchivePrincipal principal) || !policy.allows(principal)) {
                throw unavailable();
            }
            sessionStrategy.onAuthentication(authenticated, request, response);
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authenticated);
            SecurityContextHolder.setContext(context);
            contexts.saveContext(context, request, response);
            return current(request);
        } catch (AuthenticationServiceException unavailable) {
            throw new ApiException(503, "SERVICE_UNAVAILABLE", "The request could not be completed. Please try again later.");
        } catch (AuthenticationException rejected) {
            throw invalidCredentials();
        } finally {
            input.eraseCredentials();
        }
    }

    private static String normalizedUsername(String suppliedUsername, String suppliedPassword) {
        if (suppliedUsername.length() > 100 || suppliedPassword.length() > 72) throw invalidCredentials();
        String username = suppliedUsername.strip().toLowerCase(Locale.ROOT);
        if (username.length() > 100 || !username.matches("^[a-z0-9][a-z0-9._-]{2,99}$")
                || suppliedPassword.isEmpty() || !StandardCharsets.UTF_8.newEncoder().canEncode(suppliedPassword)
                || suppliedPassword.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw invalidCredentials();
        }
        return username;
    }

    public void logout(HttpServletRequest request, HttpServletResponse response) {
        policy.requireSameOrigin(request);
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        contexts.saveContext(SecurityContextHolder.createEmptyContext(), request, response);
        response.addHeader("Set-Cookie", ResponseCookie.from("MEMORY_ARCHIVE_SESSION", "")
                .path("/").httpOnly(true).secure(policy.secureCookie()).sameSite("Lax").maxAge(0).build().toString());
    }

    private static ApiException invalidCredentials() {
        return new ApiException(401, "INVALID_CREDENTIALS", "The username or password is incorrect.");
    }

    private static ApiException unavailable() {
        return new ApiException(403, "ARCHIVE_UNAVAILABLE", "Archive access is unavailable.");
    }

    public record SessionResponse(boolean authenticated, SessionUser user, String csrfToken) {}
    public record SessionUser(String displayName, List<String> roles) {}
}
