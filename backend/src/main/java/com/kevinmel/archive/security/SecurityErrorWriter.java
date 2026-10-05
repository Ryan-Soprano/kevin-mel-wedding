package com.kevinmel.archive.security;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import com.kevinmel.archive.web.ApiExceptionHandler;
import com.kevinmel.archive.web.ApiResponseHeadersFilter;

/** Security filters run outside MVC exception advice, but use the same safe envelope. */
@Component
public class SecurityErrorWriter {
    private final ObjectMapper mapper;

    public SecurityErrorWriter(ObjectMapper mapper) { this.mapper = mapper; }

    public void write(HttpServletRequest request, HttpServletResponse response,
            int status, String code, String message) throws IOException {
        Object existing = request.getAttribute(ApiResponseHeadersFilter.REQUEST_ID);
        String requestId = existing instanceof String value ? value : UUID.randomUUID().toString();
        request.setAttribute(ApiResponseHeadersFilter.REQUEST_ID, requestId);
        response.setStatus(status);
        response.setHeader("X-Request-ID", requestId);
        response.setHeader("Cache-Control", "no-store");
        response.setContentType("application/json");
        mapper.writeValue(response.getOutputStream(), new ApiExceptionHandler.ErrorResponse(
                new ApiExceptionHandler.ErrorDetail(code, message, requestId, List.of())));
    }
}
