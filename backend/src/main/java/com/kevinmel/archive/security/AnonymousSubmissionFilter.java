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
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

import com.kevinmel.archive.contribution.ContributionService;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.RequestOrigin;

/** Admits guest work before MVC reads JSON or opens a storage connection. */
public final class AnonymousSubmissionFilter extends OncePerRequestFilter {
    public static final int MAX_CONTRIBUTION_BYTES = 65_536;
    public static final int MAX_FINALIZE_BYTES = 1_024;
    private final AnonymousThrottle throttle;
    private final SecurityErrorWriter errors;

    public AnonymousSubmissionFilter(AnonymousThrottle throttle, SecurityErrorWriter errors) {
        this.throttle = throttle;
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var operation = operation(request);
        if (operation == null) {
            chain.doFilter(request, response);
            return;
        }
        HttpServletRequest admitted;
        try {
            String key = ContributionService.validateHeaders(request.getHeader("X-Api-Contract"),
                    request.getHeader("Idempotency-Key"));
            if (!"GET".equals(request.getMethod())) RequestOrigin.requireSameOrigin(request);
            int limit = switch (operation) {
                case CREATE -> MAX_CONTRIBUTION_BYTES;
                case FINALIZE, SIGNAL -> MAX_FINALIZE_BYTES;
                case GRANT, RECEIPT -> 0;
            };
            if (request.getContentLengthLong() > limit) throw tooLarge(operation);
            long retryAfter = throttle.reserve(operation, key, request);
            if (retryAfter > 0) {
                response.setHeader("Retry-After", Long.toString(retryAfter));
                throw new ApiException(429, "RATE_LIMITED", "Please wait, then retry with the same note or photos.");
            }
            // readNBytes also bounds chunked requests whose Content-Length is absent.
            byte[] body = request.getInputStream().readNBytes(limit + 1);
            if (body.length > limit) throw tooLarge(operation);
            admitted = new BoundedRequest(request, body);
        } catch (ApiException failure) {
            errors.write(request, response, failure.status(), failure.code(), failure.getMessage());
            return;
        } catch (DataAccessException | TransactionException failure) {
            // No guest content, raw keys, connection addresses or database diagnostics are emitted.
            errors.write(request, response, 503, "SERVICE_UNAVAILABLE",
                    "The request could not be completed. Keep your note or photos and try again later.");
            return;
        }
        chain.doFilter(admitted, response);
    }

    private static ApiException tooLarge(AnonymousThrottle.Operation operation) {
        if (operation == AnonymousThrottle.Operation.GRANT || operation == AnonymousThrottle.Operation.RECEIPT) {
            return new ApiException(400, "VALIDATION_FAILED", "This request has no body.");
        }
        return new ApiException(413, "PAYLOAD_TOO_LARGE", "This request is too large. Keep your note or photos.");
    }

    static AnonymousThrottle.Operation operation(HttpServletRequest request) {
        // Decode the path exactly as Spring MVC does; escaped path letters cannot bypass admission.
        String path = UrlPathHelper.defaultInstance.getPathWithinApplication(request);
        if ("POST".equals(request.getMethod())) {
            if ("/api/contributions".equals(path)) return AnonymousThrottle.Operation.CREATE;
            if (path.matches("/api/contributions/[^/]+/memories/[^/]+/upload-grants")) return AnonymousThrottle.Operation.GRANT;
            if (path.matches("/api/contributions/[^/]+/memories/[^/]+/finalize")) return AnonymousThrottle.Operation.FINALIZE;
            if (path.matches("/api/contributions/[^/]+/memories/[^/]+/upload-failures")) return AnonymousThrottle.Operation.SIGNAL;
        }
        if ("GET".equals(request.getMethod()) && path.matches("/api/contributions/[^/]+/receipt")) {
            return AnonymousThrottle.Operation.RECEIPT;
        }
        return null;
    }

    private static final class BoundedRequest extends HttpServletRequestWrapper {
        private final byte[] body;
        private final ServletInputStream input;

        BoundedRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
            var bytes = new ByteArrayInputStream(body);
            input = new ServletInputStream() {
                @Override public int read() { return bytes.read(); }
                @Override public int read(byte[] buffer, int offset, int length) { return bytes.read(buffer, offset, length); }
                @Override public boolean isFinished() { return bytes.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) {
                    throw new IllegalStateException("Guest JSON requests use synchronous reads.");
                }
            };
        }
        @Override public int getContentLength() { return body.length; }
        @Override public long getContentLengthLong() { return body.length; }
        @Override public ServletInputStream getInputStream() { return input; }
        @Override public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            return new BufferedReader(new InputStreamReader(input,
                    encoding == null ? StandardCharsets.UTF_8 : java.nio.charset.Charset.forName(encoding)));
        }
    }
}
