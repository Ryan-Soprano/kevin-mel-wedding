package com.kevinmel.archive.sharing;

import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** The single shared-memory page is the only additional guest application route. */
@RestController
public class SharedPageController {
    @GetMapping(value = "/shared/{memoryId}", produces = "text/html;charset=UTF-8")
    public ResponseEntity<Resource> shared(@PathVariable UUID memoryId) {
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer")
                .header("X-Robots-Tag", "noindex, nofollow")
                .body(new ClassPathResource("static/index.html"));
    }
}
