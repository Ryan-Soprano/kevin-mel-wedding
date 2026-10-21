package com.kevinmel.archive.library;

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

@Service
public class TagService {
    private final ArchiveAuthorization authorization;
    private final TagRepository tags;
    private final InboxRepository memories;
    private final Clock clock;

    public TagService(
            ArchiveAuthorization authorization,
            TagRepository tags,
            InboxRepository memories,
            Clock clock) {
        this.authorization = authorization;
        this.tags = tags;
        this.memories = memories;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page list(
            String limit,
            String cursor,
            String q) {
        return listing(TagQuery.listing(limit, cursor, q, null));
    }

    @Transactional(readOnly = true)
    public AttachedPage attached(
            UUID memory,
            String limit,
            String cursor) {
        var page = listing(TagQuery.listing(limit, cursor, null, memory));
        return new AttachedPage(memory, page.items(), page.nextCursor());
    }

    private Page listing(TagQuery query) {
        authorization.requireCoupleAccess();
        var rows = tags.list(query, now());
        if (!rows.getFirst().memoryValid()) {
            throw LibraryRequest.missing();
        }
        if (!rows.getFirst().anchorValid()) {
            throw LibraryRequest.tagConflict();
        }
        var cards = rows.stream()
            .map(row -> row.tag())
                .filter(java.util.Objects::nonNull)
                .toList();
        boolean more = cards.size() > query.limit();
        var items = more ? cards.subList(0, query.limit()) : cards;
        String cursorType = query.memoryId() == null ? "TAGS" : "ATTACHED";
        String next = more
                ? new LibraryCursor(cursorType, query.fingerprint(), items.getLast().tagId(), null, null).encode()
                : null;
        authorization.requireCoupleAccess();
        return new Page(List.copyOf(items), next);
    }

    @Transactional(readOnly = true)
    public TagDetail detail(UUID id) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        return result(id);
    }

    @Transactional(readOnly = true)
    public MemberPage members(
            UUID id,
            String limit,
            String cursor) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        var query = TagQuery.members(id, limit, cursor);
        var rows = tags.members(id, query, now());
        if (rows.isEmpty()) {
            throw LibraryRequest.missing();
        }
        var tag = rows.getFirst().tag();
        if (query.cursor() != null && !tag.revision().equals(query.cursor().revision())) {
            throw LibraryRequest.tagConflict();
        }
        if (!rows.getFirst().anchorValid()) {
            throw LibraryRequest.tagConflict();
        }
        var cards = rows.stream()
            .map(row -> row.memory())
                .filter(java.util.Objects::nonNull)
                .toList();
        boolean more = cards.size() > query.limit();
        var items = more ? cards.subList(0, query.limit()) : cards;
        String next = more
                ? new LibraryCursor("MEMBERS", null, items.getLast().memoryId(), id, tag.revision()).encode()
                : null;
        authorization.requireCoupleAccess();
        return new MemberPage(tag, items.stream().map(Member::new).toList(), next);
    }

    @Transactional
    public TagDetail create(
            UUID id,
            Map<String, Object> body,
            String condition) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        LibraryRequest.createCondition(condition);
        String name = LibraryRequest.name(body);
        if (!tags.create(id, name, now())) {
            throw LibraryRequest.tagConflict();
        }
        return result(id);
    }

    @Transactional
    public TagDetail rename(
            UUID id,
            Map<String, Object> body,
            String condition) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        UUID revision = LibraryRequest.revision(condition);
        String name = LibraryRequest.name(body);
        var current = locked(id, revision);
        active(current);
        if (!name.equals(current.name())) {
            tags.rename(id, name, now());
        }
        return result(id);
    }

    @Transactional
    public TagDetail delete(
            UUID id,
            String condition) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        var current = locked(id, LibraryRequest.revision(condition));
        if (current.deletedAt() == null) {
            tags.delete(id, now());
        }
        return result(id);
    }

    @Transactional
    public TagDetail add(
            UUID id,
            UUID memory,
            String condition) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        UUID revision = LibraryRequest.revision(condition);
        var original = memories.lockDetail(memory).orElseThrow(LibraryRequest::missing);
        authorization.requireCoupleAccess();
        if ("DELETE".equals(original.reviewStatus())) {
            throw LibraryRequest.missing();
        }
        var current = locked(id, revision);
        active(current);
        if (!tags.linked(id, memory)) {
            tags.add(id, memory);
            tags.refresh(id, now());
        }
        return result(id);
    }

    @Transactional
    public TagDetail remove(
            UUID id,
            UUID memory,
            String condition) {
        authorization.requireCoupleAccess();
        LibraryRequest.tagId(id);
        var current = locked(id, LibraryRequest.revision(condition));
        active(current);
        if (tags.remove(id, memory)) {
            tags.refresh(id, now());
        }
        return result(id);
    }

    private TagDetail locked(
            UUID id,
            UUID revision) {
        var current = tags.detail(id, now(), true).orElseThrow(LibraryRequest::missing);
        authorization.requireCoupleAccess();
        if (!current.revision().equals(revision)) {
            throw LibraryRequest.tagConflict();
        }
        return current;
    }

    private TagDetail result(UUID id) {
        var result = tags.detail(id, now(), false).orElseThrow(LibraryRequest::missing);
        authorization.requireCoupleAccess();
        return result;
    }

    private static void active(TagDetail tag) {
        if (tag.deletedAt() != null) {
            throw LibraryRequest.missing();
        }
    }

    private Instant now() {
        return clock.instant()
                .truncatedTo(ChronoUnit.MICROS);
    }

    public record Page(
            List<TagDetail> items,
            String nextCursor) {
    }

    public record AttachedPage(
            UUID memoryId,
            List<TagDetail> items,
            String nextCursor) {
    }

    public record Member(MemoryDetail memory) {
    }

    public record MemberPage(
            TagDetail tag,
            List<Member> items,
            String nextCursor) {
    }
}
