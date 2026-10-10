package com.kevinmel.archive.timeline;

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
public class TimelineService {
    private final ArchiveAuthorization authorization;
    private final TimelineRepository events;
    private final InboxRepository memories;
    private final Clock clock;
    public TimelineService(ArchiveAuthorization authorization,TimelineRepository events,InboxRepository memories,Clock clock) {
        this.authorization=authorization; this.events=events; this.memories=memories; this.clock=clock;
    }
    @Transactional(readOnly=true)
    public EventPage list(String limit,String cursor,String fromYear,String toYear,String datePrecision) {
        authorization.requireCoupleAccess();
        var query=TimelineQuery.listing(limit,cursor,fromYear,toYear,datePrecision);
        var rows=events.list(query,now()); var first=rows.getFirst();
        if (query.cursor()!=null) {
            if (!first.revision().equals(query.cursor().revision())) throw TimelineRequest.conflict();
            if (!first.anchorValid()) throw TimelineRequest.invalidCursor();
        }
        var all=rows.stream().map(TimelineRepository.ListRow::event).filter(java.util.Objects::nonNull).toList();
        boolean more=all.size()>query.limit(); var items=more ? all.subList(0,query.limit()) : all;
        String next=more ? TimelineCursor.listing(first.revision(),items.getLast().eventId(),query.datePrecision(),query.fromYear(),query.toYear()).encode() : null;
        authorization.requireCoupleAccess(); return new EventPage(first.revision(),List.copyOf(items),next);
    }
    @Transactional(readOnly=true)
    public TimelineEvent detail(UUID id) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id);
        return result(id);
    }
    @Transactional(readOnly=true)
    public MemberPage members(UUID id,String limit,String cursor) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id);
        var query=TimelineQuery.members(id,limit,cursor); var rows=events.members(id,query,now());
        if (rows.isEmpty()) throw missing();
        var event=rows.getFirst().event();
        if (query.cursor()!=null) {
            if (!event.revision().equals(query.cursor().revision())) throw TimelineRequest.conflict();
            if (!rows.getFirst().anchorValid()) throw TimelineRequest.invalidCursor();
        }
        var all=rows.stream().map(TimelineRepository.MemberRow::memory).filter(java.util.Objects::nonNull).toList();
        boolean more=all.size()>query.limit(); var items=more ? all.subList(0,query.limit()) : all;
        String next=more ? TimelineCursor.members(id,event.revision(),items.getLast().memoryId()).encode() : null;
        authorization.requireCoupleAccess(); return new MemberPage(event,items.stream().map(Member::new).toList(),next);
    }
    @Transactional
    public TimelineEvent create(UUID id,Map<String,Object> body,String condition) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id); TimelineRequest.createCondition(condition);
        var request=TimelineRequest.from(body); var state=state(true);
        Instant at=actedAt(state,null);
        if (!events.create(id,request,at)) throw TimelineRequest.conflict();
        events.refreshState(at); return result(id);
    }
    @Transactional
    public TimelineEvent edit(UUID id,Map<String,Object> body,String condition) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id);
        UUID revision=TimelineRequest.revision(condition); var request=TimelineRequest.from(body);
        var state=state(false); var event=locked(id,revision); active(event);
        if (!request.matches(event)) { Instant at=actedAt(state,event); events.edit(id,request,at); events.refreshState(at); }
        return result(id);
    }
    @Transactional
    public TimelineEvent delete(UUID id,String condition) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id); UUID revision=TimelineRequest.revision(condition);
        var state=state(false); var event=locked(id,revision);
        if (event.deletedAt()==null) { Instant at=actedAt(state,event); events.delete(id,at); events.refreshState(at); }
        return result(id);
    }
    @Transactional
    public TimelineEvent add(UUID id,UUID memory,String condition) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id); UUID revision=TimelineRequest.revision(condition);
        var original=memories.lockDetail(memory).orElseThrow(TimelineService::missing);
        authorization.requireCoupleAccess(); if ("DELETE".equals(original.reviewStatus())) throw missing();
        var state=state(false); var event=locked(id,revision); active(event);
        if (!events.linked(id,memory)) {
            Instant at=actedAt(state,event); events.add(id,memory); events.refreshEvent(id,at); events.refreshState(at);
        }
        return result(id);
    }
    @Transactional
    public TimelineEvent remove(UUID id,UUID memory,String condition) {
        authorization.requireCoupleAccess(); TimelineRequest.id(id); UUID revision=TimelineRequest.revision(condition);
        var state=state(false); var event=locked(id,revision); active(event);
        if (events.remove(id,memory)) { Instant at=actedAt(state,event); events.refreshEvent(id,at); events.refreshState(at); }
        return result(id);
    }
    private TimelineRepository.State state(boolean initialize) {
        var state=events.lockState(now(),initialize).orElseThrow(TimelineService::missing);
        authorization.requireCoupleAccess(); return state;
    }
    private TimelineEvent locked(UUID id,UUID revision) {
        var event=events.detail(id,now(),true).orElseThrow(TimelineService::missing);
        authorization.requireCoupleAccess(); if (!event.revision().equals(revision)) throw TimelineRequest.conflict(); return event;
    }
    private TimelineEvent result(UUID id) {
        var event=events.detail(id,now(),false).orElseThrow(TimelineService::missing);
        authorization.requireCoupleAccess(); return event;
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private Instant actedAt(TimelineRepository.State state,TimelineEvent event) {
        Instant at=now(); if (state.updatedAt().isAfter(at)) at=state.updatedAt();
        if (event!=null && event.updatedAt().isAfter(at)) at=event.updatedAt(); return at;
    }
    private static void active(TimelineEvent event) { if (event.deletedAt()!=null) throw missing(); }
    private static ApiException missing() { return new ApiException(404,"NOT_FOUND","That event or memory is unavailable."); }
    public record EventPage(UUID revision,List<TimelineEvent> items,String nextCursor) { }
    public record Member(MemoryDetail memory) { }
    public record MemberPage(TimelineEvent event,List<Member> items,String nextCursor) { }
}
