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
    private static final String GET = "GET";
    private static final String POST = "POST";
    private static final String PUT = "PUT";
    private static final String PATCH = "PATCH";
    private static final String DELETE = "DELETE";
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
        if (POST.equals(method) && ("/api/session".equals(path) || "/api/session/password".equals(path))) {
            return 4_096;
        }
        if (emptySharedBody(method, path)) {
            return 0;
        }
        if (PATCH.equals(method) && path.matches("/api/memories/[^/]+/review")) {
            return 1_024;
        }
        int organizationLimit = organizationBodyLimit(method, path);
        return organizationLimit >= 0 ? organizationLimit : memoryBodyLimit(method, path);
    }

    private static boolean emptySharedBody(String method, String path) {
        return GET.equals(method) && within(path, "/api/shared-memories")
                || POST.equals(method) && path.matches("/api/memories/[^/]+/share-link");
    }

    private static boolean within(String path, String root) {
        return path.equals(root) || path.startsWith(root + "/");
    }

    private static int organizationBodyLimit(String method, String path) {
        if (within(path, "/api/exports")) {
            return 0;
        }
        if (within(path, "/api/library")) {
            return GET.equals(method) ? 0 : -1;
        }
        if (within(path, "/api/tags")) {
            return collectionBodyLimit(method, path, "/api/tags/[^/]+/members/[^/]+", "/api/tags/[^/]+");
        }
        if (within(path, "/api/timeline")) {
            return collectionBodyLimit(method, path,
                    "/api/timeline/events/[^/]+/memories/[^/]+", "/api/timeline/events/[^/]+");
        }
        if (within(path, "/api/albums")) {
            return albumBodyLimit(method, path);
        }
        return -1;
    }

    private static int collectionBodyLimit(String method, String path, String memberPath, String detailPath) {
        if (GET.equals(method) || DELETE.equals(method)) {
            return 0;
        }
        if (PUT.equals(method) && path.matches(memberPath)) {
            return 0;
        }
        if ((PUT.equals(method) || PATCH.equals(method)) && path.matches(detailPath)) {
            return 16_384;
        }
        return -1;
    }

    private static int albumBodyLimit(String method, String path) {
        if (POST.equals(method) && path.matches("/api/albums/[^/]+/members/[^/]+/move")) {
            return 1_024;
        }
        return collectionBodyLimit(method, path, "/api/albums/[^/]+/members/[^/]+", "/api/albums/[^/]+");
    }

    private static int memoryBodyLimit(String method, String path) {
        if (POST.equals(method)) {
            return contributionBodyLimit(path);
        }
        if (GET.equals(method) && path.matches("/api/memories/contributions/[^/]+/receipt")) {
            return 0;
        }
        if (PATCH.equals(method) && path.matches("/api/memories/[^/]+/metadata")) {
            return 16_384;
        }
        return -1;
    }

    private static int contributionBodyLimit(String path) {
        if ("/api/memories/contributions".equals(path)) {
            return 65_536;
        }
        if (path.matches("/api/memories/contributions/[^/]+/memories/[^/]+/upload-grants")) {
            return 0;
        }
        if (path.matches("/api/memories/contributions/[^/]+/memories/[^/]+/finalize")) {
            return 1_024;
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
