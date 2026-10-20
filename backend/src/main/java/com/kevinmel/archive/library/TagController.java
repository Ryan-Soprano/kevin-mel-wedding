package com.kevinmel.archive.library;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
@RequestMapping("/api/tags")
public class TagController {
    private final TagService tags;
    private final ArchiveAccessPolicy policy;

    public TagController(
            TagService tags,
            ArchiveAccessPolicy policy) {
        this.tags = tags;
        this.policy = policy;
    }

    @GetMapping(produces = "application/json")
    public ResponseEntity<TagService.Page> list(
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        LibraryRequest.parameters(request.getParameterMap(), Set.of("q", "limit", "cursor"));
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(tags.list(limit, cursor, q));
    }

    @GetMapping(value = "/{tagId}", produces = "application/json")
    public ResponseEntity<TagDetail> detail(
            @PathVariable UUID tagId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version) {
        SessionService.requireContract(version);
        return response(tags.detail(tagId), 200);
    }

    @GetMapping(value = "/{tagId}/members", produces = "application/json")
    public ResponseEntity<TagService.MemberPage> members(
            @PathVariable UUID tagId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        LibraryRequest.parameters(request.getParameterMap(), Set.of("limit", "cursor"));
        var page = tags.members(tagId, limit, cursor);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .eTag(page.tag().revision().toString())
                .body(page);
    }

    @PutMapping(value = "/{tagId}", produces = "application/json")
    public ResponseEntity<TagDetail> create(
            @PathVariable UUID tagId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-None-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(tags.create(tagId, body, condition), 201);
    }

    @PatchMapping(value = "/{tagId}", produces = "application/json")
    public ResponseEntity<TagDetail> rename(
            @PathVariable UUID tagId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(tags.rename(tagId, body, condition), 200);
    }

    @DeleteMapping(value = "/{tagId}", produces = "application/json")
    public ResponseEntity<TagDetail> delete(
            @PathVariable UUID tagId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(tags.delete(tagId, condition), 200);
    }

    @PutMapping(value = "/{tagId}/members/{memoryId}", produces = "application/json")
    public ResponseEntity<TagDetail> add(
            @PathVariable UUID tagId,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(tags.add(tagId, memoryId, condition), 200);
    }

    @DeleteMapping(value = "/{tagId}/members/{memoryId}", produces = "application/json")
    public ResponseEntity<TagDetail> remove(
            @PathVariable UUID tagId,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(tags.remove(tagId, memoryId, condition), 200);
    }

    private void mutation(
            String version,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        policy.requireSameOrigin(request);
    }

    private static ResponseEntity<TagDetail> response(
            TagDetail tag,
            int status) {
        return ResponseEntity.status(status)
                .header("Cache-Control", "no-store")
                .eTag(tag.revision().toString())
                .body(tag);
    }
}
