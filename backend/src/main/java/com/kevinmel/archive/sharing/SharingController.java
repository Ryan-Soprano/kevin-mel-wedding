package com.kevinmel.archive.sharing;

import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
public class SharingController {
    private final SharingService sharing;
    private final ArchiveAccessPolicy policy;

    public SharingController(
            SharingService sharing,
            ArchiveAccessPolicy policy) {
        this.sharing = sharing;
        this.policy = policy;
    }

    @GetMapping("/api/shared-memories")
    public ResponseEntity<SharingService.SharedPage> list(
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String cursor) {
        return safe(sharing.publicMemories(limit, cursor));
    }

    @GetMapping("/api/shared-memories/{memoryId}")
    public ResponseEntity<SharedMemory> detail(
            @PathVariable UUID memoryId,
            @RequestParam(required = false) String token) {
        return safe(sharing.detail(memoryId, token));
    }

    @GetMapping("/api/shared-memories/{memoryId}/playback")
    public ResponseEntity<ObjectStorage.ReadGrant> playback(
            @PathVariable UUID memoryId,
            @RequestParam(required = false) String token) {
        return safe(sharing.playback(memoryId, token));
    }

    @PostMapping("/api/memories/{memoryId}/share-link")
    public ResponseEntity<SharingService.ShareLink> issue(
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String contract,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            HttpServletRequest request) {
        SessionService.requireContract(contract);
        policy.requireSameOrigin(request);
        var link = sharing.issueLink(memoryId, ifMatch);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer")
                .header("X-Robots-Tag", "noindex, nofollow")
                .eTag(Integer.toString(link.revision()))
                .body(link);
    }

    private static <T> ResponseEntity<T> safe(T body) {
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer")
                .header("X-Robots-Tag", "noindex, nofollow")
                .body(body);
    }
}
