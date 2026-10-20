package com.kevinmel.archive.review;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
public class ReviewController {
    private final ReviewService reviews;
    private final ArchiveAccessPolicy policy;

    public ReviewController(
            ReviewService reviews,
            ArchiveAccessPolicy policy) {
        this.reviews = reviews;
        this.policy = policy;
    }

    @PatchMapping(
            value = "/api/memories/{memoryId}/review",
            produces = "application/json")
    public ResponseEntity<MemoryDetail> review(
            @PathVariable UUID memoryId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        policy.requireSameOrigin(request);
        var changed = reviews.review(memoryId, body, ifMatch);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .eTag(Integer.toString(changed.revision()))
                .body(changed);
    }
}
