package com.kevinmel.archive.retention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.DriverManager;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.media.PhotoRepository;
import com.kevinmel.archive.media.PhotoRequest;
import com.kevinmel.archive.web.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Disposable PostgreSQL 17 schemas, real migrations/transactions, and no provider or HTTP server. */
@Testcontainers
class RetentionPostgresTest {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final Instant NOW = Instant.parse("2026-10-09T12:00:00.123456Z");
    private static final long THIRTY_DAYS = 30L * 86400;
    private final List<String> schemas = new ArrayList<>();
    private final InMemoryDeletionStorage storage = new InMemoryDeletionStorage();
    private Fixture fixture;

    @BeforeEach void disposableSchema() { fixture = newSchema(); }

    @AfterEach void removeOnlyDisposableSchemas() throws Exception {
        try (var connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
                var statement = connection.createStatement()) {
            for (String schema : schemas) {
                if (!schema.matches("retention_[0-9a-f]{32}")) throw new IllegalStateException("Unsafe fixture schema.");
                statement.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }

    @Test void thirtyElapsedDaysAreInclusiveAndOnlyExpiredVerifiedPrivateDecisionsAreClaimed() {
        var before = text("before boundary", "Boundary Guest");
        var at = text("at boundary", null);
        var after = text("after boundary", null);
        var kept = text("kept note", null);
        softDelete(fixture, before.memory(), NOW.minusSeconds(THIRTY_DAYS).minusNanos(1000));
        softDelete(fixture, at.memory(), NOW.minusSeconds(THIRTY_DAYS));
        softDelete(fixture, after.memory(), NOW.minusSeconds(THIRTY_DAYS).plusNanos(1000));
        fixture.db().sql("UPDATE memory SET review_status = 'KEEP' WHERE id = :id").param("id", kept.memory()).update();
        var pendingPhoto = photos(1);
        softDelete(fixture, pendingPhoto.memories().getFirst(), NOW.minusSeconds(THIRTY_DAYS));
        fixture.db().sql("UPDATE media_asset SET upload_state = 'PENDING' WHERE id = :id")
                .param("id", pendingPhoto.assets().getFirst()).update();
        var malformedPhoto = photos(1);
        softDelete(fixture, malformedPhoto.memories().getFirst(), NOW.minusSeconds(THIRTY_DAYS));
        fixture.db().sql("UPDATE media_asset SET expected_checksum_sha256 = :checksum WHERE id = :id")
                .param("checksum", "b".repeat(64)).param("id", malformedPhoto.assets().getFirst()).update();
        var otherEvent = text("other event", null);
        softDelete(fixture, otherEvent.memory(), NOW.minusSeconds(THIRTY_DAYS));
        fixture.db().sql("UPDATE contribution SET event_key = 'other-synthetic-event' WHERE id = :id")
                .param("id", otherEvent.contribution()).update();

        var plans = fixture.retention().claim(100, NOW);
        assertThat(plans).extracting(DeletionRecord::memoryId).containsExactly(before.memory(), at.memory());
        assertThat(plans).allSatisfy(plan -> {
            assertThat(plan.deleteAfter()).isBeforeOrEqualTo(NOW);
            assertThat(plan.recordedAt()).isEqualTo(NOW);
            assertThat(time(fixture.db(), "SELECT purge_started_at FROM memory WHERE id = :id", plan.memoryId())).isEqualTo(NOW);
        });
        assertThat(count(fixture, "deletion_ledger")).isEqualTo(2);
        assertThat(fixture.retention().claim(1, NOW)).hasSize(1);
        assertThat(time(fixture.db(), "SELECT purge_started_at FROM memory WHERE id = :id", after.memory())).isNull();
    }

    @Test void aLostWorkerAndNanosecondClockRetryKeepThePersistedImmutablePlan() {
        var note = text("lost worker fixture", "Synthetic Guest");
        softDelete(fixture, note.memory(), NOW.minusSeconds(THIRTY_DAYS));
        Instant firstClock = NOW.plusNanos(999);
        var first = fixture.retention().claim(20, firstClock).getFirst();
        var retried = fixture.retention().claim(20, firstClock.plusSeconds(600)).getFirst();
        assertThat(first.recordedAt()).isEqualTo(firstClock.truncatedTo(ChronoUnit.MICROS));
        assertThat(retried).isEqualTo(first);
        assertThat(time(fixture.db(), "SELECT purge_started_at FROM memory WHERE id = :id", note.memory())).isEqualTo(first.recordedAt());
        assertThat(count(fixture, "deletion_ledger")).isEqualTo(1);
        assertThat(string(fixture, "SELECT text_content FROM memory WHERE id = :id", note.memory())).isEqualTo(note.message());
    }

    @Test void failedOrLostLedgerResponsesAndObjectFailuresCannotScrubPrivateMetadata() {
        var batch = photos(1);
        UUID memory = batch.memories().getFirst();
        UUID asset = batch.assets().getFirst();
        softDelete(fixture, memory, NOW.minusSeconds(THIRTY_DAYS));
        storage.failRecords = 1;
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        assertThat(storage.records).isEmpty();
        assertThat(storage.operations).containsExactly("record:" + memory);
        assertUnpurgedPhoto(fixture, batch);

        storage.operations.clear();
        storage.loseRecordResponses = 1;
        assertThat(service(fixture, NOW.plusSeconds(1)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        var immutable = storage.records.get(memory);
        assertThat(immutable.recordedAt()).isEqualTo(NOW);
        assertThat(storage.operations).containsExactly("record:" + memory);
        assertUnpurgedPhoto(fixture, batch);

        storage.operations.clear();
        storage.failOriginals = 1;
        assertThat(service(fixture, NOW.plusSeconds(2)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        assertThat(storage.records.get(memory)).isEqualTo(immutable);
        assertThat(storage.operations).containsExactly("record:" + memory, "original:" + asset);
        assertUnpurgedPhoto(fixture, batch);

        assertThat(service(fixture, NOW.plusSeconds(3)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(storage.records.get(memory)).isEqualTo(immutable);
        assertThat(storage.originals).doesNotContain(asset);
        assertThat(count(fixture, "media_asset")).isZero();
        assertThat(count(fixture, "upload_grant")).isZero();
    }

    @Test void aRealDatabaseRollbackAfterObjectEraseRetainsMetadataAndRetriesTheSameEvidence() {
        var batch = photos(1);
        UUID memory = batch.memories().getFirst();
        softDelete(fixture, memory, NOW.minusSeconds(THIRTY_DAYS));
        fixture.db().sql("""
                CREATE FUNCTION reject_fixture_purge() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic transaction rejection'; END; $$
                """).update();
        fixture.db().sql("""
                CREATE TRIGGER reject_fixture_purge BEFORE UPDATE ON memory FOR EACH ROW
                WHEN (NEW.purged_at IS NOT NULL) EXECUTE FUNCTION reject_fixture_purge()
                """).update();

        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        var immutable = storage.records.get(memory);
        assertThat(immutable).isNotNull();
        assertThat(storage.originals).doesNotContain(batch.assets().getFirst());
        assertUnpurgedPhotoMetadata(fixture, batch);
        assertThat(count(fixture, "erased_submission_key")).isZero();
        assertThat(time(fixture.db(), "SELECT purged_at FROM deletion_ledger WHERE memory_id = :id", memory)).isNull();

        fixture.db().sql("DROP TRIGGER reject_fixture_purge ON memory").update();
        assertThat(service(fixture, NOW.plusSeconds(30)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(storage.records.get(memory)).isEqualTo(immutable);
        assertThat(count(fixture, "media_asset")).isZero();
        assertThat(count(fixture, "upload_grant")).isZero();
        assertThat(count(fixture, "erased_submission_key")).isEqualTo(1);
    }

    @Test void photoPurgeScrubsOnlyItsItemPreservesSiblingsAndKeepsReceiptsNonResurrecting() {
        var batch = photos(2);
        UUID erasedMemory = batch.memories().getFirst();
        UUID keptMemory = batch.memories().get(1);
        UUID erasedAsset = batch.assets().getFirst();
        UUID keptAsset = batch.assets().get(1);
        softDelete(fixture, erasedMemory, NOW.minusSeconds(THIRTY_DAYS));
        fixture.db().sql("UPDATE memory SET review_status = 'KEEP' WHERE id = :id").param("id", keptMemory).update();
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(storage.operations.getFirst()).isEqualTo("record:" + erasedMemory);
        assertThat(storage.originals).containsExactly(keptAsset);
        assertThat(storage.staging).containsExactlyElementsOf(batch.grants().get(1));
        assertThat(count(fixture, "media_asset")).isEqualTo(1);
        assertThat(count(fixture, "upload_grant")).isEqualTo(batch.grants().get(1).size());
        assertThat(string(fixture, "SELECT caption FROM memory WHERE id = :id", erasedMemory)).isNull();
        assertThat(string(fixture, "SELECT caption FROM memory WHERE id = :id", keptMemory)).isEqualTo("Synthetic caption 1");
        assertThat(string(fixture, "SELECT guest_name FROM contribution WHERE id = :id", batch.contribution())).isEqualTo("Synthetic Photo Guest");
        assertThat(string(fixture, "SELECT original_filename FROM media_asset WHERE id = :id", keptAsset)).isEqualTo("synthetic-1.png");
        assertThat(fixture.db().sql("SELECT revision FROM memory WHERE id = :id").param("id", erasedMemory).query(Integer.class).single()).isEqualTo(2);
        assertThat(fixture.db().sql("SELECT count(*) FROM media_asset WHERE id = :id").param("id", erasedAsset).query(Long.class).single()).isZero();

        var receipt = fixture.contributions().getReceipt(batch.contribution(), batch.key());
        assertThat(receipt.completion()).isEqualTo("COMPLETE");
        assertThat(receipt.memories()).extracting(m -> m.reviewStatus()).containsExactly("DELETE", "KEEP");
        assertThat(receipt.memories()).extracting(m -> m.uploadState()).containsOnly("UPLOADED");
        var replay = fixture.tx().execute(ignored -> fixture.photos().create(batch.request(), batch.key()));
        assertThat(replay.created()).isFalse();
        assertThat(replay.receipt()).isEqualTo(receipt);
        assertThatThrownBy(() -> fixture.tx().execute(ignored -> fixture.photos().lock(batch.contribution(), erasedMemory, batch.key())))
                .isInstanceOf(ApiException.class).satisfies(failure -> assertThat(((ApiException) failure).status()).isEqualTo(404));
        assertThat(storage.originals).containsExactly(keptAsset);

        softDelete(fixture, keptMemory, NOW.minusSeconds(THIRTY_DAYS));
        assertThat(service(fixture, NOW.plusSeconds(1)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(string(fixture, "SELECT guest_name FROM contribution WHERE id = :id", batch.contribution())).isNull();
        assertThat(count(fixture, "media_asset")).isZero();
        assertThat(count(fixture, "upload_grant")).isZero();
        assertThat(storage.originals).isEmpty();
        assertThat(storage.staging).isEmpty();
        assertThat(storage.records).hasSize(2);
    }

    @Test void textPurgeRemovesBodyAndGuestNameButRetainsTheOriginalSafeRetryIdentity() {
        var note = text("Synthetic private message", "Synthetic Text Guest");
        softDelete(fixture, note.memory(), NOW.minusSeconds(THIRTY_DAYS));
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(string(fixture, "SELECT text_content FROM memory WHERE id = :id", note.memory())).isNull();
        assertThat(string(fixture, "SELECT guest_name FROM contribution WHERE id = :id", note.contribution())).isNull();
        var replay = fixture.tx().execute(ignored -> fixture.contributions().saveTextContribution(
                "kevin-mel-wedding", note.guest(), note.message(), note.key()));
        assertThat(replay.created()).isFalse();
        assertThat(replay.memoryId()).isEqualTo(note.memory());
        assertThat(replay.receipt().memories().getFirst().reviewStatus()).isEqualTo("DELETE");
        assertThat(count(fixture, "memory")).isEqualTo(1);
        assertThat(storage.operations).containsExactly("record:" + note.memory());
        assertThat(storage.records.get(note.memory()).assetId()).isNull();
        assertThat(service(fixture, NOW.plusSeconds(1)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 0));
    }

    @Test void onlyVerifiedExpiredAudioIsClaimedAndObjectFailureRetainsAllMetadata() {
        var voice = audio("UPLOADED");
        var unfinished = audio("PENDING");
        softDelete(fixture, voice.memories().getFirst(), NOW.minusSeconds(THIRTY_DAYS));
        softDelete(fixture, unfinished.memories().getFirst(), NOW.minusSeconds(THIRTY_DAYS));
        storage.failOriginals = 1;
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(0, 1));
        UUID memory = voice.memories().getFirst(), asset = voice.assets().getFirst();
        assertThat(storage.operations).containsExactly("record:" + memory, "original:" + asset);
        assertThat(string(fixture, "SELECT caption FROM memory WHERE id = :id", memory)).isEqualTo("Synthetic caption 0");
        assertThat(fixture.db().sql("SELECT audio_duration_ms FROM media_asset WHERE id = :id").param("id", asset).query(Long.class).single())
            .isEqualTo(120_000L);
        assertThat(time(fixture.db(), "SELECT purge_started_at FROM memory WHERE id = :id", unfinished.memories().getFirst())).isNull();

        storage.operations.clear();
        assertThat(service(fixture, NOW.plusSeconds(1)).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        assertThat(storage.operations).startsWith("record:" + memory, "original:" + asset);
        assertThat(storage.operations).containsAll(voice.grants().getFirst().stream().map(id -> "staging:" + id).toList());
        assertThat(string(fixture, "SELECT caption FROM memory WHERE id = :id", memory)).isNull();
        assertThat(string(fixture, "SELECT guest_name FROM contribution WHERE id = :id", voice.contribution())).isNull();
        assertThat(fixture.db().sql("SELECT COUNT(*) FROM media_asset WHERE id = :id").param("id", asset).query(Long.class).single()).isZero();
        assertThat(storage.originals).containsExactly(unfinished.assets().getFirst());
        assertThat(fixture.db().sql("SELECT COUNT(*) FROM erased_submission_key WHERE key_digest = :digest")
            .param("digest", SubmissionKeyDigest.sha256(voice.key())).query(Long.class).single()).isEqualTo(1);
    }

    @Test void audioLedgerReplaysOlderOriginalAndPreservesAbsentEnvelopeErasedKey() {
        var voice = audio("UPLOADED");
        UUID erased = voice.memories().getFirst();
        softDelete(fixture, erased, NOW.minusSeconds(THIRTY_DAYS));
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        var evidence = storage.records.get(erased);
        var oldBackup = newSchema();
        restorePhotoBatch(oldBackup, voice);
        convertToAudio(oldBackup, voice, "UPLOADED");
        storage.originals.add(voice.assets().getFirst());
        storage.staging.addAll(voice.grants().getFirst());

        assertThat(service(oldBackup, NOW.plusSeconds(60)).replayLedger()).isEqualTo(1);
        assertThat(count(oldBackup, "media_asset")).isZero();
        assertThat(count(oldBackup, "upload_grant")).isZero();
        assertThat(string(oldBackup, "SELECT caption FROM memory WHERE id = :id", erased)).isNull();
        assertThat(storage.originals).isEmpty();
        assertThat(storage.staging).isEmpty();
        assertThat(storage.records.get(erased)).isEqualTo(evidence);

        var beforeEnvelope = newSchema();
        assertThat(service(beforeEnvelope, NOW.plusSeconds(90)).replayLedger()).isEqualTo(1);
        assertThat(count(beforeEnvelope, "erased_submission_key")).isEqualTo(1);
        assertThatThrownBy(() -> beforeEnvelope.tx().execute(ignored -> beforeEnvelope.contributions().saveTextContribution(
            "kevin-mel-wedding", null, "Synthetic attempted erased-key reuse", voice.key()))).isInstanceOf(ApiException.class);
    }

    @Test void independentLedgerReplaysAnOlderBackupAndAlsoReservesKeysBeforeEnvelopeCreation() {
        var batch = photos(2);
        UUID erased = batch.memories().getFirst();
        softDelete(fixture, erased, NOW.minusSeconds(THIRTY_DAYS));
        assertThat(service(fixture, NOW).purgeBatch(20)).isEqualTo(new RetentionService.Batch(1, 0));
        var evidence = storage.records.get(erased);

        var oldBackup = newSchema();
        restorePhotoBatch(oldBackup, batch);
        storage.originals.add(batch.assets().getFirst());
        storage.staging.addAll(batch.grants().getFirst());
        assertThat(count(oldBackup, "deletion_ledger")).isZero();
        assertThat(service(oldBackup, NOW.plusSeconds(60)).replayLedger()).isEqualTo(1);
        assertThat(time(oldBackup.db(), "SELECT purged_at FROM memory WHERE id = :id", erased)).isEqualTo(NOW.plusSeconds(60));
        assertThat(string(oldBackup, "SELECT caption FROM memory WHERE id = :id", erased)).isNull();
        assertThat(string(oldBackup, "SELECT caption FROM memory WHERE id = :id", batch.memories().get(1))).isEqualTo("Synthetic caption 1");
        assertThat(count(oldBackup, "media_asset")).isEqualTo(1);
        assertThat(count(oldBackup, "upload_grant")).isEqualTo(batch.grants().get(1).size());
        assertThat(storage.originals).containsExactly(batch.assets().get(1));
        assertThat(storage.records.get(erased)).isEqualTo(evidence);
        int revision = oldBackup.db().sql("SELECT revision FROM memory WHERE id = :id").param("id", erased).query(Integer.class).single();
        assertThat(service(oldBackup, NOW.plusSeconds(61)).replayLedger()).isEqualTo(1);
        assertThat(oldBackup.db().sql("SELECT revision FROM memory WHERE id = :id").param("id", erased).query(Integer.class).single()).isEqualTo(revision);
        assertThat(time(oldBackup.db(), "SELECT purged_at FROM memory WHERE id = :id", erased)).isEqualTo(NOW.plusSeconds(60));

        var beforeEnvelope = newSchema();
        assertThat(service(beforeEnvelope, NOW.plusSeconds(90)).replayLedger()).isEqualTo(1);
        assertThat(count(beforeEnvelope, "memory")).isZero();
        assertThat(count(beforeEnvelope, "contribution")).isZero();
        assertThat(count(beforeEnvelope, "erased_submission_key")).isEqualTo(1);
        assertThat(count(beforeEnvelope, "deletion_ledger")).isEqualTo(1);
        for (String key : List.of(batch.key(), batch.key().toUpperCase(Locale.ROOT))) {
            assertThatThrownBy(() -> beforeEnvelope.tx().execute(ignored -> beforeEnvelope.contributions().saveTextContribution(
                    "kevin-mel-wedding", "Synthetic guest", "Attempted resurrection", key))).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> beforeEnvelope.tx().execute(ignored -> beforeEnvelope.photos().create(batch.request(), key)))
                    .isInstanceOf(ApiException.class);
        }
        assertThat(count(beforeEnvelope, "contribution")).isZero();
        assertThat(count(beforeEnvelope, "memory")).isZero();
    }

    @Test void wrongIdentityOwnershipOrStoredScopeIsRejectedBeforeAnyRemoteObjectIo() {
        var batch = photos(2);
        UUID memory = batch.memories().getFirst();
        UUID asset = batch.assets().getFirst();
        var valid = new DeletionRecord(memory, batch.contribution(), asset, SubmissionKeyDigest.sha256(batch.key()), NOW.minusSeconds(1), NOW);
        var invalidRecords = List.of(
                new DeletionRecord(memory, UUID.randomUUID(), asset, valid.submissionKeyDigest(), valid.deleteAfter(), NOW),
                new DeletionRecord(memory, batch.contribution(), asset, "a".repeat(64), valid.deleteAfter(), NOW),
                new DeletionRecord(memory, batch.contribution(), null, valid.submissionKeyDigest(), valid.deleteAfter(), NOW),
                new DeletionRecord(memory, batch.contribution(), batch.assets().get(1), valid.submissionKeyDigest(), valid.deleteAfter(), NOW),
                new DeletionRecord(UUID.randomUUID(), UUID.randomUUID(), asset, valid.submissionKeyDigest(), valid.deleteAfter(), NOW));
        for (var invalid : invalidRecords) assertReplayRejectedBeforeObjects(invalid);

        fixture.db().sql("UPDATE contribution SET event_key = 'other-synthetic-event' WHERE id = :id").param("id", batch.contribution()).update();
        assertReplayRejectedBeforeObjects(valid);
        fixture.db().sql("UPDATE contribution SET event_key = 'kevin-mel-wedding' WHERE id = :id").param("id", batch.contribution()).update();
        fixture.db().sql("UPDATE media_asset SET object_key = 'originals/wrong-scope' WHERE id = :id").param("id", asset).update();
        assertReplayRejectedBeforeObjects(valid);
        fixture.db().sql("UPDATE media_asset SET object_key = :key WHERE id = :id").param("key", "originals/" + asset).param("id", asset).update();
        fixture.db().sql("UPDATE upload_grant SET object_key = 'staging/wrong-scope' WHERE id = :id")
                .param("id", batch.grants().getFirst().getFirst()).update();
        assertReplayRejectedBeforeObjects(valid);
        assertThat(count(fixture, "media_asset")).isEqualTo(2);
        assertThat(count(fixture, "erased_submission_key")).isZero();
        assertThat(storage.originals).containsExactlyElementsOf(batch.assets());
        assertThat(string(fixture, "SELECT caption FROM memory WHERE id = :id", memory)).isEqualTo("Synthetic caption 0");
    }

    private void assertReplayRejectedBeforeObjects(DeletionRecord record) {
        storage.records.clear(); storage.records.put(record.memoryId(), record); storage.operations.clear();
        assertThatThrownBy(() -> service(fixture, NOW).replayLedger()).isInstanceOf(IllegalStateException.class)
                .hasMessage("Retention plan identity is invalid.");
        assertThat(storage.operations).containsExactly("ledger");
    }

    private Fixture newSchema() {
        String schema = "retention_" + UUID.randomUUID().toString().replace("-", "");
        schemas.add(schema);
        String url = postgres.getJdbcUrl() + (postgres.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=" + schema;
        var source = new DriverManagerDataSource(url, postgres.getUsername(), postgres.getPassword());
        Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).load().migrate();
        var db = JdbcClient.create(source);
        var manager = new JdbcTransactionManager(source);
        var contributions = new ContributionRepository(db);
        return new Fixture(db, new RetentionRepository(db, manager), contributions,
                new PhotoRepository(db, contributions, Clock.fixed(NOW, ZoneOffset.UTC),
                        new com.kevinmel.archive.media.PhotoAdmissionPolicy(false, 7_500_000_000L, 7_500_000_000L)), new TransactionTemplate(manager));
    }

    private RetentionService service(Fixture target, Instant now) {
        return new RetentionService(target.retention(), storage, Clock.fixed(now, ZoneOffset.UTC));
    }

    private Text text(String message, String guest) {
        String key = UUID.randomUUID().toString();
        var saved = fixture.tx().execute(ignored -> fixture.contributions().saveTextContribution("kevin-mel-wedding", guest, message, key));
        fixture.db().sql("UPDATE memory SET created_at = :time, updated_at = :time WHERE id = :id")
                .param("time", utc(NOW.minusSeconds(40L * 86400))).param("id", saved.memoryId()).update();
        return new Text(saved.contributionId(), saved.memoryId(), key, message, guest);
    }

    private PhotoBatch photos(int count) {
        var items = new ArrayList<PhotoRequest.Item>();
        for (int i = 0; i < count; i++) items.add(new PhotoRequest.Item(UUID.randomUUID(), "synthetic-" + i + ".png",
                "image/png", 11, "a".repeat(64), "Synthetic caption " + i));
        var request = new PhotoRequest("Synthetic Photo Guest", List.copyOf(items));
        String key = UUID.randomUUID().toString();
        var saved = fixture.tx().execute(ignored -> fixture.photos().create(request, key));
        var memories = saved.receipt().memories().stream().map(m -> m.memoryId()).toList();
        var assets = new ArrayList<UUID>();
        var grants = new ArrayList<List<UUID>>();
        for (int i = 0; i < memories.size(); i++) {
            UUID memory = memories.get(i);
            UUID asset = fixture.db().sql("SELECT id FROM media_asset WHERE memory_id = :id").param("id", memory).query(UUID.class).single();
            assets.add(asset); storage.originals.add(asset);
            fixture.db().sql("UPDATE media_asset SET upload_state = 'UPLOADED', detected_format = 'image/png' WHERE id = :id").param("id", asset).update();
            fixture.db().sql("UPDATE memory SET created_at = :time, updated_at = :time WHERE id = :id")
                    .param("time", utc(NOW.minusSeconds(40L * 86400))).param("id", memory).update();
            var itemGrants = new ArrayList<UUID>();
            for (int grantIndex = 0; grantIndex < (i == 0 ? 2 : 1); grantIndex++) {
                UUID grant = UUID.randomUUID(); itemGrants.add(grant); storage.staging.add(grant);
                insertGrant(fixture, grant, asset);
            }
            grants.add(List.copyOf(itemGrants));
        }
        return new PhotoBatch(saved.receipt().contributionId(), key, request, memories, List.copyOf(assets), List.copyOf(grants));
    }
    private PhotoBatch audio(String state) {
        var batch = photos(1);
        convertToAudio(fixture, batch, state);
        return batch;
    }
    private static void convertToAudio(Fixture target, PhotoBatch batch, String state) {
        boolean uploaded = "UPLOADED".equals(state);
        target.db().sql("UPDATE memory SET memory_type = 'AUDIO' WHERE id = :id")
            .param("id", batch.memories().getFirst()).update();
        target.db().sql("""
            UPDATE media_asset SET detected_format = :format, declared_content_type = 'audio/webm',
                byte_size = 25000000, expected_byte_size = 25000000, expected_duration_ms = 120000,
                audio_duration_ms = :duration, audio_codec = :codec, audio_container = :container, upload_state = :state
            WHERE id = :id
            """).param("format", uploaded ? "audio/webm" : "unverified").param("duration", uploaded ? 120_000L : null)
            .param("codec", uploaded ? "opus" : null).param("container", uploaded ? "webm" : null)
            .param("state", state).param("id", batch.assets().getFirst()).update();
    }

    private static void restorePhotoBatch(Fixture target, PhotoBatch batch) {
        target.db().sql("""
                INSERT INTO contribution(id, event_key, guest_name, idempotency_key, request_fingerprint)
                VALUES (:id, 'kevin-mel-wedding', :name, :key, :fingerprint)
                """).param("id", batch.contribution()).param("name", batch.request().guestName())
                .param("key", batch.key()).param("fingerprint", batch.request().fingerprint()).update();
        for (int i = 0; i < batch.memories().size(); i++) {
            var item = batch.request().items().get(i);
            target.db().sql("""
                    INSERT INTO memory(id, contribution_id, memory_type, client_item_id, item_position, caption,
                        created_at, updated_at) VALUES (:id, :contribution, 'PHOTO', :client, :position, :caption, :time, :time)
                    """).param("id", batch.memories().get(i)).param("contribution", batch.contribution())
                    .param("client", item.clientItemId()).param("position", i).param("caption", item.caption())
                    .param("time", utc(NOW.minusSeconds(40L * 86400))).update();
            target.db().sql("""
                    INSERT INTO media_asset(id, memory_id, object_key, original_filename, detected_format,
                        byte_size, checksum_sha256, upload_state, declared_content_type, expected_byte_size, expected_checksum_sha256)
                    VALUES (:id, :memory, :key, :filename, 'image/png', :size, :checksum, 'UPLOADED', 'image/png', :size, :checksum)
                    """).param("id", batch.assets().get(i)).param("memory", batch.memories().get(i))
                    .param("key", "originals/" + batch.assets().get(i)).param("filename", item.originalFilename())
                    .param("size", item.byteSize()).param("checksum", item.checksumSha256()).update();
            for (UUID grant : batch.grants().get(i)) insertGrant(target, grant, batch.assets().get(i));
        }
    }

    private static void insertGrant(Fixture target, UUID grant, UUID asset) {
        target.db().sql("""
                INSERT INTO upload_grant(id, media_asset_id, object_key, created_at, expires_at)
                VALUES (:id, :asset, :key, :created, :expires)
                """).param("id", grant).param("asset", asset).param("key", "staging/" + grant)
                .param("created", utc(NOW.minusSeconds(60))).param("expires", utc(NOW.plusSeconds(60))).update();
    }

    private static void softDelete(Fixture target, UUID memory, Instant decided) {
        target.db().sql("""
                UPDATE memory SET review_status = 'DELETE', delete_after = :deadline, updated_at = :decided,
                    created_at = :created WHERE id = :id
                """).param("id", memory).param("deadline", utc(decided.plusSeconds(THIRTY_DAYS)))
                .param("decided", utc(decided)).param("created", utc(decided.minusSeconds(40L * 86400))).update();
    }

    private void assertUnpurgedPhoto(Fixture target, PhotoBatch batch) {
        assertUnpurgedPhotoMetadata(target, batch);
        assertThat(storage.originals).contains(batch.assets().getFirst());
        assertThat(storage.staging).containsAll(batch.grants().getFirst());
    }
    private static void assertUnpurgedPhotoMetadata(Fixture target, PhotoBatch batch) {
        assertThat(count(target, "media_asset")).isEqualTo(1);
        assertThat(count(target, "upload_grant")).isEqualTo(2);
        assertThat(time(target.db(), "SELECT purged_at FROM memory WHERE id = :id", batch.memories().getFirst())).isNull();
        assertThat(string(target, "SELECT caption FROM memory WHERE id = :id", batch.memories().getFirst())).isEqualTo("Synthetic caption 0");
        assertThat(string(target, "SELECT guest_name FROM contribution WHERE id = :id", batch.contribution())).isEqualTo("Synthetic Photo Guest");
    }
    private static long count(Fixture target, String table) {
        if (!List.of("memory", "contribution", "media_asset", "upload_grant", "deletion_ledger", "erased_submission_key").contains(table))
            throw new IllegalArgumentException("Unsafe fixture table.");
        return target.db().sql("SELECT count(*) FROM " + table).query(Long.class).single();
    }
    private static String string(Fixture target, String sql, UUID id) {
        var values = target.db().sql(sql).param("id", id).query((rs, row) -> rs.getString(1)).list();
        assertThat(values).hasSize(1);
        return values.getFirst();
    }
    private static Instant time(JdbcClient db, String sql, UUID id) {
        var values = db.sql(sql).param("id", id).query((rs, row) -> {
            var value = rs.getObject(1, OffsetDateTime.class);
            return value == null ? null : value.toInstant();
        }).list();
        assertThat(values).hasSize(1);
        return values.getFirst();
    }
    private static OffsetDateTime utc(Instant time) { return OffsetDateTime.ofInstant(time, ZoneOffset.UTC); }
    private record Fixture(JdbcClient db, RetentionRepository retention, ContributionRepository contributions,
            PhotoRepository photos, TransactionTemplate tx) { }
    private record Text(UUID contribution, UUID memory, String key, String message, String guest) { }
    private record PhotoBatch(UUID contribution, String key, PhotoRequest request, List<UUID> memories,
            List<UUID> assets, List<List<UUID>> grants) { }
}
