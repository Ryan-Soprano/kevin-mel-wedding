package com.kevinmel.archive.review;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kevinmel.archive.security.SessionService;

@RestController
public class InboxController {
    private final InboxService inbox;

    public InboxController(InboxService inbox) {
        this.inbox = inbox;
    }

    @GetMapping(value = "/api/memories", produces = "application/json")
    public InboxService.InboxPage list(
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String reviewStatus,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor) {
        SessionService.requireContract(version);
        return inbox.list(reviewStatus, limit, cursor);
    }

    @GetMapping(value = "/api/memories/{memoryId}", produces = "application/json")
    public ResponseEntity<MemoryDetail> detail(
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version) {
        SessionService.requireContract(version);
        var memory = inbox.detail(memoryId);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .eTag(Integer.toString(memory.revision()))
                .body(memory);
    }
}
