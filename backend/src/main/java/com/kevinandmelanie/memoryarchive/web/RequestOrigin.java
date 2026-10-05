package com.kevinandmelanie.memoryarchive.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.util.UriComponentsBuilder;

public final class RequestOrigin {
    private RequestOrigin() {}
    public static void requireSameOrigin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        String expected = UriComponentsBuilder.fromUriString(request.getRequestURL().toString())
                .replacePath(null).replaceQuery(null).build().toUriString();
        if ((origin != null && !origin.equals(expected)) || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
            throw new ApiException(403, "ORIGIN_INVALID", "Please submit from this website.");
        }
    }
}
