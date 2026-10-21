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
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Real HTTP, sessions and disposable PostgreSQL; uploaded media remains synthetic. */
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "archive.environment=local","spring.profiles.active=local","archive.audio.enabled=true",
        "archive.revealed=true","archive.storage.enabled=false","archive.media.uploads-paused=false","archive.retention.enabled=false"})
@Import(CoupleAuthoringHttpTest.Fixtures.class)
class AlbumHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON=JsonMapper.builder().build();
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired DataSource dataSource;
    @Autowired PasswordEncoder encoder;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired CoupleAuthoringHttpTest.ControlledStorage storage;
    @Autowired RetentionRepository retention;
    private Session couple;
    @BeforeEach void isolate() throws Exception {
        db.sql("TRUNCATE album,contribution,archive_account CASCADE").update();
        clock.now=Instant.parse("2026-10-09T12:00:00Z");
        storage.objects.clear(); storage.outage=false; storage.afterRead=null;
        couple=login("COUPLE");
    }

    @Test void conditionalCreationNamesAndTerminalDeletePreserveOriginals() throws Exception {
        UUID id=UUID.randomUUID(); String path=album(id);
        assertThat(write("PUT",path,Map.of("name"," Wedding day "),null).statusCode()).isEqualTo(428);
        var created=create(id," Wedding day ");
        assertThat(text(created,"$.name")).isEqualTo("Wedding day");
        assertThat(text(created,"$.visibility")).isEqualTo("COUPLE_ONLY");
        assertToken(created); assertThat(number(created,"$.memberCount")).isZero();
        assertThat(write("PUT",path,Map.of("name","Overwrite"),"*").statusCode()).isEqualTo(412);
        var unchanged=write("PATCH",path,Map.of("name"," Wedding day "),etag(created));
        assertThat(etag(unchanged)).isEqualTo(etag(created));
        var renamed=write("PATCH",path,Map.of("name","Our ceremony"),etag(created));
        assertThat(renamed.statusCode()).isEqualTo(200); assertThat(etag(renamed)).isNotEqualTo(etag(created));
        assertThat(write("PATCH",path,Map.of("name","Stale"),etag(created)).statusCode()).isEqualTo(412);
        UUID memory=note("Original stays intact");
        var original=get("/api/memories/"+memory);
        var added=write("PUT",member(id,memory),null,etag(renamed));
        var deleted=write("DELETE",path,null,etag(added));
        assertThat(deleted.statusCode()).isEqualTo(200); assertThat(JsonPath.<Object>read(deleted.body(),"$.name")).isNull();
        assertThat(number(deleted,"$.memberCount")).isZero(); assertThat(text(deleted,"$.deletedAt")).isNotEmpty();
        assertThat(get(path).body()).isEqualTo(deleted.body());
        assertThat(write("DELETE",path,null,etag(deleted)).headers().firstValue("ETag")).contains(etag(deleted));
        assertThat(write("PUT",path,Map.of("name","Resurrect"),"*").statusCode()).isEqualTo(412);
        assertThat(write("PATCH",path,Map.of("name","Resurrect"),etag(deleted)).statusCode()).isEqualTo(404);
        assertThat(items(get(path+"/members"),"$.items")).isEmpty();
        assertThat(get("/api/memories/"+memory).body()).isEqualTo(original.body());
        assertThat(db.sql("SELECT count(*) FROM memory WHERE id=:id").param("id",memory).query(Long.class).single()).isEqualTo(1);
        assertThat(items(get("/api/albums"),"$.items")).isEmpty();
    }

    @Test void manyToManyOrderingNoOpsAndRevisionBoundPages() throws Exception {
        UUID id=UUID.randomUUID(), other=UUID.randomUUID(); var state=create(id,"One"); var second=create(other,"Two");
        UUID a=note("First"),b=note("Second"),c=note("Third");
        for(UUID memory:List.of(a,b,c)) state=write("PUT",member(id,memory),null,etag(state));
        assertThat(number(state,"$.memberCount")).isEqualTo(3);
        var same=write("PUT",member(id,a),null,etag(state)); assertThat(etag(same)).isEqualTo(etag(state));
        assertThat(write("PUT",member(other,a),null,etag(second)).statusCode()).isEqualTo(200);
        var page=get(album(id)+"/members?limit=2");
        assertThat(ids(page)).containsExactly(a.toString(),b.toString());
        assertThat(JsonPath.<Boolean>read(page.body(),"$.items[0].canMoveEarlier")).isFalse();
        assertThat(JsonPath.<Boolean>read(page.body(),"$.items[1].canMoveLater")).isTrue();
        String cursor=text(page,"$.nextCursor");
        assertThat(ids(get(album(id)+"/members?limit=2&cursor="+cursor))).containsExactly(c.toString());
        var moved=write("POST",member(id,c)+"/move",Map.of("direction","EARLIER"),etag(state));
        assertThat(moved.statusCode()).isEqualTo(200);
        assertThat(ids(get(album(id)+"/members"))).containsExactly(a.toString(),c.toString(),b.toString());
        assertThat(get(album(id)+"/members?cursor="+cursor).statusCode()).isEqualTo(412);
        var boundary=write("POST",member(id,a)+"/move",Map.of("direction","EARLIER"),etag(moved));
        assertThat(etag(boundary)).isEqualTo(etag(moved));
        var removed=write("DELETE",member(id,c),null,etag(moved));
        assertThat(number(removed,"$.memberCount")).isEqualTo(2);
        assertThat(etag(write("DELETE",member(id,c),null,etag(removed)))).isEqualTo(etag(removed));
        assertThat(number(get(album(other)),"$.memberCount")).isEqualTo(1);
        assertThat(get("/api/memories/"+a).headers().firstValue("ETag")).contains("\"1\"");
    }

    @Test void deletingMemoryDetachesEveryAlbumAndRestoreDoesNotRejoin() throws Exception {
        UUID memory=note("Shared original"),one=UUID.randomUUID(),two=UUID.randomUUID();
        var a=write("PUT",member(one,memory),null,etag(create(one,"One")));
        var b=write("PUT",member(two,memory),null,etag(create(two,"Two")));
        var deleted=review(memory,"DELETE","\"1\""); assertThat(deleted.statusCode()).isEqualTo(200);
        for(var entry:Map.of(one,etag(a),two,etag(b)).entrySet()) {
            var album=get(album(entry.getKey())); assertThat(number(album,"$.memberCount")).isZero();
            assertThat(etag(album)).isNotEqualTo(entry.getValue());
            assertThat(write("PUT",member(entry.getKey(),memory),null,etag(album)).statusCode()).isEqualTo(404);
        }
        assertThat(db.sql("SELECT count(*) FROM album_membership").query(Long.class).single()).isZero();
        var restored=review(memory,"KEEP",etag(deleted)); assertThat(restored.statusCode()).isEqualTo(200);
        assertThat(number(get(album(one)),"$.memberCount")).isZero();
        var attached=write("PUT",member(one,memory),null,etag(get(album(one))));
        assertThat(attached.statusCode()).isEqualTo(200);
        assertThat(review(memory,"DELETE",etag(restored)).statusCode()).isEqualTo(200);
        Instant at=clock.now.plus(Duration.ofDays(31)); var plan=retention.claim(10,at).getFirst();
        // Simulate an older backup relation after the authoritative tombstone; replay must clean it even if already purged.
        db.sql("INSERT INTO album_membership(album_id,memory_id,position) VALUES(:album,:memory,1)").param("album",one).param("memory",memory).update();
        assertThat(retention.finish(plan,at)).isTrue();
        String token=etag(get(album(one)));
        db.sql("INSERT INTO album_membership(album_id,memory_id,position) VALUES(:album,:memory,1)").param("album",one).param("memory",memory).update();
        assertThat(retention.finish(plan,at)).isFalse();
        assertThat(etag(get(album(one)))).isNotEqualTo(token);
        assertThat(db.sql("SELECT count(*) FROM album_membership").query(Long.class).single()).isZero();
    }

    @Test void largePagesAndMaximumSparsePositionRemainUsable() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,"Large collection");
        var expected=new ArrayList<String>();
        for(int i=0;i<53;i++) {
            UUID memory=note("Synthetic memory "+i); expected.add(memory.toString());
            current=write("PUT",member(id,memory),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
        }
        var first=get(album(id)+"/members?limit=50"); assertThat(ids(first)).containsExactlyElementsOf(expected.subList(0,50));
        var next=get(album(id)+"/members?limit=50&cursor="+text(first,"$.nextCursor"));
        assertThat(ids(next)).containsExactlyElementsOf(expected.subList(50,53));
        assertThat(JsonPath.<Object>read(next.body(),"$.nextCursor")).isNull();
        db.sql("UPDATE album_membership SET position=:position WHERE album_id=:album AND memory_id=:memory")
                .param("position",Long.MAX_VALUE).param("album",id).param("memory",UUID.fromString(expected.getLast())).update();
        UUID added=note("Append after maximum restored position");
        var appended=write("PUT",member(id,added),null,etag(current)); assertThat(appended.statusCode()).isEqualTo(200);
        assertThat(number(appended,"$.memberCount")).isEqualTo(54);
        assertThat(db.sql("SELECT max(position) FROM album_membership WHERE album_id=:id").param("id",id).query(Long.class).single()).isEqualTo(54);
        for(int i=0;i<51;i++) create(UUID.randomUUID(),"Album "+i);
        var albums=get("/api/albums?limit=50"); assertThat(items(albums,"$.items")).hasSize(50);
        var tail=get("/api/albums?limit=50&cursor="+text(albums,"$.nextCursor")); assertThat(items(tail,"$.items")).hasSize(2);
    }

    @Test void concurrentCreateAndEditsHaveOneWinner() throws Exception {
        UUID id=UUID.randomUUID();
        try(var workers=Executors.newFixedThreadPool(2)) {
            var first=workers.submit(()->write("PUT",album(id),Map.of("name","First"),"*"));
            var second=workers.submit(()->write("PUT",album(id),Map.of("name","Second"),"*"));
            assertThat(List.of(first.get(30,TimeUnit.SECONDS).statusCode(),second.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(201,412);
            String token=etag(get(album(id)));
            var a=workers.submit(()->write("PATCH",album(id),Map.of("name","A"),token));
            var b=workers.submit(()->write("PATCH",album(id),Map.of("name","B"),token));
            assertThat(List.of(a.get(30,TimeUnit.SECONDS).statusCode(),b.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(200,412);
        }
        assertThat(db.sql("SELECT count(*) FROM album").query(Long.class).single()).isEqualTo(1);
    }

    @Test void queuedMembershipRechecksRevokedAccountAfterAlbumLock() throws Exception {
        UUID id=UUID.randomUUID(),memory=note("Queued original"); String token=etag(create(id,"Locked collection"));
        try(var holder=dataSource.getConnection();var workers=Executors.newSingleThreadExecutor()) {
            holder.setAutoCommit(false); int pid;
            try(var q=holder.createStatement();var rs=q.executeQuery("SELECT pg_backend_pid()")) { rs.next(); pid=rs.getInt(1); }
            try(var q=holder.prepareStatement("SELECT id FROM album WHERE id=? FOR UPDATE")) { q.setObject(1,id); q.executeQuery().close(); }
            var future=workers.submit(()->write("PUT",member(id,memory),null,token));
            try {
                awaitWait(pid); assertThat(future.isDone()).isFalse();
                db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id",couple.id()).update();
            } finally { holder.rollback(); }
            assertThat(future.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(401);
        }
        assertThat(db.sql("SELECT count(*) FROM album_membership").query(Long.class).single()).isZero();
        assertThat(db.sql("SELECT revision FROM album WHERE id=:id").param("id",id).query(UUID.class).single().toString()).isEqualTo(token.substring(1,token.length()-1));
    }

    @Test void incompleteFailedPhotosStayOutAndVerifiedOriginalSurvivesAlbumDelete() throws Exception {
        UUID id=UUID.randomUUID(); var album=create(id,"Photos");
        var bytes=new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(3,2,BufferedImage.TYPE_INT_RGB),"png",bytes);
        byte[] photo=bytes.toByteArray(); String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(photo));
        String key=UUID.randomUUID().toString();
        var created=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("memoryType","PHOTO","items",List.of(Map.of(
                "clientItemId",UUID.randomUUID().toString(),"originalFilename","synthetic.png","declaredContentType","image/png",
                "byteSize",photo.length,"checksumSha256",checksum,"caption","Original caption")))),Map.of("Idempotency-Key",key));
        assertThat(created.statusCode()).isEqualTo(201); UUID memory=UUID.fromString(text(created,"$.memories[0].memoryId"));
        assertThat(write("PUT",member(id,memory),null,etag(album)).statusCode()).isEqualTo(404);
        String upload="/api/memories/contributions/"+text(created,"$.contributionId")+"/memories/"+memory;
        var grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key)); assertThat(grant.statusCode()).isEqualTo(201);
        storage.objects.put("staging/"+text(grant,"$.grantId"),new byte[]{1,2,3});
        var failed=send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key));
        assertThat(failed.statusCode()).isEqualTo(422);
        assertThat(write("PUT",member(id,memory),null,etag(album)).statusCode()).isEqualTo(404);
        grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key));
        storage.objects.put("staging/"+text(grant,"$.grantId"),photo);
        assertThat(send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key)).statusCode()).isEqualTo(200);
        var before=get("/api/memories/"+memory); var added=write("PUT",member(id,memory),null,etag(album)); assertThat(added.statusCode()).isEqualTo(200);
        assertThat(text(get(album(id)+"/members"),"$.items[0].memory.media.checksumSha256")).isEqualTo(checksum);
        var snapshot=new HashMap<>(storage.objects);
        assertThat(write("DELETE",album(id),null,etag(added)).statusCode()).isEqualTo(200);
        assertThat(get("/api/memories/"+memory).body()).isEqualTo(before.body());
        assertThat(storage.objects.keySet()).isEqualTo(snapshot.keySet());
        snapshot.forEach((object,data)->assertThat(storage.objects.get(object)).containsExactly(data));
    }

    @Test void privateBoundsConditionsAndMalformedRequestsMutateNothing() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,"Validation");
        var guest=new Session(null,HttpClient.newHttpClient(),null);
        for(String path:List.of("/api/albums","/api/albums/",album(id),album(id)+"/members"))
            assertThat(send(guest,"GET",path,null,Map.of()).statusCode()).isIn(401,403);
        var operator=login("COUPLE");
        db.sql("UPDATE archive_account SET role='OPERATOR' WHERE id=:id").param("id",operator.id()).update();
        assertThat(send(operator,"GET","/api/albums",null,Map.of()).statusCode()).isEqualTo(401);
        for(String body:List.of("null","{}","{\"name\":\" \"}","{\"name\":\"ok\",\"visibility\":\"PUBLIC\"}","{\"name\":17}","{\"name\":\""+"x".repeat(201)+"\"}"))
            assertThat(send(couple,"PATCH",album(id),body,Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PATCH",album(id)," ".repeat(16_385),Map.of("If-Match",etag(current))).statusCode()).isEqualTo(413);
        var chunked=request(couple,"PATCH",album(id),Map.of("If-Match",etag(current)))
                .method("PATCH",HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(new byte[16_385]))).build();
        assertThat(couple.client().send(chunked,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        assertThat(send(couple,"DELETE",album(id),"{}",Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        assertThat(send(couple,"GET",album(id),"{}",Map.of()).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PATCH",album(id),"{\"name\":\"ok\"}",Map.of()).statusCode()).isEqualTo(428);
        assertThat(send(couple,"PATCH",album(id),"{\"name\":\"ok\"}",Map.of("If-Match","W/"+etag(current))).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PATCH",album(id),"{\"name\":\"ok\"}",Map.of("If-Match",etag(current),"Origin","https://foreign.example.test")).statusCode()).isEqualTo(403);
        var noCsrf=request(guest,"PATCH",album(id),Map.of("If-Match",etag(current))).method("PATCH",HttpRequest.BodyPublishers.ofString("{\"name\":\"ok\"}")).build();
        assertThat(couple.client().send(noCsrf,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        assertThat(get(album(id)+"/members?limit=51").statusCode()).isEqualTo(400);
        assertThat(get(album(id)+"/members?cursor=invalid").statusCode()).isEqualTo(400);
        assertThat(get(album(id)).body()).isEqualTo(current.body());
        assertThat(current.body()).doesNotContain(couple.id().toString(),"author_account_id","objectKey","couple:");
    }

    @Test void verifiedAudioGuestReviewStatesAndLegacyMemoryIdsRemainEligible() throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,"All completed types");
        var guest=new Session(null,HttpClient.newHttpClient(),null);
        var contributed=send(guest,"POST","/api/contributions","{\"message\":\"Synthetic guest note\",\"guestName\":\"Synthetic Guest\"}",
                Map.of("Idempotency-Key",UUID.randomUUID().toString()));
        assertThat(contributed.statusCode()).isEqualTo(201);
        UUID original=UUID.fromString(text(contributed,"$.memories[0].memoryId"));
        UUID legacy=UUID.fromString("00000000-0000-1000-8000-000000000001");
        db.sql("UPDATE memory SET id=:legacy WHERE id=:id").param("legacy",legacy).param("id",original).update();
        current=write("PUT",member(id,legacy),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
        var card=get(album(id)+"/members"); assertThat(text(card,"$.items[0].memory.source")).isEqualTo("GUEST");
        assertThat(text(card,"$.items[0].memory.reviewStatus")).isEqualTo("PENDING");
        assertThat(review(legacy,"ARCHIVED","\"1\"").statusCode()).isEqualTo(200);
        assertThat(text(get(album(id)+"/members"),"$.items[0].memory.reviewStatus")).isEqualTo("ARCHIVED");
        assertThat(etag(get(album(id)))).isEqualTo(etag(current));

        byte[] voice=AudioFixtures.audio("audio/webm",.35); String key=UUID.randomUUID().toString();
        var audioBody=new HashMap<>(AudioHttpTest.metadata(voice,"audio/webm",.35)); audioBody.remove("guestName");
        var created=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(audioBody),Map.of("Idempotency-Key",key));
        assertThat(created.statusCode()).isEqualTo(201); UUID memory=UUID.fromString(text(created,"$.memories[0].memoryId"));
        String upload="/api/memories/contributions/"+text(created,"$.contributionId")+"/memories/"+memory;
        assertThat(write("PUT",member(id,memory),null,etag(current)).statusCode()).isEqualTo(404);
        var grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key)); assertThat(grant.statusCode()).isEqualTo(201);
        storage.objects.put("staging/"+text(grant,"$.grantId"),voice);
        assertThat(send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key)).statusCode()).isEqualTo(200);
        var added=write("PUT",member(id,memory),null,etag(current)); assertThat(added.statusCode()).isEqualTo(200);
        assertThat(text(get(album(id)+"/members"),"$.items[1].memory.memoryType")).isEqualTo("AUDIO");
        assertThat(write("DELETE",member(id,legacy),null,etag(added)).statusCode()).isEqualTo(200);
        assertThat(get("/api/memories/"+legacy).statusCode()).isEqualTo(200);
    }

    private Session login(String role) throws Exception {
        UUID id=UUID.randomUUID(); String username="synthetic-album-"+id,password="synthetic-album-passphrase";
        db.sql("INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version) VALUES(:id,:name,'Synthetic Album',:hash,:role,true,1)")
                .param("id",id).param("name",username).param("hash",encoder.encode(password)).param("role",role).update();
        var session=new Session(id,HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build(),null);
        String csrf=text(send(session,"GET","/api/session",null,Map.of()),"$.csrfToken");
        var response=send(session,"POST","/api/session",JSON.writeValueAsString(Map.of("username",username,"password",password)),Map.of("X-CSRF-Token",csrf));
        assertThat(response.statusCode()).isEqualTo(200); return new Session(id,session.client(),text(response,"$.csrfToken"));
    }
    private UUID note(String message) throws Exception {
        var result=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("message",message)),Map.of("Idempotency-Key",UUID.randomUUID().toString()));
        assertThat(result.statusCode()).isEqualTo(201); return UUID.fromString(text(result,"$.memories[0].memoryId"));
    }
    private HttpResponse<String> create(UUID id,String name) throws Exception {
        var response=write("PUT",album(id),Map.of("name",name),"*"); assertThat(response.statusCode()).isEqualTo(201); return response;
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
        return session.client().send(request(session,method,path,headers).method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest.Builder request(Session session,String method,String path,Map<String,String> headers) {
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(45))
                .header("X-Api-Contract","1").header("Content-Type","application/json").header("Origin",headers.getOrDefault("Origin","http://localhost:"+port));
        if(session.csrf()!=null && !headers.containsKey("X-CSRF-Token")) request.header("X-CSRF-Token",session.csrf());
        headers.forEach((name,value)->{if(!name.equals("Origin"))request.header(name,value);}); return request;
    }
    private void awaitWait(int holder) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
        while(System.nanoTime()<deadline) {
            if(db.sql("SELECT count(*) FROM pg_stat_activity WHERE :holder=ANY(pg_blocking_pids(pid))")
                    .param("holder",holder).query(Long.class).single()>0) return;
            Thread.sleep(20);
        }
        throw new AssertionError("Album mutation did not wait for the owned row lock.");
    }
    private static String album(UUID id){return "/api/albums/"+id;}
    private static String member(UUID id,UUID memory){return album(id)+"/members/"+memory;}
    private static String text(HttpResponse<String> response,String path){return JsonPath.read(response.body(),path);}
    private static long number(HttpResponse<String> response,String path){return JsonPath.<Number>read(response.body(),path).longValue();}
    private static List<?> items(HttpResponse<String> response,String path){return JsonPath.read(response.body(),path);}
    private static List<String> ids(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].memory.memoryId");}
    private static String etag(HttpResponse<String> response){return response.headers().firstValue("ETag").orElseThrow();}
    private static void assertToken(HttpResponse<String> response){assertThat(etag(response)).isEqualTo("\""+text(response,"$.revision")+"\"").matches("\"[0-9a-f-]{36}\""); assertThat(UUID.fromString(text(response,"$.revision")).version()).isEqualTo(4);}
    private record Session(UUID id,HttpClient client,String csrf){}
}
