package com.kevinmel.archive.review;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kevinmel.archive.album.AlbumMemberships;
import com.kevinmel.archive.library.TagMemberships;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.security.ArchivePrincipal;
import com.kevinmel.archive.timeline.TimelineMemberships;
import com.kevinmel.archive.web.ApiException;

@Service
public class ReviewService {
    private static final Duration RETENTION = Duration.ofDays(30);
    private static final String DELETED = "DELETE";
    private final ArchiveAuthorization authorization;
    private final InboxRepository repository;
    private final Clock clock;
    private final AlbumMemberships albums;
    private final TimelineMemberships timeline;
    private final TagMemberships tags;

    public ReviewService(
            ArchiveAuthorization authorization,
            InboxRepository repository,
            Clock clock) {
        this(authorization, repository, clock, null, null, null);
    }

    public ReviewService(
            ArchiveAuthorization authorization,
            InboxRepository repository,
            Clock clock,
            AlbumMemberships albums) {
        this(authorization, repository, clock, albums, null, null);
    }

    public ReviewService(
            ArchiveAuthorization authorization,
            InboxRepository repository,
            Clock clock,
            AlbumMemberships albums,
            TimelineMemberships timeline) {
        this(authorization, repository, clock, albums, timeline, null);
    }

    @Autowired
    public ReviewService(
            ArchiveAuthorization authorization,
            InboxRepository repository,
            Clock clock,
            AlbumMemberships albums,
            TimelineMemberships timeline,
            TagMemberships tags) {
        this.authorization = authorization;
        this.repository = repository;
        this.clock = clock;
        this.albums = albums;
        this.timeline = timeline;
        this.tags = tags;
    }

    @Transactional
    public MemoryDetail review(
            UUID memoryId,
            Map<String, Object> body,
            String ifMatch) {
        authorization.requireCoupleAccess();
        var request = ReviewRequest.from(body, ifMatch);
        var current = repository.lockDetail(memoryId)
                .orElseThrow(ReviewService::unavailable);
        // A queued mutation must not retain authority after account revocation while waiting.
        authorization.requireCoupleAccess();
        Instant now = clock.instant()
                .truncatedTo(ChronoUnit.MICROS);
        // A lock can wait across the deadline; recheck after it has actually been acquired.
        if (DELETED.equals(current.reviewStatus()) && !now.isBefore(current.deleteAfter())) {
            throw unavailable();
        }
        if (current.revision() != request.revision()) {
            throw conflict();
        }
        String visibility = visibility(current, request);
        if (current.reviewStatus().equals(request.reviewStatus()) && current.visibility().equals(visibility)) {
            return current;
        }
        if (current.revision() == Integer.MAX_VALUE) {
            throw conflict();
        }

        // Keep timestamps monotonic if a wall-clock adjustment occurs.
        Instant actedAt = now.isBefore(current.updatedAt())
                ? current.updatedAt()
                : now;
        Instant deleteAfter = DELETED.equals(request.reviewStatus())
                ? now.plus(RETENTION)
                : null;
        var changed = current.visibility().equals(visibility)
                ? repository.changeReview(
                        current,
                        request.reviewStatus(),
                        deleteAfter,
                        actedAt)
                : repository.changeReviewAndVisibility(
                        current,
                        request.reviewStatus(),
                        visibility,
                        deleteAfter,
                        actedAt);
        repository.revokeShareLink(memoryId);
        detachDeletedMemberships(memoryId, request.reviewStatus(), actedAt);
        var principal = (ArchivePrincipal) SecurityContextHolder.getContext()
                .getAuthentication()
                .getPrincipal();
        repository.auditReview(current, changed, principal.getAccountId(), actedAt);
        authorization.requireCoupleAccess();
        return changed;
    }

    private static String visibility(MemoryDetail current, ReviewRequest request) {
        String visibility = request.visibility() == null
                ? current.visibility()
                : request.visibility();
        // Restoring a deleted memory never restores its previous audience or a secret link.
        if (!"KEEP".equals(request.reviewStatus()) || DELETED.equals(current.reviewStatus())) {
            return "COUPLE_ONLY";
        }
        return visibility;
    }

    private void detachDeletedMemberships(UUID memoryId, String status, Instant actedAt) {
        if (!DELETED.equals(status)) {
            return;
        }
        if (albums != null) {
            albums.detach(memoryId, actedAt);
            authorization.requireCoupleAccess();
        }
        if (timeline != null) {
            timeline.detach(memoryId, actedAt);
            authorization.requireCoupleAccess();
        }
        if (tags != null) {
            tags.detach(memoryId, actedAt);
            authorization.requireCoupleAccess();
        }
    }

    private static ApiException unavailable() {
        return new ApiException(404, "NOT_FOUND", "That memory is unavailable.");
    }

    private static ApiException conflict() {
        return new ApiException(
                412,
                "REVIEW_CONFLICT",
                "This memory changed. Reload it before reviewing it again.");
    }
}
