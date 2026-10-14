package com.kevinmel.archive.library;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.kevinmel.archive.review.MemoryDetail;
import com.kevinmel.archive.security.ArchiveAuthorization;

@Service
public class LibraryService {
    private final ArchiveAuthorization authorization;
    private final LibraryRepository repository;
    private final Clock clock;
    public LibraryService(ArchiveAuthorization authorization,LibraryRepository repository,Clock clock) {
        this.authorization=authorization; this.repository=repository; this.clock=clock;
    }
    @Transactional(readOnly=true)
    public Page list(String limit,String cursor,String q,String type,String status,String precision,String from,String to,String tag) {
        authorization.requireCoupleAccess();
        var query=LibraryQuery.from(limit,cursor,q,type,status,precision,from,to,tag);
        var rows=repository.list(query,clock.instant().truncatedTo(ChronoUnit.MICROS));
        if(!rows.getFirst().tagValid()) throw LibraryRequest.missing();
        if(!rows.getFirst().anchorValid()) throw LibraryRequest.libraryConflict();
        var cards=rows.stream().map(LibraryRepository.Row::memory).filter(java.util.Objects::nonNull).toList();
        boolean more = cards.size() > query.limit();
        var items = more ? cards.subList(0, query.limit()) : cards;
        String next = more ? new LibraryCursor("LIBRARY", query.fingerprint(), items.getLast().memoryId(), null, null).encode() : null;
        authorization.requireCoupleAccess(); return new Page(List.copyOf(items),next);
    }
    public record Page(List<MemoryDetail> items,String nextCursor) { }
}
