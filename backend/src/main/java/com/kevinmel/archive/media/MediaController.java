package com.kevinmel.archive.media;

import java.util.Map;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.contribution.ContributionReceipt;
import com.kevinmel.archive.contribution.ContributionService;
import com.kevinmel.archive.web.RequestOrigin;
import com.kevinmel.archive.web.ApiException;

@RestController
@RequestMapping("/api/contributions/{contributionId}/memories/{memoryId}")
public class MediaController {
    private final MediaService media;
    public MediaController(MediaService media) { this.media = media; }

    @PostMapping(value = "/upload-grants", produces = "application/json")
    public ResponseEntity<ObjectStorage.UploadGrant> grant(@PathVariable UUID contributionId,
            @PathVariable UUID memoryId,
            @RequestBody(required = false) byte[] body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        String validatedKey = ContributionService.validateHeaders(version, key);
        RequestOrigin.requireSameOrigin(request);
        if (body != null && body.length > 0) throw new ApiException(400, "VALIDATION_FAILED", "Upload permission requests have no body.");
        return ResponseEntity.status(201).body(media.authorize(contributionId, memoryId, validatedKey));
    }

    @PostMapping(value = "/finalize", consumes = "application/json", produces = "application/json")
    public ContributionReceipt finalizeUpload(@PathVariable UUID contributionId, @PathVariable UUID memoryId,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        String validatedKey = ContributionService.validateHeaders(version, key);
        RequestOrigin.requireSameOrigin(request);
        return media.finalizeUpload(contributionId, memoryId, validatedKey, body);
    }
}
