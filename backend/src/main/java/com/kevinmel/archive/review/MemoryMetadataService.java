package com.kevinmel.archive.review;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;

@Service
public class MemoryMetadataService {
    private final ArchiveAuthorization authorization;
    private final InboxRepository repository;
    private final Clock clock;
    public MemoryMetadataService(ArchiveAuthorization authorization, InboxRepository repository, Clock clock) {
        this.authorization = authorization; this.repository = repository; this.clock = clock;
    }
    @Transactional
    public MemoryDetail edit(UUID id, Map<String, Object> body, String ifMatch) {
        authorization.requireCoupleAccess();
        var request = MemoryMetadataRequest.from(body, ifMatch);
        var current = repository.lockDetail(id).orElseThrow(ApiException::notFound);
        authorization.requireCoupleAccess();
        if ("DELETE".equals(current.reviewStatus())) throw ApiException.notFound();
        if (current.revision() != request.revision()) throw conflict();
        if (Objects.equals(current.title(), request.title()) && Objects.equals(current.description(), request.description())
                && Objects.equals(current.memoryDate(), request.memoryDate()) && current.datePrecision().equals(request.datePrecision())) return current;
        if (current.revision() == Integer.MAX_VALUE) throw conflict();
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        return repository.changeMetadata(current, request, now.isBefore(current.updatedAt()) ? current.updatedAt() : now);
    }
    public static ApiException conflict() { return new ApiException(412, "METADATA_CONFLICT", "This memory changed. Reload it before editing again."); }
}
