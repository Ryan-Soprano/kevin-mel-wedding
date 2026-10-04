package com.kevinandmelanie.memoryarchive.contribution;

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
import org.springframework.web.util.UriComponentsBuilder;

import com.kevinandmelanie.memoryarchive.web.ApiException;

@RestController
@RequestMapping("/api/contributions")
public class ContributionController {
    private final ContributionService service;

    public ContributionController(ContributionService service) {
        this.service = service;
    }

    @PostMapping(consumes = "application/json", produces = "application/json")
    public ResponseEntity<ContributionReceipt> createContribution(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        String validatedKey = ContributionService.validateHeaders(version, key);
        String origin = request.getHeader("Origin");
        String expectedOrigin = UriComponentsBuilder.fromUriString(request.getRequestURL().toString())
                .replacePath(null).replaceQuery(null).build().toUriString();
        if ((origin != null && !origin.equals(expectedOrigin))
                || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
            throw new ApiException(403, "ORIGIN_INVALID", "Please submit from this website.");
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
