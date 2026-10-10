package com.kevinmel.archive.library;

import java.util.Set;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.security.SessionService;

@RestController
@RequestMapping("/api/library/memories")
public class LibraryController {
    private final LibraryService library;
    private final TagService tags;
    public LibraryController(LibraryService library,TagService tags) { this.library=library; this.tags=tags; }
    @GetMapping(produces="application/json")
    public ResponseEntity<LibraryService.Page> list(@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestParam(required=false) String q,@RequestParam(required=false) String memoryType,@RequestParam(required=false) String reviewStatus,
            @RequestParam(required=false) String datePrecision,@RequestParam(required=false) String fromYear,@RequestParam(required=false) String toYear,
            @RequestParam(required=false) String tagId,@RequestParam(required=false) String limit,@RequestParam(required=false) String cursor,HttpServletRequest request) {
        SessionService.requireContract(version); LibraryRequest.parameters(request.getParameterMap(),Set.of("q","memoryType","reviewStatus","datePrecision","fromYear","toYear","tagId","limit","cursor"));
        return ResponseEntity.ok().header("Cache-Control","no-store").body(library.list(limit,cursor,q,memoryType,reviewStatus,datePrecision,fromYear,toYear,tagId));
    }
    @GetMapping(value="/{memoryId}/tags",produces="application/json")
    public ResponseEntity<TagService.AttachedPage> attached(@PathVariable UUID memoryId,@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestParam(required=false) String limit,@RequestParam(required=false) String cursor,HttpServletRequest request) {
        SessionService.requireContract(version); LibraryRequest.parameters(request.getParameterMap(),Set.of("limit","cursor"));
        return ResponseEntity.ok().header("Cache-Control","no-store").body(tags.attached(memoryId,limit,cursor));
    }
}
