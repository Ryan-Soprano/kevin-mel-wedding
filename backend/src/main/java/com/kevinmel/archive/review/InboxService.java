package com.kevinmel.archive.review;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;

@Service
public class InboxService {
    private final ArchiveAuthorization authorization;
    private final InboxRepository repository;

    public InboxService(
            ArchiveAuthorization authorization,
            InboxRepository repository) {
        this.authorization = authorization;
        this.repository = repository;
    }

    public InboxPage list(
            String reviewStatus,
            String limit,
            String cursor) {
        authorization.requireCoupleAccess();
        InboxQuery query = InboxQuery.from(reviewStatus, limit, cursor);
        List<MemoryDetail> found = repository.list(query);
        List<MemoryDetail> items = List.copyOf(found.subList(0, Math.min(found.size(), query.limit())));
        String nextCursor = found.size() > query.limit()
                ? new InboxCursor(
                        query.reviewStatus(),
                        items.getLast().createdAt(),
                        items.getLast().memoryId()).encode()
                : null;
        return new InboxPage(items, nextCursor);
    }

    public MemoryDetail detail(UUID memoryId) {
        authorization.requireCoupleAccess();
        if (memoryId == null) {
            throw unavailable();
        }
        return repository.detail(memoryId)
                .orElseThrow(InboxService::unavailable);
    }

    private static ApiException unavailable() {
        return new ApiException(404, "NOT_FOUND", "That memory is unavailable.");
    }

    public record InboxPage(
            List<MemoryDetail> items,
            String nextCursor) {
        public InboxPage {
            items = List.copyOf(items);
        }

        @Override
        public String toString() {
            return "InboxPage[itemCount=" + items.size() + "]";
        }
    }
}
