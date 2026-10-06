package com.kevinmel.archive.web;

import java.io.IOException;
import java.util.UUID;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ApiResponseHeadersFilter extends OncePerRequestFilter {
    public static final String REQUEST_ID = ApiResponseHeadersFilter.class.getName() + ".requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/")) {
            Object existing = request.getAttribute(REQUEST_ID);
            String id = existing instanceof String value ? value : UUID.randomUUID().toString();
            request.setAttribute(REQUEST_ID, id);
            response.setHeader("X-Request-ID", id);
            response.setHeader("Cache-Control", "no-store");
        }
        chain.doFilter(request, response);
    }
}
