package com.kevinmel.archive.security;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.transaction.TransactionException;
import org.springframework.web.filter.OncePerRequestFilter;

/** Reloads authority/version only for session/private routes; guest collection stays independent. */
public class SessionIdentityFilter extends OncePerRequestFilter {
    private final ArchiveAccountRepository accounts;
    private final ArchiveAccessPolicy policy;
    private final SecurityErrorWriter errors;
    private final SecurityContextRepository contexts;

    public SessionIdentityFilter(ArchiveAccountRepository accounts, ArchiveAccessPolicy policy,
            SecurityErrorWriter errors, SecurityContextRepository contexts) {
        this.accounts = accounts;
        this.policy = policy;
        this.errors = errors;
        this.contexts = contexts;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = path(request);
        return !path.equals("/api/session") && !privatePath(path);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = path(request);
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (privatePath(path) && authentication != null && authentication.isAuthenticated()
                && !(authentication.getPrincipal() instanceof ArchivePrincipal)) {
            errors.write(request, response, 403, "ARCHIVE_UNAVAILABLE", "Archive access is unavailable.");
            return;
        }
        if (authentication != null && authentication.getPrincipal() instanceof ArchivePrincipal principal) {
            try {
                var current = accounts.findById(principal.getAccountId());
                boolean valid = current.isPresent() && current.get().enabled()
                        && current.get().credentialsVersion() == principal.getCredentialsVersion()
                        && current.get().username().equals(principal.getUsername())
                        && principal.getAuthorities().stream().anyMatch(authority ->
                                authority.getAuthority().equals("ROLE_" + current.get().role()));
                if (!valid) {
                    var session = request.getSession(false);
                    if (session != null) session.invalidate();
                    SecurityContextHolder.clearContext();
                    contexts.saveContext(SecurityContextHolder.createEmptyContext(), request, response);
                    if (!path.equals("/api/session")) {
                        errors.write(request, response, 401, "AUTH_REQUIRED", "Please sign in to access the archive.");
                        return;
                    }
                } else if (privatePath(path) && !policy.allows(principal)) {
                    errors.write(request, response, 403, "ARCHIVE_UNAVAILABLE", "Archive access is unavailable.");
                    return;
                }
            } catch (DataAccessException | TransactionException unavailable) {
                errors.write(request, response, 503, "SERVICE_UNAVAILABLE", "The request could not be completed. Please try again later.");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private static String path(HttpServletRequest request) {
        String servletPath = request.getServletPath();
        return servletPath.isEmpty() ? request.getRequestURI().substring(request.getContextPath().length()) : servletPath;
    }
    private static boolean privatePath(String path) {
        return path.startsWith("/api/memories") || path.startsWith("/api/albums") || path.startsWith("/api/timeline")
                || path.startsWith("/api/library") || path.startsWith("/api/tags") || path.startsWith("/api/exports");
    }
}
