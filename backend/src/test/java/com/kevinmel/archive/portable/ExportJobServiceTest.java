package com.kevinmel.archive.portable;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.*;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.web.ApiException;

/** Real private ZIP/file lifecycle with synthetic snapshots; authority/source races are controlled independently. */
class ExportJobServiceTest {
    PortableExportRepository repository; ExportAuthority authority; ObjectStorage storage;
    MutableClock clock; AtomicReference<ExportAuthority.Actor> actor; AtomicBoolean allowed,current;
    Map<String,byte[]> objects; PortableSnapshot snapshot; PortablePartWriter writer; ExportJobService jobs;
    @BeforeEach void setup() {
        repository=mock(PortableExportRepository.class); authority=mock(ExportAuthority.class); storage=mock(ObjectStorage.class);
        clock=new MutableClock(); actor=new AtomicReference<>(new ExportAuthority.Actor(UUID.randomUUID(),1)); allowed=new AtomicBoolean(true);current=new AtomicBoolean(true);
        objects=new ConcurrentHashMap<>();snapshot=snapshot(List.of());writer=new PortablePartWriter(storage);
        when(authority.current()).thenAnswer(ignored->actor.get());
        doAnswer(ignored->{if(!allowed.get())throw new ApiException(401,"AUTH_REQUIRED","Synthetic revoked account.");return null;}).when(authority).require(any());
        when(repository.capture()).thenAnswer(ignored->snapshot); when(repository.stillCurrent(any())).thenAnswer(ignored->current.get());
        when(repository.originalStillCurrent(any(),any())).thenAnswer(ignored->current.get());
        when(storage.read(anyString(),anyInt())).thenAnswer(call->Optional.ofNullable(objects.get(call.getArgument(0))));
        jobs=new ExportJobService(repository,writer,authority,clock);
    }
    @AfterEach void close() { jobs.close(); }

    @Test void knownIdentitiesExactAttemptsAndDownloadGenerationDoNotCreateHiddenWork() throws Exception {
        UUID id=UUID.randomUUID(),key=UUID.randomUUID();
        assertStatus(()->jobs.create(id,null),428); jobs.create(id,"*"); ready(id);
        assertStatus(()->jobs.create(id,"*"),412); verify(repository,times(1)).capture();
        assertThat(jobs.prepare(id,1,key.toString()).statusCode()).isEqualTo(202); var done=prepared(id);
        assertThat(done.complete()).isTrue(); assertThat(done.preparedPart().kind()).isEqualTo("INDEX");
        assertThat(jobs.prepare(id,1,key.toString()).statusCode()).isEqualTo(200);
        assertThat(jobs.attempt(id,key).state()).isEqualTo("SUCCEEDED"); assertStatus(()->jobs.cancel(id,key.toString()),409);
        assertStatus(()->jobs.download(id,1,UUID.randomUUID()),409);
        try(var download=jobs.download(id,1,done.preparedPart().generation())) {
            assertThat(download.byteSize()).isBetween(1L,ExportJobService.MAX_ZIP_BYTES);
            byte[] bytes=download.stream().readAllBytes(); assertThat(bytes.length).isEqualTo(download.byteSize());
            assertThat(hash(bytes)).isEqualTo(download.sha256());
            assertThat(entries(bytes)).contains("archive.json","archive.txt","index.html");
            assertStatus(()->jobs.prepare(id,1,UUID.randomUUID().toString()),409);
        }
        UUID cancel=UUID.randomUUID(); assertThat(jobs.cancel(id,cancel.toString()).state()).isEqualTo("CANCELLED");
        assertThat(jobs.cancel(id,cancel.toString()).state()).isEqualTo("CANCELLED"); assertStatus(()->jobs.create(id,"*"),412);
        assertThat(jobs.get(id).preparedPart()).isNull(); assertStatus(()->jobs.prepare(id,1,UUID.randomUUID().toString()),410);
        actor.set(new ExportAuthority.Actor(UUID.randomUUID(),1)); assertStatus(()->jobs.get(id),404);
    }

    @Test void expiryAndRestartAreExplicitAndTerminalIdentitySurvivesUntilHardExpiry() throws Exception {
        UUID id=create(); jobs.prepare(id,1,UUID.randomUUID().toString()); prepared(id);
        clock.now=clock.now.plus(Duration.ofMinutes(31)); var expired=jobs.get(id);
        assertThat(expired.state()).isEqualTo("EXPIRED"); assertThat(expired.totalMemories()).isZero(); assertThat(expired.preparedPart()).isNull();
        assertStatus(()->jobs.create(id,"*"),412);
        try(var restarted=new ExportJobService(repository,writer,authority,clock)) { assertStatus(()->restarted.get(id),404); }
        clock.now=clock.now.plus(Duration.ofHours(24)); assertStatus(()->jobs.get(id),404);
    }

    @Test void globalAndPerAccountAdmissionsNeverEvictAnActiveJob() throws Exception {
        var ids=new ArrayList<UUID>();
        for(int i=0;i<4;i++) {
            actor.set(new ExportAuthority.Actor(UUID.randomUUID(),1)); UUID id=create();ids.add(id);
            assertStatus(()->jobs.create(UUID.randomUUID(),"*"),409); assertThat(jobs.get(id).state()).isEqualTo("READY");
        }
        actor.set(new ExportAuthority.Actor(UUID.randomUUID(),1)); assertStatus(()->jobs.create(UUID.randomUUID(),"*"),409);
        verify(repository,times(4)).capture();
    }

    @Test void activeDiscoveryIsScopedAndCredentialRotationRetiresTheOldJob() throws Exception {
        UUID id=create();jobs.prepare(id,1,UUID.randomUUID().toString());var old=prepared(id);
        assertThat(jobs.current().exportId()).isEqualTo(id);var owner=actor.get();
        actor.set(new ExportAuthority.Actor(UUID.randomUUID(),1));assertStatus(()->jobs.current(),404);
        actor.set(new ExportAuthority.Actor(owner.accountId(),2));assertStatus(()->jobs.current(),404);assertStatus(()->jobs.get(id),404);
        UUID fresh=create();assertThat(jobs.current().exportId()).isEqualTo(fresh);
        assertStatus(()->jobs.download(id,1,old.preparedPart().generation()),404);
        jobs.cancel(fresh,UUID.randomUUID().toString());assertStatus(()->jobs.current(),404);
        UUID expiring=create();clock.now=clock.now.plus(Duration.ofMinutes(31));assertStatus(()->jobs.current(),404);
        assertThat(jobs.get(expiring).state()).isEqualTo("EXPIRED");
    }

    @Test void changedOrRevokedSourceDuringOriginalReadPublishesNoArtifact() throws Exception {
        byte[] bytes={1,2,3,4}; var original=original(bytes);snapshot=snapshot(List.of(original));objects.put("originals/"+original.assetId(),bytes);
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(storage.read(anyString(),anyInt())).thenAnswer(call->{entered.countDown();assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();return Optional.of(bytes);});
        UUID id=create();jobs.prepare(id,1,UUID.randomUUID().toString());assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
        current.set(false);release.countDown(); var stale=terminal(id);
        assertThat(stale.state()).isEqualTo("STALE");assertThat(stale.preparedPart()).isNull();assertThat(stale.totalOriginals()).isZero();
        current.set(true);var enteredAgain=new CountDownLatch(1);var releaseAgain=new CountDownLatch(1);
        when(storage.read(anyString(),anyInt())).thenAnswer(call->{enteredAgain.countDown();assertThat(releaseAgain.await(5,TimeUnit.SECONDS)).isTrue();return Optional.of(bytes);});
        UUID second=create();jobs.prepare(second,1,UUID.randomUUID().toString());assertThat(enteredAgain.await(5,TimeUnit.SECONDS)).isTrue();var rejected=new CountDownLatch(1);
        doAnswer(ignored->{if(!allowed.get()){if(Thread.currentThread().getName().equals("portable-export-worker"))rejected.countDown();throw new ApiException(401,"AUTH_REQUIRED","Synthetic revoked account.");}return null;}).when(authority).require(any());
        allowed.set(false);releaseAgain.countDown();
        assertStatus(()->jobs.get(second),401);
        assertThat(rejected.await(5,TimeUnit.SECONDS)).isTrue();allowed.set(true);assertThat(terminal(second).errorCode()).isEqualTo("ACCESS_REVOKED");assertThat(jobs.get(second).preparedPart()).isNull();
    }

    @Test void multipartWarningsRetryAndFinalIndexReflectEveryRecordedOutcome() throws Exception {
        byte[] bytes={7,8,9};var originals=new ArrayList<PortableSnapshot.Original>();
        for(int i=0;i<53;i++) originals.add(original(bytes));snapshot=snapshot(originals);
        UUID id=create();assertThat(jobs.get(id).originalPartCount()).isEqualTo(2);assertStatus(()->jobs.prepare(id,3,UUID.randomUUID().toString()),409);
        jobs.prepare(id,1,UUID.randomUUID().toString());var warning=prepared(id);assertThat(warning.unavailableOriginals()).isEqualTo(50);assertThat(warning.state()).isEqualTo("READY_WITH_WARNINGS");
        var first=jobs.issues(id,"20",null);assertThat(first.items()).hasSize(20);assertThat(jobs.issues(id,"20",first.nextCursor()).items()).hasSize(20);
        assertStatus(()->jobs.parts(id,"20",first.nextCursor()),400);
        for(var original:originals) objects.put("originals/"+original.assetId(),bytes);
        jobs.prepare(id,2,UUID.randomUUID().toString());prepared(id);jobs.prepare(id,3,UUID.randomUUID().toString());var index=prepared(id);
        assertThat(index.complete()).isFalse();assertThat(index.unavailableOriginals()).isEqualTo(50);
        UUID retry=UUID.randomUUID();var beginning=jobs.prepare(id,1,retry.toString()).status();assertThat(beginning.indexNeedsRefresh()).isTrue();assertThat(beginning.complete()).isFalse();
        prepared(id);assertThat(jobs.get(id).availableOriginals()).isEqualTo(53);assertThat(jobs.issues(id,"50",null).items()).isEmpty();
        jobs.prepare(id,3,UUID.randomUUID().toString());assertThat(prepared(id).complete()).isTrue();
        var pages=jobs.parts(id,"2",null);assertThat(pages.items()).hasSize(2);assertThat(jobs.parts(id,"2",pages.nextCursor()).items()).hasSize(1);
    }

    @Test void cleanupFailureIsQuarantinedAndRecoveryDoesNotStrandTheWorkerCounter() throws Exception {
        jobs.close();var denyCleanup=new AtomicBoolean(true);var owned=new CopyOnWriteArrayList<Path>();var deniedDelete=new CountDownLatch(1);
        jobs=new ExportJobService(repository,writer,authority,clock,path->{owned.add(path);if(denyCleanup.get()){deniedDelete.countDown();throw new IOException("Synthetic cleanup failure.");}Files.deleteIfExists(path);});
        byte[] bytes={1,2,3};var original=original(bytes);snapshot=snapshot(List.of(original));
        when(repository.originalStillCurrent(any(),any())).thenReturn(true);
        when(storage.read(anyString(),anyInt())).thenAnswer(call->{current.set(false);return Optional.of(bytes);});
        try {
            UUID id=create();jobs.prepare(id,1,UUID.randomUUID().toString());assertThat(deniedDelete.await(10,TimeUnit.SECONDS)).isTrue();
            assertThat(terminal(id).state()).isEqualTo("STALE");
            current.set(true);snapshot=snapshot(List.of());UUID fresh=create();
            assertStatus(()->jobs.prepare(fresh,1,UUID.randomUUID().toString()),503);assertThat(owned).isNotEmpty();
            assertThat(owned).anyMatch(Files::exists);
            denyCleanup.set(false);jobs.prepare(fresh,1,UUID.randomUUID().toString());assertThat(prepared(fresh).preparedPart()).isNotNull();
            jobs.cancel(fresh,UUID.randomUUID().toString());jobs.close();assertThat(owned).allMatch(path->!Files.exists(path));
        } finally { denyCleanup.set(false); }
    }

    @Test void byteChunksUseCheapGuardsAndFullValidationIsBoundedByParts() throws Exception {
        byte[] bytes=new byte[2*1024*1024];Arrays.fill(bytes,(byte)37);var original=original(bytes);snapshot=snapshot(List.of(original));objects.put("originals/"+original.assetId(),bytes);
        UUID id=create();clearInvocations(repository);jobs.prepare(id,1,UUID.randomUUID().toString());prepared(id);
        verify(repository,times(2)).originalStillCurrent(any(),eq(original));verify(repository,atMost(40)).stillCurrent(any());
    }

    @Test void shutdownStopsTheWorkerEvenWhenCachedCleanupFailsAndCanBeRetried()throws Exception {
        jobs.close();var denyCleanup=new AtomicBoolean(false);var paths=new CopyOnWriteArrayList<Path>();
        jobs=new ExportJobService(repository,writer,authority,clock,path->{paths.add(path);if(denyCleanup.get())throw new IOException("Synthetic shutdown cleanup failure.");Files.deleteIfExists(path);});
        try {
            UUID id=create();jobs.prepare(id,1,UUID.randomUUID().toString());prepared(id);denyCleanup.set(true);
            assertStatus(jobs::close,503);assertThat(paths).anyMatch(Files::exists);
            assertStatus(()->jobs.create(UUID.randomUUID(),"*"),410);
            denyCleanup.set(false);jobs.close();assertThat(paths).allMatch(path->!Files.exists(path));
        } finally { denyCleanup.set(false); }
    }

    @Test void revocationWhileCancellationWaitsForFileCleanupSuppressesTheResponseButKeepsTheAcknowledgedAttempt()throws Exception {
        jobs.close();var blocking=new AtomicBoolean(false);var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        jobs=new ExportJobService(repository,writer,authority,clock,path->{if(blocking.get()){entered.countDown();try {if(!release.await(5,TimeUnit.SECONDS))throw new IOException("Synthetic cleanup wait.");}catch(InterruptedException failure){Thread.currentThread().interrupt();throw new IOException("Synthetic cleanup interrupted.");}}Files.deleteIfExists(path);});
        try(var requests=Executors.newSingleThreadExecutor()) {
            UUID id=create();jobs.prepare(id,1,UUID.randomUUID().toString());prepared(id);UUID attempt=UUID.randomUUID();blocking.set(true);
            var cancelled=requests.submit(()->jobs.cancel(id,attempt.toString()));
            try {assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();allowed.set(false);}finally {release.countDown();}
            assertThatThrownBy(()->cancelled.get(5,TimeUnit.SECONDS)).isInstanceOfSatisfying(ExecutionException.class,error->assertThat(error.getCause()).isInstanceOfSatisfying(ApiException.class,api->assertThat(api.status()).isEqualTo(401)));
            allowed.set(true);assertThat(jobs.get(id).state()).isEqualTo("CANCELLED");assertThat(jobs.attempt(id,attempt).state()).isEqualTo("SUCCEEDED");assertThat(jobs.get(id).preparedPart()).isNull();
        }finally {blocking.set(false);release.countDown();allowed.set(true);}
    }

    @Test void boundedPrepareRetryHistoryAlwaysLeavesRoomForAnAcknowledgedCancellation()throws Exception {
        UUID id=create();
        for(int attempt=0;attempt<511;attempt++){jobs.prepare(id,1,UUID.randomUUID().toString());prepared(id);}
        assertStatus(()->jobs.prepare(id,1,UUID.randomUUID().toString()),429);
        UUID cancel=UUID.randomUUID();assertThat(jobs.cancel(id,cancel.toString()).state()).isEqualTo("CANCELLED");
        assertThat(jobs.attempt(id,cancel).state()).isEqualTo("SUCCEEDED");assertThat(jobs.get(id).preparedPart()).isNull();
        assertThat(jobs.cancel(id,cancel.toString()).state()).isEqualTo("CANCELLED");UUID fresh=create();assertThat(jobs.current().exportId()).isEqualTo(fresh);
    }

    private UUID create() throws Exception {UUID id=UUID.randomUUID();jobs.create(id,"*");ready(id);return id;}
    private ExportStatus ready(UUID id)throws Exception {await(()->!"CAPTURING".equals(jobs.get(id).state()));return jobs.get(id);}
    private ExportStatus prepared(UUID id)throws Exception {await(()->{var status=jobs.get(id);assertThat(status.state()).as(status.errorCode()).isNotIn("FAILED","STALE","EXPIRED","CANCELLED");return status.preparedPart()!=null;});return jobs.get(id);}
    private ExportStatus terminal(UUID id)throws Exception {await(()->Set.of("FAILED","STALE","EXPIRED","CANCELLED").contains(jobs.get(id).state()));return jobs.get(id);}
    private static void await(java.util.function.BooleanSupplier check)throws Exception {long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);while(!check.getAsBoolean()){assertThat(System.nanoTime()).isLessThan(end);Thread.sleep(20);}}
    private PortableSnapshot snapshot(List<PortableSnapshot.Original> originals) {return new PortableSnapshot(clock.instant(),List.of(),originals,List.of(),List.of(),List.of(),Map.of(),Map.of());}
    private static PortableSnapshot.Original original(byte[] bytes) {UUID memory=UUID.randomUUID(),asset=UUID.randomUUID();return new PortableSnapshot.Original(memory,asset,"originals/"+asset+".png","image/png",bytes.length,hash(bytes),null,null,null,"Synthetic.png");}
    private static String hash(byte[] bytes) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception failure){throw new AssertionError(failure);}}
    private static Set<String> entries(byte[] bytes)throws IOException {var names=new HashSet<String>();try(var zip=new ZipInputStream(new java.io.ByteArrayInputStream(bytes))){for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry())names.add(entry.getName());}return names;}
    private static void assertStatus(org.assertj.core.api.ThrowableAssert.ThrowingCallable operation,int status) {assertThatThrownBy(operation).isInstanceOfSatisfying(ApiException.class,error->assertThat(error.status()).isEqualTo(status));}
    private static class MutableClock extends Clock {Instant now=Instant.parse("2026-10-10T12:00:00Z");public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId zone){return this;}public Instant instant(){return now;}}
}
