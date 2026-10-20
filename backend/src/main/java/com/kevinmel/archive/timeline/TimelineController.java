package com.kevinmel.archive.timeline;

import java.util.Map;
import java.util.UUID;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
@RequestMapping("/api/timeline/events")
public class TimelineController {
    private static final String NO_STORE = "no-store";
    private final TimelineService timeline;
    private final ArchiveAccessPolicy policy;

    public TimelineController(
            TimelineService timeline,
            ArchiveAccessPolicy policy) {
        this.timeline = timeline;
        this.policy = policy;
    }

    @GetMapping(produces = "application/json")
    public ResponseEntity<TimelineService.EventPage> list(
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) String fromYear,
            @RequestParam(required = false) String toYear,
            @RequestParam(required = false) String datePrecision,
            HttpServletRequest request) {
        TimelineQuery.requireParameters(
                request.getParameterMap(),
                Set.of("limit", "cursor", "fromYear", "toYear", "datePrecision"));
        SessionService.requireContract(version);
        var page = timeline.list(
                limit,
                cursor,
                fromYear,
                toYear,
                datePrecision);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, NO_STORE)
                .eTag(page.revision().toString())
                .body(page);
    }

    @GetMapping(value = "/{eventId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> detail(
            @PathVariable UUID eventId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version) {
        SessionService.requireContract(version);
        return response(timeline.detail(eventId), 200);
    }

    @GetMapping(value = "/{eventId}/memories", produces = "application/json")
    public ResponseEntity<TimelineService.MemberPage> members(
            @PathVariable UUID eventId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        TimelineQuery.requireParameters(request.getParameterMap(), Set.of("limit", "cursor"));
        SessionService.requireContract(version);
        var page = timeline.members(eventId, limit, cursor);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, NO_STORE)
                .eTag(page.event().revision().toString())
                .body(page);
    }

    @PutMapping(value = "/{eventId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> create(
            @PathVariable UUID eventId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-None-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(timeline.create(eventId, body, condition), 201);
    }

    @PatchMapping(value = "/{eventId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> edit(
            @PathVariable UUID eventId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(timeline.edit(eventId, body, condition), 200);
    }

    @DeleteMapping(value = "/{eventId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> delete(
            @PathVariable UUID eventId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(timeline.delete(eventId, condition), 200);
    }

    @PutMapping(value = "/{eventId}/memories/{memoryId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> add(
            @PathVariable UUID eventId,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(timeline.add(eventId, memoryId, condition), 200);
    }

    @DeleteMapping(value = "/{eventId}/memories/{memoryId}", produces = "application/json")
    public ResponseEntity<TimelineEvent> remove(
            @PathVariable UUID eventId,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(timeline.remove(eventId, memoryId, condition), 200);
    }

    private void mutation(
            String version,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        policy.requireSameOrigin(request);
    }

    private static ResponseEntity<TimelineEvent> response(
            TimelineEvent event,
            int status) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.CACHE_CONTROL, NO_STORE)
                .eTag(event.revision().toString())
                .body(event);
    }
}
