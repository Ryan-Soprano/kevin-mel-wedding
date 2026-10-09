package com.kevinmel.archive.web;

import java.util.List;

/** Carries only safe, deliberately authored public error details. */
public class ApiException extends RuntimeException {
    private final int status;
    private final String code;
    private final transient List<FieldError> fieldErrors;
    private final long retryAfterSeconds;

    public ApiException(int status, String code, String message) {
        this(status, code, message, List.of());
    }

    public ApiException(int status, String code, String message, List<FieldError> fieldErrors) {
        this(status, code, message, fieldErrors, 0);
    }

    public ApiException(int status, String code, String message, long retryAfterSeconds) {
        this(status, code, message, List.of(), retryAfterSeconds);
    }

    private ApiException(int status, String code, String message, List<FieldError> fieldErrors, long retryAfterSeconds) {
        super(message);
        this.status = status;
        this.code = code;
        this.fieldErrors = List.copyOf(fieldErrors);
        if (retryAfterSeconds < 0) throw new IllegalArgumentException("Retry delay must be nonnegative.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public int status() { return status; }
    public String code() { return code; }
    public List<FieldError> fieldErrors() { return fieldErrors; }
    public long retryAfterSeconds() { return retryAfterSeconds; }

    public static ApiException notFound() {
        return new ApiException(404, "NOT_FOUND", "That receipt is unavailable.");
    }

    public static ApiException conflict() {
        return new ApiException(409, "IDEMPOTENCY_CONFLICT",
                "This retry key was already used for different content.");
    }

    public record FieldError(String field, String code, String message) {}
}
