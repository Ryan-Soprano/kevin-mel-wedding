package com.kevinmel.archive.contribution;

import java.util.Map;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.media.MediaService;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.web.ApiException;

@RestController
@RequestMapping("/api/memories/contributions")
public class CoupleContributionController {
    private final CoupleContributionService contributions;
    private final MediaService media;
    private final ArchiveAccessPolicy policy;
    public CoupleContributionController(CoupleContributionService contributions, MediaService media, ArchiveAccessPolicy policy) {
        this.contributions = contributions; this.media = media; this.policy = policy;
    }
    @PostMapping(consumes = "application/json", produces = "application/json")
    public ResponseEntity<ContributionReceipt> create(@RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        String validated = ContributionService.validateHeaders(version, key); policy.requireSameOrigin(request);
        var saved = contributions.create(body, validated);
        return ResponseEntity.status(saved.created() ? 201 : 200).header("Cache-Control", "no-store").body(saved.receipt());
    }
    @GetMapping(value = "/{contributionId}/receipt", produces = "application/json")
    public ContributionReceipt receipt(@PathVariable UUID contributionId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return contributions.receipt(contributionId, ContributionService.validateHeaders(version, key));
    }
    @PostMapping(value = "/{contributionId}/memories/{memoryId}/upload-grants", produces = "application/json")
    public ResponseEntity<ObjectStorage.UploadGrant> grant(@PathVariable UUID contributionId, @PathVariable UUID memoryId,
            @RequestBody(required = false) byte[] body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        String validated = ContributionService.validateHeaders(version, key); policy.requireSameOrigin(request);
        if (body != null && body.length != 0) throw new ApiException(400, "VALIDATION_FAILED", "Upload permission requests have no body.");
        return ResponseEntity.status(201).header("Cache-Control", "no-store").body(media.authorize(contributionId, memoryId, contributions.scope(validated)));
    }
    @PostMapping(value = "/{contributionId}/memories/{memoryId}/finalize", consumes = "application/json", produces = "application/json")
    public ContributionReceipt finish(@PathVariable UUID contributionId, @PathVariable UUID memoryId,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        String validated = ContributionService.validateHeaders(version, key); policy.requireSameOrigin(request);
        return media.finalizeUpload(contributionId, memoryId, contributions.scope(validated), body);
    }
}
