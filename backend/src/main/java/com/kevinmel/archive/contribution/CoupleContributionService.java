package com.kevinmel.archive.contribution;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.media.MediaService;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;

@Service
public class CoupleContributionService {
    private final ArchiveAuthorization authorization;
    private final ContributionRepository contributions;
    private final MediaService media;

    public CoupleContributionService(
            ArchiveAuthorization authorization,
            ContributionRepository contributions,
            MediaService media) {
        this.authorization = authorization;
        this.contributions = contributions;
        this.media = media;
    }

    @Transactional
    public Saved create(Map<String, Object> body, String externalKey) {
        var scope = ContributionScope.couple(externalKey, authorization);
        if (body == null) {
            throw new ApiException(400, "VALIDATION_FAILED", "Supply a private memory.");
        }
        if (body.get("guestName") != null) {
            throw new ApiException(
                    400,
                    "VALIDATION_FAILED",
                    "Private memories use your signed-in account; leave guest attribution empty.");
        }
        Saved saved;
        if (body.containsKey("memoryType")) {
            var value = media.create(body, scope);
            saved = new Saved(value.receipt(), value.created());
        } else {
            var request = ContributionRequest.from(body);
            var value = contributions.saveTextContribution(
                    "kevin-mel-wedding",
                    null,
                    request.message(),
                    scope);
            saved = new Saved(value.receipt(), value.created());
        }
        scope.recheck(authorization);
        return saved;
    }

    @Transactional(readOnly = true)
    public ContributionReceipt receipt(UUID id, String externalKey) {
        var scope = ContributionScope.couple(externalKey, authorization);
        contributions.requireScope(id, scope);
        var receipt = contributions.getReceipt(id, scope.key());
        scope.recheck(authorization);
        return receipt;
    }

    public ContributionScope scope(String key) {
        return ContributionScope.couple(key, authorization);
    }

    public record Saved(ContributionReceipt receipt, boolean created) {
    }
}
