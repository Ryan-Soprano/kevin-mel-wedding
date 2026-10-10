package com.kevinmel.archive.portable;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Isolated real PostgreSQL snapshots and currentness checks; never copies the operator recovery format. */
@Testcontainers
class PortableExportRepositoryPostgresTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");
    private final List<String> schemas = new ArrayList<>();
    private DataSource data; private JdbcClient db; private PortableExportRepository repository;

    @BeforeEach void isolate() {
        String schema = "portable_" + UUID.randomUUID().toString().replace("-", ""); schemas.add(schema);
        data = new DriverManagerDataSource(postgres.getJdbcUrl() + (postgres.getJdbcUrl().contains("?")?"&":"?") + "currentSchema=" + schema, postgres.getUsername(), postgres.getPassword());
        Flyway.configure().dataSource(data).schemas(schema).defaultSchema(schema).load().migrate(); db=JdbcClient.create(data);
        repository = repository(data);
    }
    @AfterEach void removeOnlyOwnedSchemas() throws Exception {
        try (var connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword()); var statement=connection.createStatement()) {
            for(String schema:schemas) { if(!schema.matches("portable_[0-9a-f]{32}")) throw new IllegalStateException("Unsafe fixture schema."); statement.execute("DROP SCHEMA " + schema + " CASCADE"); }
        }
    }

    @Test void mixedCompletedPrivateSnapshotPreservesGroupingDatesOrderedSharedLinksAndExcludesSecretsDeletedAndUnfinished() {
        UUID guest=contribution(false), couple=contribution(true);
        UUID note=memory(guest,"TEXT","PENDING","A complete named note",null), anonymous=memory(contribution(false),"TEXT","ARCHIVED","Anonymous note",null);
        db.sql("UPDATE contribution SET guest_name='Synthetic named guest' WHERE id=:id").param("id",guest).update();
        UUID photo=memory(guest,"PHOTO","KEEP",null,0), second=memory(guest,"PHOTO","KEEP",null,1), audio=memory(couple,"AUDIO","KEEP",null,0);
        asset(photo,"image/png","UPLOADED"); asset(second,"image/webp","UPLOADED"); asset(audio,"audio/webm","UPLOADED");
        db.sql("UPDATE memory SET title='Partial date',description='Preserve metadata',memory_date='2020-05',date_precision='MONTH' WHERE id=:id").param("id",photo).update();
        memory(guest,"TEXT","DELETE","Excluded secret deleted content",null);
        memory(guest,"PHOTO","PENDING",null,2); // no asset at all: SQL NULL must still count as unavailable
        asset(memory(guest,"PHOTO","PENDING",null,3),"image/png","PENDING");
        asset(memory(guest,"AUDIO","PENDING",null,4),"audio/webm","FAILED");
        UUID album=organization("album","Shared album"), other=organization("album","Empty album");
        link("album_membership","album_id",album,note,1L); link("album_membership","album_id",album,photo,Long.MAX_VALUE);
        UUID event=organization("timeline_event","First remembered moment"), tag=organization("tag","Same label");
        db.sql("UPDATE timeline_event SET event_date='2020',date_precision='YEAR' WHERE id=:id").param("id",event).update();
        UUID earlier=organization("timeline_event","Earlier partial month"), undated=organization("timeline_event","Undated event");
        db.sql("UPDATE timeline_event SET event_date='1999-05',date_precision='MONTH' WHERE id=:id").param("id",earlier).update();
        link("timeline_event_memory","event_id",event,photo,null); link("timeline_event_memory","event_id",event,audio,null);
        link("memory_tag","tag_id",tag,note,null); link("memory_tag","tag_id",tag,photo,null);
        organization("tag","Same label");
        tombstone("album"); tombstone("timeline_event"); tombstone("tag");
        var captured=repository.capture(); String json=new String(PortableExportRepository.JSON.writeValueAsBytes(captured.archiveData()),java.nio.charset.StandardCharsets.UTF_8);
        assertThat(captured.memories()).hasSize(5); assertThat(captured.originals()).hasSize(3);
        assertThat(captured.memories()).filteredOn(row->guest.equals(row.contributionId())).extracting(PortableSnapshot.Memory::memoryId).contains(note,photo,second);
        assertThat(captured.memories()).filteredOn(row->photo.equals(row.memoryId())).singleElement().satisfies(row->{ assertThat(row.itemPosition()).isZero(); assertThat(row.memoryDate()).isEqualTo("2020-05"); assertThat(row.datePrecision()).isEqualTo("MONTH"); });
        assertThat(captured.memories()).filteredOn(row->anonymous.equals(row.memoryId())).singleElement().satisfies(row->assertThat(row.guestName()).isNull());
        assertThat(captured.originals()).filteredOn(row->audio.equals(row.memoryId())).singleElement().satisfies(row->{ assertThat(row.audioContainer()).isEqualTo("webm"); assertThat(row.audioCodec()).isEqualTo("opus"); assertThat(row.durationMs()).isEqualTo(1000L); });
        assertThat(captured.albums()).filteredOn(row->album.equals(row.id())).singleElement().satisfies(row->assertThat(row.members()).containsExactly(new PortableSnapshot.AlbumMember(note,"1"),new PortableSnapshot.AlbumMember(photo,Long.toString(Long.MAX_VALUE))));
        assertThat(captured.albums()).filteredOn(row->other.equals(row.id())).singleElement().satisfies(row->assertThat(row.members()).isEmpty());
        assertThat(captured.events()).extracting(PortableSnapshot.Event::id).containsExactly(earlier,event,undated);
        assertThat(captured.events()).filteredOn(row->event.equals(row.id())).singleElement().satisfies(row->{ assertThat(row.eventDate()).isEqualTo("2020"); assertThat(row.datePrecision()).isEqualTo("YEAR"); assertThat(row.memoryIds()).containsExactlyInAnyOrder(photo,audio); });
        assertThat(captured.tags()).hasSize(2); assertThat(captured.tags()).filteredOn(row->tag.equals(row.id())).singleElement().satisfies(row->assertThat(row.memoryIds()).containsExactlyInAnyOrder(note,photo));
        assertThat(captured.excludedCounts()).containsEntry("deletedOrPurgingMemories",1L).containsEntry("unfinishedOrUnavailableMemories",3L)
                .containsEntry("deletedAlbums",1L).containsEntry("deletedTimelineEvents",1L).containsEntry("deletedTags",1L);
        assertThat(json).doesNotContain("Excluded secret", "idempotency", "author_account_id", "object_key", "revision", "grant", "validation", "couple:", "private-capability");
        assertThat(repository.stillCurrent(captured)).isTrue();
        assertThat(captured.originals()).allMatch(row->repository.originalStillCurrent(captured,row));
    }

    @Test void capturedRowAndMembershipChangesInvalidateButNewUnrelatedMemoriesAndOrganizationDoNotChangeTheFrozenCut() {
        UUID contribution=contribution(false), note=memory(contribution,"TEXT","KEEP","Original note",null), photo=memory(contribution,"PHOTO","KEEP",null,0);
        UUID asset=asset(photo,"image/png","UPLOADED"), album=organization("album","Frozen organization");
        link("album_membership","album_id",album,note,1L);
        var captured=repository.capture(); var original=captured.originals().getFirst();
        UUID fresh=memory(contribution(false),"TEXT","KEEP","A later memory",null); organization("tag","A later tag");
        assertThat(repository.stillCurrent(captured)).isTrue(); assertThat(captured.memories()).hasSize(2);
        db.sql("UPDATE memory SET text_content='Changed without token bump' WHERE id=:id").param("id",note).update();
        assertThat(repository.stillCurrent(captured)).isFalse(); assertThat(repository.originalStillCurrent(captured,original)).isTrue();
        db.sql("UPDATE memory SET text_content='Original note' WHERE id=:id").param("id",note).update();
        link("album_membership","album_id",album,fresh,2L);
        assertThat(repository.stillCurrent(captured)).isFalse();
        db.sql("DELETE FROM album_membership WHERE memory_id=:id").param("id",fresh).update(); assertThat(repository.stillCurrent(captured)).isTrue();
        db.sql("UPDATE media_asset SET checksum_sha256=:hash,expected_checksum_sha256=:hash WHERE id=:id").param("hash","b".repeat(64)).param("id",asset).update();
        assertThat(repository.originalStillCurrent(captured,original)).isFalse(); assertThat(repository.stillCurrent(captured)).isFalse();
    }

    @Test void currentnessUsesFreshVisibilityEvenInsideAnOlderRepeatableReadAndRefusesDeleteImmediately() {
        UUID photo=memory(contribution(false),"PHOTO","KEEP",null,0); asset(photo,"image/png","UPLOADED"); var captured=repository.capture();
        var old=new TransactionTemplate(new JdbcTransactionManager(data)); old.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        old.executeWithoutResult(ignored->{
            assertThat(db.sql("SELECT review_status FROM memory WHERE id=:id").param("id",photo).query(String.class).single()).isEqualTo("KEEP");
            var isolated=JdbcClient.create(new DriverManagerDataSource(((DriverManagerDataSource)data).getUrl(),postgres.getUsername(),postgres.getPassword()));
            isolated.sql("UPDATE memory SET review_status='DELETE',delete_after=:at,revision=revision+1 WHERE id=:id").param("at",time(NOW.plusSeconds(300))).param("id",photo).update();
            assertThat(db.sql("SELECT review_status FROM memory WHERE id=:id").param("id",photo).query(String.class).single()).isEqualTo("KEEP");
            assertThat(repository.originalStillCurrent(captured,captured.originals().getFirst())).isFalse();
            assertThat(repository.stillCurrent(captured)).isFalse();
        });
    }

    @Test void captureUsesOneRepeatableSnapshotAcrossMemoryAndOrganizationQueriesWhileConcurrentEditsAreVisibleToLaterChecks() {
        UUID note=memory(contribution(false),"TEXT","KEEP","Before concurrent edit",null), album=organization("album","Before concurrent rename");
        link("album_membership","album_id",album,note,1L); var edited=new AtomicBoolean();
        DataSource intercepted=new DelegatingDataSource(data) {
            @Override public Connection getConnection() throws java.sql.SQLException {
                Connection delegate=super.getConnection();
                return (Connection)Proxy.newProxyInstance(Connection.class.getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
                    try {
                        Object result=method.invoke(delegate,args);
                        if(method.getName().equals("prepareStatement") && args[0] instanceof String sql && sql.contains("SELECT m.id, m.contribution_id")) {
                            var statement=(PreparedStatement)result;
                            return Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(),new Class<?>[]{PreparedStatement.class},(p,m,a)->{
                                try { Object answer=m.invoke(statement,a);
                                    if(m.getName().equals("executeQuery") && edited.compareAndSet(false,true)) {
                                        db.sql("UPDATE memory SET text_content='After concurrent edit',revision=revision+1 WHERE id=:id").param("id",note).update();
                                        db.sql("UPDATE album SET name='After concurrent rename',revision=gen_random_uuid() WHERE id=:id").param("id",album).update();
                                    }
                                    return answer;
                                } catch(InvocationTargetException failure) { throw failure.getCause(); }
                            });
                        }
                        return result;
                    } catch(InvocationTargetException failure) { throw failure.getCause(); }
                });
            }
        };
        var reader=repository(intercepted); var captured=reader.capture();
        assertThat(edited).isTrue(); assertThat(captured.memories()).singleElement().satisfies(row->assertThat(row.text()).isEqualTo("Before concurrent edit"));
        assertThat(captured.albums()).singleElement().satisfies(row->assertThat(row.name()).isEqualTo("Before concurrent rename"));
        assertThat(repository.stillCurrent(captured)).isFalse();
    }

    @Test void oversizedTextMetadataFailsDuringBoundedCaptureWithoutWritingOrCallingStorage() {
        UUID contribution=contribution(false);
        db.sql("INSERT INTO memory(contribution_id,memory_type,text_content) SELECT :contribution,'TEXT',repeat('x',5000) FROM generate_series(1,3500)").param("contribution",contribution).update();
        assertThatThrownBy(repository::capture).isInstanceOf(PortableExportException.class);
        assertThat(db.sql("SELECT count(*) FROM memory").query(Long.class).single()).isEqualTo(3500L);
    }

    @Test void combinedGraphRowCeilingRejectsLargeMembershipSetsEvenWhenNamesAndNotesAreSmall() {
        UUID contribution=contribution(false);
        db.sql("INSERT INTO memory(contribution_id,memory_type,text_content) SELECT :contribution,'TEXT','x' FROM generate_series(1,10000)").param("contribution",contribution).update();
        db.sql("INSERT INTO tag(id,name) SELECT gen_random_uuid(),'x' FROM generate_series(1,10)").update();
        db.sql("INSERT INTO memory_tag(tag_id,memory_id) SELECT t.id,m.id FROM tag t CROSS JOIN memory m").update();
        assertThatThrownBy(repository::capture).isInstanceOf(PortableExportException.class);
        assertThat(db.sql("SELECT count(*) FROM memory_tag").query(Long.class).single()).isEqualTo(100000L);
    }

    private static PortableExportRepository repository(DataSource data) { return new PortableExportRepository(data,new JdbcTransactionManager(data),Clock.fixed(NOW,ZoneOffset.UTC)); }
    private UUID contribution(boolean couple) {
        UUID id=UUID.randomUUID(); db.sql("INSERT INTO contribution(id,event_key,idempotency_key,source,author_account_id) VALUES (:id,'kevin-mel-wedding',:key,:source,:actor)")
                .param("id",id).param("key",couple?"couple:"+"c".repeat(64):"private-capability-"+UUID.randomUUID()).param("source",couple?"COUPLE":"GUEST").param("actor",couple?UUID.randomUUID():null).update(); return id;
    }
    private UUID memory(UUID contribution,String type,String status,String text,Integer position) {
        UUID id=UUID.randomUUID(); db.sql("""
                INSERT INTO memory(id,contribution_id,memory_type,review_status,text_content,item_position,delete_after,created_at,updated_at)
                VALUES (:id,:contribution,:type,:status,:text,:position,:deadline,:at,:at)
                """).param("id",id).param("contribution",contribution).param("type",type).param("status",status).param("text",text).param("position",position)
                .param("deadline",status.equals("DELETE")?time(NOW.plusSeconds(300)):null).param("at",time(NOW)).update(); return id;
    }
    private UUID asset(UUID memory,String mime,String state) {
        UUID id=UUID.randomUUID(); boolean audio=mime.startsWith("audio/"),verified=state.equals("UPLOADED");
        db.sql("""
                INSERT INTO media_asset(id,memory_id,object_key,original_filename,detected_format,declared_content_type,byte_size,expected_byte_size,
                    checksum_sha256,expected_checksum_sha256,upload_state,expected_duration_ms,audio_duration_ms,audio_container,audio_codec,created_at,updated_at)
                VALUES (:id,:memory,:key,'../metadata-filename',:detected,:mime,4,4,:hash,:hash,:state,:expectedDuration,:duration,:container,:codec,:at,:at)
                """).param("id",id).param("memory",memory).param("key","originals/"+id).param("mime",mime).param("hash","a".repeat(64)).param("state",state)
                .param("detected",verified?mime:"application/octet-stream").param("expectedDuration",audio?1000L:null)
                .param("duration",audio&&verified?1000L:null).param("container",audio&&verified?"webm":null).param("codec",audio&&verified?"opus":null).param("at",time(NOW)).update(); return id;
    }
    private UUID organization(String table,String name) {
        UUID id=UUID.randomUUID(); String field=table.equals("timeline_event")?"title":"name";
        db.sql("INSERT INTO "+table+"(id,"+field+",created_at,updated_at) VALUES (:id,:name,:at,:at)").param("id",id).param("name",name).param("at",time(NOW)).update(); return id;
    }
    private void tombstone(String table) {
        UUID id=organization(table,"Deleted organization"); String field=table.equals("timeline_event")?"title":"name";
        db.sql("UPDATE "+table+" SET "+field+"=NULL,deleted_at=:at WHERE id=:id").param("at",time(NOW)).param("id",id).update();
    }
    private void link(String table,String parent,UUID organization,UUID memory,Long position) {
        var sql=db.sql("INSERT INTO "+table+"("+parent+",memory_id"+(position==null?"":",position")+") VALUES (:parent,:memory"+(position==null?"":",:position")+")")
                .param("parent",organization).param("memory",memory); if(position!=null) sql=sql.param("position",position); sql.update();
    }
    private static OffsetDateTime time(Instant at) { return OffsetDateTime.ofInstant(at,ZoneOffset.UTC); }
}
