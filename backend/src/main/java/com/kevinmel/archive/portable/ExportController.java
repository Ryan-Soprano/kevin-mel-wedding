package com.kevinmel.archive.portable;

import java.io.IOException;
import java.util.Set;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.SessionService;

@RestController
@RequestMapping("/api/exports")
public class ExportController {
    private final ExportJobService jobs;
    private final ArchiveAccessPolicy policy;
    public ExportController(ExportJobService jobs,ArchiveAccessPolicy policy) { this.jobs=jobs;this.policy=policy; }
    @GetMapping(value="/current",produces="application/json")
    public ResponseEntity<ExportStatus> current(@RequestHeader(value="X-Api-Contract",required=false) String version,HttpServletRequest request) {
        read(version,request,Set.of()); return response(jobs.current(),200);
    }
    @PutMapping(value="/{exportId}",produces="application/json")
    public ResponseEntity<ExportStatus> create(@PathVariable UUID exportId,@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestHeader(value="If-None-Match",required=false) String condition,HttpServletRequest request) {
        mutation(version,request); return response(jobs.create(exportId,condition),202);
    }
    @GetMapping(value="/{exportId}",produces="application/json")
    public ResponseEntity<ExportStatus> status(@PathVariable UUID exportId,@RequestHeader(value="X-Api-Contract",required=false) String version,HttpServletRequest request) {
        read(version,request,Set.of()); return response(jobs.get(exportId),200);
    }
    @DeleteMapping(value="/{exportId}",produces="application/json")
    public ResponseEntity<ExportStatus> cancel(@PathVariable UUID exportId,@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest request) {
        mutation(version,request); return response(jobs.cancel(exportId,key),200);
    }
    @PostMapping(value="/{exportId}/parts/{partNumber}/prepare",produces="application/json")
    public ResponseEntity<ExportStatus> prepare(@PathVariable UUID exportId,@PathVariable int partNumber,
            @RequestHeader(value="X-Api-Contract",required=false) String version,@RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest request) {
        mutation(version,request); var result=jobs.prepare(exportId,partNumber,key); return response(result.status(),result.statusCode());
    }
    @GetMapping(value="/{exportId}/attempts/{attemptId}",produces="application/json")
    public ResponseEntity<ExportStatus.Attempt> attempt(@PathVariable UUID exportId,@PathVariable UUID attemptId,
            @RequestHeader(value="X-Api-Contract",required=false) String version,HttpServletRequest request) {
        read(version,request,Set.of()); return response(jobs.attempt(exportId,attemptId),200);
    }
    @GetMapping(value="/{exportId}/parts",produces="application/json")
    public ResponseEntity<ExportStatus.Parts> parts(@PathVariable UUID exportId,@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestParam(required=false) String limit,@RequestParam(required=false) String cursor,HttpServletRequest request) {
        read(version,request,Set.of("limit","cursor")); return response(jobs.parts(exportId,limit,cursor),200);
    }
    @GetMapping(value="/{exportId}/issues",produces="application/json")
    public ResponseEntity<ExportStatus.Issues> issues(@PathVariable UUID exportId,@RequestHeader(value="X-Api-Contract",required=false) String version,
            @RequestParam(required=false) String limit,@RequestParam(required=false) String cursor,HttpServletRequest request) {
        read(version,request,Set.of("limit","cursor")); return response(jobs.issues(exportId,limit,cursor),200);
    }
    @GetMapping(value="/{exportId}/parts/{partNumber}/download")
    public void download(@PathVariable UUID exportId,@PathVariable int partNumber,@RequestParam UUID generation,
            @RequestHeader(value="X-Api-Contract",required=false) String version,HttpServletRequest request,HttpServletResponse response) throws IOException {
        read(version,request,Set.of("generation")); policy.requireSameOrigin(request);
        try(var part=jobs.download(exportId,partNumber,generation)) {
            response.setStatus(200); response.setContentType("application/zip"); response.setContentLengthLong(part.byteSize());
            response.setHeader("Cache-Control","no-store"); response.setHeader("X-Content-Type-Options","nosniff");
            response.setHeader("Content-Disposition","attachment; filename=\""+part.filename()+"\"");
            response.setHeader("X-Archive-SHA256",part.sha256());
            var output=response.getOutputStream(); byte[] buffer=new byte[65_536]; long sent=0;
            for(int size;;) {
                part.requireOpen(); size=part.stream().read(buffer); if(size==-1) break;
                part.requireOpen(); sent+=size; if(sent>part.byteSize()) throw new IOException("Export length changed."); output.write(buffer,0,size);
            }
            if(sent!=part.byteSize()) throw new IOException("Export length changed."); output.flush();
        }
    }
    private void mutation(String version,HttpServletRequest request) {
        read(version,request,Set.of()); policy.requireSameOrigin(request);
    }
    private static void read(String version,HttpServletRequest request,Set<String> allowed) {
        SessionService.requireContract(version); ExportRequest.parameters(request.getParameterMap(),allowed);
    }
    private static <T> ResponseEntity<T> response(T body,int status) { return ResponseEntity.status(status).header("Cache-Control","no-store").body(body); }
}
