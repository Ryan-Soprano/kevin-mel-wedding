package com.kevinmel.archive.media;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipInputStream;
import javax.imageio.ImageIO;
import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.portable.ExportAuthority;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

/** Actual sessions, HTTP streaming, original verification and disposable PostgreSQL; synthetic content only. */
@Testcontainers
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "archive.environment=local","spring.profiles.active=local","archive.audio.enabled=true","archive.revealed=true",
    "archive.storage.enabled=false","archive.media.uploads-paused=false","archive.retention.enabled=false"})
@Import(CoupleAuthoringHttpTest.Fixtures.class)
class ExportHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON=JsonMapper.builder().build();
    private static final String PASSWORD="synthetic-export-passphrase";
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired PasswordEncoder encoder;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired CoupleAuthoringHttpTest.ControlledStorage storage;
    @MockitoSpyBean ExportAuthority authority;
    private Session couple;
    private final Map<UUID,Session> owned=new LinkedHashMap<>();
    @BeforeEach void isolate()throws Exception {
        db.sql("TRUNCATE tag,timeline_state,timeline_event,album,contribution,archive_account CASCADE").update();
        clock.now=Instant.parse("2026-10-10T12:00:00Z");storage.objects.clear();storage.outage=false;storage.afterRead=null;
        couple=newAccount();
    }
    @AfterEach void cancelOwnedJobs()throws Exception {
        storage.afterRead=null;
        for(var entry:owned.entrySet()) {
            var session=entry.getValue();
            db.sql("UPDATE archive_account SET enabled=true WHERE id=:id").param("id",session.id()).update();
            var fresh=login(session.id(),session.username());
            var response=send(fresh,"DELETE",path(entry.getKey()),null,Map.of("Idempotency-Key",UUID.randomUUID().toString()));
            assertThat(response.statusCode()).isIn(200,404);
        }
        owned.clear();
    }

    @Test void authenticatedNoteExportStreamsAnIntegrityBoundOfflineArchiveWithoutCapabilities()throws Exception {
        UUID memory=note("Full synthetic note <script>private text & punctuation</script>");
        UUID id=create();var ready=await(id,"READY");assertThat(number(ready,"$.totalMemories")).isEqualTo(1);
        assertThat(number(ready,"$.totalOriginals")).isZero();assertThat(number(ready,"$.indexPartNumber")).isEqualTo(1);
        UUID attempt=UUID.randomUUID();assertThat(prepare(id,1,attempt).statusCode()).isEqualTo(202);
        var status=prepared(id);assertThat(JsonPath.<Boolean>read(status.body(),"$.complete")).isTrue();
        assertThat(text(get(path(id)+"/attempts/"+attempt),"$.state")).isEqualTo("SUCCEEDED");
        assertThat(prepare(id,1,attempt).statusCode()).isEqualTo(200);
        var response=download(couple,id,1,text(status,"$.preparedPart.generation"),Map.of());
        assertThat(response.statusCode()).isEqualTo(200);assertThat(response.headers().firstValue("Content-Type")).contains("application/zip");
        assertThat(response.headers().firstValue("Cache-Control")).contains("no-store");assertThat(response.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
        assertThat(response.headers().firstValue("Content-Disposition")).contains("attachment; filename=\"kevin-mel-archive-"+id+"-part-1.zip\"");
        assertThat(response.headers().firstValue("Content-Length")).contains(Integer.toString(response.body().length));
        assertThat(hash(response.body())).isEqualTo(text(status,"$.preparedPart.sha256")).isEqualTo(response.headers().firstValue("X-Archive-SHA256").orElseThrow());
        var files=unzip(response.body());assertThat(files).containsKeys("archive.json","archive.txt","index.html");
        String manifest=new String(files.get("archive.json"),StandardCharsets.UTF_8);
        assertThat(manifest).contains(memory.toString(),"Full synthetic note").doesNotContain("authorAccountId","idempotencyKey","objectKey","csrfToken","credentialsVersion","password_hash");
        assertThat(new String(files.get("archive.txt"),StandardCharsets.UTF_8)).contains("<script>private text & punctuation</script>");
        assertThat(new String(files.get("index.html"),StandardCharsets.UTF_8)).doesNotContain("<script>private text").contains("archive.txt","archive.json");
        assertThat(get(path(id)+"/parts?limit=1").statusCode()).isEqualTo(200);assertThat(get(path(id)+"/issues?limit=1").body()).contains("\"items\":[]");
        assertThat(download(couple,id,1,UUID.randomUUID().toString(),Map.of()).statusCode()).isEqualTo(409);
    }

    @Test void allPrivateRoutesEnforceSessionCsrfOriginBodyAndStrictVersionQueryContracts()throws Exception {
        var anonymous=new Session(UUID.randomUUID(),"unused",client(),null);UUID id=UUID.randomUUID();
        for(String suffix:List.of("/current","/"+id,"/"+id+"/parts","/"+id+"/issues","/"+id+"/attempts/"+UUID.randomUUID(),"/"+id+"/parts/1/download?generation="+UUID.randomUUID(),"/"+id+"/"))
            assertThat(send(anonymous,"GET","/api/exports"+suffix,null,Map.of()).statusCode()).isEqualTo(401);
        assertThat(send(anonymous,"POST",path(id)+"/unsupported",null,Map.of("X-CSRF-Token","synthetic-invalid")).statusCode()).isIn(401,403);
        assertThat(send(couple,"PUT",path(id),null,Map.of("If-None-Match","*","X-CSRF-Token","invalid")).statusCode()).isEqualTo(403);
        assertThat(send(couple,"PUT",path(id),null,Map.of("If-None-Match","*","Origin","https://other.invalid")).statusCode()).isEqualTo(403);
        assertThat(send(couple,"PUT",path(id),"{}",Map.of("If-None-Match","*")).statusCode()).isEqualTo(400);
        assertThat(send(couple,"GET","/api/exports/current","x",Map.of()).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PUT",path(id),null,Map.of("If-None-Match","*","X-Api-Contract","2")).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PUT",path(id),null,Map.of()).statusCode()).isEqualTo(428);
        assertThat(send(couple,"PUT",path(id),null,Map.of("If-None-Match","\"other\"")).statusCode()).isEqualTo(400);
        id=create();await(id,"READY");
        for(String suffix:List.of("?unknown=1","?limit=1","/parts?limit=51","/parts?limit=1&limit=2","/issues?cursor=invalid","/parts?cursor="+"x".repeat(300)))
            assertThat(get(path(id)+suffix).statusCode()).isEqualTo(400);
        assertThat(get("/api/exports/current?unknown=1").statusCode()).isEqualTo(400);
        assertThat(send(couple,"POST",path(id)+"/parts/1/prepare",null,Map.of()).statusCode()).isEqualTo(400);
        assertThat(send(couple,"DELETE",path(id),"x",Map.of("Idempotency-Key",UUID.randomUUID().toString())).statusCode()).isEqualTo(400);
        prepare(id,1,UUID.randomUUID());var done=prepared(id);
        assertThat(download(couple,id,1,text(done,"$.preparedPart.generation"),Map.of("Origin","https://other.invalid")).statusCode()).isEqualTo(403);
    }

    @Test void discoverySurvivesLogoutButRemainsAccountAndCredentialsScoped()throws Exception {
        UUID id=create();await(id,"READY");prepare(id,1,UUID.randomUUID());var cached=prepared(id);
        assertThat(text(get("/api/exports/current"),"$.exportId")).isEqualTo(id.toString());
        assertThat(send(couple,"DELETE","/api/session",null,Map.of()).statusCode()).isEqualTo(204);
        assertThat(get("/api/exports/current").statusCode()).isEqualTo(401);couple=login(couple.id(),couple.username());
        assertThat(text(get("/api/exports/current"),"$.exportId")).isEqualTo(id.toString());
        var other=newAccount();assertThat(send(other,"GET",path(id),null,Map.of()).statusCode()).isEqualTo(404);
        assertThat(send(other,"GET","/api/exports/current",null,Map.of()).statusCode()).isEqualTo(404);
        db.sql("UPDATE archive_account SET credentials_version=2 WHERE id=:id").param("id",couple.id()).update();
        assertThat(get(path(id)).statusCode()).isEqualTo(401);couple=login(couple.id(),couple.username());
        assertThat(get("/api/exports/current").statusCode()).isEqualTo(404);
        assertThat(download(couple,id,1,text(cached,"$.preparedPart.generation"),Map.of()).statusCode()).isEqualTo(404);
        UUID fresh=create();await(fresh,"READY");assertThat(text(get("/api/exports/current"),"$.exportId")).isEqualTo(fresh.toString());
    }

    @Test void changedMetadataAndInactivityPreventCachedDeliveryAndIdentityResurrection()throws Exception {
        UUID memory=note("Original unchanged text");UUID id=create();await(id,"READY");prepare(id,1,UUID.randomUUID());var old=prepared(id);
        var body=new LinkedHashMap<String,Object>();body.put("title","New title");body.put("description",null);body.put("memoryDate",null);body.put("datePrecision","UNKNOWN");
        assertThat(send(couple,"PATCH","/api/memories/"+memory+"/metadata",JSON.writeValueAsString(body),Map.of("If-Match","\"1\"")).statusCode()).isEqualTo(200);
        var stale=download(couple,id,1,text(old,"$.preparedPart.generation"),Map.of());assertThat(stale.statusCode()).isEqualTo(410);
        assertThat(stale.headers().firstValue("Content-Type").orElse("")).contains("application/json");
        assertThat(text(get(path(id)),"$.state")).isEqualTo("STALE");assertThat(get(path(id)).body()).doesNotContain("New title","Original unchanged text");
        UUID fresh=create();await(fresh,"READY");clock.now=clock.now.plus(Duration.ofMinutes(31));
        assertThat(text(get(path(fresh)),"$.state")).isEqualTo("EXPIRED");assertThat(get("/api/exports/current").statusCode()).isEqualTo(404);
        assertThat(send(couple,"PUT",path(fresh),null,Map.of("If-None-Match","*")).statusCode()).isEqualTo(412);
        assertThat(send(couple,"POST",path(fresh)+"/parts/1/prepare",null,Map.of("Idempotency-Key",UUID.randomUUID().toString())).statusCode()).isEqualTo(410);
    }

    @Test void revocationDuringAnOriginalReadFailsTheBackgroundJobWithoutPublishingBytes()throws Exception {
        var output=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(3,2,BufferedImage.TYPE_INT_RGB),"png",output);byte[] bytes=output.toByteArray();
        var item=Map.of("clientItemId",UUID.randomUUID().toString(),"originalFilename","Synthetic.png","declaredContentType","image/png","byteSize",bytes.length,"checksumSha256",hash(bytes),"caption","Synthetic original");
        String key=UUID.randomUUID().toString();var created=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("memoryType","PHOTO","items",List.of(item))),Map.of("Idempotency-Key",key));
        assertThat(created.statusCode()).isEqualTo(201);String upload="/api/memories/contributions/"+text(created,"$.contributionId")+"/memories/"+text(created,"$.memories[0].memoryId");
        var grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key));assertThat(grant.statusCode()).isEqualTo(201);
        storage.objects.put("staging/"+text(grant,"$.grantId"),bytes);assertThat(send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key)).statusCode()).isEqualTo(200);
        UUID id=create();await(id,"READY");UUID account=couple.id();var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);var revoked=new java.util.concurrent.CountDownLatch(1);
        doAnswer(call->{try {return call.callRealMethod();}catch(RuntimeException failure){if(Thread.currentThread().getName().equals("portable-export-worker"))revoked.countDown();throw failure;}}).when(authority).require(any());
        storage.afterRead=()->{entered.countDown();try {if(!release.await(10,TimeUnit.SECONDS))throw new AssertionError("Synthetic read did not release.");}catch(InterruptedException failure){Thread.currentThread().interrupt();throw new AssertionError(failure);}};
        try {
            assertThat(prepare(id,1,UUID.randomUUID()).statusCode()).isEqualTo(202);assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
            db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id",account).update();
        } finally { release.countDown(); }
        assertThat(get(path(id)).statusCode()).isEqualTo(401);assertThat(revoked.await(10,TimeUnit.SECONDS)).isTrue();storage.afterRead=null;
        db.sql("UPDATE archive_account SET enabled=true WHERE id=:id").param("id",account).update();
        couple=login(couple.id(),couple.username());var failed=await(id,"FAILED");assertThat(text(failed,"$.errorCode")).isEqualTo("ACCESS_REVOKED");
        assertThat(JsonPath.<Object>read(failed.body(),"$.preparedPart")).isNull();assertThat(number(failed,"$.totalOriginals")).isZero();
    }

    private Session newAccount()throws Exception {
        UUID id=UUID.randomUUID();String username="synthetic-export-"+id;
        db.sql("INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version) VALUES(:id,:name,'Synthetic Export',:hash,'COUPLE',true,1)").param("id",id).param("name",username).param("hash",encoder.encode(PASSWORD)).update();return login(id,username);
    }
    private Session login(UUID id,String username)throws Exception {
        var session=new Session(id,username,client(),null);String csrf=text(send(session,"GET","/api/session",null,Map.of()),"$.csrfToken");
        var result=send(session,"POST","/api/session",JSON.writeValueAsString(Map.of("username",username,"password",PASSWORD)),Map.of("X-CSRF-Token",csrf));
        assertThat(result.statusCode()).as(result.body()).isEqualTo(200);return new Session(id,username,session.client(),text(result,"$.csrfToken"));
    }
    private UUID note(String message)throws Exception {var response=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("message",message)),Map.of("Idempotency-Key",UUID.randomUUID().toString()));assertThat(response.statusCode()).isEqualTo(201);return UUID.fromString(text(response,"$.memories[0].memoryId"));}
    private UUID create()throws Exception {UUID id=UUID.randomUUID();var response=send(couple,"PUT",path(id),null,Map.of("If-None-Match","*"));assertThat(response.statusCode()).as(response.body()).isEqualTo(202);owned.put(id,couple);return id;}
    private HttpResponse<String> prepare(UUID id,int part,UUID attempt)throws Exception {return send(couple,"POST",path(id)+"/parts/"+part+"/prepare",null,Map.of("Idempotency-Key",attempt.toString()));}
    private HttpResponse<String> get(String path)throws Exception {return send(couple,"GET",path,null,Map.of());}
    private HttpResponse<String> await(UUID id,String state)throws Exception {return waitFor(id,response->state.equals(text(response,"$.state")));}
    private HttpResponse<String> prepared(UUID id)throws Exception {return waitFor(id,response->{assertThat(text(response,"$.state")).as(text(response,"$.errorCode")).isNotIn("FAILED","STALE","EXPIRED","CANCELLED");return JsonPath.<Object>read(response.body(),"$.preparedPart")!=null;});}
    private HttpResponse<String> waitFor(UUID id,java.util.function.Predicate<HttpResponse<String>> condition)throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(15);HttpResponse<String> response;
        do {response=get(path(id));assertThat(response.statusCode()).as(response.body()).isEqualTo(200);if(condition.test(response))return response;Thread.sleep(20);}while(System.nanoTime()<deadline);
        throw new AssertionError("Synthetic export did not settle: "+text(response,"$.state"));
    }
    private HttpResponse<String> send(Session session,String method,String path,String body,Map<String,String> headers)throws Exception {return session.client().send(request(session,path,headers).method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());}
    private HttpResponse<byte[]> download(Session session,UUID id,int part,String generation,Map<String,String> headers)throws Exception {return session.client().send(request(session,path(id)+"/parts/"+part+"/download?generation="+generation,headers).GET().build(),HttpResponse.BodyHandlers.ofByteArray());}
    private HttpRequest.Builder request(Session session,String path,Map<String,String> headers) {
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(45)).header("X-Api-Contract",headers.getOrDefault("X-Api-Contract","1")).header("Content-Type","application/json").header("Origin",headers.getOrDefault("Origin","http://localhost:"+port));
        if(session.csrf()!=null&&!headers.containsKey("X-CSRF-Token"))request.header("X-CSRF-Token",session.csrf());headers.forEach((key,value)->{if(!Set.of("Origin","X-Api-Contract").contains(key))request.header(key,value);});return request;
    }
    private static HttpClient client(){return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();}
    private static String path(UUID id){return "/api/exports/"+id;}
    private static String text(HttpResponse<String> response,String path){return JsonPath.read(response.body(),path);}
    private static long number(HttpResponse<String> response,String path){return JsonPath.<Number>read(response.body(),path).longValue();}
    private static String hash(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static Map<String,byte[]> unzip(byte[] bytes)throws IOException {var files=new LinkedHashMap<String,byte[]>();try(var zip=new ZipInputStream(new ByteArrayInputStream(bytes))){for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry())files.put(entry.getName(),zip.readAllBytes());}return files;}
    private record Session(UUID id,String username,HttpClient client,String csrf) { }
}
