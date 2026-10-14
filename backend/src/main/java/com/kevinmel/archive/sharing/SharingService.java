package com.kevinmel.archive.sharing;

import java.time.Clock;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.media.PlaybackRepository;
import com.kevinmel.archive.media.PlaybackService;
import com.kevinmel.archive.review.InboxCursor;
import com.kevinmel.archive.review.InboxQuery;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.ReviewRequest;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.security.ArchivePrincipal;
import com.kevinmel.archive.web.ApiException;

@Service
public class SharingService {
    private final SharingRepository shares;
    private final InboxRepository inbox;
    private final PlaybackRepository media;
    private final ObjectStorage storage;
    private final ArchiveAuthorization authorization;
    private final Clock clock;
    public SharingService(SharingRepository shares, InboxRepository inbox, PlaybackRepository media,
            ObjectStorage storage, ArchiveAuthorization authorization, Clock clock) {
        this.shares = shares; this.inbox = inbox; this.media = media; this.storage = storage;
        this.authorization = authorization; this.clock = clock;
    }
    @Transactional(readOnly = true)
    public SharedPage publicMemories(String limit, String cursor) {
        var query = InboxQuery.from("KEEP", limit, cursor);
        var found = shares.publicMemories(query.limit(), query.cursor());
        var items = List.copyOf(found.subList(0, Math.min(found.size(), query.limit())));
        String next = found.size() > query.limit()
                ? new InboxCursor("KEEP", items.getLast().createdAt(), items.getLast().memoryId()).encode() : null;
        return new SharedPage(items, next);
    }
    @Transactional(readOnly = true)
    public SharedMemory detail(UUID memoryId, String token) {
        return shares.accessible(memoryId, ShareTokens.digest(token)).orElseThrow(SharingService::unavailable);
    }
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ObjectStorage.ReadGrant playback(UUID memoryId, String token) {
        var memory = shares.accessibleDetail(memoryId, ShareTokens.digest(token), true).orElseThrow(SharingService::unavailable);
        if (!("PHOTO".equals(memory.memoryType()) || "AUDIO".equals(memory.memoryType()))) throw unavailable();
        var asset = media.findPlayable(memoryId).orElseThrow(SharingService::unavailable);
        PlaybackService.requireVerifiedOriginal(asset);
        return storage.authorizeRead(asset.objectKey(), asset.contentType(), asset.byteSize(), clock.instant().plus(Duration.ofMinutes(5)));
    }
    @Transactional
    public ShareLink issueLink(UUID memoryId, String ifMatch) {
        authorization.requireCoupleAccess();
        int revision = ReviewRequest.from(Map.of("reviewStatus", "KEEP"), ifMatch).revision();
        var current = inbox.lockDetail(memoryId).orElseThrow(SharingService::unavailable);
        authorization.requireCoupleAccess();
        if (current.revision() != revision || revision == Integer.MAX_VALUE) throw conflict();
        if (!"KEEP".equals(current.reviewStatus()) || !"FRIENDS_FAMILY".equals(current.visibility())) throw unavailable();
        var at = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (at.isBefore(current.updatedAt())) at = current.updatedAt();
        String token = ShareTokens.create();
        var changed = inbox.changeReview(current, "KEEP", null, at);
        shares.issue(memoryId, ShareTokens.digest(token), at);
        var principal = (ArchivePrincipal) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        inbox.auditReview(current, changed, principal.getAccountId(), at);
        authorization.requireCoupleAccess();
        return new ShareLink(memoryId, changed.revision(), "/shared/" + memoryId + "#token=" + token);
    }
    public record SharedPage(List<SharedMemory> items, String nextCursor) {
        public SharedPage { items = List.copyOf(items); }
        @Override public String toString() { return "SharedPage[itemCount=" + items.size() + "]"; }
    }
    public record ShareLink(UUID memoryId, int revision, String url) {
        @Override public String toString() { return "ShareLink[memoryId=" + memoryId + "]"; }
    }
    private static ApiException unavailable() { return new ApiException(404, "NOT_FOUND", "That shared memory is unavailable."); }
    private static ApiException conflict() { return new ApiException(412, "REVIEW_CONFLICT", "This memory changed. Reload it before sharing it again."); }
}
