package com.kevinmel.archive.media;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.kevinmel.archive.security.SessionService;

@RestController
public class PlaybackController {
    private final PlaybackService playback;

    public PlaybackController(PlaybackService playback) {
        this.playback = playback;
    }

    @GetMapping(value = "/api/memories/{memoryId}/playback", produces = "application/json")
    public ObjectStorage.ReadGrant playback(
            @PathVariable UUID memoryId,
            @RequestHeader(value = "X-Api-Contract", required = false) String version) {
        SessionService.requireContract(version);
        return playback.playback(memoryId);
    }
}
