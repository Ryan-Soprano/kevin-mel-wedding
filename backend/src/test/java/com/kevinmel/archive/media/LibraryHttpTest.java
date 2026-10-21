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
import com.kevinmel.archive.library.LibraryCursor;
import com.kevinmel.archive.library.LibraryQuery;
import com.kevinmel.archive.library.LibraryRepository;
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

/** Real HTTP, current sessions and disposable PostgreSQL; all names/content/objects are synthetic. */
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "archive.environment=local","spring.profiles.active=local","archive.audio.enabled=true","archive.revealed=true",
        "archive.storage.enabled=false","archive.media.uploads-paused=false","archive.retention.enabled=false"})
@Import(CoupleAuthoringHttpTest.Fixtures.class)
class LibraryHttpTest {
    @Container @ServiceConnection static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    private static final JsonMapper JSON=JsonMapper.builder().build();
    private static final String LIBRARY="/api/library/memories";
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired DataSource dataSource;
    @Autowired PasswordEncoder encoder;
    @Autowired PhotoHttpTest.MutableClock clock;
    @Autowired CoupleAuthoringHttpTest.ControlledStorage storage;
    @Autowired RetentionRepository retention;
    private Session couple;
    @BeforeEach void isolate()throws Exception {
        db.sql("TRUNCATE tag,timeline_state,timeline_event,album,contribution,archive_account CASCADE").update();
        clock.now=Instant.parse("2026-10-10T12:00:00Z"); storage.objects.clear(); storage.outage=false; storage.afterRead=null; couple=login();
    }

    @Test void terminalTagIdentityDuplicatesAndNoOpsPreserveOriginals()throws Exception {
        assertThat(tags(get("/api/tags"))).isEmpty(); assertThat(memories(get(LIBRARY))).isEmpty();
        UUID id=UUID.randomUUID(),other=UUID.randomUUID(),memory=note("Original contents"); var before=get("/api/memories/"+memory);
        assertThat(write("PUT",tag(id),Map.of("name","New"),null).statusCode()).isEqualTo(428);
        var current=create(id," \u3000Synthetic tag\u00a0"); assertThat(text(current,"$.name")).isEqualTo("Synthetic tag"); assertToken(current);
        var duplicate=create(other,"Synthetic tag"); assertThat(text(duplicate,"$.tagId")).isNotEqualTo(text(current,"$.tagId"));
        assertThat(write("PUT",tag(id),Map.of("name","Overwrite"),"*").statusCode()).isEqualTo(412);
        assertThat(etag(write("PATCH",tag(id),Map.of("name","Synthetic tag"),etag(current)))).isEqualTo(etag(current));
        var linked=write("PUT",link(id,memory),null,etag(current)); assertThat(linked.statusCode()).isEqualTo(200);
        assertThat(number(linked,"$.memberCount")).isEqualTo(1); assertThat(etag(linked)).isNotEqualTo(etag(current));
        assertThat(etag(write("PUT",link(id,memory),null,etag(linked)))).isEqualTo(etag(linked));
        assertThat(write("PATCH",tag(id),Map.of("name","Stale"),etag(current)).statusCode()).isEqualTo(412);
        var removed=write("DELETE",link(id,memory),null,etag(linked)); assertThat(number(removed,"$.memberCount")).isZero();
        assertThat(etag(write("DELETE",link(id,memory),null,etag(removed)))).isEqualTo(etag(removed));
        current=write("PUT",link(id,memory),null,etag(removed));
        var deleted=write("DELETE",tag(id),null,etag(current)); assertThat(JsonPath.<Object>read(deleted.body(),"$.name")).isNull();
        assertThat(number(deleted,"$.memberCount")).isZero(); assertThat(text(deleted,"$.deletedAt")).isNotNull();
        assertThat(get(tag(id)).body()).isEqualTo(deleted.body()); assertThat(memberMemories(get(tag(id)+"/members"))).isEmpty();
        assertThat(etag(write("DELETE",tag(id),null,etag(deleted)))).isEqualTo(etag(deleted));
        assertThat(write("PUT",tag(id),Map.of("name","Resurrection"),"*").statusCode()).isEqualTo(412);
        assertThat(write("PATCH",tag(id),Map.of("name","Resurrection"),etag(deleted)).statusCode()).isEqualTo(404);
        assertThat(get("/api/memories/"+memory).body()).isEqualTo(before.body()); assertThat(tags(get("/api/tags"))).containsExactly(other.toString());
    }

    @Test void literalTextAndPartialMemoryDatesCombineWithoutChangingSavedOrder()throws Exception {
        UUID written=note("Literal %_\\' phrase"),title=note("Title only"),description=note("Description only"),guest=note("Guest only"),unknown=note("Unknown date");
        db.sql("UPDATE memory SET title='Literal %_\\'' phrase',memory_date='2024',date_precision='YEAR' WHERE id=:id").param("id",title).update();
        db.sql("UPDATE memory SET description='Literal %_\\'' phrase',memory_date='2024-02',date_precision='MONTH' WHERE id=:id").param("id",description).update();
        db.sql("UPDATE memory SET memory_date='2024-02-29',date_precision='DAY' WHERE id=:id").param("id",written).update();
        db.sql("UPDATE contribution SET source='GUEST',author_account_id=NULL,guest_name='Literal %_\\'' phrase' WHERE id=(SELECT contribution_id FROM memory WHERE id=:id)").param("id",guest).update();
        String needle=url("  lItErAl %_\\' PhRaSe  ");
        assertThat(memories(get(LIBRARY+"?q="+needle))).containsExactlyInAnyOrder(written.toString(),title.toString(),description.toString(),guest.toString());
        assertThat(memories(get(LIBRARY+"?q="+url("%")))).hasSize(4); assertThat(memories(get(LIBRARY+"?q="+url("_")))).hasSize(4);
        assertThat(memories(get(LIBRARY+"?fromYear=2024&toYear=2024"))).containsExactlyInAnyOrder(written.toString(),title.toString(),description.toString());
        assertThat(memories(get(LIBRARY+"?datePrecision=MONTH&fromYear=2024&toYear=2024"))).containsExactly(description.toString());
        assertThat(memories(get(LIBRARY+"?datePrecision=UNKNOWN"))).containsExactlyInAnyOrder(guest.toString(),unknown.toString());
        assertThat(memories(get(LIBRARY+"?q="+url("' OR 1=1 --")))).isEmpty();
        var all=get(LIBRARY); List<String> firstOrder=memories(all); assertThat(memories(get(LIBRARY+"?q="+url(" \u3000 ")))).isEqualTo(firstOrder);
        var page=get(LIBRARY+"?q="+needle+"&limit=1"); String cursor=text(page,"$.nextCursor");
        assertThat(new String(Base64.getUrlDecoder().decode(cursor),java.nio.charset.StandardCharsets.UTF_8)).doesNotContain("phrase","2024","Literal");
        assertThat(get(LIBRARY+"?q="+url("different")+"&cursor="+cursor).statusCode()).isEqualTo(400);
        String anchor=memories(page).getFirst(); db.sql("UPDATE memory SET text_content='Changed',title=NULL,description=NULL WHERE id=:id").param("id",UUID.fromString(anchor)).update();
        db.sql("UPDATE contribution SET guest_name=NULL WHERE id=(SELECT contribution_id FROM memory WHERE id=:id)").param("id",UUID.fromString(anchor)).update();
        var stale=get(LIBRARY+"?q="+needle+"&cursor="+cursor); assertThat(stale.statusCode()).isEqualTo(412); assertThat(text(stale,"$.error.code")).isEqualTo("LIBRARY_CONFLICT");
    }

    @Test void boundedTagAndMemberPagesBindContextAndSupportLegacyMemoryIds()throws Exception {
        UUID first=note("Original legacy"),legacy=UUID.fromString("00000000-0000-1000-8000-000000000001");
        db.sql("UPDATE memory SET id=:legacy WHERE id=:id").param("legacy",legacy).param("id",first).update();
        UUID id=UUID.randomUUID(); var current=create(id,"Paginated"); List<String> attached=new ArrayList<>();
        for(int i=0;i<53;i++) { clock.now=clock.now.plusSeconds(1); UUID extra=UUID.randomUUID(); var t=create(extra,"Label "+i); write("PUT",link(extra,legacy),null,etag(t)); attached.addFirst(extra.toString()); }
        var tagsPage=get(LIBRARY+"/"+legacy+"/tags?limit=50"); assertThat(text(tagsPage,"$.memoryId")).isEqualTo(legacy.toString());
        assertThat(tags(tagsPage)).isEqualTo(attached.subList(0,50)); String attachedCursor=text(tagsPage,"$.nextCursor");
        assertThat(tags(get(LIBRARY+"/"+legacy+"/tags?limit=50&cursor="+attachedCursor))).isEqualTo(attached.subList(50,53));
        assertThat(get(LIBRARY+"/"+note("Other original")+"/tags?cursor="+attachedCursor).statusCode()).isEqualTo(400);
        var catalogue=get("/api/tags?q=Label&limit=50"); assertThat(tags(catalogue)).hasSize(50); String catalogueCursor=text(catalogue,"$.nextCursor");
        assertThat(tags(get("/api/tags?q=Label&cursor="+catalogueCursor))).hasSize(3);
        assertThat(get("/api/tags?q=Changed&cursor="+catalogueCursor).statusCode()).isEqualTo(400);
        UUID anchor=UUID.fromString(tags(catalogue).getLast()); var changed=get(tag(anchor));
        assertThat(write("PATCH",tag(anchor),Map.of("name","Changed"),etag(changed)).statusCode()).isEqualTo(200);
        assertThat(get("/api/tags?q=Label&cursor="+catalogueCursor).statusCode()).isEqualTo(412);
        List<String> expected=new ArrayList<>();
        for(int i=0;i<53;i++) { clock.now=clock.now.plusSeconds(1); UUID memory=i==0 ? legacy : note("Tagged original "+i); current=write("PUT",link(id,memory),null,etag(current)); expected.addFirst(memory.toString()); }
        var members=get(tag(id)+"/members?limit=50"); assertThat(memberMemories(members)).isEqualTo(expected.subList(0,50));
        String memberCursor=text(members,"$.nextCursor"); assertThat(memberMemories(get(tag(id)+"/members?cursor="+memberCursor))).isEqualTo(expected.subList(50,53));
        assertThat(get(tag(UUID.randomUUID())+"/members?cursor="+memberCursor).statusCode()).isEqualTo(400);
        UUID removed=UUID.fromString(expected.getFirst()); current=write("DELETE",link(id,removed),null,etag(current));
        assertThat(get(tag(id)+"/members?cursor="+memberCursor).statusCode()).isEqualTo(412);
        assertThat(memories(get(LIBRARY+"?tagId="+id+"&limit=50"))).hasSize(50);
        assertThat(get(LIBRARY+"?tagId="+UUID.randomUUID()).statusCode()).isEqualTo(404);
    }

    @Test void memoryDeleteDetachAndErasureReplayPreserveOtherTagsAndOriginals()throws Exception {
        UUID memory=note("Erase this original"),sibling=note("Retained original"),first=UUID.randomUUID(),second=UUID.randomUUID();
        var one=create(first,"First"); var two=create(second,"Second"); one=write("PUT",link(first,memory),null,etag(one)); one=write("PUT",link(first,sibling),null,etag(one)); two=write("PUT",link(second,memory),null,etag(two));
        String beforeOne=etag(one),beforeTwo=etag(two); var preserved=get("/api/memories/"+sibling);
        assertThat(review(memory,"DELETE","\"1\"").statusCode()).isEqualTo(200);
        assertThat(etag(get(tag(first)))).isNotEqualTo(beforeOne); assertThat(etag(get(tag(second)))).isNotEqualTo(beforeTwo);
        assertThat(memberMemories(get(tag(first)+"/members"))).containsExactly(sibling.toString()); assertThat(memberMemories(get(tag(second)+"/members"))).isEmpty();
        assertThat(memories(get(LIBRARY))).containsExactly(sibling.toString()); assertThat(get(LIBRARY+"/"+memory+"/tags").statusCode()).isEqualTo(404);
        assertThat(write("PUT",link(first,memory),null,etag(get(tag(first)))).statusCode()).isEqualTo(404);
        assertThat(review(memory,"KEEP","\"2\"").statusCode()).isEqualTo(200); assertThat(tags(get(LIBRARY+"/"+memory+"/tags"))).isEmpty();
        one=write("PUT",link(first,memory),null,etag(get(tag(first)))); assertThat(one.statusCode()).isEqualTo(200);
        assertThat(review(memory,"DELETE","\"3\"").statusCode()).isEqualTo(200);
        Instant at=clock.now.plus(Duration.ofDays(31)); var plan=retention.claim(10,at).getFirst();
        db.sql("INSERT INTO memory_tag(tag_id,memory_id) VALUES(:tag,:memory)").param("tag",first).param("memory",memory).update();
        String revision=etag(get(tag(first))); assertThat(retention.finish(plan,at)).isTrue(); assertThat(etag(get(tag(first)))).isNotEqualTo(revision);
        db.sql("INSERT INTO memory_tag(tag_id,memory_id) VALUES(:tag,:memory)").param("tag",second).param("memory",memory).update();
        revision=etag(get(tag(second))); assertThat(retention.finish(plan,at)).isFalse(); assertThat(etag(get(tag(second)))).isNotEqualTo(revision);
        assertThat(db.sql("SELECT count(*) FROM memory_tag WHERE memory_id=:id").param("id",memory).query(Long.class).single()).isZero();
        assertThat(get("/api/memories/"+sibling).body()).isEqualTo(preserved.body()); assertThat(db.sql("SELECT count(*) FROM tag").query(Long.class).single()).isEqualTo(2);
    }

    @Test void pendingAndVerifiedPhotoAudioSearchAndTagDeletionPreserveOriginalBytes()throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,"Media label"); var bytes=new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(3,2,BufferedImage.TYPE_INT_RGB),"png",bytes);
        for(String type:List.of("PHOTO","AUDIO")) {
            byte[] original=type.equals("PHOTO") ? bytes.toByteArray() : AudioFixtures.audio("audio/webm",.35);
            String checksum=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original));
            var item=new HashMap<String,Object>(); item.put("clientItemId",UUID.randomUUID().toString()); item.put("originalFilename","Literal %_' "+type.toLowerCase()+".file");
            item.put("declaredContentType",type.equals("PHOTO") ? "image/png" : "audio/webm"); item.put("byteSize",original.length); item.put("checksumSha256",checksum); item.put("caption","Literal %_\\' caption");
            if(type.equals("AUDIO")) item.put("durationSeconds",.35); String key=UUID.randomUUID().toString();
            var created=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("memoryType",type,"items",List.of(item))),Map.of("Idempotency-Key",key));
            assertThat(created.statusCode()).isEqualTo(201); UUID memory=UUID.fromString(text(created,"$.memories[0].memoryId"));
            assertThat(memories(get(LIBRARY+"?memoryType="+type))).isEmpty(); assertThat(get(LIBRARY+"/"+memory+"/tags").statusCode()).isEqualTo(404);
            assertThat(write("PUT",link(id,memory),null,etag(current)).statusCode()).isEqualTo(404);
            String upload="/api/memories/contributions/"+text(created,"$.contributionId")+"/memories/"+memory;
            var grant=send(couple,"POST",upload+"/upload-grants",null,Map.of("Idempotency-Key",key)); assertThat(grant.statusCode()).isEqualTo(201);
            storage.objects.put("staging/"+text(grant,"$.grantId"),original);
            assertThat(send(couple,"POST",upload+"/finalize",JSON.writeValueAsString(Map.of("grantId",text(grant,"$.grantId"))),Map.of("Idempotency-Key",key)).statusCode()).isEqualTo(200);
            var before=get("/api/memories/"+memory); current=write("PUT",link(id,memory),null,etag(current)); assertThat(current.statusCode()).isEqualTo(200);
            assertThat(memories(get(LIBRARY+"?memoryType="+type+"&q="+url("%_\\' caption")+"&tagId="+id))).containsExactly(memory.toString());
            assertThat(memories(get(LIBRARY+"?memoryType="+type+"&q="+url(type.toLowerCase()+".file")))).containsExactly(memory.toString());
            assertThat(get("/api/memories/"+memory).body()).isEqualTo(before.body());
        }
        var snapshot=new HashMap<>(storage.objects); var rows=db.sql("SELECT id,checksum_sha256,byte_size,created_at FROM media_asset ORDER BY id").query((rs,row)->rs.getString(1)+rs.getString(2)+rs.getLong(3)+rs.getString(4)).list();
        assertThat(write("DELETE",tag(id),null,etag(current)).statusCode()).isEqualTo(200); assertThat(memories(get(LIBRARY))).hasSize(2);
        assertThat(storage.objects.keySet()).isEqualTo(snapshot.keySet()); snapshot.forEach((key,value)->assertThat(storage.objects.get(key)).containsExactly(value));
        assertThat(db.sql("SELECT id,checksum_sha256,byte_size,created_at FROM media_asset ORDER BY id").query((rs,row)->rs.getString(1)+rs.getString(2)+rs.getLong(3)+rs.getString(4)).list()).isEqualTo(rows);
    }

    @Test void currentAuthorityAfterTagWaitAndMemoryDeleteLockOrderPreventDanglingLinks()throws Exception {
        UUID memory=note("Queued original"),id=UUID.randomUUID(); String token=etag(create(id,"Queued"));
        try(var holder=dataSource.getConnection();var workers=Executors.newSingleThreadExecutor()) {
            holder.setAutoCommit(false); int holderPid=pid(holder); lockTag(holder,id);
            var queued=workers.submit(()->write("PUT",link(id,memory),null,token));
            try { awaitWaiter(holderPid); assertThat(queued.isDone()).isFalse(); db.sql("UPDATE archive_account SET enabled=false WHERE id=:id").param("id",couple.id()).update(); }
            finally { holder.rollback(); }
            assertThat(queued.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(401);
        }
        assertThat(db.sql("SELECT count(*) FROM memory_tag").query(Long.class).single()).isZero();
        assertThat(db.sql("SELECT revision FROM tag WHERE id=:id").param("id",id).query(UUID.class).single().toString()).isEqualTo(token.substring(1,token.length()-1));
        couple=login();
        try(var holder=dataSource.getConnection();var workers=Executors.newFixedThreadPool(2)) {
            holder.setAutoCommit(false); int holderPid=pid(holder); lockTag(holder,id);
            var add=workers.submit(()->write("PUT",link(id,memory),null,token)); Future<HttpResponse<String>> delete;
            try { int addingPid=awaitWaiter(holderPid); delete=workers.submit(()->review(memory,"DELETE","\"1\"")); awaitWaiter(addingPid); assertThat(delete.isDone()).isFalse(); }
            finally { holder.rollback(); }
            assertThat(add.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(200); assertThat(delete.get(30,TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        }
        assertThat(db.sql("SELECT count(*) FROM memory_tag").query(Long.class).single()).isZero(); assertThat(number(get(tag(id)),"$.memberCount")).isZero();
    }

    @Test void concurrentKnownCreationAndSameRevisionEditsHaveOneWinner()throws Exception {
        UUID id=UUID.randomUUID();
        try(var workers=Executors.newFixedThreadPool(2)) {
            var a=workers.submit(()->write("PUT",tag(id),Map.of("name","A"),"*")); var b=workers.submit(()->write("PUT",tag(id),Map.of("name","B"),"*"));
            assertThat(List.of(a.get(30,TimeUnit.SECONDS).statusCode(),b.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(201,412);
            String token=etag(get(tag(id))); a=workers.submit(()->write("PATCH",tag(id),Map.of("name","Changed A"),token)); b=workers.submit(()->write("PATCH",tag(id),Map.of("name","Changed B"),token));
            assertThat(List.of(a.get(30,TimeUnit.SECONDS).statusCode(),b.get(30,TimeUnit.SECONDS).statusCode())).containsExactlyInAnyOrder(200,412);
        }
        assertThat(db.sql("SELECT count(*) FROM tag").query(Long.class).single()).isEqualTo(1);
    }

    @Test void malformedPrivateFiltersBodiesAndConditionsCannotMutateOrLeak()throws Exception {
        UUID id=UUID.randomUUID(); var current=create(id,"Validation"); var guest=new Session(null,HttpClient.newHttpClient(),null);
        for(String path:List.of("/api/library","/api/library/",LIBRARY,LIBRARY+"/","/api/tags","/api/tags/",tag(id),tag(id)+"/members"))
            assertThat(send(guest,"GET",path,null,Map.of()).statusCode()).isIn(401,403);
        var revoked=login(); db.sql("UPDATE archive_account SET role='OPERATOR' WHERE id=:id").param("id",revoked.id()).update(); assertThat(send(revoked,"GET",LIBRARY,null,Map.of()).statusCode()).isEqualTo(401);
        for(String body:List.of("null","{}","{\"name\":\"ok\",\"visibility\":\"PUBLIC\"}","{\"name\":\" \"}"))
            assertThat(send(couple,"PATCH",tag(id),body,Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        assertThat(write("PATCH",tag(id),Map.of("name","x".repeat(201)),etag(current)).statusCode()).isEqualTo(400);
        for(String suffix:List.of("limit=0","limit=51","fromYear=0","fromYear=10000","fromYear=2025&toYear=2024","datePrecision=UNKNOWN&fromYear=2024","reviewStatus=DELETE","memoryType=toString","tagId=bad","unknown=1","q=a&q=b","cursor=invalid"))
            assertThat(get(LIBRARY+"?"+suffix).statusCode()).as(suffix).isEqualTo(400);
        assertThat(get("/api/tags?q=a&q=b").statusCode()).isEqualTo(400); assertThat(get("/api/tags?unknown=1").statusCode()).isEqualTo(400);
        assertThat(send(couple,"PATCH",tag(id)," ".repeat(16_385),Map.of("If-Match",etag(current))).statusCode()).isEqualTo(413);
        var chunked=request(couple,tag(id),Map.of("If-Match",etag(current))).method("PATCH",HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(new byte[16_385]))).build();
        assertThat(couple.client().send(chunked,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(413);
        assertThat(send(couple,"GET",LIBRARY,"{}",Map.of()).statusCode()).isEqualTo(400); assertThat(send(couple,"DELETE",tag(id),"{}",Map.of("If-Match",etag(current))).statusCode()).isEqualTo(400);
        assertThat(write("PATCH",tag(id),Map.of("name","ok"),null).statusCode()).isEqualTo(428); assertThat(write("PATCH",tag(id),Map.of("name","ok"),"W/"+etag(current)).statusCode()).isEqualTo(400);
        assertThat(send(couple,"PATCH",tag(id),"{\"name\":\"ok\"}",Map.of("If-Match",etag(current),"Origin","https://foreign.example.test")).statusCode()).isEqualTo(403);
        var noCsrf=request(guest,tag(id),Map.of("If-Match",etag(current))).method("PATCH",HttpRequest.BodyPublishers.ofString("{\"name\":\"ok\"}")).build(); assertThat(couple.client().send(noCsrf,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
        assertThat(get(tag(id)).body()).isEqualTo(current.body()); assertThat(current.body()).doesNotContain(couple.id().toString(),"objectKey","password","couple:");
    }

    @Test void tenThousandRowArchiveUsesBoundedKeysetPagesAndLiteralFilteredDatabaseResults()throws Exception {
        db.sql("""
                WITH source AS(INSERT INTO contribution(id,event_key,guest_name,idempotency_key,created_at)
                    SELECT gen_random_uuid(),'kevin-mel-wedding','Fixture '||i,gen_random_uuid()::text,:at FROM generate_series(1,10000) i RETURNING id,guest_name)
                INSERT INTO memory(id,contribution_id,memory_type,text_content,review_status,visibility,created_at,updated_at,delete_after,purge_started_at,memory_date,date_precision)
                SELECT gen_random_uuid(),id,'TEXT',guest_name||' literal %_needle',
                    CASE WHEN n%5=0 OR n%100=1 THEN 'DELETE' WHEN n%3=0 THEN 'PENDING' WHEN n%3=1 THEN 'KEEP' ELSE 'ARCHIVED' END,
                    'COUPLE_ONLY',:at+make_interval(secs=>n),:at+make_interval(secs=>n),
                    CASE WHEN n%5=0 OR n%100=1 THEN :at+interval '30 days' ELSE NULL END,
                    CASE WHEN n%100=1 THEN :at ELSE NULL END,
                    CASE WHEN n%4=0 THEN NULL WHEN n%4=1 THEN lpad((2000+n%30)::text,4,'0') WHEN n%4=2 THEN (2000+n%30)::text||'-02' ELSE (2000+n%30)::text||'-02-28' END,
                    CASE WHEN n%4=0 THEN 'UNKNOWN' WHEN n%4=1 THEN 'YEAR' WHEN n%4=2 THEN 'MONTH' ELSE 'DAY' END
                FROM(SELECT id,guest_name,substring(guest_name FROM 9)::integer n FROM source) numbered
                """).param("at",java.time.OffsetDateTime.ofInstant(clock.now,ZoneOffset.UTC)).update();
        UUID tag=UUID.randomUUID(); create(tag,"Fixture subset");
        db.sql("INSERT INTO memory_tag(tag_id,memory_id) SELECT :tag,id FROM memory WHERE review_status<>'DELETE' AND substring(text_content FROM 9 FOR position(' literal' IN text_content)-9)::integer%7=0").param("tag",tag).update();
        db.sql("ANALYZE memory").update(); db.sql("ANALYZE contribution").update(); db.sql("ANALYZE memory_tag").update();
        long started=System.nanoTime(); var first=get(LIBRARY+"?limit=50"); assertThat(first.statusCode()).isEqualTo(200); assertThat(memories(first)).hasSize(50);
        assertThat(Instant.parse(text(first,"$.items[0].createdAt"))).isAfter(clock.now);
        String cursor=text(first,"$.nextCursor"); var next=get(LIBRARY+"?limit=50&cursor="+cursor); assertThat(memories(next)).hasSize(50);
        assertThat(memories(first)).doesNotContainAnyElementsOf(memories(next));
        var filtered=get(LIBRARY+"?q="+url("%_needle")+"&memoryType=TEXT&datePrecision=DAY&fromYear=2010&toYear=2020&tagId="+tag+"&limit=50");
        assertThat(filtered.statusCode()).isEqualTo(200); assertThat(memories(filtered)).isNotEmpty().hasSizeLessThanOrEqualTo(50);
        List<String> expected=db.sql("SELECT m.id::text FROM memory m JOIN memory_tag mt ON mt.memory_id=m.id WHERE mt.tag_id=:tag AND m.date_precision='DAY' AND left(m.memory_date,4)::integer BETWEEN 2010 AND 2020 ORDER BY m.created_at DESC,m.id DESC LIMIT 50").param("tag",tag).query(String.class).list();
        assertThat(memories(filtered)).isEqualTo(expected);
        assertThat(get(LIBRARY+"?q="+url("%_not_present")+"&limit=50").statusCode()).isEqualTo(200);
        assertThat(memories(get(LIBRARY+"?q="+url("%_not_present")+"&limit=50"))).isEmpty();
        String plan=String.join("\n",db.sql("EXPLAIN(ANALYZE,BUFFERS) SELECT id FROM memory WHERE visibility='COUPLE_ONLY' AND review_status IN('PENDING','KEEP','ARCHIVED') AND purge_started_at IS NULL AND purged_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 51").query(String.class).list());
        assertThat(plan).contains("Limit","Execution Time"); System.out.println("ARC04 synthetic10k first/next/filter reads observedMilliseconds="+TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)+"\n"+plan);
        assertThat(db.sql("SELECT count(*) FROM memory").query(Long.class).single()).isEqualTo(10000);
        var bound=LibraryQuery.from("50",null,"%_needle","TEXT","ALL","DAY","2010","2020",tag.toString());
        assertThat(new LibraryRepository(db).list(bound,clock.now).stream().filter(row->row.memory()!=null).count()).isLessThanOrEqualTo(51);
    }

    private Session login()throws Exception {
        UUID id=UUID.randomUUID(); String username="synthetic-library-"+id,password="synthetic-library-passphrase";
        db.sql("INSERT INTO archive_account(id,username,display_name,password_hash,role,enabled,credentials_version) VALUES(:id,:name,'Synthetic Library',:hash,'COUPLE',true,1)").param("id",id).param("name",username).param("hash",encoder.encode(password)).update();
        var session=new Session(id,HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build(),null);
        String csrf=text(send(session,"GET","/api/session",null,Map.of()),"$.csrfToken");
        var response=send(session,"POST","/api/session",JSON.writeValueAsString(Map.of("username",username,"password",password)),Map.of("X-CSRF-Token",csrf)); assertThat(response.statusCode()).isEqualTo(200);
        return new Session(id,session.client(),text(response,"$.csrfToken"));
    }
    private UUID note(String message)throws Exception {
        var response=send(couple,"POST","/api/memories/contributions",JSON.writeValueAsString(Map.of("message",message)),Map.of("Idempotency-Key",UUID.randomUUID().toString()));
        assertThat(response.statusCode()).isEqualTo(201); return UUID.fromString(text(response,"$.memories[0].memoryId"));
    }
    private HttpResponse<String> create(UUID id,String name)throws Exception { var result=write("PUT",tag(id),Map.of("name",name),"*"); assertThat(result.statusCode()).as(result.body()).isEqualTo(201); return result; }
    private HttpResponse<String> write(String method,String path,Map<String,Object> body,String token)throws Exception {
        var headers=new HashMap<String,String>(); if(token!=null) headers.put(token.equals("*") ? "If-None-Match" : "If-Match",token); return send(couple,method,path,body==null ? null : JSON.writeValueAsString(body),headers);
    }
    private HttpResponse<String> review(UUID id,String status,String token)throws Exception {return send(couple,"PATCH","/api/memories/"+id+"/review",JSON.writeValueAsString(Map.of("reviewStatus",status)),Map.of("If-Match",token));}
    private HttpResponse<String> get(String path)throws Exception {return send(couple,"GET",path,null,Map.of());}
    private HttpResponse<String> send(Session session,String method,String path,String body,Map<String,String> headers)throws Exception {
        return session.client().send(request(session,path,headers).method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest.Builder request(Session session,String path,Map<String,String> headers) {
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(45)).header("X-Api-Contract","1").header("Content-Type","application/json").header("Origin",headers.getOrDefault("Origin","http://localhost:"+port));
        if(session.csrf()!=null && !headers.containsKey("X-CSRF-Token")) request.header("X-CSRF-Token",session.csrf()); headers.forEach((key,value)->{if(!key.equals("Origin"))request.header(key,value);}); return request;
    }
    private int awaitWaiter(int holder)throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10); while(System.nanoTime()<deadline) {
            var waiting=db.sql("SELECT pid FROM pg_stat_activity WHERE :holder=ANY(pg_blocking_pids(pid)) ORDER BY pid").param("holder",holder).query(Integer.class).list();
            if(!waiting.isEmpty())return waiting.getFirst(); Thread.sleep(20);
        } throw new AssertionError("Tag request did not wait for the owned PostgreSQL lock.");
    }
    private static int pid(java.sql.Connection connection)throws Exception {try(var q=connection.createStatement();var rs=q.executeQuery("SELECT pg_backend_pid()")){rs.next();return rs.getInt(1);}}
    private static void lockTag(java.sql.Connection connection,UUID id)throws Exception {try(var q=connection.prepareStatement("SELECT id FROM tag WHERE id=? FOR UPDATE")){q.setObject(1,id);q.executeQuery().close();}}
    private static String tag(UUID id){return "/api/tags/"+id;}
    private static String link(UUID id,UUID memory){return tag(id)+"/members/"+memory;}
    private static String text(HttpResponse<String> response,String path){return JsonPath.read(response.body(),path);}
    private static long number(HttpResponse<String> response,String path){return JsonPath.<Number>read(response.body(),path).longValue();}
    private static List<String> memories(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].memoryId");}
    private static List<String> memberMemories(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].memory.memoryId");}
    private static List<String> tags(HttpResponse<String> response){return JsonPath.read(response.body(),"$.items[*].tagId");}
    private static String etag(HttpResponse<String> response){return response.headers().firstValue("ETag").orElseThrow();}
    private static String url(String value){return URLEncoder.encode(value,java.nio.charset.StandardCharsets.UTF_8);}
    private static void assertToken(HttpResponse<String> response){assertThat(etag(response)).isEqualTo("\""+text(response,"$.revision")+"\"");assertThat(UUID.fromString(text(response,"$.revision")).version()).isEqualTo(4);}
    private record Session(UUID id,HttpClient client,String csrf) { }
}
