package com.kevinmel.archive.security;

import jakarta.servlet.ServletRequestEvent;
import jakarta.servlet.ServletRequestListener;
import jakarta.servlet.http.HttpServletRequest;
import com.kevinmel.archive.web.ApiException;

/** Servlet initialization precedes forwarding filters, so this is the connection peer. */
public final class RequestPeerCapture implements ServletRequestListener {
    private static final String ATTRIBUTE = RequestPeerCapture.class.getName() + ".connectionPeer";

    private record ConnectionPeer(String address) {
        @Override public String toString() { return "ConnectionPeer[captured]"; }
    }

    @Override
    public void requestInitialized(ServletRequestEvent event) {
        var request = event.getServletRequest();
        String address = request.getRemoteAddr();
        if (address == null || address.isBlank()) {
            request.removeAttribute(ATTRIBUTE);
        } else {
            request.setAttribute(ATTRIBUTE, new ConnectionPeer(address));
        }
    }

    @Override
    public void requestDestroyed(ServletRequestEvent event) {
        event.getServletRequest().removeAttribute(ATTRIBUTE);
    }

    static String requirePeer(HttpServletRequest request) {
        if (request.getAttribute(ATTRIBUTE) instanceof ConnectionPeer peer) return peer.address();
        // Never fall back to a request address that a forwarding filter may have replaced.
        throw new ApiException(503, "SERVICE_UNAVAILABLE",
                "The request could not be completed. Please try again later.");
    }
}
