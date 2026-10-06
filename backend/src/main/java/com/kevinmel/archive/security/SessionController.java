package com.kevinmel.archive.security;

import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/session")
public class SessionController {
    private final SessionService service;
    public SessionController(SessionService service) { this.service = service; }

    @GetMapping(produces = "application/json")
    public SessionService.SessionResponse current(
            @RequestHeader(value = "X-Api-Contract", required = false) String version, HttpServletRequest request) {
        SessionService.requireContract(version);
        return service.current(request);
    }

    @PostMapping(consumes = "application/json", produces = "application/json")
    public SessionService.SessionResponse login(@RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            HttpServletRequest request, HttpServletResponse response) {
        SessionService.requireContract(version);
        return service.login(body, request, response);
    }

    @DeleteMapping
    public ResponseEntity<Void> logout(
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            HttpServletRequest request, HttpServletResponse response) {
        SessionService.requireContract(version);
        service.logout(request, response);
        return ResponseEntity.noContent().build();
    }
}
