package com.kevinmel.archive.web;

import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handleApi(ApiException exception, HttpServletRequest request) {
        if (exception.expectedOperationalResponse()) {
            request.setAttribute(com.kevinmel.archive.operations.GuestOperationsFilter.EXPECTED_UNAVAILABLE, true);
        }
        var result = response(exception.status(), exception.code(), exception.getMessage(), exception.fieldErrors(), request);
        if (exception.retryAfterSeconds() == 0) return result;
        return ResponseEntity.status(result.getStatusCode()).headers(result.getHeaders())
                .header("Retry-After", Long.toString(exception.retryAfterSeconds())).body(result.getBody());
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    public ResponseEntity<ErrorResponse> handleDatabase(Exception exception, HttpServletRequest request) {
        // Diagnostics can contain SQL parameters/guest content; never serialize or log them.
        return response(503, "SERVICE_UNAVAILABLE", "The request could not be completed. Please try again later.", List.of(), request);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    public ResponseEntity<ErrorResponse> handleBody(Exception exception, HttpServletRequest request) {
        return response(400, "VALIDATION_FAILED", "Send a supported JSON request.", List.of(), request);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleId(Exception exception, HttpServletRequest request) {
        return handleApi(ApiException.notFound(), request);
    }

    private ResponseEntity<ErrorResponse> response(int status, String code, String message,
            List<ApiException.FieldError> fields, HttpServletRequest request) {
        Object storedId = request.getAttribute(ApiResponseHeadersFilter.REQUEST_ID);
        String id = storedId instanceof String value ? value : UUID.randomUUID().toString();
        return ResponseEntity.status(status).header("X-Request-ID", id).header("Cache-Control", "no-store")
                .body(new ErrorResponse(new ErrorDetail(code, message, id, fields)));
    }

    public record ErrorResponse(ErrorDetail error) {}
    public record ErrorDetail(String code, String message, String requestId, List<ApiException.FieldError> fieldErrors) {}
}
