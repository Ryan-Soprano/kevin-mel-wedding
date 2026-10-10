package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.*;
import java.net.http.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import javax.imageio.ImageIO;
import javax.sql.DataSource;
import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.retention.RetentionRepository;
import com.kevinmel.archive.timeline.TimelineCursor;
import com.kevinmel.archive.timeline.TimelineRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Real HTTP/session/PostgreSQL boundaries, with synthetic originals and no provider or physical-device claim. */
@Testcontainers
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "archive.environment=local","spring.profiles.active=local","archive.audio.enabled=true",
        "archive.revealed=true","archive.storage.enabled=false","archive.media.uploads-paused=false","archive.retention.enabled=false"})
@Import(CoupleAuthoringHttpTest.Fixtures.class)
class TimelineHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON=JsonMapper.builder().build();
    private static final String LIST="/api/timeline/events";
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired DataSource dataSource;
    @Autowired PasswordEncoder encoder;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired CoupleAuthoringHttpTest.ControlledStorage storage;
    @Autowired RetentionRepository retention;
    private Session couple;
    @BeforeEach void isolate() throws Exception {
        db.sql("TRUNCATE timeline_state,timeline_event,album,contribution,archive_account CASCADE").update();
        clock.now=Instant.parse("2026-10-10T12:00:00Z");
        storage.objects.clear(); storage.outage=false; storage.afterRead=null;
        couple=login();
    }

    @Test void emptyReadIsNonMutatingAndConditionalCreateDeleteHasTerminalIdentity() throws Exception {
        var empty=get(LIST); assertThat(empty.statusCode()).isEqualTo(200);
        assertThat(text(empty,"$.revision")).isEqualTo(TimelineRepository.EMPTY_REVISION.toString());
        assertThat(etag(empty)).isEqualTo("\""+TimelineRepository.EMPTY_REVISION+"\""); assertThat(ids(empty)).isEmpty();
        assertThat(db.sql("SELECT count(*) FROM timeline_state").query(Long.class).single()).isZero();
        UUID id=UUID.randomUUID(); var body=metadata(" Wedding milestone "," Our story ","2026-10","MONTH");
        assertThat(write("PUT",event(id),body,null).statusCode()).isEqualTo(428);
        var created=create(id,body); assertThat(text(created,"$.title")).isEqualTo("Wedding milestone");
        assertThat(text(created,"$.description")).isEqualTo("Our story"); assertThat(text(created,"$.eventDate")).isEqualTo("2026-10");
        assertThat(text(created,"$.visibility")).isEqualTo("COUPLE_ONLY"); assertToken(created);
        assertThat(db.sql("SELECT count(*) FROM timeline_state").query(Long.class).single()).isEqualTo(1);
        String global=etag(get(LIST)); assertThat(global).isNotEqualTo(etag(empty));
        assertThat(write("PUT",event(id),metadata("Overwrite",null,null,"UNKNOWN"),"*").statusCode()).isEqualTo(412);
        var noOp=write("PATCH",event(id),body,etag(created)); assertThat(etag(noOp)).isEqualTo(etag(created));
        assertThat(etag(get(LIST))).isEqualTo(global);
        var edited=write("PATCH",event(id),metadata("Changed milestone",null,"2027","YEAR"),etag(created));
        assertThat(edited.statusCode()).isEqualTo(200); assertThat(etag(edited)).isNotEqualTo(etag(created));
        assertThat(etag(get(LIST))).isNotEqualTo(global);
        assertThat(write("PATCH",event(id),body,etag(created)).statusCode()).isEqualTo(412);
        UUID memory=note("Original remains"); var original=get("/api/memories/"+memory);
        var attached=write("PUT",link(id,memory),null,etag(edited));
        var deleted=write("DELETE",event(id),null,etag(attached)); assertThat(deleted.statusCode()).isEqualTo(200);
        for(String field:List.of("title","description","eventDate")) assertThat(JsonPath.<Object>read(deleted.body(),"$."+field)).isNull();
        assertThat(text(deleted,"$.datePrecision")).isEqualTo("UNKNOWN"); assertThat(number(deleted,"$.memberCount")).isZero();
        assertThat(get(event(id)).body()).isEqualTo(deleted.body()); assertThat(ids(get(LIST))).isEmpty();
        assertThat(memories(get(event(id)+"/memories"))).isEmpty();
        global=etag(get(LIST)); assertThat(etag(write("DELETE",event(id),null,etag(deleted)))).isEqualTo(etag(deleted));
        assertThat(etag(get(LIST))).isEqualTo(global);
        assertThat(write("PUT",event(id),body,"*").statusCode()).isEqualTo(412);
        assertThat(write("PATCH",event(id),body,etag(deleted)).statusCode()).isEqualTo(404);
        assertThat(get("/api/memories/"+memory).body()).isEqualTo(original.body());
    }

    @Test void partialChronologyYearFiltersAndAnchorsInvalidateOnDateEdits() throws Exception {
        UUID unknown=UUID.randomUUID(),year=UUID.randomUUID(),month=UUID.randomUUID(),day=UUID.randomUUID(),old=UUID.randomUUID();
        create(unknown,metadata("Unknown",null,null,"UNKNOWN"));
        create(day,metadata("Leap day",null,"2024-02-29","DAY"));
        create(month,metadata("February",null,"2024-02","MONTH"));
        var yearEvent=create(year,metadata("Year only",null,"2024","YEAR"));
        create(old,metadata("Oldest",null,"0001","YEAR"));
        assertThat(ids(get(LIST))).containsExactly(old.toString(),year.toString(),month.toString(),day.toString(),unknown.toString());
        assertThat(ids(get(LIST+"?fromYear=2024&toYear=2024"))).containsExactly(year.toString(),month.toString(),day.toString());
        assertThat(ids(get(LIST+"?datePrecision=UNKNOWN"))).containsExactly(unknown.toString());
        assertThat(ids(get(LIST+"?datePrecision=MONTH"))).containsExactly(month.toString());
        var page=get(LIST+"?limit=2"); String cursor=text(page,"$.nextCursor");
        String decoded=new String(Base64.getUrlDecoder().decode(cursor),java.nio.charset.StandardCharsets.UTF_8);
        assertThat(decoded).doesNotContain("2024","Oldest","Year only");
        assertThat(ids(get(LIST+"?limit=2&cursor="+cursor))).containsExactly(month.toString(),day.toString());
        assertThat(get(LIST+"?datePrecision=YEAR&cursor="+cursor).statusCode()).isEqualTo(400);
        UUID global=UUID.fromString(text(page,"$.revision"));
        String forged=TimelineCursor.listing(global,UUID.randomUUID(),"ALL",null,null).encode();
        assertThat(get(LIST+"?cursor="+forged).statusCode()).isEqualTo(400);
        assertThat(write("PATCH",event(year),metadata("Year only",null,"2028","YEAR"),etag(yearEvent)).statusCode()).isEqualTo(200);
        assertThat(get(LIST+"?cursor="+cursor).statusCode()).isEqualTo(412);
        assertThat(ids(get(LIST))).containsExactly(old.toString(),month.toString(),day.toString(),year.toString(),unknown.toString());
    }

    @Test void linkedMemoryDatesStayDistinctAndLegacyIdsAndSharedMembershipAreSupported() throws Exception {
        UUID id=UUID.randomUUID(),other=UUID.randomUUID(); var current=create(id,metadata("Event title","Event description","2024","YEAR"));
        var second=create(other,metadata("Other event",null,null,"UNKNOWN"));
        UUID original=note("Immutable note"),legacy=UUID.fromString("00000000-0000-1000-8000-000000000001");
        db.sql("UPDATE memory SET id=:legacy WHERE id=:id").param("legacy",legacy).param("id",original).update();
        var ownDate=send(couple,"PATCH","/api/memories/"+legacy+"/metadata",JSON.writeValueAsString(Map.of(
                "title","Memory title","description","Memory description","memoryDate","2020-02-29","datePrecision","DAY")),Map.of("If-Match","\"1\""));
        assertThat(ownDate.statusCode()).isEqualTo(200); var before=get("/api/memories/"+legacy);
        current=write("PUT",link(id,legacy),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
        assertThat(write("PUT",link(other,legacy),null,etag(second)).statusCode()).isEqualTo(200);
        var page=get(event(id)+"/memories");
        assertThat(text(page,"$.event.title")).isEqualTo("Event title"); assertThat(text(page,"$.event.eventDate")).isEqualTo("2024");
        assertThat(text(page,"$.items[0].memory.title")).isEqualTo("Memory title");
        assertThat(text(page,"$.items[0].memory.description")).isEqualTo("Memory description");
        assertThat(text(page,"$.items[0].memory.datePrecision")).isEqualTo("DAY");
        assertThat(text(page,"$.items[0].memory.memoryDate")).isEqualTo("2020-02-29");
        String global=etag(get(LIST));
        assertThat(etag(write("PUT",link(id,legacy),null,etag(current)))).isEqualTo(etag(current)); assertThat(etag(get(LIST))).isEqualTo(global);
        var removed=write("DELETE",link(id,legacy),null,etag(current)); assertThat(number(removed,"$.memberCount")).isZero();
        global=etag(get(LIST)); assertThat(etag(write("DELETE",link(id,legacy),null,etag(removed)))).isEqualTo(etag(removed));
        assertThat(etag(get(LIST))).isEqualTo(global); assertThat(number(get(event(other)),"$.memberCount")).isEqualTo(1);
        assertThat(get("/api/memories/"+legacy).body()).isEqualTo(before.body());
    }

    @Test void paginatedMembersUseSavedOrderAndRejectStaleOrForeignAnchors() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,metadata("Large event",null,null,"UNKNOWN"));
        var expected=new ArrayList<String>();
        for(int i=0;i<53;i++) {
            clock.now=clock.now.plusSeconds(1); UUID memory=note("Synthetic ordered memory "+i); expected.add(memory.toString());
            current=write("PUT",link(id,memory),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
        }
        var first=get(event(id)+"/memories?limit=50"); String cursor=text(first,"$.nextCursor");
        assertThat(memories(first)).containsExactlyElementsOf(expected.subList(0,50));
        var tail=get(event(id)+"/memories?limit=50&cursor="+cursor); assertThat(memories(tail)).containsExactlyElementsOf(expected.subList(50,53));
        assertThat(JsonPath.<Object>read(tail.body(),"$.nextCursor")).isNull();
        String forged=TimelineCursor.members(id,UUID.fromString(text(current,"$.revision")),UUID.randomUUID()).encode();
        assertThat(get(event(id)+"/memories?cursor="+forged).statusCode()).isEqualTo(400);
        assertThat(get(event(UUID.randomUUID())+"/memories?cursor="+cursor).statusCode()).isEqualTo(400);
        assertThat(write("DELETE",link(id,UUID.fromString(expected.getFirst())),null,etag(current)).statusCode()).isEqualTo(200);
        assertThat(get(event(id)+"/memories?cursor="+cursor).statusCode()).isEqualTo(412);
        for(int i=0;i<51;i++) create(UUID.randomUUID(),metadata("Extra event "+i,null,"9999","YEAR"));
        var events=get(LIST+"?limit=50"); assertThat(ids(events)).hasSize(50);
        assertThat(ids(get(LIST+"?limit=50&cursor="+text(events,"$.nextCursor")))).hasSize(2);
    }

    @Test void originalDeleteDetachesEventsAndAlbumsAndErasureReplayNeverRejoins() throws Exception {
        UUID memory=note("Delete original"),one=UUID.randomUUID(),two=UUID.randomUUID(),album=UUID.randomUUID();
        var a=write("PUT",link(one,memory),null,etag(create(one,metadata("One",null,"2024","YEAR"))));
        var b=write("PUT",link(two,memory),null,etag(create(two,metadata("Two",null,"2025","YEAR"))));
        var collection=write("PUT","/api/albums/"+album,Map.of("name","Shared collection"),"*");
        assertThat(write("PUT","/api/albums/"+album+"/members/"+memory,null,etag(collection)).statusCode()).isEqualTo(200);
        String global=etag(get(LIST)); var deleted=review(memory,"DELETE","\"1\""); assertThat(deleted.statusCode()).isEqualTo(200);
        assertThat(etag(get(LIST))).isNotEqualTo(global);
        for(var entry:Map.of(one,etag(a),two,etag(b)).entrySet()) {
            var event=get(event(entry.getKey())); assertThat(number(event,"$.memberCount")).isZero();
            assertThat(etag(event)).isNotEqualTo(entry.getValue());
        }
        assertThat(db.sql("SELECT count(*) FROM timeline_event_memory").query(Long.class).single()).isZero();
        assertThat(db.sql("SELECT count(*) FROM album_membership").query(Long.class).single()).isZero();
        assertThat(write("PUT",link(one,memory),null,etag(get(event(one)))).statusCode()).isEqualTo(404);
        var restored=review(memory,"KEEP",etag(deleted)); assertThat(restored.statusCode()).isEqualTo(200);
        assertThat(number(get(event(one)),"$.memberCount")).isZero();
        assertThat(write("PUT",link(one,memory),null,etag(get(event(one)))).statusCode()).isEqualTo(200);
        assertThat(review(memory,"DELETE",etag(restored)).statusCode()).isEqualTo(200);
        Instant at=clock.now.plus(Duration.ofDays(31)); var plan=retention.claim(10,at).getFirst();
        db.sql("INSERT INTO timeline_event_memory(event_id,memory_id) VALUES(:event,:memory)").param("event",one).param("memory",memory).update();
        assertThat(retention.finish(plan,at)).isTrue();
        global=etag(get(LIST)); String token=etag(get(event(one)));
        db.sql("INSERT INTO timeline_event_memory(event_id,memory_id) VALUES(:event,:memory)").param("event",one).param("memory",memory).update();
        assertThat(retention.finish(plan,at)).isFalse(); assertThat(etag(get(LIST))).isNotEqualTo(global); assertThat(etag(get(event(one)))).isNotEqualTo(token);
        assertThat(db.sql("SELECT count(*) FROM timeline_event_memory").query(Long.class).single()).isZero();
        assertThat(db.sql("SELECT count(*) FROM timeline_event WHERE deleted_at IS NULL").query(Long.class).single()).isEqualTo(2);
        assertThat(db.sql("SELECT s.updated_at >= max(te.updated_at) FROM timeline_state s CROSS JOIN timeline_event te GROUP BY s.updated_at")
                .query(Boolean.class).single()).isTrue();
    }

    @Test void unrelatedErasureDoesNotInitializeTimelineState() throws Exception {
        UUID memory=note("Unrelated erasure"); assertThat(review(memory,"DELETE","\"1\"").statusCode()).isEqualTo(200);
        Instant at=clock.now.plus(Duration.ofDays(31)); assertThat(retention.finish(retention.claim(10,at).getFirst(),at)).isTrue();
        assertThat(db.sql("SELECT count(*) FROM timeline_state").query(Long.class).single()).isZero();
        assertThat(text(get(LIST),"$.revision")).isEqualTo(TimelineRepository.EMPTY_REVISION.toString());
    }

    @Test void concurrentIdentityAndRevisionChangesHaveOnlyOneWinner() throws Exception {
        UUID id=UUID.randomUUID();
        try(var workers=Executors.newFixedThreadPool(2)) {
            var a=workers.submit(()->write("PUT",event(id),metadata("First",null,"2024","YEAR"),"*"));
            var b=workers.submit(()->write("PUT",event(id),metadata("Second",null,"2025","YEAR"),"*"));
            assertThat(List.of(a.get(30,TimeUnit.SECONDS).statusCode(),b.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(201,412);
            String token=etag(get(event(id)));
            a=workers.submit(()->write("PATCH",event(id),metadata("A",null,"2026","YEAR"),token));
            b=workers.submit(()->write("PATCH",event(id),metadata("B",null,"2027","YEAR"),token));
            assertThat(List.of(a.get(30,TimeUnit.SECONDS).statusCode(),b.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(200,412);
        }
        assertThat(db.sql("SELECT count(*) FROM timeline_event").query(Long.class).single()).isEqualTo(1);
        assertThat(db.sql("SELECT count(*) FROM timeline_state").query(Long.class).single()).isEqualTo(1);
    }

    @Test void waitingForStateOrEventRechecksAccountBeforeAnyLinkCommit() throws Exception {
        for(boolean holdState:List.of(true,false)) {
            couple=login(); UUID id=UUID.randomUUID(),memory=note("Queued original"); String token=etag(create(id,metadata("Locked",null,null,"UNKNOWN")));
            String global=etag(get(LIST));
            try(var holder=dataSource.getConnection();var workers=Executors.newSingleThreadExecutor()) {
                holder.setAutoCommit(false); int pid=pid(holder);
                try(var q=holder.prepareStatement(holdState ? "SELECT id FROM timeline_state WHERE id=1 FOR UPDATE" : "SELECT id FROM timeline_event WHERE id=? FOR UPDATE")) {
                    if(!holdState)q.setObject(1,id); q.executeQuery().close();
                }
                var future=workers.submit(()->write("PUT",link(id,memory),null,token));
                try { awaitWaiter(pid); assertThat(future.isDone()).isFalse(); db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id",couple.id()).update(); }
                finally { holder.rollback(); }
                assertThat(future.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(401);
            }
            assertThat(db.sql("SELECT count(*) FROM timeline_event_memory WHERE event_id=:id").param("id",id).query(Long.class).single()).isZero();
            assertThat(db.sql("SELECT revision FROM timeline_event WHERE id=:id").param("id",id).query(UUID.class).single().toString()).isEqualTo(token.substring(1,token.length()-1));
            assertThat(db.sql("SELECT revision FROM timeline_state WHERE id=1").query(UUID.class).single().toString()).isEqualTo(global.substring(1,global.length()-1));
        }
    }

    @Test void addThenOriginalDeleteWaitsInOneLockOrderAndLeavesNoLink() throws Exception {
        UUID memory=note("Race original"),id=UUID.randomUUID(); String token=etag(create(id,metadata("Race event",null,null,"UNKNOWN")));
        try(var holder=dataSource.getConnection();var workers=Executors.newFixedThreadPool(2)) {
            holder.setAutoCommit(false); int pid=pid(holder);
            try(var q=holder.createStatement()) { q.executeQuery("SELECT id FROM timeline_state WHERE id=1 FOR UPDATE").close(); }
            var add=workers.submit(()->write("PUT",link(id,memory),null,token));
            java.util.concurrent.Future<HttpResponse<String>> delete;
            try {
                int addingPid=awaitWaiter(pid); assertThat(add.isDone()).isFalse();
                delete=workers.submit(()->review(memory,"DELETE","\"1\""));
                awaitWaiter(addingPid); assertThat(delete.isDone()).isFalse();
            } finally { holder.rollback(); }
            assertThat(add.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(delete.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        }
        assertThat(db.sql("SELECT count(*) FROM timeline_event_memory").query(Long.class).single()).isZero();
        assertThat(number(get(event(id)),"$.memberCount")).isZero();
    }

    @Test void malformedPrivateBodiesDatesFiltersAndConditionsCannotMutate() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,metadata("Validation",null,null,"UNKNOWN")); String global=etag(get(LIST));
        var guest=new Session(null,HttpClient.newHttpClient(),null);
        for(String path:List.of("/api/timeline","/api/timeline/",LIST,LIST+"/",event(id),event(id)+"/memories"))
            assertThat(send(guest,"GET",path,null,Map.of()).statusCode()).isIn(401,403);
        var revoked=login(); db.sql("UPDATE archive_account SET role='OPERATOR' WHERE id=:id").param("id",revoked.id()).update();
        assertThat(send(revoked,"GET",LIST,null,Map.of()).statusCode()).isEqualTo(401);
        for(String body:List.of("null","{}","{\"title\":\"ok\",\"description\":null,\"eventDate\":null,\"datePrecision\":\"UNKNOWN\",\"visibility\":\"PUBLIC\"}"))
            assertThat(send(couple,"PATCH",event(id),body,Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        for(Map<String,Object> body:List.of(metadata(" ",null,null,"UNKNOWN"),metadata("x".repeat(201),null,null,"UNKNOWN"),
                metadata("ok",null,"0000","YEAR"),metadata("ok",null,"2024-2","MONTH"),metadata("ok",null,"2023-02-29","DAY"),
                metadata("ok",null,"2024-02-30","DAY"),metadata("ok",null,"2024","UNKNOWN")))
            assertThat(write("PATCH",event(id),body,etag(current)).statusCode()).isEqualTo(400);
        for(String suffix:List.of("limit=0","limit=51","fromYear=0","fromYear=10000","fromYear=2025&toYear=2024",
                "datePrecision=UNKNOWN&fromYear=2024","datePrecision=toString","unknown=1","limit=1&limit=2","cursor=invalid"))
            assertThat(get(LIST+"?"+suffix).statusCode()).as(suffix).isEqualTo(400);
        assertThat(send(couple,"PATCH",event(id)," ".repeat(16_385),Map.of("If-Match",etag(current))).statusCode()).isEqualTo(413);
        var chunked=request(couple,event(id),Map.of("If-Match",etag(current)))
                .method("PATCH",HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(new byte[16_385]))).build();
        assertThat(couple.client().send(chunked,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        assertThat(send(couple,"GET",event(id),"{}",Map.of()).statusCode()).isEqualTo(400);
        assertThat(send(couple,"DELETE",event(id),"{}",Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        assertThat(write("PATCH",event(id),metadata("ok",null,null,"UNKNOWN"),null).statusCode()).isEqualTo(428);
        assertThat(write("PATCH",event(id),metadata("ok",null,null,"UNKNOWN"),"W/"+etag(current)).statusCode()).isEqualTo(400);
        var noCsrf=request(guest,event(id),Map.of("If-Match",etag(current))).method("PATCH",HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(metadata("ok",null,null,"UNKNOWN")))).build();
        assertThat(couple.client().send(noCsrf,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        assertThat(send(couple,"PATCH",event(id),JSON.writeValueAsString(metadata("ok",null,null,"UNKNOWN")),Map.of("If-Match",etag(current),"Origin","https://foreign.example.test")).statusCode()).isEqualTo(403);
        assertThat(get(event(id)).body()).isEqualTo(current.body()); assertThat(etag(get(LIST))).isEqualTo(global);
        assertThat(current.body()).doesNotContain(couple.id().toString(),"objectKey","couple:","password");
    }

    @Test void verifiedPhotoAndAudioEligibilityAndEventDeletePreserveOriginalBytes() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,metadata("Media event",null,"2024-03","MONTH"));
        var bytes=new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(3,2,BufferedImage.TYPE_INT_RGB),"png",bytes);
        for(String type:List.of("PHOTO","AUDIO")) {
            byte[] original=type.equals("PHOTO") ? bytes.toByteArray() : AudioFixtures.audio("audio/webm",.35);
            String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original));
            var item=new HashMap<String,Object>(); item.put("clientItemId",UUID.randomUUID().toString());
            item.put("originalFilename",type.equals("PHOTO") ? "synthetic.png" : "synthetic.webm"); item.put("declaredContentType",type.equals("PHOTO") ? "image/png" : "audio/webm");
            item.put("byteSize",original.length); item.put("checksumSha256",checksum); item.put("caption","Original caption");
            if(type.equals("AUDIO")) item.put("durationSeconds",.35);
            String key=UUID.randomUUID().toString();
            var created=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("memoryType",type,"items",List.of(item))),Map.of("Idempotency-Key",key));
            assertThat(created.statusCode()).isEqualTo(201); UUID memory=UUID.fromString(text(created,"$.memories[0].memoryId"));
            assertThat(write("PUT",link(id,memory),null,etag(current)).statusCode()).isEqualTo(404);
            String upload="/api/memories/contributions/"+text(created,"$.contributionId")+"/memories/"+memory;
            var grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key)); assertThat(grant.statusCode()).isEqualTo(201);
            storage.objects.put("staging/"+text(grant,"$.grantId"),original);
            assertThat(send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key)).statusCode()).isEqualTo(200);
            var before=get("/api/memories/"+memory);
            current=write("PUT",link(id,memory),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
            assertThat(get("/api/memories/"+memory).body()).isEqualTo(before.body());
            assertThat(text(get(event(id)+"/memories"),"$.event.eventDate")).isEqualTo("2024-03");
        }
        assertThat(number(current,"$.memberCount")).isEqualTo(2); var snapshot=new HashMap<>(storage.objects);
        var originals=db.sql("SELECT id,checksum_sha256,byte_size,created_at FROM media_asset ORDER BY id").query((rs,row)->rs.getString(1)+":"+rs.getString(2)+":"+rs.getLong(3)+":"+rs.getString(4)).list();
        assertThat(write("DELETE",event(id),null,etag(current)).statusCode()).isEqualTo(200);
        assertThat(storage.objects.keySet()).isEqualTo(snapshot.keySet()); snapshot.forEach((object,data)->assertThat(storage.objects.get(object)).containsExactly(data));
        assertThat(db.sql("SELECT id,checksum_sha256,byte_size,created_at FROM media_asset ORDER BY id").query((rs,row)->rs.getString(1)+":"+rs.getString(2)+":"+rs.getLong(3)+":"+rs.getString(4)).list()).isEqualTo(originals);
    }

    private Session login() throws Exception {
        UUID id=UUID.randomUUID(); String username="synthetic-timeline-"+id,password="synthetic-timeline-passphrase";
        db.sql("INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version) VALUES(:id,:name,'Synthetic Timeline',:hash,'COUPLE',true,1)")
                .param("id",id).param("name",username).param("hash",encoder.encode(password)).update();
        var session=new Session(id,HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build(),null);
        String csrf=text(send(session,"GET","/api/session",null,Map.of()),"$.csrfToken");
        var response=send(session,"POST","/api/session",JSON.writeValueAsString(Map.of("username",username,"password",password)),Map.of("X-CSRF-Token",csrf));
        assertThat(response.statusCode()).isEqualTo(200); return new Session(id,session.client(),text(response,"$.csrfToken"));
    }
    private UUID note(String message) throws Exception {
        var result=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("message",message)),Map.of("Idempotency-Key",UUID.randomUUID().toString()));
        assertThat(result.statusCode()).isEqualTo(201); return UUID.fromString(text(result,"$.memories[0].memoryId"));
    }
    private HttpResponse<String> create(UUID id,Map<String,Object> body) throws Exception {
        var result=write("PUT",event(id),body,"*"); assertThat(result.statusCode()).as(result.body()).isEqualTo(201); return result;
    }
    private HttpResponse<String> write(String method,String path,Map<String,Object> body,String token) throws Exception {
        var headers=new HashMap<String,String>(); if(token!=null) headers.put(token.equals("*") ? "If-None-Match" : "If-Match",token);
        return send(couple,method,path,body==null ? null : JSON.writeValueAsString(body),headers);
    }
    private HttpResponse<String> review(UUID id,String status,String token) throws Exception {
        return send(couple,"PATCH","/api/memories/"+id+"/review",JSON.writeValueAsString(Map.of("reviewStatus",status)),Map.of("If-Match",token));
    }
    private HttpResponse<String> get(String path) throws Exception { return send(couple,"GET",path,null,Map.of()); }
    private HttpResponse<String> send(Session session,String method,String path,String body,Map<String,String> headers) throws Exception {
        return session.client().send(request(session,path,headers).method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest.Builder request(Session session,String path,Map<String,String> headers) {
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(45))
                .header("X-Api-Contract","1").header("Content-Type","application/json").header("Origin",headers.getOrDefault("Origin","http://localhost:"+port));
        if(session.csrf()!=null && !headers.containsKey("X-CSRF-Token")) request.header("X-CSRF-Token",session.csrf());
        headers.forEach((name,value)->{if(!name.equals("Origin"))request.header(name,value);}); return request;
    }
    private int awaitWaiter(int holder) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
        while(System.nanoTime()<deadline) {
            var waiting=db.sql("SELECT pid FROM pg_stat_activity WHERE :holder=ANY(pg_blocking_pids(pid)) ORDER BY pid")
                    .param("holder",holder).query(Integer.class).list();
            if(!waiting.isEmpty())return waiting.getFirst(); Thread.sleep(20);
        }
        throw new AssertionError("Timeline request did not wait for the owned database lock.");
    }
    private static int pid(java.sql.Connection connection) throws Exception {
        try(var q=connection.createStatement();var rs=q.executeQuery("SELECT pg_backend_pid()")){rs.next();return rs.getInt(1);}
    }
    private static Map<String,Object> metadata(String title,String description,String date,String precision) {
        var body=new LinkedHashMap<String,Object>();body.put("title",title);body.put("description",description);body.put("eventDate",date);body.put("datePrecision",precision);return body;
    }
    private static String event(UUID id){return LIST+"/"+id;}
    private static String link(UUID id,UUID memory){return event(id)+"/memories/"+memory;}
    private static String text(HttpResponse<String> response,String path){return JsonPath.read(response.body(),path);}
    private static long number(HttpResponse<String> response,String path){return JsonPath.<Number>read(response.body(),path).longValue();}
    private static List<String> ids(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].eventId");}
    private static List<String> memories(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].memory.memoryId");}
    private static String etag(HttpResponse<String> response){return response.headers().firstValue("ETag").orElseThrow();}
    private static void assertToken(HttpResponse<String> response){assertThat(etag(response)).isEqualTo("\""+text(response,"$.revision")+"\"");assertThat(UUID.fromString(text(response,"$.revision")).version()).isEqualTo(4);}
    private record Session(UUID id,HttpClient client,String csrf){}
}
