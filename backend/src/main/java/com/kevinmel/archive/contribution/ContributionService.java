package com.kevinmel.archive.contribution;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.kevinmel.archive.web.ApiException;

@Service
public class ContributionService {
    private final ContributionRepository repository;

    public ContributionService(ContributionRepository repository) {
        this.repository = repository;
    }

    public ContributionRepository.SavedTextContribution submit(Map<String, Object> body, String key) {
        ContributionRequest normalized = ContributionRequest.from(body);
        return repository.saveTextContribution("kevin-mel-wedding", normalized.guestName(), normalized.message(), key);
    }

    public ContributionReceipt receipt(UUID id, String key) {
        return repository.getReceipt(id, key);
    }

    public static String validateHeaders(String version, String key) {
        if (!"1".equals(version)) {
            throw new ApiException(400, "UNSUPPORTED_CONTRACT", "Use API contract version 1.");
        }
        if (key == null || !key.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw new ApiException(400, "VALIDATION_FAILED", "A random UUID v4 retry key is required.");
        }
        return UUID.fromString(key).toString();
    }
}
