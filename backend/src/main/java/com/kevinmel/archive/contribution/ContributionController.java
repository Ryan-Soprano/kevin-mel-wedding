package com.kevinmel.archive.contribution;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.kevinmel.archive.web.RequestOrigin;
import com.kevinmel.archive.media.MediaService;

@RestController
@RequestMapping("/api/contributions")
public class ContributionController {
    private final ContributionService service;
    private final MediaService media;

    public ContributionController(ContributionService service, MediaService media) {
        this.service = service;
        this.media = media;
    }

    @PostMapping(consumes = "application/json", produces = "application/json")
    public ResponseEntity<ContributionReceipt> createContribution(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        String validatedKey = ContributionService.validateHeaders(version, key);
        RequestOrigin.requireSameOrigin(request);
        if (body.containsKey("memoryType")) {
            var saved = media.create(body, validatedKey);
            return ResponseEntity.status(saved.created() ? 201 : 200).body(saved.receipt());
        }
        var saved = service.submit(body, validatedKey);
        return ResponseEntity.status(saved.created() ? 201 : 200).body(saved.receipt());
    }

    @GetMapping(value = "/{contributionId}/receipt", produces = "application/json")
    public ContributionReceipt receipt(@PathVariable UUID contributionId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return service.receipt(contributionId, ContributionService.validateHeaders(version, key));
    }
}
