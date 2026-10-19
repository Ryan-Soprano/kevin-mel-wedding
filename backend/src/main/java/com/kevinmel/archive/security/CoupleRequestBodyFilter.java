package com.kevinmel.archive.security;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

/** Bounds session and private JSON before MVC; guest admission quotas do not apply here. */
public final class CoupleRequestBodyFilter extends OncePerRequestFilter {
    private final SecurityErrorWriter errors;

    public CoupleRequestBodyFilter(SecurityErrorWriter errors) {
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        int limit = bodyLimit(
                request.getMethod(),
                UrlPathHelper.defaultInstance.getPathWithinApplication(request));
        if (limit < 0) {
            chain.doFilter(request, response);
            return;
        }

        byte[] body = request.getContentLengthLong() > limit
                ? null
                : request.getInputStream().readNBytes(limit + 1);
        if (body == null || body.length > limit) {
            errors.write(
                    request,
                    response,
                    limit == 0 ? 400 : 413,
                    limit == 0 ? "VALIDATION_FAILED" : "PAYLOAD_TOO_LARGE",
                    limit == 0 ? "This request has no body." : "This request is too large.");
            return;
        }
        chain.doFilter(new BoundedRequest(request, body), response);
    }

    static int bodyLimit(String method, String path) {
        if ("POST".equals(method) && "/api/session".equals(path)) {
            return 4_096;
        }
        if ("GET".equals(method) && (path.equals("/api/shared-memories") || path.startsWith("/api/shared-memories/"))) {
            return 0;
        }
        if ("POST".equals(method) && path.matches("/api/memories/[^/]+/share-link")) {
            return 0;
        }
        if ("PATCH".equals(method) && path.matches("/api/memories/[^/]+/review")) {
            return 1_024;
        }
        if (path.equals("/api/exports") || path.startsWith("/api/exports/")) {
            return 0;
        }
        if (path.equals("/api/library") || path.startsWith("/api/library/")) {
            if ("GET".equals(method)) {
                return 0;
            }
        }
        if (path.equals("/api/tags") || path.startsWith("/api/tags/")) {
            if ("GET".equals(method) || "DELETE".equals(method)) {
                return 0;
            }
            if ("PUT".equals(method) && path.matches("/api/tags/[^/]+/members/[^/]+")) {
                return 0;
            }
            if (("PUT".equals(method) || "PATCH".equals(method)) && path.matches("/api/tags/[^/]+")) {
                return 16_384;
            }
        }
        if (path.equals("/api/timeline") || path.startsWith("/api/timeline/")) {
            if ("GET".equals(method) || "DELETE".equals(method)) {
                return 0;
            }
            if ("PUT".equals(method) && path.matches("/api/timeline/events/[^/]+/memories/[^/]+")) {
                return 0;
            }
            if (("PUT".equals(method) || "PATCH".equals(method)) && path.matches("/api/timeline/events/[^/]+")) {
                return 16_384;
            }
        }
        if (path.equals("/api/albums") || path.startsWith("/api/albums/")) {
            if ("GET".equals(method) || "DELETE".equals(method)) {
                return 0;
            }
            if ("PUT".equals(method) && path.matches("/api/albums/[^/]+/members/[^/]+")) {
                return 0;
            }
            if ("POST".equals(method) && path.matches("/api/albums/[^/]+/members/[^/]+/move")) {
                return 1_024;
            }
            if (("PUT".equals(method) || "PATCH".equals(method)) && path.matches("/api/albums/[^/]+")) {
                return 16_384;
            }
        }
        if ("POST".equals(method) && "/api/memories/contributions".equals(path)) {
            return 65_536;
        }
        if ("GET".equals(method) && path.matches("/api/memories/contributions/[^/]+/receipt")) {
            return 0;
        }
        if ("POST".equals(method) && path.matches("/api/memories/contributions/[^/]+/memories/[^/]+/upload-grants")) {
            return 0;
        }
        if ("POST".equals(method) && path.matches("/api/memories/contributions/[^/]+/memories/[^/]+/finalize")) {
            return 1_024;
        }
        if ("PATCH".equals(method) && path.matches("/api/memories/[^/]+/metadata")) {
            return 16_384;
        }
        return -1;
    }

    private static final class BoundedRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        BoundedRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            var stream = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return stream.read();
                }

                @Override
                public int read(byte[] bytes, int offset, int length) {
                    return stream.read(bytes, offset, length);
                }

                @Override
                public boolean isFinished() {
                    return stream.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new IllegalStateException("Private JSON uses synchronous reads.");
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
