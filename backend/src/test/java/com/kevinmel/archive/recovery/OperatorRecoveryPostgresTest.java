package com.kevinmel.archive.recovery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import javax.imageio.ImageIO;
import javax.sql.DataSource;

import com.kevinmel.archive.contribution.ContributionRepository;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.media.AudioFixtures;
import com.kevinmel.archive.media.AudioVerifier;
import com.kevinmel.archive.media.PhotoAdmissionPolicy;
import com.kevinmel.archive.media.PhotoRepository;
import com.kevinmel.archive.media.PhotoRequest;
import com.kevinmel.archive.retention.DeletionRecord;
import com.kevinmel.archive.retention.DeletionStorage;
import com.kevinmel.archive.retention.RetentionRepository;
import com.kevinmel.archive.retention.RetentionService;
import com.kevinmel.archive.retention.SubmissionKeyDigest;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Real directory bundles, separately migrated source/target schemas, and no
 * live provider.
 */
@Testcontainers
class OperatorRecoveryPostgresTest {
    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    private static final Instant NOW = Instant.now().truncatedTo(ChronoUnit.MICROS);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final List<String> TABLES = List.of("contribution", "memory", "media_asset", "upload_grant",
            "review_audit", "deletion_ledger", "erased_submission_key", "album", "album_membership",
            "timeline_state", "timeline_event", "timeline_event_memory", "tag", "memory_tag");
    @TempDir
    Path temporary;
    private final List<String> schemas = new ArrayList<>();
    private final MemoryStorage sourceStorage = new MemoryStorage();
    private final MemoryStorage targetStorage = new MemoryStorage();
    private Fixture source;
    private Fixture target;

    @BeforeEach
    void isolatedDatabasesAndStores() {
        source = schema();
        target = schema();
    }

    @AfterEach
    void removeOnlyDisposableSchemas() throws Exception {
        try (var connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(),
                postgres.getPassword());
                var statement = connection.createStatement()) {
            for (String schema : schemas) {
                if (!schema.matches("recovery_[0-9a-f]{32}"))
                    throw new IllegalStateException("Unsafe fixture schema.");
                statement.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }

    @Test
    void portableBundleRestoresMixedArchiveAndExactOriginalsIntoSeparateEmptyDatabase() throws Exception {
        var note = note(source, "A private synthetic note", "Synthetic note guest");
        var batch = photos(source, sourceStorage, "UPLOADED", "PENDING", "FAILED", "UPLOADED");
        review(source, note.memory(), "KEEP", 3);
        review(source, batch.memories().get(3), "ARCHIVED", 2);
        UUID grant = grant(source, batch.assets().get(1), NOW.minusSeconds(600), NOW.minusSeconds(300));
        grant(source, batch.assets().get(2), NOW.minusSeconds(600), NOW.minusSeconds(300));
        String reserved = SubmissionKeyDigest.sha256(UUID.randomUUID().toString());
        source.db().sql("INSERT INTO erased_submission_key(key_digest, erased_at) VALUES (:digest, :at)")
                .param("digest", reserved).param("at", time(NOW.minusSeconds(60))).update();
        source.db()
                .sql("""
                        INSERT INTO archive_account(username, display_name, password_hash, role)
                        VALUES ('synthetic.recovery', 'Synthetic excluded operator', 'synthetic-secret-excluded-marker', 'OPERATOR')
                        """)
                .update();
        var before = snapshot(source);
        Path bundle = temporary.resolve("portable-archive");

        var exported = export(bundle);
        assertThat(exported.ready()).isTrue();
        assertThat(exported.contributions()).isEqualTo(2);
        assertThat(exported.memories()).isEqualTo(5);
        assertThat(exported.originals()).isEqualTo(2);
        assertThat(exported.pendingMedia()).isEqualTo(1);
        assertThat(exported.failedMedia()).isEqualTo(1);
        assertThat(exported.unavailableOriginals()).isZero();
        assertPrivateBundle(bundle);
        try (var files = Files.walk(bundle)) {
            assertThat(files.filter(Files::isRegularFile).map(bundle::relativize).map(Path::toString).toList())
                    .hasSize(4)
                    .contains("manifest.json", "metadata.json")
                    .noneMatch(name -> name.contains("private-name") || name.contains("caption"));
        }
        assertThat(Files.readString(bundle.resolve("metadata.json"))).contains("private-name-0.png",
                "Synthetic caption 0");
        assertThat(Files.readString(bundle.resolve("metadata.json"))).doesNotContain("synthetic-secret-excluded-marker",
                "archive_account");
        for (int index : List.of(0, 3)) {
            assertThat(Files.readAllBytes(bundle.resolve("originals").resolve(batch.assets().get(index).toString())))
                    .isEqualTo(batch.bytes().get(index));
        }

        var restored = restore(bundle);
        assertThat(restored.contributions()).isEqualTo(2);
        assertThat(restored.memories()).isEqualTo(5);
        assertThat(restored.originals()).isEqualTo(2);
        assertThat(restored.replayedDeletions()).isZero();
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(target.db().sql("SELECT count(*) FROM archive_account").query(Long.class).single()).isZero();
        assertThat(targetStorage.objects).hasSize(2);
        for (int index : List.of(0, 3))
            assertThat(targetStorage.objects.get("originals/" + batch.assets().get(index)))
                    .isEqualTo(batch.bytes().get(index));
        assertThat(count(target, "upload_grant")).isEqualTo(2);
        assertThat(target.db().sql("SELECT object_key FROM upload_grant WHERE id = :id").param("id", grant)
                .query(String.class).single()).isEqualTo("staging/" + grant);
        var receipt = target.contributions().getReceipt(batch.contribution(), batch.key());
        assertThat(receipt.completion()).isEqualTo("PARTIAL");
        assertThat(receipt.memories()).extracting(item -> item.memoryId()).containsExactlyElementsOf(batch.memories());
        assertThat(receipt.memories()).extracting(item -> item.uploadState()).containsExactly("UPLOADED", "PENDING",
                "FAILED", "UPLOADED");
        var textReplay = target.tx().execute(ignored -> target.contributions().saveTextContribution(
                "kevin-mel-wedding", note.guest(), note.message(), note.key()));
        assertThat(textReplay.created()).isFalse();
        assertThat(textReplay.memoryId()).isEqualTo(note.memory());
        assertThat(target.tx().execute(ignored -> target.photos().create(batch.request(), batch.key())).created())
                .isFalse();
    }

    @Test
    void activeUploadGrantPreventsExportUntilExpiryAndItsReservationStillRestores() {
        var batch = photos(source, sourceStorage, "PENDING");
        UUID id = grant(source, batch.assets().getFirst(), NOW, NOW.plusSeconds(300));
        Path active = temporary.resolve("active-grant");
        assertThatThrownBy(() -> export(active)).isInstanceOf(RecoveryException.class);
        assertThat(targetStorage.operations).isEmpty();
        Path expired = temporary.resolve("expired-grant");
        var exporter = recovery(source, sourceStorage, sourceStorage, sourceStorage, NOW.plusSeconds(300));
        assertThat(exporter.exportTo(expired).ready()).isTrue();
        recovery(target, targetStorage, sourceStorage, targetStorage, NOW.plusSeconds(301)).restoreFrom(expired);
        assertThat(count(target, "upload_grant")).isEqualTo(1);
        assertThat(target.db().sql("SELECT media_asset_id FROM upload_grant WHERE id = :id").param("id", id)
                .query(UUID.class).single()).isEqualTo(batch.assets().getFirst());
        assertThat(targetStorage.objects).isEmpty();
    }

    @Test
    void versionTwoPreservesAudioOriginalsVerifiedMetadataAndUnfinishedAudioIntents() throws Exception {
        source = schema("9");
        target = schema("9");
        legacyNote(source, "Synthetic note alongside audio");
        legacyPhotos(source, sourceStorage, "UPLOADED");
        var voices = List.of(audio(source, sourceStorage, "audio/webm", "UPLOADED"),
                audio(source, sourceStorage, "audio/ogg", "UPLOADED"),
                audio(source, sourceStorage, "audio/mp4", "UPLOADED"));
        var pending = audio(source, sourceStorage, "audio/webm", "PENDING");
        audio(source, sourceStorage, "audio/mp4", "FAILED");
        grant(source, pending.asset(), NOW.minusSeconds(600), NOW.minusSeconds(300));
        var before = snapshot(source);
        Path bundle = temporary.resolve("audio-archive");

        var exported = export(bundle);
        assertThat(exported.ready()).isTrue();
        assertThat(exported.memories()).isEqualTo(7);
        assertThat(exported.originals()).isEqualTo(4);
        assertThat(exported.pendingMedia()).isEqualTo(1);
        assertThat(exported.failedMedia()).isEqualTo(1);
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(2);
        assertThat(manifest.get("counts").has("pendingMedia")).isTrue();
        assertThat(manifest.get("counts").has("pendingPhotos")).isFalse();
        for (var voice : voices)
            assertThat(Files.readAllBytes(bundle.resolve("originals").resolve(voice.asset().toString())))
                    .isEqualTo(voice.bytes());
        var restored = restore(bundle);
        assertThat(restored.originals()).isEqualTo(4);
        assertThat(snapshot(target)).isEqualTo(before);
        for (var voice : voices) {
            assertThat(targetStorage.objects.get("originals/" + voice.asset())).isEqualTo(voice.bytes());
            assertThat(target.db().sql("SELECT audio_duration_ms FROM media_asset WHERE id = :id")
                    .param("id", voice.asset())
                    .query(Long.class).single()).isEqualTo(voice.verified().durationMs());
        }
        assertThat(target.db().sql("SELECT expected_duration_ms FROM media_asset WHERE id = :id")
                .param("id", voices.getFirst().asset())
                .query(Long.class).single()).isEqualTo(60_000L);
    }

    @Test
    void rehashedAudioDurationCannotSubstituteForDecodedOriginalDuration() throws Exception {
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        Path bundle = temporary.resolve("changed-audio-duration");
        assertThat(export(bundle).ready()).isTrue();
        ObjectNode metadata = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json")));
        long changedDuration = voice.verified().durationMs() + 1;
        ((ObjectNode) metadata.get("tables").get("media_asset").get(0)).put("audio_duration_ms", changedDuration);
        rewriteMetadataDigest(bundle, metadata);
        ObjectNode manifest = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        ((ObjectNode) manifest.get("originals").get(0)).put("audioDurationMs", changedDuration);
        Files.write(bundle.resolve("manifest.json"), JSON.writeValueAsBytes(manifest));
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void changedAudioOriginalHashMakesExportUnreadyAndBlocksRestoration() {
        var voice = audio(source, sourceStorage, "audio/mp4", "UPLOADED");
        byte[] changed = voice.bytes().clone();
        changed[changed.length - 1] ^= 1;
        sourceStorage.objects.put("originals/" + voice.asset(), changed);
        Path bundle = temporary.resolve("audio-original-integrity");
        var result = export(bundle);
        assertThat(result.ready()).isFalse();
        assertThat(result.unavailableOriginals()).isEqualTo(1);
        assertThat(result.originals()).isZero();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void olderAudioBundleReplaysCurrentErasureAndReservesAbsentSubmissionKeys() {
        var voice = audio(source, sourceStorage, "audio/ogg", "UPLOADED");
        var kept = note(source, "Synthetic retained sibling note", "Retained synthetic guest");
        Path bundle = temporary.resolve("before-audio-erasure");
        assertThat(export(bundle).ready()).isTrue();
        softDelete(source, voice.memory());
        assertThat(new RetentionService(source.retention(), sourceStorage, fixed(NOW)).purgeBatch(20))
                .isEqualTo(new RetentionService.Batch(1, 0));
        String absentKey = UUID.randomUUID().toString();
        sourceStorage.record(new DeletionRecord(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                SubmissionKeyDigest.sha256(absentKey), NOW.minusSeconds(1), NOW));

        var restored = restore(bundle);
        assertThat(restored.originals()).isZero();
        assertThat(restored.replayedDeletions()).isEqualTo(2);
        assertThat(targetStorage.objects).isEmpty();
        assertThat(count(target, "media_asset")).isZero();
        assertThat(string(target, "SELECT caption FROM memory WHERE id = :id", voice.memory())).isNull();
        assertThat(string(target, "SELECT text_content FROM memory WHERE id = :id", kept.memory()))
                .isEqualTo(kept.message());
        assertThat(count(target, "erased_submission_key")).isEqualTo(2);
        assertThatThrownBy(() -> target.tx().execute(ignored -> target.contributions().saveTextContribution(
                "kevin-mel-wedding", null, "Synthetic attempted erased-key reuse", absentKey)))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void exactVersionOneV8PackageRestoresIntoV10WithNullAudioAndArchiveFields() throws Exception {
        source = schema("8");
        target = schema("10");
        var note = legacyNote(source, "Synthetic legacy note");
        var batch = legacyPhotos(source, sourceStorage, "UPLOADED", "PENDING");
        Path bundle = temporary.resolve("legacy-v8");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(1);
        assertThat(manifest.get("counts").has("pendingPhotos")).isTrue();
        assertThat(manifest.get("originals").get(0).has("audioDurationMs")).isFalse();
        assertThat(Files.readString(bundle.resolve("metadata.json"))).doesNotContain("expected_duration_ms");
        // Current authority may contain an erased audio contribution created after this
        // V8 backup.
        String newerAudioKey = UUID.randomUUID().toString();
        sourceStorage.record(new DeletionRecord(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                SubmissionKeyDigest.sha256(newerAudioKey), NOW.minusSeconds(1), NOW));

        var restored = restore(bundle);
        assertThat(restored.originals()).isEqualTo(1);
        assertThat(restored.replayedDeletions()).isEqualTo(1);
        assertThat(string(target, "SELECT text_content FROM memory WHERE id = :id", note.memory()))
                .isEqualTo(note.message());
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(target.db().sql(
                "SELECT COUNT(*) FROM media_asset WHERE expected_duration_ms IS NOT NULL OR audio_duration_ms IS NOT NULL OR audio_codec IS NOT NULL OR audio_container IS NOT NULL")
                .query(Long.class).single()).isZero();
        assertArchiveDefaults(target);
        assertThat(target.db().sql("SELECT COUNT(*) FROM erased_submission_key WHERE key_digest = :digest")
                .param("digest", SubmissionKeyDigest.sha256(newerAudioKey)).query(Long.class).single()).isEqualTo(1);
        assertThatThrownBy(() -> target.tx().execute(ignored -> target.contributions().saveTextContribution(
                "kevin-mel-wedding", null, "Synthetic attempted post-backup audio key reuse", newerAudioKey)))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void versionOneRejectsAudioEvenWithValidRehashedMetadata() throws Exception {
        source = schema("8");
        legacyPhotos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("legacy-rehashed-audio");
        assertThat(export(bundle).ready()).isTrue();
        ObjectNode metadata = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json")));
        ((ObjectNode) metadata.get("tables").get("memory").get(0)).put("memory_type", "AUDIO");
        rewriteMetadataDigest(bundle, metadata);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void versionTwoCannotRestoreIntoAnOlderV8Target() {
        source = schema("9");
        audio(source, sourceStorage, "audio/mp4", "UPLOADED");
        Path bundle = temporary.resolve("v2-requires-v9");
        assertThat(export(bundle).ready()).isTrue();
        target = schema("8");
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void versionThreePreservesHistoricalAuthorsAndAllDatePrecisionsWithoutRestoringAccounts() throws Exception {
        source = schema("10");
        UUID author = UUID.randomUUID();
        var notes = new ArrayList<Text>();
        for (String[] date : List.of(new String[] { "UNKNOWN", null }, new String[] { "YEAR", "0001" },
                new String[] { "MONTH", "2026-10" }, new String[] { "DAY", "2024-02-29" })) {
            var note = note(source, "Synthetic authored note " + date[0], null);
            notes.add(note);
            coupleAttribution(source, note.contribution(), author);
            metadata(source, note.memory(), "Synthetic " + date[0] + " title", "Synthetic private description", date[1],
                    date[0]);
        }
        var batch = photos(source, sourceStorage, "UPLOADED");
        coupleAttribution(source, batch.contribution(), author);
        metadata(source, batch.memories().getFirst(), "Synthetic photo title", "Synthetic original description",
                "9999-12-31", "DAY");
        var before = snapshot(source);
        Path bundle = temporary.resolve("authored-v3");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(3);
        assertThat(manifest.get("originals").get(0).has("audioDurationMs")).isTrue();
        assertThat(Files.readString(bundle.resolve("metadata.json")))
                .contains(author.toString(), "author_account_id", "0001", "2024-02-29")
                .doesNotContain("password_hash", "archive_account");
        assertThat(restore(bundle).originals()).isEqualTo(1);
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(target.db().sql("SELECT count(*) FROM archive_account").query(Long.class).single()).isZero();
        assertThat(target.db().sql("SELECT author_account_id FROM contribution WHERE source='COUPLE'").query(UUID.class)
                .list())
                .hasSize(5).containsOnly(author);
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
    }

    @Test
    void versionTwoRestoresIntoV10WithArchiveDefaultsAndVerifiedAudioUnchanged() throws Exception {
        source = schema("9");
        target = schema("10");
        legacyNote(source, "Synthetic v2 note");
        var voice = audio(source, sourceStorage, "audio/mp4", "UPLOADED");
        Path bundle = temporary.resolve("v2-to-v10");
        assertThat(export(bundle).ready()).isTrue();
        assertThat(JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json"))).get("version").intValue())
                .isEqualTo(2);
        assertThat(restore(bundle).originals()).isEqualTo(1);
        assertArchiveDefaults(target);
        assertThat(targetStorage.objects.get("originals/" + voice.asset())).isEqualTo(voice.bytes());
        assertThat(target.db().sql("SELECT audio_duration_ms FROM media_asset WHERE id=:id").param("id", voice.asset())
                .query(Long.class).single()).isEqualTo(voice.verified().durationMs());
    }

    @Test
    void legacyVersionOneStillRestoresIntoReviewedV8AndV9Targets() {
        source = schema("8");
        var retained = legacyNote(source, "Synthetic backwards-compatible note");
        var erased = legacyNote(source, "Synthetic old-schema note later erased");
        Path bundle = temporary.resolve("v1-compatible-targets");
        assertThat(export(bundle).ready()).isTrue();
        // Authoritative erasure happened after the backup: legacy targets must replay
        // it without V10 columns.
        sourceStorage.record(new DeletionRecord(erased.memory(), erased.contribution(), null,
                SubmissionKeyDigest.sha256(erased.key()), NOW.minusSeconds(1), NOW));
        for (String migration : List.of("8", "9")) {
            target = schema(migration);
            var result = restore(bundle);
            assertThat(result.memories()).isEqualTo(2);
            assertThat(result.replayedDeletions()).isEqualTo(1);
            assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", erased.memory())).isNull();
            assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", retained.memory()))
                    .isEqualTo(retained.message());
            assertThat(count(target, "erased_submission_key")).isEqualTo(1);
        }
    }

    @Test
    void versionThreeCannotRestoreIntoOlderV8OrV9BeforeAnyOriginalMutation() {
        source = schema("10");
        photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("v3-requires-v10");
        assertThat(export(bundle).ready()).isTrue();
        for (String migration : List.of("8", "9")) {
            target = schema(migration);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void rehashedVersionThreeRejectsInvalidAttributionAndNoncanonicalMetadataBeforeAnyWrites() throws Exception {
        source = schema("10");
        note(source, "Synthetic metadata validation note", null);
        photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("v3-invalid-metadata");
        assertThat(export(bundle).ready()).isTrue();
        byte[] originalMetadata = Files.readAllBytes(bundle.resolve("metadata.json"));
        for (String invalid : List.of("GUEST_AUTHOR", "COUPLE_WITHOUT_AUTHOR", "COUPLE_GUEST_NAME", "COUPLE_BAD_KEY",
                "UNKNOWN_SOURCE", "TITLE_TOO_LONG",
                "DESCRIPTION_TOO_LONG", "SUPPLEMENTARY_TITLE_TOO_LONG", "SUPPLEMENTARY_DESCRIPTION_TOO_LONG",
                "PADDED_TITLE", "PADDED_DESCRIPTION",
                "UNKNOWN_WITH_DATE", "YEAR_ZERO", "MONTH_INVALID", "DAY_INVALID", "PRECISION_MISMATCH")) {
            ObjectNode metadata = (ObjectNode) JSON.readTree(originalMetadata);
            ObjectNode contribution = (ObjectNode) metadata.get("tables").get("contribution").get(0);
            ObjectNode memory = (ObjectNode) metadata.get("tables").get("memory").get(0);
            switch (invalid) {
                case "GUEST_AUTHOR" -> contribution.put("author_account_id", UUID.randomUUID().toString());
                case "COUPLE_WITHOUT_AUTHOR" -> contribution.put("source", "COUPLE");
                case "COUPLE_GUEST_NAME" ->
                    contribution.put("source", "COUPLE").put("author_account_id", UUID.randomUUID().toString())
                            .put("idempotency_key", "couple:" + "a".repeat(64))
                            .put("guest_name", "Synthetic invalid private attribution");
                case "COUPLE_BAD_KEY" ->
                    contribution.put("source", "COUPLE").put("author_account_id", UUID.randomUUID().toString())
                            .putNull("guest_name").put("idempotency_key", UUID.randomUUID().toString());
                case "UNKNOWN_SOURCE" -> contribution.put("source", "OTHER");
                case "TITLE_TOO_LONG" -> memory.put("title", "t".repeat(201));
                case "DESCRIPTION_TOO_LONG" -> memory.put("description", "d".repeat(2001));
                case "SUPPLEMENTARY_TITLE_TOO_LONG" -> memory.put("title", "\uD83D\uDE03".repeat(101));
                case "SUPPLEMENTARY_DESCRIPTION_TOO_LONG" -> memory.put("description", "\uD83D\uDE03".repeat(1001));
                case "PADDED_TITLE" -> memory.put("title", " \u3000Synthetic padded title");
                case "PADDED_DESCRIPTION" -> memory.put("description", "Synthetic padded description\u00a0");
                case "UNKNOWN_WITH_DATE" -> memory.put("memory_date", "2026");
                case "YEAR_ZERO" -> memory.put("memory_date", "0000").put("date_precision", "YEAR");
                case "MONTH_INVALID" -> memory.put("memory_date", "2026-13").put("date_precision", "MONTH");
                case "DAY_INVALID" -> memory.put("memory_date", "2025-02-29").put("date_precision", "DAY");
                case "PRECISION_MISMATCH" -> memory.put("memory_date", "2026-10-09").put("date_precision", "MONTH");
                default -> throw new IllegalArgumentException("Unreviewed fixture.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle)).as(invalid).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void rehashedVersionThreeAcceptsExactUtf16MetadataLimitsAndPreservesOriginals() throws Exception {
        source = schema("10");
        var note = note(source, "Synthetic immutable note under metadata", null);
        var batch = photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("v3-utf16-boundaries");
        assertThat(export(bundle).ready()).isTrue();
        ObjectNode metadata = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json")));
        String title = "\uD83D\uDE03".repeat(100), description = "\uD83D\uDE03".repeat(1000);
        assertThat(title.length()).isEqualTo(200);
        assertThat(description.length()).isEqualTo(2000);
        for (var row : metadata.get("tables").get("memory")) {
            ((ObjectNode) row).put("title", title).put("description", description);
        }
        rewriteMetadataDigest(bundle, metadata);
        var restored = restore(bundle);
        assertThat(restored.memories()).isEqualTo(2);
        assertThat(restored.originals()).isEqualTo(1);
        for (UUID memory : List.of(note.memory(), batch.memories().getFirst())) {
            assertThat(string(target, "SELECT title FROM memory WHERE id=:id", memory)).isEqualTo(title);
            assertThat(string(target, "SELECT description FROM memory WHERE id=:id", memory)).isEqualTo(description);
        }
        assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", note.memory()))
                .isEqualTo(note.message());
        assertThat(string(target, "SELECT caption FROM memory WHERE id=:id", batch.memories().getFirst()))
                .isEqualTo("Synthetic caption 0");
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
    }

    @Test
    void versionFourRestoresOrderedManyToManyAlbumsEmptyAlbumsAndTerminalTombstones() throws Exception {
        source = schema("11");
        var note = note(source, "Synthetic shared album note", null);
        coupleAttribution(source, note.contribution(), UUID.randomUUID());
        var batch = photos(source, sourceStorage, "UPLOADED");
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        UUID first = album(source, "\uD83D\uDE03".repeat(100), false),
                second = album(source, "Synthetic event collection", false);
        UUID empty = album(source, "Synthetic empty album", false), deleted = album(source, null, true);
        member(source, first, batch.memories().getFirst(), 10);
        member(source, first, note.memory(), 90);
        member(source, second, voice.memory(), 20);
        member(source, second, batch.memories().getFirst(), 300);
        var before = snapshot(source);
        Path bundle = temporary.resolve("v4-ordered-albums");
        var exported = export(bundle);
        assertThat(exported.ready()).isTrue();
        assertThat(exported.originals()).isEqualTo(2);
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(4);
        var tables = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
        assertThat(tables.get("album").size()).isEqualTo(4);
        assertThat(tables.get("album_membership").size()).isEqualTo(4);
        var restored = restore(bundle);
        assertThat(restored.memories()).isEqualTo(3);
        assertThat(restored.originals()).isEqualTo(2);
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(members(target, first)).containsExactly(batch.memories().getFirst(), note.memory());
        assertThat(members(target, second)).containsExactly(voice.memory(), batch.memories().getFirst());
        assertThat(members(target, empty)).isEmpty();
        assertThat(members(target, deleted)).isEmpty();
        assertThat(string(target, "SELECT name FROM album WHERE id=:id", deleted)).isNull();
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(targetStorage.objects.get("originals/" + voice.asset())).isEqualTo(voice.bytes());
        assertThat(target.db().sql("SELECT count(*) FROM archive_account").query(Long.class).single()).isZero();
    }

    @Test
    void everyLegacyVersionRestoresIntoEachReviewedCompatibleTargetWithEmptyNewOrganization() throws Exception {
        for (int migration = 8; migration <= 13; migration++) {
            source = schema(Integer.toString(migration));
            var note = migration < 10
                    ? legacyNote(source, "Synthetic legacy compatible note")
                    : note(source, "Synthetic legacy compatible note", null);
            var batch = migration < 10
                    ? legacyPhotos(source, sourceStorage, "UPLOADED")
                    : photos(source, sourceStorage, "UPLOADED");
            review(source, note.memory(), "KEEP", 2);
            UUID actor = source.db()
                    .sql("SELECT actor_account_id FROM review_audit WHERE memory_id=:id")
                    .param("id", note.memory())
                    .query(UUID.class)
                    .single();
            UUID album = migration >= 11 ? album(source, "Synthetic legacy album", false) : null;
            if (album != null) {
                member(source, album, note.memory(), 17);
            }
            UUID event = migration >= 12
                    ? timelineEvent(source, "Synthetic legacy timeline", null, "2024", "YEAR", false)
                    : null;
            if (event != null) {
                timelineMember(source, event, note.memory());
            }
            UUID tag = migration >= 13 ? tag(source, "Synthetic legacy tag", false) : null;
            if (tag != null) {
                tagMember(source, tag, note.memory());
            }
            Path bundle = temporary.resolve("legacy-compatibility-" + migration);
            assertThat(export(bundle).ready()).isTrue();
                assertThat(JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")))
                    .get("version").intValue()).isEqualTo(migration - 7);
            var tables = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
                assertThat(new Object[] {
                    tables.has("album"), tables.has("album_membership"),
                    tables.has("timeline_state"), tables.has("timeline_event"),
                    tables.has("timeline_event_memory"), tables.has("tag"), tables.has("memory_tag")
                }).containsExactly(
                    migration >= 11, migration >= 11,
                    migration >= 12, migration >= 12, migration >= 12,
                    migration >= 13, migration >= 13);
                assertThat(new Object[] {
                    tables.get("review_audit").get(0).has("before_visibility"),
                    tables.get("review_audit").get(0).has("after_visibility")
                }).containsExactly(false, false);
            for (int destination = migration; destination <= 15; destination++) {
                target = schema(Integer.toString(destination));
                targetStorage.objects.clear();
                targetStorage.records.clear();
                targetStorage.publications.clear();
                targetStorage.operations.clear();
                var restored = restore(bundle);
                assertThat(new Object[] {restored.memories(), restored.originals()}).containsExactly(2, 1);
                assertThat(new Object[] {
                    string(target, "SELECT text_content FROM memory WHERE id=:id", note.memory()),
                    targetStorage.objects.get("originals/" + batch.assets().getFirst())
                }).containsExactly(note.message(), batch.bytes().getFirst());
                assertThat(new Object[] {
                    target.db().sql("SELECT visibility FROM memory").query(String.class).list(),
                    target.db().sql("SELECT actor_account_id FROM review_audit WHERE memory_id=:id")
                        .param("id", note.memory()).query(UUID.class).single(),
                    target.db().sql("SELECT from_status || '/' || to_status FROM review_audit")
                        .query(String.class).list()
                }).containsExactly(List.of("COUPLE_ONLY", "COUPLE_ONLY"), actor, List.of("PENDING/KEEP"));
                if (destination >= 10) {
                    assertArchiveDefaults(target);
                }
                if (destination >= 11) {
                    assertThat(new Object[] {count(target, "album"), count(target, "album_membership")})
                            .containsExactly(album == null ? 0L : 1L, album == null ? 0L : 1L);
                    if (album != null) {
                        assertThat(members(target, album)).containsExactly(note.memory());
                    }
                }
                if (destination >= 12) {
                    assertThat(new Object[] {
                            count(target, "timeline_state"), count(target, "timeline_event"),
                            count(target, "timeline_event_memory")
                    }).containsExactly(event == null ? 0L : 1L, event == null ? 0L : 1L, event == null ? 0L : 1L);
                    if (event != null) {
                        assertThat(timelineMembers(target, event)).containsExactly(note.memory());
                    }
                }
                if (destination >= 13) {
                    assertThat(new Object[] {count(target, "tag"), count(target, "memory_tag")})
                            .containsExactly(tag == null ? 0L : 1L, tag == null ? 0L : 1L);
                    if (tag != null) {
                        assertThat(tagMembers(target, tag)).containsExactly(note.memory());
                    }
                }
                if (destination >= 14) {
                    assertThat(new Object[] {
                        target.db().sql("SELECT before_visibility || '/' || after_visibility FROM review_audit")
                            .query(String.class).list(),
                        target.db().sql("SELECT COUNT(*) FROM memory_share_link")
                            .query(Long.class).single()
                    }).containsExactly(List.of("COUPLE_ONLY/COUPLE_ONLY"), 0L);
                }
            }
        }
    }

    @Test
    void versionFourRequiresV11AndRefusesPopulatedAlbumTargetsBeforeOriginalPublication() {
        source = schema("11");
        var batch = photos(source, sourceStorage, "UPLOADED");
        UUID album = album(source, "Synthetic version-four album", false);
        member(source, album, batch.memories().getFirst(), 7);
        Path bundle = temporary.resolve("v4-target-schema");
        assertThat(export(bundle).ready()).isTrue();
        for (String migration : List.of("8", "9", "10")) {
            target = schema(migration);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
        target = schema();
        UUID existing = album(target, "Synthetic target organization", false);
        var before = snapshot(target);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(string(target, "SELECT name FROM album WHERE id=:id", existing))
                .isEqualTo("Synthetic target organization");
        assertNoTargetMutations();
        assertThat(targetStorage.objects).isEmpty();
    }

    @Test
    void rehashedVersionFourRejectsMalformedAlbumsAndMembershipGraphsBeforeAnyTargetWrites() throws Exception {
        source = schema("11");
        var note = note(source, "Synthetic album graph note", null);
        var batch = photos(source, sourceStorage, "UPLOADED", "PENDING");
        UUID album = album(source, "Synthetic graph album", false);
        member(source, album, batch.memories().getFirst(), 1);
        Path bundle = temporary.resolve("v4-malformed-album-graphs");
        assertThat(export(bundle).ready()).isTrue();
        byte[] original = Files.readAllBytes(bundle.resolve("metadata.json"));
        for (String invalid : List.of("DUPLICATE_ALBUM", "ALBUM_WRONG_VERSION", "ALBUM_WRONG_VARIANT",
                "REVISION_WRONG_VERSION", "REVISION_WRONG_VARIANT",
                "NULL_ACTIVE_NAME", "EMPTY_ACTIVE_NAME", "PADDED_NAME", "NAME_TOO_LONG", "SUPPLEMENTARY_NAME_TOO_LONG",
                "PUBLIC_ALBUM", "UPDATED_BEFORE_CREATED",
                "TOMBSTONE_WITH_NAME", "TOMBSTONE_WITH_MEMBERS", "DUPLICATE_MEMBERSHIP", "DUPLICATE_POSITION",
                "MISSING_ALBUM", "MISSING_MEMORY",
                "ZERO_POSITION", "NEGATIVE_POSITION", "OVERFLOW_POSITION", "UNFINISHED_MEDIA", "DELETED_MEMORY",
                "UNKNOWN_ALBUM_FIELD", "UNKNOWN_MEMBERSHIP_FIELD")) {
            ObjectNode metadata = (ObjectNode) JSON.readTree(original);
            var tables = metadata.get("tables");
            var albums = (tools.jackson.databind.node.ArrayNode) tables.get("album");
            ObjectNode a = (ObjectNode) albums.get(0);
            var memberships = (tools.jackson.databind.node.ArrayNode) tables.get("album_membership");
            ObjectNode edge = (ObjectNode) memberships.get(0);
            switch (invalid) {
                case "DUPLICATE_ALBUM" -> albums.add(a.deepCopy());
                case "ALBUM_WRONG_VERSION" -> {
                    String id = "00000000-0000-1000-8000-000000000001";
                    a.put("id", id);
                    edge.put("album_id", id);
                }
                case "ALBUM_WRONG_VARIANT" -> {
                    String id = "00000000-0000-4000-0000-000000000001";
                    a.put("id", id);
                    edge.put("album_id", id);
                }
                case "REVISION_WRONG_VERSION" -> a.put("revision", "00000000-0000-1000-8000-000000000001");
                case "REVISION_WRONG_VARIANT" -> a.put("revision", "00000000-0000-4000-0000-000000000001");
                case "NULL_ACTIVE_NAME" -> a.putNull("name");
                case "EMPTY_ACTIVE_NAME" -> a.put("name", "");
                case "PADDED_NAME" -> a.put("name", "\u3000Synthetic album\u00a0");
                case "NAME_TOO_LONG" -> a.put("name", "n".repeat(201));
                case "SUPPLEMENTARY_NAME_TOO_LONG" -> a.put("name", "\uD83D\uDE03".repeat(101));
                case "PUBLIC_ALBUM" -> a.put("visibility", "PUBLIC");
                case "UPDATED_BEFORE_CREATED" -> a.put("updated_at", NOW.minusSeconds(7200).toString());
                case "TOMBSTONE_WITH_NAME" -> {
                    a.put("deleted_at", NOW.minusSeconds(60).toString()).put("updated_at",
                            NOW.minusSeconds(60).toString());
                    memberships.removeAll();
                }
                case "TOMBSTONE_WITH_MEMBERS" -> a.putNull("name").put("deleted_at", NOW.minusSeconds(60).toString())
                        .put("updated_at", NOW.minusSeconds(60).toString());
                case "DUPLICATE_MEMBERSHIP" -> memberships.add(edge.deepCopy());
                case "DUPLICATE_POSITION" ->
                    memberships.add(edge.deepCopy().put("memory_id", note.memory().toString()));
                case "MISSING_ALBUM" -> edge.put("album_id", UUID.randomUUID().toString());
                case "MISSING_MEMORY" -> edge.put("memory_id", UUID.randomUUID().toString());
                case "ZERO_POSITION" -> edge.put("position", 0);
                case "NEGATIVE_POSITION" -> edge.put("position", -1);
                case "OVERFLOW_POSITION" -> edge.put("position", new java.math.BigInteger("9223372036854775808"));
                case "UNFINISHED_MEDIA" -> edge.put("memory_id", batch.memories().get(1).toString());
                case "DELETED_MEMORY" -> {
                    for (var memory : tables.get("memory"))
                        if (memory.get("id").asString().equals(batch.memories().getFirst().toString())) {
                            ((ObjectNode) memory).put("review_status", "DELETE").put("delete_after",
                                    NOW.plusSeconds(86400).toString());
                        }
                }
                case "UNKNOWN_ALBUM_FIELD" -> a.put("unreviewed", "synthetic");
                case "UNKNOWN_MEMBERSHIP_FIELD" -> edge.put("unreviewed", "synthetic");
                default -> throw new IllegalArgumentException("Unreviewed fixture.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle)).as(invalid).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void newerIndependentMemoryErasureDetachesEveryAlbumLinkAndPreservesSparseSiblingsAndEmptyAlbums() {
        source = schema("11");
        var erasedNote = note(source, "Synthetic album note later erased", null);
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        UUID first = album(source, "Synthetic collection A", false),
                second = album(source, "Synthetic collection B", false);
        UUID emptyAfterReplay = album(source, "Synthetic empty-after-erasure collection", false);
        member(source, first, erasedNote.memory(), 1);
        member(source, first, batch.memories().getFirst(), 40);
        member(source, first, batch.memories().get(1), 800);
        member(source, second, batch.memories().getFirst(), 70);
        member(source, second, batch.memories().get(1), 300);
        member(source, emptyAfterReplay, erasedNote.memory(), 9);
        UUID firstRevision = albumRevision(source, first), secondRevision = albumRevision(source, second),
                emptyRevision = albumRevision(source, emptyAfterReplay);
        Path bundle = temporary.resolve("v4-before-independent-erasure");
        assertThat(export(bundle).ready()).isTrue();
        sourceStorage.record(new DeletionRecord(erasedNote.memory(), erasedNote.contribution(), null,
                SubmissionKeyDigest.sha256(erasedNote.key()), NOW.minusSeconds(1), NOW));
        sourceStorage
                .record(new DeletionRecord(batch.memories().getFirst(), batch.contribution(), batch.assets().getFirst(),
                        SubmissionKeyDigest.sha256(batch.key()), NOW.minusSeconds(1), NOW));
        var restored = restore(bundle);
        assertThat(restored.replayedDeletions()).isEqualTo(2);
        assertThat(restored.originals()).isEqualTo(1);
        assertThat(members(target, first)).containsExactly(batch.memories().get(1));
        assertThat(members(target, second)).containsExactly(batch.memories().get(1));
        assertThat(members(target, emptyAfterReplay)).isEmpty();
        assertThat(count(target, "album")).isEqualTo(3);
        assertThat(count(target, "album_membership")).isEqualTo(2);
        assertThat(albumRevision(target, first)).isNotEqualTo(firstRevision);
        assertThat(albumRevision(target, second)).isNotEqualTo(secondRevision);
        assertThat(albumRevision(target, emptyAfterReplay)).isNotEqualTo(emptyRevision);
        assertThat(target.db().sql("SELECT position FROM album_membership WHERE album_id=:id").param("id", first)
                .query(Long.class).single()).isEqualTo(800);
        assertThat(target.db().sql("SELECT position FROM album_membership WHERE album_id=:id").param("id", second)
                .query(Long.class).single()).isEqualTo(300);
        assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", erasedNote.memory())).isNull();
        assertThat(string(target, "SELECT caption FROM memory WHERE id=:id", batch.memories().get(1)))
                .isEqualTo("Synthetic caption 1");
        assertThat(targetStorage.objects).hasSize(1);
        assertThat(targetStorage.objects.get("originals/" + batch.assets().get(1))).isEqualTo(batch.bytes().get(1));
    }

    @Test
    void versionFiveRestoresLifeEventsAllDatePrecisionsUnicodeBoundsAndMixedMemoryLinks() throws Exception {
        source = schema("12");
        var note = note(source, "Synthetic life-event note", null);
        var batch = photos(source, sourceStorage, "UPLOADED");
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        UUID year = timelineEvent(source, "\uD83D\uDE03".repeat(100), "\uD83D\uDE03".repeat(1000), "0001", "YEAR",
                false);
        UUID month = timelineEvent(source, "Synthetic month event", null, "9999-12", "MONTH", false);
        UUID day = timelineEvent(source, "Synthetic leap-day event", "Preserve this context", "2000-02-29", "DAY",
                false);
        UUID anotherDay = timelineEvent(source, "Synthetic second leap-day event", null, "2024-02-29", "DAY", false);
        UUID undated = timelineEvent(source, "Synthetic undated event", null, null, "UNKNOWN", false);
        UUID deleted = timelineEvent(source, null, null, null, "UNKNOWN", true);
        timelineMember(source, year, note.memory());
        timelineMember(source, year, batch.memories().getFirst());
        timelineMember(source, month, voice.memory());
        timelineMember(source, day, batch.memories().getFirst());
        timelineMember(source, day, voice.memory());
        UUID album = album(source, "Synthetic parallel album", false);
        member(source, album, voice.memory(), 700);
        var before = snapshot(source);
        Path bundle = temporary.resolve("v5-life-timeline");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(5);
        var tables = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
        assertThat(tables.get("timeline_state").size()).isEqualTo(1);
        assertThat(tables.get("timeline_event").size()).isEqualTo(6);
        assertThat(tables.get("timeline_event_memory").size()).isEqualTo(5);
        var restored = restore(bundle);
        assertThat(restored.memories()).isEqualTo(3);
        assertThat(restored.originals()).isEqualTo(2);
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(timelineMembers(target, year)).containsExactlyInAnyOrder(note.memory(), batch.memories().getFirst());
        assertThat(timelineMembers(target, month)).containsExactly(voice.memory());
        assertThat(timelineMembers(target, day)).containsExactlyInAnyOrder(batch.memories().getFirst(), voice.memory());
        for (UUID event : List.of(anotherDay, undated, deleted))
            assertThat(timelineMembers(target, event)).isEmpty();
        assertThat(string(target, "SELECT title FROM timeline_event WHERE id=:id", deleted)).isNull();
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(targetStorage.objects.get("originals/" + voice.asset())).isEqualTo(voice.bytes());
        assertThat(target.db().sql("SELECT count(*) FROM archive_account").query(Long.class).single()).isZero();
    }

    @Test
    void freshVersionFiveArchiveExportsAndRestoresWithNoSeededTimelineState() throws Exception {
        source = schema("12");
        Path bundle = temporary.resolve("v5-empty-lazy-timeline");
        assertThat(export(bundle).ready()).isTrue();
        var tables = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
        for (String table : List.of("timeline_state", "timeline_event", "timeline_event_memory"))
            assertThat(tables.get(table).size()).isZero();
        var restored = restore(bundle);
        assertThat(restored.memories()).isZero();
        assertThat(restored.originals()).isZero();
        assertEmptyTarget();
    }

    @Test
    void versionFiveRequiresV12AndRejectsTimelineOnlyPopulatedTargetsBeforeAnyOriginalPublication() {
        source = schema("12");
        var batch = photos(source, sourceStorage, "UPLOADED");
        UUID event = timelineEvent(source, "Synthetic source timeline", null, "2026", "YEAR", false);
        timelineMember(source, event, batch.memories().getFirst());
        Path bundle = temporary.resolve("v5-target-schema");
        assertThat(export(bundle).ready()).isTrue();
        for (String migration : List.of("8", "9", "10", "11")) {
            target = schema(migration);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
        for (boolean stateOnly : List.of(false, true)) {
            target = schema();
            if (stateOnly)
                target.db().sql("INSERT INTO timeline_state(id,revision,updated_at) VALUES(1,:revision,:at)")
                        .param("revision", UUID.randomUUID()).param("at", time(NOW.minusSeconds(60))).update();
            else
                timelineEvent(target, "Synthetic target-only organization", null, null, "UNKNOWN", false);
            var before = snapshot(target);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertThat(snapshot(target)).isEqualTo(before);
            assertNoTargetMutations();
            assertThat(targetStorage.objects).isEmpty();
        }
    }

    @Test
    void rehashedVersionFiveRejectsForgedTimelineStateDatesTombstonesAndMemoryGraphBeforeAnyWrites() throws Exception {
        source = schema("12");
        var batch = photos(source, sourceStorage, "UPLOADED", "PENDING");
        UUID event = timelineEvent(source, "Synthetic graph event", "Synthetic description", "2024-02-29", "DAY",
                false);
        timelineMember(source, event, batch.memories().getFirst());
        Path bundle = temporary.resolve("v5-malformed-timeline-graphs");
        assertThat(export(bundle).ready()).isTrue();
        byte[] original = Files.readAllBytes(bundle.resolve("metadata.json"));
        for (String invalid : List.of("DUPLICATE_EVENT", "EVENT_WRONG_VERSION", "EVENT_WRONG_VARIANT",
                "NONCANONICAL_EVENT_UUID",
                "REVISION_WRONG_VERSION", "REVISION_WRONG_VARIANT", "MISSING_STATE", "DUPLICATE_STATE",
                "WRONG_STATE_ID",
                "STATE_WRONG_VERSION", "STATE_WRONG_VARIANT", "STATE_BEFORE_EVENT", "STATE_WITHOUT_EVENTS",
                "NULL_ACTIVE_TITLE", "EMPTY_TITLE", "PADDED_TITLE", "TITLE_TOO_LONG", "SUPPLEMENTARY_TITLE_TOO_LONG",
                "NUL_TITLE", "UNPAIRED_TITLE",
                "EMPTY_DESCRIPTION", "PADDED_DESCRIPTION", "DESCRIPTION_TOO_LONG", "SUPPLEMENTARY_DESCRIPTION_TOO_LONG",
                "NUL_DESCRIPTION", "UNPAIRED_DESCRIPTION",
                "UNKNOWN_WITH_DATE", "YEAR_WITHOUT_DATE", "ZERO_YEAR", "SHORT_YEAR", "BAD_MONTH", "NONCANONICAL_MONTH",
                "BAD_LEAP_DAY", "BAD_CENTURY_LEAP_DAY", "BAD_DAY", "NONCANONICAL_DAY", "UNSUPPORTED_PRECISION",
                "PUBLIC_EVENT", "UPDATED_BEFORE_CREATED", "DELETED_BEFORE_CREATED", "DELETED_AFTER_UPDATED",
                "TOMBSTONE_TITLE", "TOMBSTONE_DESCRIPTION", "TOMBSTONE_DATE", "TOMBSTONE_PRECISION",
                "TOMBSTONE_WITH_MEMBERS",
                "DUPLICATE_LINK", "MISSING_EVENT", "MISSING_MEMORY", "UNFINISHED_MEDIA", "DELETED_MEMORY",
                "UNKNOWN_STATE_FIELD", "UNKNOWN_EVENT_FIELD", "UNKNOWN_LINK_FIELD")) {
            ObjectNode metadata = (ObjectNode) JSON.readTree(original);
            var tables = metadata.get("tables");
            var events = (tools.jackson.databind.node.ArrayNode) tables.get("timeline_event");
            ObjectNode e = (ObjectNode) events.get(0);
            var states = (tools.jackson.databind.node.ArrayNode) tables.get("timeline_state");
            ObjectNode state = (ObjectNode) states.get(0);
            var links = (tools.jackson.databind.node.ArrayNode) tables.get("timeline_event_memory");
            ObjectNode edge = (ObjectNode) links.get(0);
            if (invalid.startsWith("TOMBSTONE_") || invalid.startsWith("DELETED_")) {
                e.putNull("title").putNull("description").putNull("event_date").put("date_precision", "UNKNOWN")
                        .put("deleted_at", NOW.minusSeconds(60).toString())
                        .put("updated_at", NOW.minusSeconds(60).toString());
                if (!invalid.equals("TOMBSTONE_WITH_MEMBERS") && !invalid.equals("DELETED_MEMORY"))
                    links.removeAll();
            }
            switch (invalid) {
                case "DUPLICATE_EVENT" -> events.add(e.deepCopy());
                case "EVENT_WRONG_VERSION" -> {
                    String id = "00000000-0000-1000-8000-000000000001";
                    e.put("id", id);
                    edge.put("event_id", id);
                }
                case "EVENT_WRONG_VARIANT" -> {
                    String id = "00000000-0000-4000-0000-000000000001";
                    e.put("id", id);
                    edge.put("event_id", id);
                }
                case "NONCANONICAL_EVENT_UUID" -> {
                    String id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
                    e.put("id", id);
                    edge.put("event_id", id);
                }
                case "REVISION_WRONG_VERSION" -> e.put("revision", "00000000-0000-1000-8000-000000000001");
                case "REVISION_WRONG_VARIANT" -> e.put("revision", "00000000-0000-4000-0000-000000000001");
                case "MISSING_STATE" -> states.removeAll();
                case "DUPLICATE_STATE" -> states.add(state.deepCopy());
                case "WRONG_STATE_ID" -> state.put("id", 2);
                case "STATE_WRONG_VERSION" -> state.put("revision", "00000000-0000-1000-8000-000000000001");
                case "STATE_WRONG_VARIANT" -> state.put("revision", "00000000-0000-4000-0000-000000000001");
                case "STATE_BEFORE_EVENT" -> state.put("updated_at", NOW.minusSeconds(7200).toString());
                case "STATE_WITHOUT_EVENTS" -> {
                    events.removeAll();
                    links.removeAll();
                }
                case "NULL_ACTIVE_TITLE" -> e.putNull("title");
                case "EMPTY_TITLE" -> e.put("title", "");
                case "PADDED_TITLE" -> e.put("title", "\u3000Synthetic title\u00a0");
                case "TITLE_TOO_LONG" -> e.put("title", "t".repeat(201));
                case "SUPPLEMENTARY_TITLE_TOO_LONG" -> e.put("title", "\uD83D\uDE03".repeat(100) + "x");
                case "NUL_TITLE" -> e.put("title", "a\0b");
                case "UNPAIRED_TITLE" -> e.put("title", "\uD800");
                case "EMPTY_DESCRIPTION" -> e.put("description", "");
                case "PADDED_DESCRIPTION" -> e.put("description", "\uFEFFSynthetic description ");
                case "DESCRIPTION_TOO_LONG" -> e.put("description", "d".repeat(2001));
                case "SUPPLEMENTARY_DESCRIPTION_TOO_LONG" -> e.put("description", "\uD83D\uDE03".repeat(1000) + "x");
                case "NUL_DESCRIPTION" -> e.put("description", "a\0b");
                case "UNPAIRED_DESCRIPTION" -> e.put("description", "\uDC00");
                case "UNKNOWN_WITH_DATE" -> e.put("date_precision", "UNKNOWN");
                case "YEAR_WITHOUT_DATE" -> e.put("date_precision", "YEAR").putNull("event_date");
                case "ZERO_YEAR" -> e.put("date_precision", "YEAR").put("event_date", "0000");
                case "SHORT_YEAR" -> e.put("date_precision", "YEAR").put("event_date", "123");
                case "BAD_MONTH" -> e.put("date_precision", "MONTH").put("event_date", "2024-13");
                case "NONCANONICAL_MONTH" -> e.put("date_precision", "MONTH").put("event_date", "2024-2");
                case "BAD_LEAP_DAY" -> e.put("event_date", "2023-02-29");
                case "BAD_CENTURY_LEAP_DAY" -> e.put("event_date", "1900-02-29");
                case "BAD_DAY" -> e.put("event_date", "2024-02-30");
                case "NONCANONICAL_DAY" -> e.put("event_date", "2024-2-29");
                case "UNSUPPORTED_PRECISION" -> e.put("date_precision", "HOUR");
                case "PUBLIC_EVENT" -> e.put("visibility", "PUBLIC");
                case "UPDATED_BEFORE_CREATED" -> e.put("updated_at", NOW.minusSeconds(7200).toString());
                case "DELETED_BEFORE_CREATED" -> e.put("deleted_at", NOW.minusSeconds(7200).toString());
                case "DELETED_AFTER_UPDATED" -> e.put("deleted_at", NOW.minusSeconds(30).toString());
                case "TOMBSTONE_TITLE" -> e.put("title", "Should have been scrubbed");
                case "TOMBSTONE_DESCRIPTION" -> e.put("description", "Should have been scrubbed");
                case "TOMBSTONE_DATE" -> e.put("event_date", "2026").put("date_precision", "YEAR");
                case "TOMBSTONE_PRECISION" -> e.put("date_precision", "YEAR");
                case "TOMBSTONE_WITH_MEMBERS" -> {
                }
                case "DUPLICATE_LINK" -> links.add(edge.deepCopy());
                case "MISSING_EVENT" -> edge.put("event_id", UUID.randomUUID().toString());
                case "MISSING_MEMORY" -> edge.put("memory_id", UUID.randomUUID().toString());
                case "UNFINISHED_MEDIA" -> edge.put("memory_id", batch.memories().get(1).toString());
                case "DELETED_MEMORY" -> {
                    // Leave the event active: the only invalid relationship is the DELETE member.
                    e.put("title", "Synthetic graph event").put("description", "Synthetic description")
                            .put("event_date", "2024-02-29")
                            .put("date_precision", "DAY").putNull("deleted_at")
                            .put("updated_at", NOW.minusSeconds(3600).toString());
                    for (var memory : tables.get("memory"))
                        if (memory.get("id").asString().equals(batch.memories().getFirst().toString()))
                            ((ObjectNode) memory).put("review_status", "DELETE").put("delete_after",
                                    NOW.plusSeconds(86400).toString());
                }
                case "UNKNOWN_STATE_FIELD" -> state.put("unreviewed", true);
                case "UNKNOWN_EVENT_FIELD" -> e.put("unreviewed", true);
                case "UNKNOWN_LINK_FIELD" -> edge.put("unreviewed", true);
                default -> throw new IllegalArgumentException("Unreviewed timeline fixture.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle)).as(invalid).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void independentMemoryErasureReplayDetachesMixedTimelineAndAlbumLinksButPreservesOtherLifeEvents() {
        source = schema("12");
        var erasedNote = note(source, "Synthetic timeline note later erased", null);
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        UUID first = timelineEvent(source, "Synthetic event A", "Context remains", "2026-10", "MONTH", false);
        UUID second = timelineEvent(source, "Synthetic event B", null, "2026", "YEAR", false);
        UUID emptied = timelineEvent(source, "Synthetic emptied event", null, null, "UNKNOWN", false);
        UUID untouched = timelineEvent(source, "Synthetic untouched event", null, "2024-02-29", "DAY", false);
        for (UUID memory : List.of(erasedNote.memory(), batch.memories().getFirst(), voice.memory(),
                batch.memories().get(1)))
            timelineMember(source, first, memory);
        timelineMember(source, second, voice.memory());
        timelineMember(source, second, batch.memories().get(1));
        timelineMember(source, emptied, erasedNote.memory());
        timelineMember(source, untouched, batch.memories().get(1));
        UUID album = album(source, "Synthetic parallel erasure album", false);
        member(source, album, voice.memory(), 17);
        member(source, album, batch.memories().get(1), 900);
        UUID firstRevision = timelineRevision(source, first), secondRevision = timelineRevision(source, second),
                emptyRevision = timelineRevision(source, emptied);
        UUID untouchedRevision = timelineRevision(source, untouched), listRevision = timelineListRevision(source),
                albumRevision = albumRevision(source, album);
        Path bundle = temporary.resolve("v5-before-independent-erasure");
        assertThat(export(bundle).ready()).isTrue();
        sourceStorage.record(new DeletionRecord(erasedNote.memory(), erasedNote.contribution(), null,
                SubmissionKeyDigest.sha256(erasedNote.key()), NOW.minusSeconds(1), NOW));
        sourceStorage
                .record(new DeletionRecord(batch.memories().getFirst(), batch.contribution(), batch.assets().getFirst(),
                        SubmissionKeyDigest.sha256(batch.key()), NOW.minusSeconds(1), NOW));
        sourceStorage.record(new DeletionRecord(voice.memory(), voice.contribution(), voice.asset(),
                SubmissionKeyDigest.sha256(voice.key()), NOW.minusSeconds(1), NOW));
        var restored = restore(bundle);
        assertThat(restored.replayedDeletions()).isEqualTo(3);
        assertThat(restored.originals()).isEqualTo(1);
        for (UUID event : List.of(first, second, untouched))
            assertThat(timelineMembers(target, event)).containsExactly(batch.memories().get(1));
        assertThat(timelineMembers(target, emptied)).isEmpty();
        assertThat(count(target, "timeline_event")).isEqualTo(4);
        assertThat(count(target, "timeline_event_memory")).isEqualTo(3);
        assertThat(count(target, "timeline_state")).isEqualTo(1);
        assertThat(timelineRevision(target, first)).isNotEqualTo(firstRevision);
        assertThat(timelineRevision(target, second)).isNotEqualTo(secondRevision);
        assertThat(timelineRevision(target, emptied)).isNotEqualTo(emptyRevision);
        assertThat(timelineRevision(target, untouched)).isEqualTo(untouchedRevision);
        assertThat(timelineListRevision(target)).isNotEqualTo(listRevision);
        assertThat(albumRevision(target, album)).isNotEqualTo(albumRevision);
        assertThat(members(target, album)).containsExactly(batch.memories().get(1));
        assertThat(target.db().sql("SELECT position FROM album_membership WHERE album_id=:id").param("id", album)
                .query(Long.class).single()).isEqualTo(900);
        assertThat(string(target, "SELECT description FROM timeline_event WHERE id=:id", first))
                .isEqualTo("Context remains");
        assertThat(string(target, "SELECT event_date FROM timeline_event WHERE id=:id", first)).isEqualTo("2026-10");
        assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", erasedNote.memory())).isNull();
        assertThat(targetStorage.objects).hasSize(1);
        assertThat(targetStorage.objects.get("originals/" + batch.assets().get(1))).isEqualTo(batch.bytes().get(1));
    }

    @Test
    void versionSixPreservesTagsDuplicateNamesUnicodeTombstonesAndMixedOriginalLinks() throws Exception {
        var note = note(source, "Synthetic tagged note", null);
        UUID legacyMemory = UUID.fromString("aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa");
        source.db().sql("UPDATE memory SET id=:legacy WHERE id=:id").param("legacy", legacyMemory)
                .param("id", note.memory()).update();
        var batch = photos(source, sourceStorage, "UPLOADED");
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        source.db().sql("UPDATE memory SET review_status='KEEP' WHERE id=:id").param("id", batch.memories().getFirst())
                .update();
        source.db().sql("UPDATE memory SET review_status='ARCHIVED' WHERE id=:id").param("id", voice.memory()).update();
        UUID first = tag(source, "\uD83D\uDE03".repeat(100), false), second = tag(source, "Shared label", false);
        UUID duplicateName = tag(source, "Shared label", false), empty = tag(source, "Empty tag", false),
                deleted = tag(source, null, true);
        for (UUID memory : List.of(legacyMemory, batch.memories().getFirst(), voice.memory()))
            tagMember(source, first, memory);
        tagMember(source, second, legacyMemory);
        tagMember(source, second, voice.memory());
        tagMember(source, duplicateName, voice.memory());
        UUID album = album(source, "Synthetic tagged album", false);
        member(source, album, voice.memory(), 701);
        UUID event = timelineEvent(source, "Synthetic tagged event", null, "2024", "YEAR", false);
        timelineMember(source, event, legacyMemory);
        var before = snapshot(source);
        Path bundle = temporary.resolve("v6-private-tags");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(6);
        var tables = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
        assertThat(tables.size()).isEqualTo(14);
        assertThat(tables.get("tag").size()).isEqualTo(5);
        assertThat(tables.get("memory_tag").size()).isEqualTo(6);
        var restored = restore(bundle);
        assertThat(restored.memories()).isEqualTo(3);
        assertThat(restored.originals()).isEqualTo(2);
        assertThat(snapshot(target)).isEqualTo(before);
        assertThat(tagMembers(target, first)).containsExactlyInAnyOrder(legacyMemory, batch.memories().getFirst(),
                voice.memory());
        assertThat(tagMembers(target, second)).containsExactlyInAnyOrder(legacyMemory, voice.memory());
        assertThat(tagMembers(target, duplicateName)).containsExactly(voice.memory());
        for (UUID id : List.of(empty, deleted))
            assertThat(tagMembers(target, id)).isEmpty();
        assertThat(string(target, "SELECT name FROM tag WHERE id=:id", deleted)).isNull();
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(targetStorage.objects.get("originals/" + voice.asset())).isEqualTo(voice.bytes());
        assertThat(target.db().sql("SELECT count(*) FROM archive_account").query(Long.class).single()).isZero();
    }

    @Test
    void freshVersionSixArchiveRemainsRestorableWithoutTagOrTimelineSeedRows() throws Exception {
        Path bundle = temporary.resolve("v6-empty-tags");
        assertThat(export(bundle).ready()).isTrue();
        var metadata = JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json"))).get("tables");
        assertThat(metadata.size()).isEqualTo(14);
        for (String table : List.of("tag", "memory_tag", "timeline_state", "timeline_event", "timeline_event_memory"))
            assertThat(metadata.get(table).size()).isZero();
        var restored = restore(bundle);
        assertThat(restored.memories()).isZero();
        assertThat(restored.originals()).isZero();
        assertEmptyTarget();
    }

    @Test
    void versionSevenPreservesAudiencesButNeverRestoresOldPrivateLinkCapabilities() throws Exception {
        source = schema("14");
        target = schema("14");
        var publicNote = note(source, "Synthetic public note", null);
        var familyNote = note(source, "Synthetic family note", "Private guest name");
        source.db().sql("UPDATE memory SET review_status='KEEP', visibility='PUBLIC' WHERE id=:id")
                .param("id", publicNote.memory()).update();
        source.db().sql("UPDATE memory SET review_status='KEEP', visibility='FRIENDS_FAMILY' WHERE id=:id")
                .param("id", familyNote.memory()).update();
        source.db().sql("INSERT INTO memory_share_link(memory_id,token_digest,issued_at) VALUES(:id,:digest,:at)")
                .param("id", familyNote.memory()).param("digest", "a".repeat(64)).param("at", time(NOW)).update();
        Path bundle = temporary.resolve("v7-sharing");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(7);
        String encoded = Files.readString(bundle.resolve("metadata.json"));
        assertThat(encoded).contains("FRIENDS_FAMILY", "PUBLIC").doesNotContain("memory_share_link", "token_digest");
        assertThat(restore(bundle).memories()).isEqualTo(2);
        assertThat(string(target, "SELECT visibility FROM memory WHERE id=:id", publicNote.memory()))
                .isEqualTo("PUBLIC");
        assertThat(string(target, "SELECT visibility FROM memory WHERE id=:id", familyNote.memory()))
                .isEqualTo("FRIENDS_FAMILY");
        assertThat(target.db().sql("SELECT COUNT(*) FROM memory_share_link").query(Long.class).single()).isZero();
    }

    @Test
    void versionSevenCannotRestoreIntoV13BeforeAnyTargetMutation() {
        source = schema("14");
        var batch = photos(source, sourceStorage, "UPLOADED");
        source.db()
                .sql("UPDATE memory SET review_status='KEEP', visibility='PUBLIC' WHERE id=:id")
                .param("id", batch.memories().getFirst())
                .update();
        Path bundle = temporary.resolve("v7-requires-v14");
        assertThat(export(bundle).ready()).isTrue();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void accountOnlyV15KeepsVersionSevenWithItsExactFingerprintAndNeverExportsCredentials() throws Exception {
        source = schema("15");
        target = schema("15");
        var oldSchema = schema("14");
        source.db().sql("""
                INSERT INTO archive_account(username,display_name,password_hash,role,enabled,password_change_required)
                VALUES('synthetic-couple','Synthetic account','synthetic-credential-not-archive-data','COUPLE',true,true)
                """).update();
        var text = note(source, "Synthetic V15 archive note", null);
        var batch = photos(source, sourceStorage, "UPLOADED");
        var current = RecoverySchema.requireReviewed(source.db());
        var previous = RecoverySchema.requireReviewed(oldSchema.db());
        assertThat(current.bundleVersion()).isEqualTo(7);
        assertThat(current.fingerprint()).isNotEqualTo(previous.fingerprint());
        assertThat(current.accepts(7, previous.fingerprint())).isTrue();
        assertThat(previous.accepts(7, current.fingerprint())).isFalse();

        Path bundle = temporary.resolve("v15-account-only-v7");
        assertThat(export(bundle).ready()).isTrue();
        var manifest = JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        assertThat(manifest.get("version").intValue()).isEqualTo(7);
        assertThat(manifest.get("schemaFingerprint").asString()).isEqualTo(current.fingerprint());
        assertThat(Files.readString(bundle.resolve("metadata.json"))).doesNotContain(
                "archive_account", "password_change_required", "synthetic-credential-not-archive-data");
        var restored = restore(bundle);
        assertThat(restored.memories()).isEqualTo(2);
        assertThat(restored.originals()).isEqualTo(1);
        assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", text.memory()))
                .isEqualTo(text.message());
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(target.db().sql("SELECT COUNT(*) FROM archive_account").query(Long.class).single()).isZero();
    }

    @Test
    void legacyV14VersionSevenRestoresIntoV15WithAudiencesAndExactOriginals() throws Exception {
        source = schema("14");
        target = schema("15");
        var text = note(source, "Synthetic legacy V7 audience", null);
        var batch = photos(source, sourceStorage, "UPLOADED");
        source.db().sql("UPDATE memory SET review_status='KEEP',visibility='FRIENDS_FAMILY' WHERE id=:id")
                .param("id", text.memory()).update();
        Path bundle = temporary.resolve("legacy-v7-to-v15");
        assertThat(export(bundle).ready()).isTrue();
        assertThat(restore(bundle).memories()).isEqualTo(2);
        assertThat(string(target, "SELECT visibility FROM memory WHERE id=:id", text.memory()))
                .isEqualTo("FRIENDS_FAMILY");
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        assertThat(target.db().sql("SELECT COUNT(*) FROM archive_account").query(Long.class).single()).isZero();
        assertThat(target.db().sql("SELECT COUNT(*) FROM memory_share_link").query(Long.class).single()).isZero();
    }

    @Test
    void v15FingerprintRejectsOlderTargetsAndChangedV15HistoryBeforeRecoveryWrites() throws Exception {
        source = schema("15");
        target = schema("14");
        photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("v15-requires-reviewed-v15");
        assertThat(export(bundle).ready()).isTrue();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
        for (String field : List.of("checksum", "success", "script")) {
            String change = switch (field) {
                case "checksum" -> "checksum=checksum+1";
                case "success" -> "success=false";
                default -> "script='unreviewed-account-migration.sql'";
            };
            String restoreHistory = switch (field) {
                case "checksum" -> "checksum=checksum-1";
                case "success" -> "success=true";
                default -> "script='V15__require_first_login_password_change.sql'";
            };
            source.db().sql("UPDATE flyway_schema_history SET " + change + " WHERE version='15'").update();
            try {
                assertThatThrownBy(() -> RecoverySchema.requireReviewed(source.db()))
                        .as(field).isInstanceOf(RecoveryException.class);
            } finally {
                source.db().sql("UPDATE flyway_schema_history SET " + restoreHistory + " WHERE version='15'").update();
            }
        }
    }

    @Test
    void rehashedVersionSevenRejectsInvalidMemoryAndAuditAudienceStatesBeforeAnyWrites() throws Exception {
        source = schema("14");
        target = schema("14");
        var note = note(source, "Synthetic audience-state recovery note", null);
        photos(source, sourceStorage, "UPLOADED");
        review(source, note.memory(), "KEEP", 2);
        source.db()
                .sql("UPDATE memory SET review_status='KEEP'")
                .update();
        Path bundle = temporary.resolve("v7-invalid-audience-states");
        assertThat(export(bundle).ready()).isTrue();
        byte[] original = Files.readAllBytes(bundle.resolve("metadata.json"));
        for (String invalid : List.of(
                "UNKNOWN_MEMORY_AUDIENCE",
                "PUBLIC_PENDING_MEMORY",
                "FAMILY_ARCHIVED_MEMORY",
                "UNKNOWN_AUDIT_BEFORE_AUDIENCE",
                "UNKNOWN_AUDIT_AFTER_AUDIENCE",
                "SHARED_AUDIT_FROM_PENDING",
                "SHARED_AUDIT_TO_ARCHIVED")) {
            ObjectNode metadata = (ObjectNode) JSON.readTree(original);
            var tables = metadata.get("tables");
            ObjectNode memory = (ObjectNode) tables.get("memory").get(0);
            ObjectNode audit = (ObjectNode) tables.get("review_audit").get(0);
            switch (invalid) {
                case "UNKNOWN_MEMORY_AUDIENCE" -> memory.put("visibility", "OPEN");
                case "PUBLIC_PENDING_MEMORY" -> memory
                        .put("visibility", "PUBLIC")
                        .put("review_status", "PENDING");
                case "FAMILY_ARCHIVED_MEMORY" -> memory
                        .put("visibility", "FRIENDS_FAMILY")
                        .put("review_status", "ARCHIVED");
                case "UNKNOWN_AUDIT_BEFORE_AUDIENCE" -> audit.put("before_visibility", "OPEN");
                case "UNKNOWN_AUDIT_AFTER_AUDIENCE" -> audit.put("after_visibility", "OPEN");
                case "SHARED_AUDIT_FROM_PENDING" -> audit.put("before_visibility", "PUBLIC");
                case "SHARED_AUDIT_TO_ARCHIVED" -> audit
                        .put("after_visibility", "FRIENDS_FAMILY")
                        .put("to_status", "ARCHIVED");
                default -> throw new IllegalArgumentException("Unreviewed audience-state fixture.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle))
                    .as(invalid)
                    .isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
            assertThat(target.db()
                    .sql("SELECT COUNT(*) FROM memory_share_link")
                    .query(Long.class)
                    .single()).isZero();
        }
    }

    @Test
    void versionSixRequiresV13AndRejectsTagOnlyPopulatedTargetsBeforeAnyOriginalPublication() {
        var batch = photos(source, sourceStorage, "UPLOADED");
        UUID id = tag(source, "Synthetic source tag", false);
        tagMember(source, id, batch.memories().getFirst());
        Path bundle = temporary.resolve("v6-target-schema");
        assertThat(export(bundle).ready()).isTrue();
        for (String migration : List.of("8", "9", "10", "11", "12")) {
            target = schema(migration);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
        for (boolean deleted : List.of(false, true)) {
            target = schema();
            tag(target, deleted ? null : "Synthetic target-only tag", deleted);
            var before = snapshot(target);
            assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
            assertThat(snapshot(target)).isEqualTo(before);
            assertNoTargetMutations();
            assertThat(targetStorage.objects).isEmpty();
        }
    }

    @Test
    void rehashedVersionSixRejectsForgedTagNamesTombstonesAndMembershipGraphsBeforeAnyWrites() throws Exception {
        var batch = photos(source, sourceStorage, "UPLOADED", "PENDING", "FAILED");
        UUID id = tag(source, "Synthetic graph tag", false);
        tagMember(source, id, batch.memories().getFirst());
        Path bundle = temporary.resolve("v6-malformed-tag-graphs");
        assertThat(export(bundle).ready()).isTrue();
        byte[] original = Files.readAllBytes(bundle.resolve("metadata.json"));
        for (String invalid : List.of("DUPLICATE_TAG", "TAG_WRONG_VERSION", "TAG_WRONG_VARIANT",
                "NONCANONICAL_TAG_UUID", "REVISION_WRONG_VERSION", "REVISION_WRONG_VARIANT",
                "NULL_ACTIVE_NAME", "EMPTY_NAME", "PADDED_NAME", "NAME_TOO_LONG", "SUPPLEMENTARY_NAME_TOO_LONG",
                "NUL_NAME", "UNPAIRED_NAME", "PUBLIC_TAG",
                "UPDATED_BEFORE_CREATED", "DELETED_BEFORE_CREATED", "DELETED_AFTER_UPDATED", "TOMBSTONE_NAME",
                "TOMBSTONE_WITH_MEMBERS",
                "DUPLICATE_LINK", "MISSING_TAG", "MISSING_MEMORY", "UNFINISHED_MEDIA", "FAILED_MEDIA", "DELETED_MEMORY",
                "UNKNOWN_TAG_FIELD", "UNKNOWN_LINK_FIELD", "UNREVIEWED_STATE_TABLE")) {
            ObjectNode metadata = (ObjectNode) JSON.readTree(original);
            var tables = metadata.get("tables");
            var tags = (tools.jackson.databind.node.ArrayNode) tables.get("tag");
            ObjectNode t = (ObjectNode) tags.get(0);
            var links = (tools.jackson.databind.node.ArrayNode) tables.get("memory_tag");
            ObjectNode edge = (ObjectNode) links.get(0);
            if (invalid.startsWith("TOMBSTONE_")
                    || invalid.startsWith("DELETED_") && !invalid.equals("DELETED_MEMORY")) {
                t.putNull("name").put("deleted_at", NOW.minusSeconds(60).toString()).put("updated_at",
                        NOW.minusSeconds(60).toString());
                if (!invalid.equals("TOMBSTONE_WITH_MEMBERS"))
                    links.removeAll();
            }
            switch (invalid) {
                case "DUPLICATE_TAG" -> tags.add(t.deepCopy());
                case "TAG_WRONG_VERSION" -> {
                    String value = "00000000-0000-1000-8000-000000000001";
                    t.put("id", value);
                    edge.put("tag_id", value);
                }
                case "TAG_WRONG_VARIANT" -> {
                    String value = "00000000-0000-4000-0000-000000000001";
                    t.put("id", value);
                    edge.put("tag_id", value);
                }
                case "NONCANONICAL_TAG_UUID" -> {
                    String value = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
                    t.put("id", value);
                    edge.put("tag_id", value);
                }
                case "REVISION_WRONG_VERSION" -> t.put("revision", "00000000-0000-1000-8000-000000000001");
                case "REVISION_WRONG_VARIANT" -> t.put("revision", "00000000-0000-4000-0000-000000000001");
                case "NULL_ACTIVE_NAME" -> t.putNull("name");
                case "EMPTY_NAME" -> t.put("name", "");
                case "PADDED_NAME" -> t.put("name", "\u3000Synthetic name\u00a0");
                case "NAME_TOO_LONG" -> t.put("name", "n".repeat(201));
                case "SUPPLEMENTARY_NAME_TOO_LONG" -> t.put("name", "\uD83D\uDE03".repeat(100) + "x");
                case "NUL_NAME" -> t.put("name", "a\0b");
                case "UNPAIRED_NAME" -> t.put("name", "\uD800");
                case "PUBLIC_TAG" -> t.put("visibility", "PUBLIC");
                case "UPDATED_BEFORE_CREATED" -> t.put("updated_at", NOW.minusSeconds(7200).toString());
                case "DELETED_BEFORE_CREATED" -> t.put("deleted_at", NOW.minusSeconds(7200).toString());
                case "DELETED_AFTER_UPDATED" -> t.put("deleted_at", NOW.minusSeconds(30).toString());
                case "TOMBSTONE_NAME" -> t.put("name", "Should have been scrubbed");
                case "TOMBSTONE_WITH_MEMBERS" -> {
                }
                case "DUPLICATE_LINK" -> links.add(edge.deepCopy());
                case "MISSING_TAG" -> edge.put("tag_id", UUID.randomUUID().toString());
                case "MISSING_MEMORY" -> edge.put("memory_id", UUID.randomUUID().toString());
                case "UNFINISHED_MEDIA" -> edge.put("memory_id", batch.memories().get(1).toString());
                case "FAILED_MEDIA" -> edge.put("memory_id", batch.memories().get(2).toString());
                case "DELETED_MEMORY" -> {
                    for (var memory : tables.get("memory"))
                        if (memory.get("id").asString().equals(batch.memories().getFirst().toString()))
                            ((ObjectNode) memory).put("review_status", "DELETE").put("delete_after",
                                    NOW.plusSeconds(86400).toString());
                }
                case "UNKNOWN_TAG_FIELD" -> t.put("unreviewed", true);
                case "UNKNOWN_LINK_FIELD" -> edge.put("unreviewed", true);
                case "UNREVIEWED_STATE_TABLE" -> ((ObjectNode) tables).putArray("tag_state");
                default -> throw new IllegalArgumentException("Unreviewed tag fixture.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle)).as(invalid).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void independentMemoryErasureReplayDetachesTagsAndOtherOrganizationPreservingUnrelatedOriginals() {
        var erasedNote = note(source, "Synthetic tagged note later erased", null);
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        var voice = audio(source, sourceStorage, "audio/webm", "UPLOADED");
        UUID first = tag(source, "Synthetic tag A", false), second = tag(source, "Synthetic tag B", false);
        UUID emptied = tag(source, "Synthetic emptied tag", false),
                untouched = tag(source, "Synthetic untouched tag", false);
        for (UUID memory : List.of(erasedNote.memory(), batch.memories().getFirst(), voice.memory(),
                batch.memories().get(1)))
            tagMember(source, first, memory);
        tagMember(source, second, voice.memory());
        tagMember(source, second, batch.memories().get(1));
        tagMember(source, emptied, erasedNote.memory());
        tagMember(source, untouched, batch.memories().get(1));
        UUID event = timelineEvent(source, "Synthetic parallel event", "Context remains", "2026-10", "MONTH", false);
        UUID album = album(source, "Synthetic parallel album", false);
        timelineMember(source, event, voice.memory());
        timelineMember(source, event, batch.memories().get(1));
        member(source, album, voice.memory(), 17);
        member(source, album, batch.memories().get(1), 900);
        UUID firstRevision = tagRevision(source, first), secondRevision = tagRevision(source, second),
                emptyRevision = tagRevision(source, emptied);
        UUID untouchedRevision = tagRevision(source, untouched), eventRevision = timelineRevision(source, event),
                collectionRevision = albumRevision(source, album);
        Path bundle = temporary.resolve("v6-before-independent-erasure");
        assertThat(export(bundle).ready()).isTrue();
        sourceStorage.record(new DeletionRecord(erasedNote.memory(), erasedNote.contribution(), null,
                SubmissionKeyDigest.sha256(erasedNote.key()), NOW.minusSeconds(1), NOW));
        sourceStorage.record(new DeletionRecord(batch.memories().getFirst(), batch.contribution(),
                batch.assets().getFirst(), SubmissionKeyDigest.sha256(batch.key()), NOW.minusSeconds(1), NOW));
        sourceStorage.record(new DeletionRecord(voice.memory(), voice.contribution(), voice.asset(),
                SubmissionKeyDigest.sha256(voice.key()), NOW.minusSeconds(1), NOW));
        var restored = restore(bundle);
        assertThat(restored.replayedDeletions()).isEqualTo(3);
        assertThat(restored.originals()).isEqualTo(1);
        for (UUID id : List.of(first, second, untouched))
            assertThat(tagMembers(target, id)).containsExactly(batch.memories().get(1));
        assertThat(tagMembers(target, emptied)).isEmpty();
        assertThat(count(target, "tag")).isEqualTo(4);
        assertThat(count(target, "memory_tag")).isEqualTo(3);
        assertThat(tagRevision(target, first)).isNotEqualTo(firstRevision);
        assertThat(tagRevision(target, second)).isNotEqualTo(secondRevision);
        assertThat(tagRevision(target, emptied)).isNotEqualTo(emptyRevision);
        assertThat(tagRevision(target, untouched)).isEqualTo(untouchedRevision);
        assertThat(timelineRevision(target, event)).isNotEqualTo(eventRevision);
        assertThat(albumRevision(target, album)).isNotEqualTo(collectionRevision);
        assertThat(timelineMembers(target, event)).containsExactly(batch.memories().get(1));
        assertThat(members(target, album)).containsExactly(batch.memories().get(1));
        assertThat(target.db().sql("SELECT position FROM album_membership WHERE album_id=:id").param("id", album)
                .query(Long.class).single()).isEqualTo(900);
        assertThat(string(target, "SELECT name FROM tag WHERE id=:id", emptied)).isEqualTo("Synthetic emptied tag");
        assertThat(string(target, "SELECT text_content FROM memory WHERE id=:id", erasedNote.memory())).isNull();
        assertThat(targetStorage.objects).hasSize(1);
        assertThat(targetStorage.objects.get("originals/" + batch.assets().get(1))).isEqualTo(batch.bytes().get(1));
    }

    @Test
    void largerArchiveRestoresEveryContributionAndMemoryWithAccurateCounts() {
        for (int index = 0; index < 130; index++)
            note(source, "Synthetic recoverable note " + index, null);
        Path bundle = temporary.resolve("larger-archive");
        var exported = export(bundle);
        assertThat(exported.ready()).isTrue();
        assertThat(exported.contributions()).isEqualTo(130);
        assertThat(exported.memories()).isEqualTo(130);
        var restored = restore(bundle);
        assertThat(restored.contributions()).isEqualTo(130);
        assertThat(restored.memories()).isEqualTo(130);
        assertThat(restored.originals()).isZero();
        assertThat(snapshot(target)).isEqualTo(snapshot(source));
        assertThat(targetStorage.objects).isEmpty();
    }

    @Test
    void missingAndCorruptOriginalsAreExplicitlyIncompleteAndCannotRestore() {
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        sourceStorage.objects.remove("originals/" + batch.assets().getFirst());
        sourceStorage.objects.put("originals/" + batch.assets().get(1), new byte[] { 1, 2, 3 });
        Path bundle = temporary.resolve("incomplete");
        var result = export(bundle);
        assertThat(result.ready()).isFalse();
        assertThat(result.unavailableOriginals()).isEqualTo(2);
        assertThat(result.originals()).isZero();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void currentIndependentLedgerPreventsResurrectionFromOlderBackupAndReservesAbsentEnvelopeKey() {
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        var deletedNote = note(source, "Synthetic note later erased", "Later erased guest");
        var keptNote = note(source, "Synthetic retained note", "Retained guest");
        UUID author = UUID.randomUUID();
        coupleAttribution(source, deletedNote.contribution(), author);
        metadata(source, batch.memories().getFirst(), "Synthetic erased photo title",
                "Synthetic erased photo description", "2026-10-09", "DAY");
        metadata(source, batch.memories().get(1), "Synthetic retained photo title",
                "Synthetic retained photo description", "2026-10", "MONTH");
        metadata(source, deletedNote.memory(), "Synthetic erased note title", "Synthetic erased note description",
                "2026", "YEAR");
        Path old = temporary.resolve("older-backup");
        assertThat(export(old).ready()).isTrue();
        var absentNote = note(source, "Created and deleted after backup", "Absent guest");
        softDelete(source, batch.memories().getFirst());
        softDelete(source, deletedNote.memory());
        softDelete(source, absentNote.memory());
        var service = new RetentionService(source.retention(), sourceStorage, fixed(NOW.plusSeconds(120)));
        assertThat(service.purgeBatch(100)).isEqualTo(new RetentionService.Batch(3, 0));
        assertThat(sourceStorage.records).hasSize(3);

        var result = recovery(target, targetStorage, sourceStorage, targetStorage, NOW.plusSeconds(600))
                .restoreFrom(old);
        assertThat(result.replayedDeletions()).isEqualTo(3);
        assertThat(targetStorage.objects.keySet()).containsExactly("originals/" + batch.assets().get(1));
        assertThat(targetStorage.publications).doesNotContain("originals/" + batch.assets().getFirst());
        assertThat(string(target, "SELECT caption FROM memory WHERE id = :id", batch.memories().getFirst())).isNull();
        assertThat(string(target, "SELECT text_content FROM memory WHERE id = :id", deletedNote.memory())).isNull();
        assertThat(string(target, "SELECT guest_name FROM contribution WHERE id = :id", deletedNote.contribution()))
                .isNull();
        assertThat(string(target, "SELECT caption FROM memory WHERE id = :id", batch.memories().get(1)))
                .isEqualTo("Synthetic caption 1");
        assertThat(string(target, "SELECT text_content FROM memory WHERE id = :id", keptNote.memory()))
                .isEqualTo(keptNote.message());
        for (UUID memory : List.of(batch.memories().getFirst(), deletedNote.memory())) {
            assertThat(string(target, "SELECT title FROM memory WHERE id=:id", memory)).isNull();
            assertThat(string(target, "SELECT description FROM memory WHERE id=:id", memory)).isNull();
            assertThat(string(target, "SELECT memory_date FROM memory WHERE id=:id", memory)).isNull();
            assertThat(string(target, "SELECT date_precision FROM memory WHERE id=:id", memory)).isEqualTo("UNKNOWN");
        }
        assertThat(string(target, "SELECT title FROM memory WHERE id=:id", batch.memories().get(1)))
                .isEqualTo("Synthetic retained photo title");
        assertThat(string(target, "SELECT memory_date FROM memory WHERE id=:id", batch.memories().get(1)))
                .isEqualTo("2026-10");
        assertThat(string(target, "SELECT date_precision FROM memory WHERE id=:id", batch.memories().get(1)))
                .isEqualTo("MONTH");
        for (UUID contribution : List.of(deletedNote.contribution())) {
            assertThat(string(target, "SELECT source FROM contribution WHERE id=:id", contribution))
                    .isEqualTo("COUPLE");
            assertThat(
                    target.db().sql("SELECT author_account_id FROM contribution WHERE id=:id").param("id", contribution)
                            .query(UUID.class).single())
                    .isEqualTo(author);
        }
        assertThat(count(target, "deletion_ledger")).isEqualTo(3);
        assertThat(count(target, "erased_submission_key")).isEqualTo(3);
        assertThat(count(target, "media_asset")).isEqualTo(1);
        assertThat(count(target, "contribution")).isEqualTo(3);
        assertThat(target.contributions().getReceipt(batch.contribution(), batch.key()).completion())
                .isEqualTo("COMPLETE");
        assertThatThrownBy(() -> target.tx().execute(ignored -> target.contributions().saveTextContribution(
                "kevin-mel-wedding", absentNote.guest(), absentNote.message(), absentNote.key())))
                .isInstanceOf(com.kevinmel.archive.web.ApiException.class);
        assertThat(count(target, "contribution")).isEqualTo(3);
    }

    @Test
    void storageFailureRollsBackAllMetadataAndRetryReusesExactPublishedBytes() {
        photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        note(source, "Must not be partially committed", "Rollback guest");
        Path bundle = temporary.resolve("storage-retry");
        assertThat(export(bundle).ready()).isTrue();
        targetStorage.failPublication = 2;
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        for (String table : TABLES)
            assertThat(count(target, table)).as(table).isZero();
        assertThat(targetStorage.objects).hasSize(1);
        var alreadyPublished = new LinkedHashMap<>(targetStorage.objects);
        assertThat(restore(bundle).originals()).isEqualTo(2);
        alreadyPublished.forEach((key, bytes) -> assertThat(targetStorage.objects.get(key)).isEqualTo(bytes));
        assertThat(snapshot(target)).isEqualTo(snapshot(source));
    }

    @Test
    void databaseFailureAfterParentInsertRollsBackAllRowsAndRetryPreservesPublishedOriginal() {
        var batch = photos(source, sourceStorage, "UPLOADED");
        note(source, "Synthetic atomic database import", null);
        Path bundle = temporary.resolve("database-retry");
        assertThat(export(bundle).ready()).isTrue();
        target.db().sql("""
                CREATE FUNCTION reject_fixture_import() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic import rejection'; END; $$
                """).update();
        target.db().sql("""
                CREATE CONSTRAINT TRIGGER reject_fixture_import AFTER INSERT ON memory
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
                EXECUTE FUNCTION reject_fixture_import()
                """).update();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        for (String table : TABLES)
            assertThat(count(target, table)).as(table).isZero();
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
        target.db().sql("DROP TRIGGER reject_fixture_import ON memory").update();
        assertThat(restore(bundle).originals()).isEqualTo(1);
        assertThat(snapshot(target)).isEqualTo(snapshot(source));
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst()))
                .isEqualTo(batch.bytes().getFirst());
    }

    @Test
    void nonemptyTargetIsRejectedBeforeAnyObjectOrLedgerMutation() {
        note(source, "Source", null);
        Path bundle = temporary.resolve("nonempty-target");
        assertThat(export(bundle).ready()).isTrue();
        note(target, "Existing target data", null);
        var before = snapshot(target);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertThat(snapshot(target)).isEqualTo(before);
        assertNoTargetMutations();
    }

    @Test
    void schemaDriftAndMismatchedOrFailedMigrationHistoryRejectRestoreBeforeWrites() {
        note(source, "Portable source", null);
        Path bundle = temporary.resolve("schema-mismatch");
        assertThat(export(bundle).ready()).isTrue();
        int checksum = target.db().sql("SELECT checksum FROM flyway_schema_history WHERE version = '8'")
                .query(Integer.class).single();
        target.db().sql("UPDATE flyway_schema_history SET checksum = checksum + 1 WHERE version = '8'").update();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
        target.db().sql("UPDATE flyway_schema_history SET checksum = :checksum, success = false WHERE version = '8'")
                .param("checksum", checksum).update();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
        target.db().sql("UPDATE flyway_schema_history SET success = true WHERE version = '8'").update();
        target.db().sql("ALTER TABLE memory ADD COLUMN unreviewed_recovery_field TEXT").update();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void deletionLifecycleWithoutMatchingWriteAheadPlanCannotBeExported() {
        var note = note(source, "Malformed deletion lifecycle must not be portable", null);
        softDelete(source, note.memory());
        source.db().sql("UPDATE memory SET purge_started_at = :at WHERE id = :id")
                .param("at", time(NOW.minusSeconds(1))).param("id", note.memory()).update();
        assertThatThrownBy(() -> export(temporary.resolve("unrecorded-started-purge")))
                .isInstanceOf(RecoveryException.class);
        source.db().sql("UPDATE memory SET purged_at = :at, text_content = NULL WHERE id = :id")
                .param("at", time(NOW)).param("id", note.memory()).update();
        assertThatThrownBy(() -> export(temporary.resolve("unrecorded-completed-purge")))
                .isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void unavailableCurrentDeletionAuthorityFailsClosedEvenForOtherwiseValidBundle() {
        photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("missing-authority");
        assertThat(export(bundle).ready()).isTrue();
        sourceStorage.failLedger = true;
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void futureCurrentDeletionEvidenceIsRejectedBeforeMetadataOrOriginalWrites() {
        var note = note(source, "Must remain private in source only", null);
        Path bundle = temporary.resolve("future-authority");
        assertThat(export(bundle).ready()).isTrue();
        var future = new DeletionRecord(note.memory(), note.contribution(), null,
                SubmissionKeyDigest.sha256(note.key()),
                NOW.plusSeconds(30), NOW.plusSeconds(60));
        sourceStorage.records.put(future.memoryId(), future);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void cyclicAuthorityPaginationIsRejectedBeforeAnyWrites() {
        note(source, "Valid portable note", null);
        Path bundle = temporary.resolve("cyclic-authority");
        assertThat(export(bundle).ready()).isTrue();
        DeletionStorage malformed = new DeletionStorage() {
            @Override
            public void record(DeletionRecord record) {
                throw new AssertionError("Authority is read-only.");
            }

            @Override
            public Page ledger(String cursor, int limit) {
                return new Page(List.of(), "same-cursor");
            }

            @Override
            public void deleteOriginal(UUID id) {
                throw new AssertionError("Authority is read-only.");
            }

            @Override
            public void deleteStaging(UUID id) {
                throw new AssertionError("Authority is read-only.");
            }
        };
        assertThatThrownBy(
                () -> recovery(target, targetStorage, malformed, targetStorage, NOW.plusSeconds(1)).restoreFrom(bundle))
                .isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void backedUpDeletionEvidenceMustStillExistInIndependentCurrentAuthority() {
        var note = note(source, "Previously deleted note", "Deleted guest");
        softDelete(source, note.memory());
        assertThat(new RetentionService(source.retention(), sourceStorage, fixed(NOW)).purgeBatch(100))
                .isEqualTo(new RetentionService.Batch(1, 0));
        Path bundle = temporary.resolve("backed-up-deletion");
        assertThat(export(bundle).ready()).isTrue();
        sourceStorage.records.clear();
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void changedAuthorityIdentityCannotReplaceAnExactBackedUpDeletionRecord() {
        var note = note(source, "Previously erased private text", null);
        softDelete(source, note.memory());
        assertThat(new RetentionService(source.retention(), sourceStorage, fixed(NOW)).purgeBatch(100))
                .isEqualTo(new RetentionService.Batch(1, 0));
        Path bundle = temporary.resolve("changed-deletion");
        assertThat(export(bundle).ready()).isTrue();
        var old = sourceStorage.records.get(note.memory());
        sourceStorage.records.put(old.memoryId(), new DeletionRecord(old.memoryId(), UUID.randomUUID(), old.assetId(),
                old.submissionKeyDigest(), old.deleteAfter(), old.recordedAt()));
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void currentDeletionCannotEraseAnAssetOwnedByAnotherBundledSibling() {
        var batch = photos(source, sourceStorage, "UPLOADED", "UPLOADED");
        Path bundle = temporary.resolve("wrong-asset-owner");
        assertThat(export(bundle).ready()).isTrue();
        var wrong = new DeletionRecord(batch.memories().getFirst(), batch.contribution(), batch.assets().get(1),
                SubmissionKeyDigest.sha256(batch.key()), NOW.minusSeconds(1), NOW);
        sourceStorage.records.put(wrong.memoryId(), wrong);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void conflictingExistingDestinationObjectCannotBeOverwrittenByRestoreRetry() {
        var batch = photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("conflicting-original");
        assertThat(export(bundle).ready()).isTrue();
        String key = "originals/" + batch.assets().getFirst();
        byte[] conflicting = png(9);
        targetStorage.objects.put(key, conflicting);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        for (String table : TABLES)
            assertThat(count(target, table)).as(table).isZero();
        assertThat(targetStorage.objects).hasSize(1);
        assertThat(targetStorage.objects.get(key)).isEqualTo(conflicting);
        assertThat(targetStorage.records).isEmpty();
        assertThat(targetStorage.publications).isEmpty();
    }

    @Test
    void racingDestinationPublicationCannotOverwriteCompetingBytesOrCommitMetadata() {
        var batch = photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("racing-destination-original");
        assertThat(export(bundle).ready()).isTrue();
        byte[] competing = png(11);
        targetStorage.competingBytes = competing;
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        for (String table : TABLES)
            assertThat(count(target, table)).as(table).isZero();
        assertThat(targetStorage.objects).hasSize(1);
        assertThat(targetStorage.objects.get("originals/" + batch.assets().getFirst())).isEqualTo(competing);
        assertThat(targetStorage.records).isEmpty();
        assertThat(targetStorage.publications).isEmpty();
    }

    @Test
    void manifestDuplicateKeysUnknownFieldsAndTrailingJsonAreRejectedBeforeWrites() throws Exception {
        note(source, "Valid source remains local", null);
        int index = 0;
        for (String addition : List.of("\"version\":1,", "\"unreviewedField\":true,", "TRAILING")) {
            Path bundle = temporary.resolve("strict-manifest-" + index++);
            assertThat(export(bundle).ready()).isTrue();
            Path manifest = bundle.resolve("manifest.json");
            String original = Files.readString(manifest);
            String mutated = addition.equals("TRAILING") ? original + " true"
                    : original.replaceFirst("\\{", "{" + addition);
            Files.writeString(manifest, mutated);
            assertThatThrownBy(() -> restore(bundle)).as(addition).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void alteredOriginalAndMetadataHashesFailBeforeAnyTargetWrites() throws Exception {
        var batch = photos(source, sourceStorage, "UPLOADED");
        Path photoBundle = temporary.resolve("tampered-original");
        assertThat(export(photoBundle).ready()).isTrue();
        Files.write(photoBundle.resolve("originals").resolve(batch.assets().getFirst().toString()), png(10));
        assertThatThrownBy(() -> restore(photoBundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();

        Path metadataBundle = temporary.resolve("tampered-metadata");
        assertThat(export(metadataBundle).ready()).isTrue();
        Path metadata = metadataBundle.resolve("metadata.json");
        Files.writeString(metadata,
                Files.readString(metadata).replace("Synthetic caption 0", "Tampered private caption"));
        assertThatThrownBy(() -> restore(metadataBundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void unlistedExtraFileInBundleIsRejectedBeforeAnyWrites() throws Exception {
        note(source, "Valid source", null);
        Path bundle = temporary.resolve("extra-file");
        assertThat(export(bundle).ready()).isTrue();
        Files.writeString(bundle.resolve("unlisted-private-extra.json"), "{}");
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    @Test
    void rehashedMetadataStillRejectsUnknownFieldsDuplicateIdentityAndInvalidStates() throws Exception {
        photos(source, sourceStorage, "UPLOADED", "PENDING");
        int index = 0;
        for (String mutation : List.of("UNKNOWN_FIELD", "DUPLICATE_ID", "INVALID_STATE", "WRONG_OWNER",
                "BAD_PENDING_FORMAT")) {
            Path bundle = temporary.resolve("rehashed-metadata-" + index++);
            assertThat(export(bundle).ready()).isTrue();
            ObjectNode metadata = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("metadata.json")));
            var tables = metadata.get("tables");
            ObjectNode firstMemory = (ObjectNode) tables.get("memory").get(0);
            ObjectNode firstAsset = (ObjectNode) tables.get("media_asset").get(0);
            ObjectNode secondAsset = (ObjectNode) tables.get("media_asset").get(1);
            switch (mutation) {
                case "UNKNOWN_FIELD" -> firstMemory.put("unexpectedPrivateField", "fixture");
                case "DUPLICATE_ID" ->
                    ((ObjectNode) tables.get("memory").get(1)).put("id", firstMemory.get("id").asString());
                case "INVALID_STATE" -> firstAsset.put("upload_state", "SILENTLY_COMPLETE");
                case "WRONG_OWNER" -> firstAsset.put("memory_id", secondAsset.get("memory_id").asString());
                case "BAD_PENDING_FORMAT" -> {
                    ObjectNode pending = "PENDING".equals(firstAsset.get("upload_state").asString()) ? firstAsset
                            : secondAsset;
                    pending.put("detected_format", "image/png");
                }
                default -> throw new IllegalStateException("Unknown test mutation.");
            }
            rewriteMetadataDigest(bundle, metadata);
            assertThatThrownBy(() -> restore(bundle)).as(mutation).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    void manifestTraversalAndAbsoluteObjectPathsAreRejectedBeforeAnyWrites() throws Exception {
        photos(source, sourceStorage, "UPLOADED");
        int index = 0;
        for (String assetId : List.of("../outside", "/tmp/private-file", "C:\\outside\\private-file")) {
            Path bundle = temporary.resolve("traversal-" + index++);
            assertThat(export(bundle).ready()).isTrue();
            ObjectNode manifest = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
            ((ObjectNode) manifest.get("originals").get(0)).put("assetId", assetId);
            Files.write(bundle.resolve("manifest.json"), JSON.writeValueAsBytes(manifest));
            assertThatThrownBy(() -> restore(bundle)).as(assetId).isInstanceOf(RecoveryException.class);
            assertEmptyTarget();
        }
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    void symlinkedOriginalAndSymlinkedBundleRootAreRejectedBeforeAnyWrites() throws Exception {
        var batch = photos(source, sourceStorage, "UPLOADED");
        Path bundle = temporary.resolve("symlinked-original");
        assertThat(export(bundle).ready()).isTrue();
        Path original = bundle.resolve("originals").resolve(batch.assets().getFirst().toString());
        Path outside = temporary.resolve("outside-private-original");
        Files.move(original, outside);
        Files.createSymbolicLink(original, outside);
        assertThatThrownBy(() -> restore(bundle)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();

        Path clean = temporary.resolve("real-bundle-root");
        assertThat(export(clean).ready()).isTrue();
        Path linked = temporary.resolve("linked-bundle-root");
        Files.createSymbolicLink(linked, clean);
        assertThatThrownBy(() -> restore(linked)).isInstanceOf(RecoveryException.class);
        assertEmptyTarget();
    }

    private static void rewriteMetadataDigest(Path bundle, ObjectNode metadata) throws Exception {
        byte[] encoded = JSON.writeValueAsBytes(metadata);
        Files.write(bundle.resolve("metadata.json"), encoded);
        ObjectNode manifest = (ObjectNode) JSON.readTree(Files.readAllBytes(bundle.resolve("manifest.json")));
        ((ObjectNode) manifest.get("metadata")).put("byteSize", encoded.length).put("sha256", hash(encoded));
        Files.write(bundle.resolve("manifest.json"), JSON.writeValueAsBytes(manifest));
    }

    private static void assertPrivateBundle(Path bundle) throws Exception {
        try (var files = Files.walk(bundle)) {
            for (Path path : files.toList()) {
                var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class);
                if (posix != null) {
                    Set<PosixFilePermission> expected = Files.isDirectory(path)
                            ? Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                                    PosixFilePermission.OWNER_EXECUTE)
                            : Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
                    assertThat(posix.readAttributes().permissions()).as(path.getFileName().toString())
                            .isEqualTo(expected);
                } else {
                    var acl = Files.getFileAttributeView(path, AclFileAttributeView.class);
                    assertThat(acl).isNotNull();
                    var owner = acl.getOwner();
                    assertThat(acl.getAcl()).filteredOn(entry -> entry.type() == AclEntryType.ALLOW).isNotEmpty()
                            .allSatisfy(entry -> assertThat(entry.principal()).isEqualTo(owner));
                }
            }
        }
    }

    private OperatorRecovery.ExportResult export(Path bundle) {
        return recovery(source, sourceStorage, sourceStorage, sourceStorage, NOW).exportTo(bundle);
    }

    private OperatorRecovery.RestoreResult restore(Path bundle) {
        return recovery(target, targetStorage, sourceStorage, targetStorage, NOW.plusSeconds(1)).restoreFrom(bundle);
    }

    private static OperatorRecovery recovery(Fixture db, MemoryStorage objects, DeletionStorage authority,
            DeletionStorage destination, Instant now) {
        return new OperatorRecovery(db.source(), objects, authority, destination, fixed(now));
    }

    private void assertEmptyTarget() {
        for (var table : RecoverySchema.tables(target.version()))
            assertThat(count(target, table.name())).as(table.name()).isZero();
        assertThat(targetStorage.objects).isEmpty();
        assertNoTargetMutations();
    }

    private void assertNoTargetMutations() {
        assertThat(targetStorage.records).isEmpty();
        assertThat(targetStorage.publications).isEmpty();
        assertThat(targetStorage.operations).noneMatch(operation -> operation.startsWith("publish:")
                || operation.startsWith("record:") || operation.startsWith("delete-"));
    }

    // Existing recovery fixtures exercise V8–V13 bundle compatibility; V14 sharing
    // has its own case.
    private Fixture schema() {
        return schema("13");
    }

    private Fixture schema(String migrationTarget) {
        String schema = "recovery_" + UUID.randomUUID().toString().replace("-", "");
        schemas.add(schema);
        String url = postgres.getJdbcUrl() + (postgres.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema="
                + schema;
        var data = new DriverManagerDataSource(url, postgres.getUsername(), postgres.getPassword());
        var migration = Flyway.configure().dataSource(data).schemas(schema).defaultSchema(schema);
        if (migrationTarget != null)
            migration.target(migrationTarget);
        migration.load().migrate();
        var db = JdbcClient.create(data);
        var manager = new JdbcTransactionManager(data);
        var contributions = new ContributionRepository(db);
        int version = migrationTarget == null ? 7 : Math.min(Integer.parseInt(migrationTarget), 14) - 7;
        return new Fixture(data, db, contributions, new PhotoRepository(db, contributions, fixed(NOW),
                new PhotoAdmissionPolicy(false, 7_500_000_000L, 7_500_000_000L)),
                new RetentionRepository(db, manager, version >= 3, version >= 4, version >= 5, version >= 6),
                new TransactionTemplate(manager), version);
    }

    private static Text note(Fixture fixture, String message, String guest) {
        String key = UUID.randomUUID().toString();
        var saved = fixture.tx().execute(ignored -> fixture.contributions().saveTextContribution(
                "kevin-mel-wedding", guest, message, key));
        normalize(fixture, saved.contributionId(), List.of(saved.memoryId()));
        return new Text(saved.contributionId(), saved.memoryId(), key, message, guest);
    }

    private static PhotoBatch photos(Fixture fixture, MemoryStorage storage, String... states) {
        var items = new ArrayList<PhotoRequest.Item>();
        var bytes = new ArrayList<byte[]>();
        for (int index = 0; index < states.length; index++) {
            byte[] content = png(index + 1);
            bytes.add(content);
            items.add(new PhotoRequest.Item(UUID.randomUUID(), "private-name-" + index + ".png",
                    "image/png", content.length, hash(content), "Synthetic caption " + index));
        }
        var request = new PhotoRequest("Synthetic grouped guest", List.copyOf(items));
        String key = UUID.randomUUID().toString();
        var saved = fixture.tx().execute(ignored -> fixture.photos().create(request, key));
        var memories = saved.receipt().memories().stream().map(item -> item.memoryId()).toList();
        var assets = new ArrayList<UUID>();
        for (int index = 0; index < states.length; index++) {
            UUID asset = fixture.db().sql("SELECT id FROM media_asset WHERE memory_id = :memory")
                    .param("memory", memories.get(index)).query(UUID.class).single();
            assets.add(asset);
            fixture.db().sql("""
                    UPDATE media_asset SET upload_state = :state, detected_format = :format,
                        created_at = :at, updated_at = :at WHERE id = :asset
                    """).param("state", states[index])
                    .param("format", "UPLOADED".equals(states[index]) ? "image/png" : "unverified")
                    .param("at", time(NOW.minusSeconds(3600))).param("asset", asset).update();
            if ("UPLOADED".equals(states[index]))
                storage.objects.put("originals/" + asset, bytes.get(index));
        }
        normalize(fixture, saved.receipt().contributionId(), memories);
        return new PhotoBatch(saved.receipt().contributionId(), key, request, memories, assets, bytes);
    }

    private static Voice audio(Fixture fixture, MemoryStorage storage, String type, String state) {
        byte[] bytes = AudioFixtures.audio(type, 1.0);
        UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID(), asset = UUID.randomUUID();
        String key = UUID.randomUUID().toString();
        var verified = new AudioVerifier().verify(bytes, new PhotoRepository.Asset(asset, "originals/" + asset,
                type, bytes.length, hash(bytes), "UPLOADED", "AUDIO", 60_000L));
        fixture.db().sql("""
                INSERT INTO contribution(id, event_key, guest_name, idempotency_key, created_at, request_fingerprint)
                VALUES (:id, 'kevin-mel-wedding', 'Synthetic voice guest', :key, :at, :fingerprint)
                """).param("id", contribution).param("key", key).param("at", time(NOW.minusSeconds(3600)))
                .param("fingerprint", "a".repeat(64)).update();
        fixture.db()
                .sql("""
                        INSERT INTO memory(id, contribution_id, memory_type, client_item_id, caption, item_position, created_at, updated_at)
                        VALUES (:id, :contribution, 'AUDIO', :client, 'Synthetic voice caption', 0, :at, :at)
                        """)
                .param("id", memory).param("contribution", contribution).param("client", UUID.randomUUID())
                .param("at", time(NOW.minusSeconds(3600))).update();
        boolean uploaded = "UPLOADED".equals(state);
        fixture.db().sql("""
                INSERT INTO media_asset(id, memory_id, object_key, original_filename, detected_format, byte_size,
                    checksum_sha256, upload_state, created_at, updated_at, declared_content_type, expected_byte_size,
                    expected_checksum_sha256, expected_duration_ms, audio_duration_ms, audio_codec, audio_container)
                VALUES (:id, :memory, :key, 'synthetic-voice-original', :format, :size, :hash, :state, :at, :at,
                    :type, :size, :hash, 60000, :duration, :codec, :container)
                """).param("id", asset).param("memory", memory).param("key", "originals/" + asset)
                .param("format", uploaded ? type : "unverified")
                .param("size", bytes.length).param("hash", hash(bytes)).param("state", state)
                .param("at", time(NOW.minusSeconds(3600)))
                .param("type", type).param("duration", uploaded ? verified.durationMs() : null)
                .param("codec", uploaded ? verified.codec() : null)
                .param("container", uploaded ? verified.container() : null).update();
        if (uploaded)
            storage.objects.put("originals/" + asset, bytes);
        return new Voice(contribution, memory, asset, key, bytes, verified);
    }

    private static PhotoBatch legacyPhotos(Fixture fixture, MemoryStorage storage, String... states) {
        UUID contribution = UUID.randomUUID();
        String key = UUID.randomUUID().toString();
        var items = new ArrayList<PhotoRequest.Item>();
        var memories = new ArrayList<UUID>();
        var assets = new ArrayList<UUID>();
        var originals = new ArrayList<byte[]>();
        for (int index = 0; index < states.length; index++) {
            byte[] bytes = png(index + 1);
            originals.add(bytes);
            items.add(new PhotoRequest.Item(UUID.randomUUID(), "synthetic-legacy-" + index + ".png", "image/png",
                    bytes.length, hash(bytes), "Synthetic legacy caption " + index));
        }
        var request = new PhotoRequest(null, List.copyOf(items));
        fixture.db().sql("""
                INSERT INTO contribution(id, event_key, idempotency_key, created_at, request_fingerprint)
                VALUES (:id, 'kevin-mel-wedding', :key, :at, :fingerprint)
                """).param("id", contribution).param("key", key).param("at", time(NOW.minusSeconds(3600)))
                .param("fingerprint", request.fingerprint()).update();
        for (int index = 0; index < states.length; index++) {
            UUID memory = UUID.randomUUID(), asset = UUID.randomUUID();
            memories.add(memory);
            assets.add(asset);
            var item = items.get(index);
            byte[] bytes = originals.get(index);
            fixture.db()
                    .sql("""
                            INSERT INTO memory(id, contribution_id, memory_type, client_item_id, caption, item_position, created_at, updated_at)
                            VALUES (:id, :contribution, 'PHOTO', :client, :caption, :position, :at, :at)
                            """)
                    .param("id", memory).param("contribution", contribution).param("client", item.clientItemId())
                    .param("caption", item.caption()).param("position", index).param("at", time(NOW.minusSeconds(3600)))
                    .update();
            fixture.db()
                    .sql("""
                            INSERT INTO media_asset(id, memory_id, object_key, original_filename, detected_format, byte_size,
                                checksum_sha256, upload_state, created_at, updated_at, declared_content_type, expected_byte_size, expected_checksum_sha256)
                            VALUES (:id, :memory, :key, :filename, :format, :size, :hash, :state, :at, :at, 'image/png', :size, :hash)
                            """)
                    .param("id", asset).param("memory", memory).param("key", "originals/" + asset)
                    .param("filename", item.originalFilename())
                    .param("format", "UPLOADED".equals(states[index]) ? "image/png" : "unverified")
                    .param("size", bytes.length).param("hash", hash(bytes)).param("state", states[index])
                    .param("at", time(NOW.minusSeconds(3600))).update();
            if ("UPLOADED".equals(states[index]))
                storage.objects.put("originals/" + asset, bytes);
        }
        return new PhotoBatch(contribution, key, request, memories, assets, originals);
    }

    private static Text legacyNote(Fixture fixture, String message) {
        UUID contribution = UUID.randomUUID(), memory = UUID.randomUUID();
        String key = UUID.randomUUID().toString();
        fixture.db().sql("""
                INSERT INTO contribution(id, event_key, idempotency_key, created_at, request_fingerprint)
                VALUES (:id, 'kevin-mel-wedding', :key, :at, :fingerprint)
                """).param("id", contribution).param("key", key).param("at", time(NOW.minusSeconds(3600)))
                .param("fingerprint", "a".repeat(64)).update();
        fixture.db().sql("""
                INSERT INTO memory(id, contribution_id, memory_type, text_content, created_at, updated_at)
                VALUES (:id, :contribution, 'TEXT', :message, :at, :at)
                """).param("id", memory).param("contribution", contribution).param("message", message)
                .param("at", time(NOW.minusSeconds(3600))).update();
        return new Text(contribution, memory, key, message, null);
    }

    private static void normalize(Fixture fixture, UUID contribution, List<UUID> memories) {
        fixture.db().sql("UPDATE contribution SET created_at = :at WHERE id = :id")
                .param("at", time(NOW.minusSeconds(3600))).param("id", contribution).update();
        for (UUID memory : memories)
            fixture.db().sql("UPDATE memory SET created_at = :at, updated_at = :at WHERE id = :id")
                    .param("at", time(NOW.minusSeconds(3600))).param("id", memory).update();
    }

    private static void coupleAttribution(Fixture fixture, UUID contribution, UUID author) {
        fixture.db().sql(
                "UPDATE contribution SET source='COUPLE',author_account_id=:author,guest_name=NULL,idempotency_key=:key WHERE id=:id")
                .param("author", author)
                .param("key", "couple:" + SubmissionKeyDigest.sha256(author + ":" + UUID.randomUUID()))
                .param("id", contribution).update();
    }

    private static void metadata(Fixture fixture, UUID memory, String title, String description, String date,
            String precision) {
        fixture.db().sql(
                "UPDATE memory SET title=:title,description=:description,memory_date=:date,date_precision=:precision WHERE id=:id")
                .param("title", title).param("description", description).param("date", date)
                .param("precision", precision)
                .param("id", memory).update();
    }

    private static UUID album(Fixture fixture, String name, boolean deleted) {
        UUID id = UUID.randomUUID();
        fixture.db().sql("""
                INSERT INTO album(id,name,visibility,revision,created_at,updated_at,deleted_at)
                VALUES(:id,:name,'COUPLE_ONLY',:revision,:created,:updated,:deleted)
                """).param("id", id).param("name", name).param("revision", UUID.randomUUID())
                .param("created", time(NOW.minusSeconds(3600)))
                .param("updated", time(NOW.minusSeconds(deleted ? 60 : 3600)))
                .param("deleted", deleted ? time(NOW.minusSeconds(60)) : null).update();
        return id;
    }

    private static void member(Fixture fixture, UUID album, UUID memory, long position) {
        fixture.db().sql("INSERT INTO album_membership(album_id,memory_id,position) VALUES(:album,:memory,:position)")
                .param("album", album).param("memory", memory).param("position", position).update();
    }

    private static List<UUID> members(Fixture fixture, UUID album) {
        return fixture.db().sql("SELECT memory_id FROM album_membership WHERE album_id=:id ORDER BY position,memory_id")
                .param("id", album).query(UUID.class).list();
    }

    private static UUID albumRevision(Fixture fixture, UUID album) {
        return fixture.db().sql("SELECT revision FROM album WHERE id=:id").param("id", album).query(UUID.class)
                .single();
    }

    private static UUID tag(Fixture fixture, String name, boolean deleted) {
        UUID id = UUID.randomUUID();
        fixture.db().sql("""
                INSERT INTO tag(id,name,visibility,revision,created_at,updated_at,deleted_at)
                VALUES(:id,:name,'COUPLE_ONLY',:revision,:created,:updated,:deleted)
                """).param("id", id).param("name", name).param("revision", UUID.randomUUID())
                .param("created", time(NOW.minusSeconds(3600)))
                .param("updated", time(NOW.minusSeconds(60)))
                .param("deleted", deleted ? time(NOW.minusSeconds(60)) : null).update();
        return id;
    }

    private static void tagMember(Fixture fixture, UUID tag, UUID memory) {
        fixture.db().sql("INSERT INTO memory_tag(tag_id,memory_id) VALUES(:tag,:memory)").param("tag", tag)
                .param("memory", memory).update();
    }

    private static List<UUID> tagMembers(Fixture fixture, UUID tag) {
        return fixture.db().sql("SELECT memory_id FROM memory_tag WHERE tag_id=:id ORDER BY memory_id").param("id", tag)
                .query(UUID.class).list();
    }

    private static UUID tagRevision(Fixture fixture, UUID tag) {
        return fixture.db().sql("SELECT revision FROM tag WHERE id=:id").param("id", tag).query(UUID.class).single();
    }

    private static UUID timelineEvent(Fixture fixture, String title, String description, String date, String precision,
            boolean deleted) {
        fixture.db().sql(
                "INSERT INTO timeline_state(id,revision,updated_at) VALUES(1,:revision,:at) ON CONFLICT(id) DO NOTHING")
                .param("revision", UUID.randomUUID()).param("at", time(NOW.minusSeconds(1))).update();
        UUID id = UUID.randomUUID();
        fixture.db()
                .sql("""
                        INSERT INTO timeline_event(id,title,description,event_date,date_precision,visibility,revision,created_at,updated_at,deleted_at)
                        VALUES(:id,:title,:description,:date,:precision,'COUPLE_ONLY',:revision,:created,:updated,:deleted)
                        """)
                .param("id", id).param("title", title).param("description", description).param("date", date)
                .param("precision", precision)
                .param("revision", UUID.randomUUID()).param("created", time(NOW.minusSeconds(3600)))
                .param("updated", time(NOW.minusSeconds(deleted ? 60 : 3600)))
                .param("deleted", deleted ? time(NOW.minusSeconds(60)) : null).update();
        return id;
    }

    private static void timelineMember(Fixture fixture, UUID event, UUID memory) {
        fixture.db().sql("INSERT INTO timeline_event_memory(event_id,memory_id) VALUES(:event,:memory)")
                .param("event", event).param("memory", memory).update();
    }

    private static List<UUID> timelineMembers(Fixture fixture, UUID event) {
        return fixture.db().sql("SELECT memory_id FROM timeline_event_memory WHERE event_id=:id ORDER BY memory_id")
                .param("id", event).query(UUID.class).list();
    }

    private static UUID timelineRevision(Fixture fixture, UUID event) {
        return fixture.db().sql("SELECT revision FROM timeline_event WHERE id=:id").param("id", event).query(UUID.class)
                .single();
    }

    private static UUID timelineListRevision(Fixture fixture) {
        return fixture.db().sql("SELECT revision FROM timeline_state WHERE id=1").query(UUID.class).single();
    }

    private static void assertArchiveDefaults(Fixture fixture) {
        assertThat(fixture.db()
                .sql("SELECT COUNT(*) FROM contribution WHERE source <> 'GUEST' OR author_account_id IS NOT NULL")
                .query(Long.class).single()).isZero();
        assertThat(fixture.db().sql(
                "SELECT COUNT(*) FROM memory WHERE title IS NOT NULL OR description IS NOT NULL OR memory_date IS NOT NULL OR date_precision <> 'UNKNOWN'")
                .query(Long.class).single()).isZero();
    }

    private static UUID grant(Fixture fixture, UUID asset, Instant created, Instant expires) {
        UUID id = UUID.randomUUID();
        fixture.db().sql("""
                INSERT INTO upload_grant(id, media_asset_id, object_key, created_at, expires_at)
                VALUES (:id, :asset, :key, :created, :expires)
                """).param("id", id).param("asset", asset).param("key", "staging/" + id)
                .param("created", time(created)).param("expires", time(expires)).update();
        return id;
    }

    private static void review(Fixture fixture, UUID memory, String state, int revision) {
        fixture.db().sql("UPDATE memory SET review_status = :state, revision = :revision WHERE id = :id")
                .param("state", state).param("revision", revision).param("id", memory).update();
        fixture.db().sql("""
                INSERT INTO review_audit(memory_id, actor_account_id, from_status, to_status,
                    before_revision, after_revision, acted_at)
                VALUES (:memory, :actor, 'PENDING', :state, 1, :revision, :at)
                """).param("memory", memory).param("actor", UUID.randomUUID()).param("state", state)
                .param("revision", revision).param("at", time(NOW.minusSeconds(60))).update();
    }

    private static void softDelete(Fixture fixture, UUID memory) {
        fixture.db().sql("""
                UPDATE memory SET review_status = 'DELETE', delete_after = :deadline,
                    created_at = :created, updated_at = :decided WHERE id = :id
                """).param("deadline", time(NOW.minusSeconds(1))).param("created", time(NOW.minusSeconds(40L * 86400)))
                .param("decided", time(NOW.minusSeconds(30L * 86400 + 1))).param("id", memory).update();
    }

    private static Map<String, List<String>> snapshot(Fixture fixture) {
        var tables = new LinkedHashMap<String, List<String>>();
        var installed = RecoverySchema.tables(fixture.version()).stream().map(RecoverySchema.Table::name).toList();
        for (String table : TABLES)
            tables.put(table, installed.contains(table)
                    ? fixture.db().sql("SELECT row_to_json(t)::text FROM " + table + " t ORDER BY row_to_json(t)::text")
                            .query(String.class).list()
                    : List.of());
        return tables;
    }

    private static long count(Fixture fixture, String table) {
        if (!TABLES.contains(table))
            throw new IllegalArgumentException("Unsafe fixture table.");
        return fixture.db().sql("SELECT count(*) FROM " + table).query(Long.class).single();
    }

    private static String string(Fixture fixture, String sql, UUID id) {
        var rows = fixture.db().sql(sql).param("id", id).query((rs, row) -> rs.getString(1)).list();
        assertThat(rows).hasSize(1);
        return rows.getFirst();
    }

    private static byte[] png(int variant) {
        try {
            var pixels = new BufferedImage(variant + 1, 2, BufferedImage.TYPE_INT_RGB);
            pixels.setRGB(0, 0, 0x102030 * variant);
            var out = new ByteArrayOutputStream();
            ImageIO.write(pixels, "png", out);
            return out.toByteArray();
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static String hash(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static OffsetDateTime time(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static Clock fixed(Instant instant) {
        return Clock.fixed(instant, ZoneOffset.UTC);
    }

    private record Fixture(DataSource source, JdbcClient db, ContributionRepository contributions,
            PhotoRepository photos, RetentionRepository retention, TransactionTemplate tx, int version) {
    }

    private record Text(UUID contribution, UUID memory, String key, String message, String guest) {
    }

    private record PhotoBatch(UUID contribution, String key, PhotoRequest request, List<UUID> memories,
            List<UUID> assets, List<byte[]> bytes) {
    }

    private record Voice(UUID contribution, UUID memory, UUID asset, String key, byte[] bytes,
            AudioVerifier.Verified verified) {
    }

    /**
     * Durable synthetic stores are separate from each database and separate from
     * one another.
     */
    private static final class MemoryStorage implements ObjectStorage, DeletionStorage {
        final Map<String, byte[]> objects = new LinkedHashMap<>();
        final Map<UUID, DeletionRecord> records = new LinkedHashMap<>();
        final List<String> operations = new ArrayList<>();
        final List<String> publications = new ArrayList<>();
        int failPublication;
        boolean failLedger;
        byte[] competingBytes;

        @Override
        public void requireAvailable() {
        }

        @Override
        public UploadGrant authorize(UUID id, String key, String type, long size, Instant expires) {
            throw new UnsupportedOperationException("Recovery never grants browser uploads.");
        }

        @Override
        public ReadGrant authorizeRead(String key, String type, long size, Instant expires) {
            throw new UnsupportedOperationException("Recovery never signs browser reads.");
        }

        @Override
        public Optional<byte[]> read(String key, int maxBytes) {
            operations.add("read:" + key);
            byte[] bytes = objects.get(key);
            if (bytes != null && bytes.length > maxBytes)
                throw new IllegalStateException("Synthetic bound exceeded.");
            return Optional.ofNullable(bytes).map(byte[]::clone);
        }

        @Override
        public void publish(String key, byte[] bytes, String type) {
            operations.add("publish:" + key);
            if (failPublication > 0 && --failPublication == 0)
                throw new IllegalStateException("Synthetic storage unavailable.");
            if (competingBytes != null) {
                objects.put(key, competingBytes.clone());
                competingBytes = null;
            }
            byte[] old = objects.putIfAbsent(key, bytes.clone());
            if (old != null && !Arrays.equals(old, bytes))
                throw new IllegalStateException("Synthetic object conflict.");
            publications.add(key);
        }

        public void publishRecovered(String key, byte[] bytes, String type) {
            publish(key, bytes, type);
        }

        @Override
        public void record(DeletionRecord record) {
            operations.add("record:" + record.memoryId());
            var old = records.putIfAbsent(record.memoryId(), record);
            if (old != null && !old.equals(record))
                throw new IllegalStateException("Synthetic ledger conflict.");
        }

        @Override
        public Page ledger(String cursor, int limit) {
            operations.add("ledger");
            if (failLedger)
                throw new IllegalStateException("Synthetic missing authority.");
            int offset = cursor == null ? 0 : Integer.parseInt(cursor);
            var values = List.copyOf(records.values());
            int end = Math.min(values.size(), offset + limit);
            return new Page(values.subList(offset, end), end == values.size() ? null : Integer.toString(end));
        }

        @Override
        public void deleteOriginal(UUID id) {
            operations.add("delete-original:" + id);
            objects.remove("originals/" + id);
        }

        @Override
        public void deleteStaging(UUID id) {
            operations.add("delete-staging:" + id);
            objects.remove("staging/" + id);
        }
    }
}
