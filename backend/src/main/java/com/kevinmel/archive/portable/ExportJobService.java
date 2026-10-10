package com.kevinmel.archive.portable;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import com.kevinmel.archive.web.ApiException;

/** Ephemeral, bounded jobs. Restart deliberately loses identities; this is not a backup scheduler. */
@Service
public class ExportJobService implements AutoCloseable {
    public static final long MAX_ZIP_BYTES=83_886_080;
    private static final Duration INACTIVITY=Duration.ofMinutes(30), HARD_LIFETIME=Duration.ofHours(24);
    private static final int MAX_ACTIVE=4, MAX_IDENTITIES=256, MAX_ATTEMPTS=512;
    private final Object monitor=new Object();
    private final Map<UUID,Job> jobs=new LinkedHashMap<>();
    private final PortableExportRepository repository;
    private final PortablePartWriter writer;
    private final ExportAuthority authority;
    private final Clock clock;
    private final FileCleaner cleaner;
    private final java.util.Set<Path> pendingCleanup=new java.util.LinkedHashSet<>();
    private final ThreadPoolExecutor worker;
    private final ScheduledExecutorService maintenance;
    private int pendingTasks;
    private boolean closed, leased, orphanCleanupBlocked;
    private OwnedExportDirectory directory;
    private Cached cached;

    @Autowired
    public ExportJobService(PortableExportRepository repository,PortablePartWriter writer,ExportAuthority authority,Clock clock) {
        this(repository,writer,authority,clock,Files::deleteIfExists);
    }
    ExportJobService(PortableExportRepository repository,PortablePartWriter writer,ExportAuthority authority,Clock clock,FileCleaner cleaner) {
        this.repository=repository; this.writer=writer; this.authority=authority; this.clock=clock;
        this.cleaner=cleaner;
        this.worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(MAX_ACTIVE), runnable -> {
            var thread=new Thread(runnable,"portable-export-worker"); thread.setDaemon(true); return thread;
        },new ThreadPoolExecutor.AbortPolicy());
        this.maintenance=Executors.newSingleThreadScheduledExecutor(runnable -> {
            var thread=new Thread(runnable,"portable-export-expiry"); thread.setDaemon(true); return thread;
        });
        reapOrphans();
        maintenance.scheduleWithFixedDelay(this::maintain,1,1,TimeUnit.MINUTES);
    }

    public ExportStatus create(UUID id,String condition) {
        return respond(actor->create(id,condition,actor));
    }
    private ExportStatus create(UUID id,String condition,ExportAuthority.Actor actor) {
        ExportRequest.id(id); ExportRequest.createCondition(condition);
        synchronized(monitor) {
            if(closed) throw ExportRequest.unavailable();sweep();
            retireOldCredentials(actor);
            var old=jobs.get(id);
            if(old!=null) {
                if(!old.actor.equals(actor)) throw ExportRequest.missing();
                throw new ApiException(412,"EXPORT_EXISTS","Read this known export before starting another.");
            }
            long active=jobs.values().stream().filter(Job::active).count();
            if(active>=MAX_ACTIVE || jobs.values().stream().anyMatch(j->j.active()&&j.actor.accountId().equals(actor.accountId()))) throw ExportRequest.busy();
            if(jobs.size()>=MAX_IDENTITIES) throw new ApiException(429,"EXPORT_LIMIT","Temporary export identities are at capacity. Try later.",60);
            var job=new Job(id,actor,clock.instant()); jobs.put(id,job); pendingTasks++;
            try { worker.execute(()->capture(job)); }
            catch(RuntimeException failure) { pendingTasks--; end(job,"FAILED","EXPORT_FAILED"); }
            return status(job);
        }
    }

    public ExportStatus get(UUID id) {
        return respond(actor->get(id,actor));
    }
    private ExportStatus get(UUID id,ExportAuthority.Actor actor) {
        Job job=owned(id,actor); check(job);
        synchronized(monitor) { touch(job); return status(job); }
    }

    public ExportStatus current() {
        return respond(this::current);
    }
    private ExportStatus current(ExportAuthority.Actor actor) {
        Job found;
        synchronized(monitor) {
            sweep(); retireOldCredentials(actor);
            found=jobs.values().stream().filter(job->job.active()&&job.actor.equals(actor)).findFirst().orElseThrow(ExportRequest::missing);
        }
        check(found); authority.require(actor);
        synchronized(monitor) { if(!found.active()) throw ExportRequest.missing(); touch(found); return status(found); }
    }

    private void retireOldCredentials(ExportAuthority.Actor actor) {
        for(var job:jobs.values()) if(job.active()&&job.actor.accountId().equals(actor.accountId())&&!job.actor.equals(actor)) end(job,"FAILED","ACCESS_REVOKED");
    }

    public ExportStatus.Attempt attempt(UUID id,UUID attempt) {
        return respond(actor->attempt(id,attempt,actor));
    }
    private ExportStatus.Attempt attempt(UUID id,UUID attempt,ExportAuthority.Actor actor) {
        ExportRequest.id(attempt); Job job=owned(id,actor); check(job);
        synchronized(monitor) {
            touch(job); var found=job.attempts.get(attempt); if(found==null) throw ExportRequest.missing(); return found.dto();
        }
    }

    public Mutation prepare(UUID id,int partNumber,String key) {
        return respond(actor->prepare(id,partNumber,key,actor));
    }
    private Mutation prepare(UUID id,int partNumber,String key,ExportAuthority.Actor actor) {
        UUID attemptId=ExportRequest.attempt(key); Job job=owned(id,actor);
        check(job);
        synchronized(monitor) {
            touch(job); var previous=job.attempts.get(attemptId);
            if(previous!=null) { requireSame(previous,"PREPARE",partNumber); return new Mutation(status(job),"RUNNING".equals(previous.state)?202:200); }
            if(!job.active()) throw ExportRequest.unavailable();
            if(job.snapshot==null || pendingTasks!=0 || leased) throw ExportRequest.busy();
            if(partNumber<1 || partNumber>job.parts.size()+1) throw ExportRequest.invalid();
            if(partNumber==job.parts.size()+1 && job.results.keySet().stream().filter(number->number<=job.parts.size()).count()!=job.parts.size())
                throw new ApiException(409,"EXPORT_PARTS_PENDING","Prepare every original part before preparing the final index.");
            // Reserve one identity for explicit cancellation so a full retry history cannot strand an active job.
            if(job.attempts.size()>=MAX_ATTEMPTS-1) throw new ApiException(429,"EXPORT_LIMIT","This export has reached its retry limit. Cancel it before starting a new export deliberately.",60);
            reapOrphans();retryCleanup(); if(orphanCleanupBlocked||!pendingCleanup.isEmpty()) throw new ApiException(503,"EXPORT_TEMP_UNAVAILABLE","Temporary export cleanup could not be confirmed. Try later.");
            deleteCached();
            var attempt=new Attempt(attemptId,"PREPARE",partNumber); job.attempts.put(attemptId,attempt); job.lastAttempt=attempt;
            job.indexFresh=false; job.state="PREPARING"; pendingTasks++;
            try { worker.execute(()->preparePart(job,attempt)); }
            catch(RuntimeException failure) { pendingTasks--; attempt.state="FAILED"; end(job,"FAILED","EXPORT_FAILED"); }
            return new Mutation(status(job),202);
        }
    }

    public ExportStatus cancel(UUID id,String key) {
        return respond(actor->cancel(id,key,actor));
    }
    private ExportStatus cancel(UUID id,String key,ExportAuthority.Actor actor) {
        UUID attemptId=ExportRequest.attempt(key); Job job=owned(id,actor);
        synchronized(monitor) {
            var previous=job.attempts.get(attemptId);
            if(previous!=null) { requireSame(previous,"CANCEL",null); return status(job); }
            if(job.attempts.size()>=MAX_ATTEMPTS) throw ExportRequest.unavailable();
            var attempt=new Attempt(attemptId,"CANCEL",null); attempt.state="SUCCEEDED";
            job.attempts.put(attemptId,attempt); job.lastAttempt=attempt;
            if(job.active()) end(job,"CANCELLED",null);
            return status(job);
        }
    }

    public ExportStatus.Parts parts(UUID id,String limit,String cursor) {
        return respond(actor->parts(id,limit,cursor,actor));
    }
    private ExportStatus.Parts parts(UUID id,String limit,String cursor,ExportAuthority.Actor actor) {
        int size=ExportRequest.limit(limit); Job job=owned(id,actor); check(job);
        synchronized(monitor) {
            touch(job); var all=new ArrayList<ExportStatus.Part>();
            if(job.snapshot!=null) {
                for(int number=1;number<=job.parts.size()+1;number++) {
                    var result=job.results.get(number); boolean isCached=cached!=null&&cached.job==job&&cached.number==number;
                    all.add(new ExportStatus.Part(number,number<=job.parts.size()?"ORIGINALS":"INDEX",isCached?"CACHED":result!=null?"PROCESSED":"UNPROCESSED",
                            result==null?0:included(result.outcomes()),result==null?0:issues(result.outcomes())));
                }
            }
            int offset=ExportRequest.offset(cursor,id,"PARTS",all.size()),end=Math.min(offset+size,all.size());
            return new ExportStatus.Parts(id,List.copyOf(all.subList(offset,end)),end<all.size()?ExportRequest.cursor(id,"PARTS",end):null);
        }
    }

    public ExportStatus.Issues issues(UUID id,String limit,String cursor) {
        return respond(actor->issues(id,limit,cursor,actor));
    }
    private ExportStatus.Issues issues(UUID id,String limit,String cursor,ExportAuthority.Actor actor) {
        int size=ExportRequest.limit(limit); Job job=owned(id,actor); check(job);
        synchronized(monitor) {
            touch(job); var all=new ArrayList<ExportStatus.Issue>();
            for(var entry:job.results.entrySet()) if(entry.getKey()<=job.parts.size()) for(var outcome:entry.getValue().outcomes())
                if(outcome.status()!=PortablePartWriter.Status.INCLUDED) all.add(new ExportStatus.Issue(entry.getKey(),outcome.memoryId(),outcome.assetId(),outcome.status().name()));
            int offset=ExportRequest.offset(cursor,id,"ISSUES",all.size()),end=Math.min(offset+size,all.size());
            return new ExportStatus.Issues(id,List.copyOf(all.subList(offset,end)),end<all.size()?ExportRequest.cursor(id,"ISSUES",end):null);
        }
    }

    public Download download(UUID id,int number,UUID generation) {
        ExportRequest.id(generation); var actor=authority.current(); Job job=owned(id,actor); check(job); authority.require(actor);
        Download result;
        synchronized(monitor) {
            touch(job); if(!job.active()) throw ExportRequest.unavailable();
            if(pendingTasks!=0 || leased) throw ExportRequest.busy();
            if(cached==null || cached.job!=job || cached.number!=number || !cached.generation.equals(generation)) throw ExportRequest.notCached();
            try {
                if(!Files.isRegularFile(cached.path,LinkOption.NOFOLLOW_LINKS) || Files.size(cached.path)!=cached.prepared.byteSize()) throw ExportRequest.notCached();
                result=new Download(cached,Files.newInputStream(cached.path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)); leased=true;
            } catch(IOException failure) { throw new ApiException(503,"EXPORT_DOWNLOAD_FAILED","This temporary export part could not be opened. Prepare it again deliberately."); }
        }
        try {
            if(!check(job)) throw ExportRequest.unavailable(); authority.require(actor); return result;
        } catch(RuntimeException failure) { result.close(); throw failure; }
    }

    /** Recheck after registry/filesystem waits, outside the monitor and before the HTTP response. */
    private <T> T respond(java.util.function.Function<ExportAuthority.Actor,T> action) {
        var actor=authority.current(); authority.require(actor);
        var result=action.apply(actor); authority.require(actor); return result;
    }

    private void capture(Job job) {
        try {
            if(!check(job)) return;
            var snapshot=repository.capture();
            authority.require(job.actor);
            if(!repository.stillCurrent(snapshot)) { synchronized(monitor) { end(job,"STALE","EXPORT_STALE"); } return; }
            var plan=List.copyOf(writer.plan(snapshot));
            authority.require(job.actor);
            if(!repository.stillCurrent(snapshot)) { synchronized(monitor) { end(job,"STALE","EXPORT_STALE"); } return; }
            synchronized(monitor) {
                if(!job.active()) return;
                job.snapshot=snapshot; job.parts=plan; job.state="READY";
            }
        } catch(RuntimeException failure) { fail(job,failure); }
        finally { synchronized(monitor) { pendingTasks--; } }
    }

    private void preparePart(Job job,Attempt attempt) {
        Path destination=null;
        try {
            if(!check(job)) throw new CancellationException();
            PortableSnapshot snapshot; List<PortablePartWriter.OriginalPart> plan; List<PortablePartWriter.OriginalOutcome> outcomes;
            synchronized(monitor) {
                snapshot=job.snapshot; plan=job.parts; outcomes=originalOutcomes(job);
                destination=directory().resolve(UUID.randomUUID()+".zip");
            }
            var prepared=attempt.number<=plan.size()
                ? writer.writeOriginalPart(snapshot,plan.get(attempt.number-1),destination,()->alive(job),original->originalCurrent(job,snapshot,original))
                : writer.writeIndexPart(snapshot,outcomes,destination,()->alive(job));
            if(prepared.byteSize()<1 || prepared.byteSize()>MAX_ZIP_BYTES || !prepared.sha256().matches("[0-9a-f]{64}")) throw new IllegalStateException();
            if(!check(job)) throw new CancellationException();
            synchronized(monitor) {
                if(!job.active()) throw new CancellationException();
                job.results.put(attempt.number,prepared); job.indexFresh=attempt.number==plan.size()+1;
                cached=new Cached(job,attempt.number,UUID.randomUUID(),attempt.id,destination,prepared); destination=null;
                attempt.state="SUCCEEDED"; job.state=unavailable(job)>0?"READY_WITH_WARNINGS":"READY";
            }
        } catch(RuntimeException failure) { synchronized(monitor) { attempt.state="FAILED"; } fail(job,failure); }
        finally {
            try { if(destination!=null) synchronized(monitor) { deletePrivateFile(destination); } }
            catch(RuntimeException cleanupFailure) { synchronized(monitor) { if(job.active()) end(job,"FAILED","EXPORT_TEMP_UNAVAILABLE"); else job.error="EXPORT_TEMP_UNAVAILABLE"; } }
            finally { synchronized(monitor) { pendingTasks--; } }
        }
    }

    private boolean alive(Job job) {
        synchronized(monitor) {
            if(closed || !job.active()) return false;
            if(!clock.instant().isBefore(job.expires)) { end(job,"EXPIRED",null); return false; }
            return true;
        }
    }
    private boolean originalCurrent(Job job,PortableSnapshot snapshot,PortableSnapshot.Original original) {
        if(!alive(job)) return false;
        try { authority.require(job.actor); }
        catch(RuntimeException failure) { fail(job,failure); return false; }
        if(!repository.originalStillCurrent(snapshot,original)) {
            synchronized(monitor) { end(job,"STALE","EXPORT_STALE"); } return false;
        }
        return alive(job);
    }

    /** Calls fresh account and source validation outside any metadata snapshot or registry monitor. */
    private boolean check(Job job) {
        PortableSnapshot snapshot;
        synchronized(monitor) { sweep(); if(closed || !job.active()) return false; snapshot=job.snapshot; }
        try { authority.require(job.actor); }
        catch(RuntimeException failure) { fail(job,failure); return false; }
        if(snapshot!=null && !repository.stillCurrent(snapshot)) {
            synchronized(monitor) { end(job,"STALE","EXPORT_STALE"); } return false;
        }
        synchronized(monitor) { sweep(); return !closed&&job.active(); }
    }

    private Job owned(UUID id,ExportAuthority.Actor actor) {
        ExportRequest.id(id);
        synchronized(monitor) { sweep(); var job=jobs.get(id); if(job==null || !job.actor.equals(actor)) throw ExportRequest.missing(); return job; }
    }
    private void fail(Job job,RuntimeException failure) {
        synchronized(monitor) {
            if(!job.active()) return;
            String code=failure instanceof ApiException api && (api.status()==401 || api.status()==403)?"ACCESS_REVOKED":"EXPORT_FAILED";
            end(job,"FAILED",code);
        }
    }
    private void end(Job job,String state,String code) {
        job.state=state; job.error=code; job.snapshot=null; job.parts=List.of(); job.results.clear(); job.indexFresh=false;
        for(var attempt:job.attempts.values()) if("RUNNING".equals(attempt.state)) attempt.state="FAILED";
        if(cached!=null&&cached.job==job&&!leased) try { deleteCached(); } catch(ApiException failure) { job.error="EXPORT_TEMP_UNAVAILABLE"; }
    }
    private void touch(Job job) { if(job.active()) job.expires=min(clock.instant().plus(INACTIVITY),job.hardExpires); }
    private void sweep() {
        retryCleanup();
        Instant now=clock.instant();
        for(var job:jobs.values()) if(job.active() && !now.isBefore(job.expires)) end(job,"EXPIRED",null);
        jobs.entrySet().removeIf(entry->!entry.getValue().active() && !now.isBefore(entry.getValue().hardExpires)
                && (cached==null||cached.job!=entry.getValue()));
        if(cached!=null && !cached.job.active() && !leased) deleteCached();
    }
    private void maintain() { synchronized(monitor) { try { sweep(); } catch(RuntimeException ignored) { /* The next admission retries cleanup; no paths or content are logged. */ } reapOrphans(); } }
    private static Path temporaryParent() { return Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize(); }
    private void reapOrphans() {
        try { OwnedExportDirectory.reapAbandoned(temporaryParent());orphanCleanupBlocked=false; }
        catch(RuntimeException ignored) { orphanCleanupBlocked=true; /* Preparation retries and fails closed; no paths or content are logged. */ }
    }
    private void deleteCached() {
        if(cached==null) return; if(leased) throw ExportRequest.busy();
        deletePrivateFile(cached.path); cached=null;
    }
    private void deletePrivateFile(Path path) {
        try { cleaner.delete(path); pendingCleanup.remove(path); }
        catch(IOException failure) { pendingCleanup.add(path); throw new ApiException(503,"EXPORT_TEMP_UNAVAILABLE","Temporary export cleanup could not be confirmed. Try later."); }
    }
    private void retryCleanup() {
        if(leased) return;
        for(var path:List.copyOf(pendingCleanup)) try { cleaner.delete(path); pendingCleanup.remove(path); } catch(IOException ignored) { }
        if(cached!=null&&!Files.exists(cached.path,LinkOption.NOFOLLOW_LINKS)) cached=null;
    }
    private Path directory() {
        if(directory!=null) return directory.path();
        try {
            var candidate=OwnedExportDirectory.create(temporaryParent());
            directory=candidate; return candidate.path();
        } catch(RuntimeException failure) {
            throw new ApiException(503,"EXPORT_TEMP_UNAVAILABLE","Private temporary export storage is unavailable.");
        }
    }
    private ExportStatus status(Job job) {
        var snapshot=job.snapshot; int originals=snapshot==null?0:snapshot.originals().size();
        int processed=(int)job.results.keySet().stream().filter(number->number<=job.parts.size()).count();
        var current=cached!=null&&cached.job==job&&job.active()?cached:null;
        var part=current==null?null:new ExportStatus.PreparedPart(current.number,current.number<=job.parts.size()?"ORIGINALS":"INDEX",filename(job.id,current.number),current.prepared.byteSize(),current.prepared.sha256(),current.generation,current.attempt);
        int missing=unavailable(job);
        return new ExportStatus(job.id,job.state,job.created,snapshot==null?null:snapshot.capturedAt(),job.expires,job.hardExpires,
                snapshot==null?0:snapshot.memories().size(),originals,snapshot==null?0:snapshot.originals().stream().mapToLong(PortableSnapshot.Original::byteSize).sum(),
                snapshot==null?Map.of():snapshot.excludedCounts(),
                job.parts.size(),snapshot==null?null:job.parts.size()+1,processed,available(job),missing,
                snapshot!=null&&processed==job.parts.size()&&missing==0&&job.indexFresh,snapshot!=null&&!job.indexFresh,
                part,job.lastAttempt==null?null:job.lastAttempt.dto(),job.error,2);
    }
    private static int available(Job job) { return originalOutcomes(job).stream().mapToInt(outcome->outcome.status()==PortablePartWriter.Status.INCLUDED?1:0).sum(); }
    private static int unavailable(Job job) { return originalOutcomes(job).stream().mapToInt(outcome->outcome.status()==PortablePartWriter.Status.INCLUDED?0:1).sum(); }
    private static List<PortablePartWriter.OriginalOutcome> originalOutcomes(Job job) {
        var all=new ArrayList<PortablePartWriter.OriginalOutcome>();
        job.results.forEach((number,result)->{if(number<=job.parts.size()) all.addAll(result.outcomes());}); return List.copyOf(all);
    }
    private static int included(List<PortablePartWriter.OriginalOutcome> list) { return (int)list.stream().filter(o->o.status()==PortablePartWriter.Status.INCLUDED).count(); }
    private static int issues(List<PortablePartWriter.OriginalOutcome> list) { return list.size()-included(list); }
    private static void requireSame(Attempt attempt,String kind,Integer number) {
        if(!attempt.kind.equals(kind)||!java.util.Objects.equals(attempt.number,number))
            throw new ApiException(409,"IDEMPOTENCY_CONFLICT","That export attempt identity was already used for a different action.");
    }
    private static Instant min(Instant a,Instant b) { return a.isBefore(b)?a:b; }
    private static String filename(UUID id,int number) { return "kevin-mel-archive-"+id+"-part-"+number+".zip"; }
    @FunctionalInterface interface FileCleaner { void delete(Path path) throws IOException; }

    @PreDestroy @Override public void close() {
        RuntimeException initialFailure=null;
        try { synchronized(monitor) { closed=true; for(var job:jobs.values()) if(job.active()) end(job,"CANCELLED",null); } }
        catch(RuntimeException failure) { initialFailure=failure; }
        finally { maintenance.shutdownNow(); worker.shutdownNow(); }
        try { if(!worker.awaitTermination(20,TimeUnit.SECONDS)) throw new IllegalStateException("Export worker shutdown was not confirmed."); }
        catch(InterruptedException failure) { Thread.currentThread().interrupt(); throw new IllegalStateException("Export shutdown was interrupted."); }
        synchronized(monitor) {
            if(leased) { if(initialFailure!=null)throw initialFailure;return; } retryCleanup(); deleteCached();
            if(!pendingCleanup.isEmpty()) throw new IllegalStateException("Temporary export cleanup was not confirmed.");
            if(directory!=null) { directory.close(); directory=null; }
        }
        if(initialFailure!=null) throw initialFailure;
    }
    public record Mutation(ExportStatus status,int statusCode) { }
    private static final class Job {
        final UUID id; final ExportAuthority.Actor actor; final Instant created,hardExpires;
        Instant expires; String state="CAPTURING",error; PortableSnapshot snapshot;
        List<PortablePartWriter.OriginalPart> parts=List.of();
        final Map<Integer,PortablePartWriter.PreparedPart> results=new java.util.TreeMap<>();
        final Map<UUID,Attempt> attempts=new LinkedHashMap<>(); Attempt lastAttempt; boolean indexFresh;
        Job(UUID id,ExportAuthority.Actor actor,Instant at) { this.id=id;this.actor=actor;this.created=at;this.expires=at.plus(INACTIVITY);this.hardExpires=at.plus(HARD_LIFETIME); }
        boolean active() { return java.util.Set.of("CAPTURING","READY","PREPARING","READY_WITH_WARNINGS").contains(state); }
    }
    private static final class Attempt {
        final UUID id; final String kind; final Integer number; String state="RUNNING";
        Attempt(UUID id,String kind,Integer number) { this.id=id;this.kind=kind;this.number=number; }
        ExportStatus.Attempt dto() { return new ExportStatus.Attempt(id,kind,number,state); }
    }
    private record Cached(Job job,int number,UUID generation,UUID attempt,Path path,PortablePartWriter.PreparedPart prepared) { }
    public final class Download implements AutoCloseable {
        private final Cached part; private final InputStream stream; private boolean done;
        private Download(Cached part,InputStream stream) { this.part=part;this.stream=stream; }
        public InputStream stream() { return stream; }
        public long byteSize() { return part.prepared.byteSize(); }
        public String sha256() { return part.prepared.sha256(); }
        public String filename() { return ExportJobService.filename(part.job.id,part.number); }
        public void requireOpen() throws IOException { if(done||!alive(part.job)) throw new IOException("Export transfer ended."); }
        @Override public void close() {
            synchronized(monitor) {
                if(done) return; done=true; try { stream.close(); } catch(IOException ignored) { }
                leased=false; if(!part.job.active()||closed) deleteCached();
                if(closed&&directory!=null) { if(!worker.isTerminated()||!pendingCleanup.isEmpty())throw new IllegalStateException("Temporary export cleanup was not confirmed.");directory.close();directory=null; }
            }
        }
    }
}
