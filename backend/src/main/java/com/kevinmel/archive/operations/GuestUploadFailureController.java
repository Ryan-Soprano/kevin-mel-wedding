package com.kevinmel.archive.operations;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.kevinmel.archive.contribution.ContributionService;
import com.kevinmel.archive.web.RequestOrigin;

/** Write-only, bounded negative signal; no public operational observation is exposed. */
@RestController
public class GuestUploadFailureController {
    private final GuestUploadFailureReporter reporter;

    public GuestUploadFailureController(GuestUploadFailureReporter reporter) { this.reporter = reporter; }

    @PostMapping(value = "/api/contributions/{contributionId}/memories/{memoryId}/upload-failures",
            consumes = "application/json")
    public ResponseEntity<Void> report(@PathVariable UUID contributionId, @PathVariable UUID memoryId,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        String validatedKey = ContributionService.validateHeaders(version, key);
        RequestOrigin.requireSameOrigin(request);
        reporter.report(contributionId, memoryId, validatedKey, body);
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
}
