package com.kevinmel.archive.operations;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

/** Observes technical failures only; never reads a body, key, identifier or exception message. */
public final class GuestOperationsFilter extends OncePerRequestFilter {
    public static final String EXPECTED_UNAVAILABLE = GuestOperationsFilter.class.getName() + ".expectedUnavailable";
    private final GuestOperationsSignals signals;

    public GuestOperationsFilter(GuestOperationsSignals signals) { this.signals = signals; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = UrlPathHelper.defaultInstance.getPathWithinApplication(request);
        boolean media = path.matches("/api/contributions/[^/]+/memories/[^/]+/(upload-grants|finalize)");
        if (!"POST".equals(request.getMethod()) || !("/api/contributions".equals(path) || media)) {
            chain.doFilter(request, response);
            return;
        }
        boolean threw = false;
        try {
            chain.doFilter(request, response);
        } catch (IOException | ServletException | RuntimeException failure) {
            threw = true;
            throw failure;
        } finally {
            if ((threw || response.getStatus() >= 500)
                    && !Boolean.TRUE.equals(request.getAttribute(EXPECTED_UNAVAILABLE))) {
                signals.record(GuestOperationsSignals.Category.GUEST_API_5XX);
                if (media) signals.record(GuestOperationsSignals.Category.GUEST_MEDIA_5XX);
            }
        }
    }
}
