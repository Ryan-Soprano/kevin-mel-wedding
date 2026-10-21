package com.kevinmel.archive.album;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.kevinmel.archive.review.InboxRepository;
import com.kevinmel.archive.review.MemoryDetail;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;

@Service
public class AlbumService {
    private final ArchiveAuthorization authorization;
    private final AlbumRepository albums;
    private final InboxRepository memories;
    private final Clock clock;

    public AlbumService(
            ArchiveAuthorization authorization,
            AlbumRepository albums,
            InboxRepository memories,
            Clock clock) {
        this.authorization = authorization;
        this.albums = albums;
        this.memories = memories;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AlbumPage list(
            String limit,
            String cursor) {
        authorization.requireCoupleAccess();
        var query = AlbumQuery.from(limit, cursor, null);
        var rows = albums.list(query, now());
        authorization.requireCoupleAccess();
        boolean more = rows.size() > query.limit();
        var items = more ? rows.subList(0, query.limit()) : rows;
        var last = items.isEmpty() ? null : items.getLast();
        return new AlbumPage(
                List.copyOf(items),
                more && last != null
                        ? AlbumCursor.listing(last.createdAt(), last.albumId()).encode()
                        : null);
    }

    @Transactional(readOnly = true)
    public AlbumDetail detail(UUID id) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        var result = required(id, false);
        authorization.requireCoupleAccess();
        return result;
    }

    @Transactional(readOnly = true)
    public MemberPage members(
            UUID id,
            String limit,
            String cursor) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        var query = AlbumQuery.from(limit, cursor, id);
        var rows = albums.members(id, query, now());
        if (rows.isEmpty()) {
            throw missing();
        }
        var album = rows.getFirst().album();
        if (query.cursor() != null && !album.revision().equals(query.cursor().revision())) {
            throw AlbumRequest.conflict();
        }
        var cards = rows.stream().filter(row -> row.memory() != null).toList();
        boolean more = cards.size() > query.limit();
        var page = more ? cards.subList(0, query.limit()) : cards;
        String next = more
                ? AlbumCursor.members(id, album.revision(), page.getLast().position()).encode()
                : null;
        authorization.requireCoupleAccess();
        return new MemberPage(
                album,
                page.stream()
                        .map(row -> new Member(
                                row.memory(),
                                row.canMoveEarlier(),
                                row.canMoveLater()))
                        .toList(),
                next);
    }

    @Transactional
    public AlbumDetail create(
            UUID id,
            Map<String, Object> body,
            String condition) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        AlbumRequest.createCondition(condition);
        String name = AlbumRequest.name(body);
        if (!albums.create(id, name, now())) {
            throw AlbumRequest.conflict();
        }
        return result(id);
    }

    @Transactional
    public AlbumDetail rename(
            UUID id,
            Map<String, Object> body,
            String ifMatch) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        UUID revision = AlbumRequest.revision(ifMatch);
        String name = AlbumRequest.name(body);
        var current = locked(id, revision);
        active(current);
        if (!name.equals(current.name())) {
            albums.rename(id, name, now());
        }
        return result(id);
    }

    @Transactional
    public AlbumDetail delete(
            UUID id,
            String ifMatch) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        var current = locked(id, AlbumRequest.revision(ifMatch));
        if (current.deletedAt() == null) {
            albums.delete(id, now());
        }
        return result(id);
    }

    @Transactional
    public AlbumDetail add(
            UUID id,
            UUID memoryId,
            String ifMatch) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        UUID revision = AlbumRequest.revision(ifMatch);
        // Memory before album: DELETE and retention use this same order, and
        // remove/move never lock memories.
        var memory = memories.lockDetail(memoryId).orElseThrow(AlbumService::missing);
        authorization.requireCoupleAccess();
        if ("DELETE".equals(memory.reviewStatus())) {
            throw missing();
        }
        var current = locked(id, revision);
        active(current);
        if (albums.position(id, memoryId).isEmpty()) {
            albums.add(id, memoryId);
            albums.refresh(id, now());
        }
        return result(id);
    }

    @Transactional
    public AlbumDetail remove(
            UUID id,
            UUID memoryId,
            String ifMatch) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        var current = locked(id, AlbumRequest.revision(ifMatch));
        active(current);
        if (albums.remove(id, memoryId)) {
            albums.refresh(id, now());
        }
        return result(id);
    }

    @Transactional
    public AlbumDetail move(
            UUID id,
            UUID memoryId,
            Map<String, Object> body,
            String ifMatch) {
        authorization.requireCoupleAccess();
        AlbumRequest.id(id);
        UUID revision = AlbumRequest.revision(ifMatch);
        String direction = AlbumRequest.direction(body);
        var current = locked(id, revision);
        active(current);
        Instant at = now();
        if (!albums.eligibleMember(id, memoryId, at)) {
            throw missing();
        }
        if (albums.move(id, memoryId, direction, at)) {
            albums.refresh(id, at);
        }
        return result(id);
    }

    private AlbumDetail locked(
            UUID id,
            UUID revision) {
        var current = required(id, true);
        authorization.requireCoupleAccess();
        if (!current.revision().equals(revision)) {
            throw AlbumRequest.conflict();
        }
        return current;
    }

    private AlbumDetail result(UUID id) {
        var result = required(id, false);
        authorization.requireCoupleAccess();
        return result;
    }

    private AlbumDetail required(
            UUID id,
            boolean lock) {
        return albums.detail(id, now(), lock).orElseThrow(AlbumService::missing);
    }

    private static void active(AlbumDetail album) {
        if (album.deletedAt() != null) {
            throw missing();
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private static ApiException missing() {
        return new ApiException(404, "NOT_FOUND", "That album or memory is unavailable.");
    }

    public record AlbumPage(
            List<AlbumDetail> items,
            String nextCursor) {
    }

    public record Member(
            MemoryDetail memory,
            boolean canMoveEarlier,
            boolean canMoveLater) {
    }

    public record MemberPage(
            AlbumDetail album,
            List<Member> items,
            String nextCursor) {
    }
}
