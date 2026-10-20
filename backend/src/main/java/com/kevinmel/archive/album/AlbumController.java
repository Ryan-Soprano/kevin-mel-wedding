package com.kevinmel.archive.album;

import java.util.Map;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
@RequestMapping("/api/albums")
public class AlbumController {
    private final AlbumService albums;
    private final ArchiveAccessPolicy policy;

    public AlbumController(
            AlbumService albums,
            ArchiveAccessPolicy policy) {
        this.albums = albums;
        this.policy = policy;
    }

    @GetMapping(produces = "application/json")
    public ResponseEntity<AlbumService.AlbumPage> list(
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor) {
        SessionService.requireContract(version);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(albums.list(limit, cursor));
    }

    @GetMapping(value = "/{id}", produces = "application/json")
    public ResponseEntity<AlbumDetail> detail(
            @PathVariable UUID id,
            @RequestHeader(value = "X-Api-Contract", required = false) String version) {
        SessionService.requireContract(version);
        return response(albums.detail(id), 200);
    }

    @GetMapping(value = "/{id}/members", produces = "application/json")
    public ResponseEntity<AlbumService.MemberPage> members(
            @PathVariable UUID id,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor) {
        SessionService.requireContract(version);
        var page = albums.members(id, limit, cursor);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .eTag(page.album().revision().toString())
                .body(page);
    }

    @PutMapping(value = "/{id}", produces = "application/json")
    public ResponseEntity<AlbumDetail> create(
            @PathVariable UUID id,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-None-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.create(id, body, condition), 201);
    }

    @PatchMapping(value = "/{id}", produces = "application/json")
    public ResponseEntity<AlbumDetail> rename(
            @PathVariable UUID id,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.rename(id, body, condition), 200);
    }

    @DeleteMapping(value = "/{id}", produces = "application/json")
    public ResponseEntity<AlbumDetail> delete(
            @PathVariable UUID id,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.delete(id, condition), 200);
    }

    @PutMapping(value = "/{id}/members/{memoryId}", produces = "application/json")
    public ResponseEntity<AlbumDetail> add(
            @PathVariable UUID id,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.add(id, memoryId, condition), 200);
    }

    @DeleteMapping(value = "/{id}/members/{memoryId}", produces = "application/json")
    public ResponseEntity<AlbumDetail> remove(
            @PathVariable UUID id,
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.remove(id, memoryId, condition), 200);
    }

    @PostMapping(value = "/{id}/members/{memoryId}/move", produces = "application/json")
    public ResponseEntity<AlbumDetail> move(
            @PathVariable UUID id,
            @PathVariable UUID memoryId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Api-Contract", required = false) String version,
            @RequestHeader(value = "If-Match", required = false) String condition,
            HttpServletRequest request) {
        mutation(version, request);
        return response(albums.move(id, memoryId, body, condition), 200);
    }

    private void mutation(
            String version,
            HttpServletRequest request) {
        SessionService.requireContract(version);
        policy.requireSameOrigin(request);
    }

    private static ResponseEntity<AlbumDetail> response(
            AlbumDetail album,
            int status) {
        return ResponseEntity.status(status)
                .header("Cache-Control", "no-store")
                .eTag(album.revision().toString())
                .body(album);
    }
}
