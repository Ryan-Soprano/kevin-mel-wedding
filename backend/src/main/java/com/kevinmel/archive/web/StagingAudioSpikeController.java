package com.kevinmel.archive.web;

import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Disposable local-only recorder preparation. The staging admission filter remains mandatory. */
@RestController
@Profile("staging")
public class StagingAudioSpikeController {
    @GetMapping({"/staging/audio", "/staging/audio/"})
    ResponseEntity<Resource> index() { return file("index.html", "text/html;charset=UTF-8"); }

    @GetMapping("/staging/audio/recorder.js")
    ResponseEntity<Resource> recorder() { return file("recorder.js", "text/javascript;charset=UTF-8"); }

    @GetMapping("/staging/audio/probe-model.js")
    ResponseEntity<Resource> model() { return file("probe-model.js", "text/javascript;charset=UTF-8"); }

    @GetMapping("/staging/audio/style.css")
    ResponseEntity<Resource> style() { return file("style.css", "text/css;charset=UTF-8"); }

    private ResponseEntity<Resource> file(String filename, String type) {
        var resource = new ClassPathResource("staging-audio/" + filename);
        if (!resource.exists()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(type))
                .header("X-Content-Type-Options", "nosniff")
                .header("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; "
                        + "media-src blob:; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
                        + "form-action 'none'; object-src 'none'")
                .body(resource);
    }
}
