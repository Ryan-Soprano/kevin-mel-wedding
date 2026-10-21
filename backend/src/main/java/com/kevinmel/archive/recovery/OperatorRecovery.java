package com.kevinmel.archive.recovery;

import static com.kevinmel.archive.recovery.RecoveryMetadata.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.media.AudioVerifier;
import com.kevinmel.archive.media.MediaTypes;
import com.kevinmel.archive.media.PhotoRepository;
import com.kevinmel.archive.media.PhotoVerifier;
import com.kevinmel.archive.media.R2ObjectStorage;
import com.kevinmel.archive.retention.DeletionRecord;
import com.kevinmel.archive.retention.DeletionStorage;
import com.kevinmel.archive.retention.RetentionRepository;
import com.kevinmel.archive.retention.RetentionService;

import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Privileged offline archive data recovery. This class never listens on HTTP or
 * deletes source objects.
 */
public final class OperatorRecovery {
    private static final String ASSET_ID_FIELD = "assetId";
    private static final String AUDIO_CODEC_FIELD = "audioCodec";
    private static final String AUDIO_CONTAINER_FIELD = "audioContainer";
    private static final String AUDIO_DURATION_FIELD = "audioDurationMs";
    private static final String AUTHORITY_IDENTITY_FIELD = "authorityIdentity";
    private static final String AUTHORITY_LEDGER_FIELD = "authorityLedger";
    private static final String AVAILABLE_FIELD = "available";
    private static final String BYTE_SIZE_FIELD = "byteSize";
    private static final String CONTENT_TYPE_FIELD = "contentType";
    private static final String CONTRIBUTIONS_FIELD = "contributions";
    private static final String COUNT_QUERY_PREFIX = "SELECT COUNT(*) FROM ";
    private static final String COUNTS_FIELD = "counts";
    private static final String CREATED_AT_FIELD = "createdAt";
    private static final String EVENT_KEY_FIELD = "eventKey";
    private static final String INVALID_BUNDLE = "INVALID_BUNDLE";
    private static final String INVALID_LEDGER = "INVALID_LEDGER";
    private static final String INVALID_PATH = "INVALID_PATH";
    private static final String MANIFEST_FILE = "manifest.json";
    private static final String MEMORIES_FIELD = "memories";
    private static final String MEMORY_ID_COLUMN = "memory_id";
    private static final String MEMORY_ID_FIELD = "memoryId";
    private static final String METADATA_FIELD = "metadata";
    private static final String METADATA_FILE = "metadata.json";
    private static final String ORIGINALS_FIELD = "originals";
    private static final String ORIGINALS_PREFIX = "originals/";
    private static final String READY_FIELD = "ready";
    private static final String SCHEMA_FINGERPRINT_FIELD = "schemaFingerprint";
    private static final String SHA256_FIELD = "sha256";
    private static final String TABLES_FIELD = "tables";
    private static final String UNAVAILABLE_ORIGINALS_FIELD = "unavailableOriginals";
    private static final String VERSION_FIELD = "version";
    public static final int MAX_METADATA_BYTES = 16_777_216;
    public static final int MAX_MANIFEST_BYTES = 4_194_304;
    public static final int MAX_ORIGINALS = 10_000;
    public static final long MAX_ORIGINAL_BYTES = 7_500_000_000L;
    private static final int MAX_MEDIA_BYTES = 25_000_000;
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();
    private final JdbcClient db;
    private final JdbcTransactionManager manager;
    private final ObjectStorage storage;
    private final DeletionStorage authority;
    private final DeletionStorage target;
    private final Clock clock;
    private final String authorityIdentity;
    private final AudioVerifier audioVerifier = new AudioVerifier();

    OperatorRecovery(
            DataSource dataSource,
            ObjectStorage storage,
            DeletionStorage authority,
            DeletionStorage target,
            Clock clock) {
        this(dataSource, storage, authority, target, clock, "0".repeat(64));
    }

    /**
     * The console binds the bundle to SHA-256 of its original private provider
     * endpoint and bucket.
     */
    public OperatorRecovery(
            DataSource dataSource,
            ObjectStorage storage,
            DeletionStorage authority,
            DeletionStorage target,
            Clock clock,
            String authorityIdentity) {
        this.db = JdbcClient.create(Objects.requireNonNull(dataSource));
        this.manager = new JdbcTransactionManager(dataSource);
        this.storage = Objects.requireNonNull(storage);
        this.authority = Objects.requireNonNull(authority);
        this.target = Objects.requireNonNull(target);
        this.clock = Objects.requireNonNull(clock);
        if (authorityIdentity == null || !authorityIdentity.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Invalid recovery authority identity.");
        }
        this.authorityIdentity = authorityIdentity;
    }

    public ExportResult exportTo(Path destination) {
        try {
            Instant at = clock.instant();
            var transaction = new TransactionTemplate(manager);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
            transaction.setReadOnly(true);
            Snapshot snapshot = Objects.requireNonNull(transaction.execute(ignored -> {
                var schema = RecoverySchema.requireReviewed(db);
                return new Snapshot(schema, RecoverySchema.read(db, schema.bundleVersion()));
            }));
            int version = snapshot.schema().bundleVersion();
            var graph = new RecoveryMetadata(snapshot.tables(), at, version);
            List<DeletionRecord> ledger = readLedger(authority, at);
            graph.validatePlans(ledger, at);
            requireSuperset(ledger, graph.packagedPlans());
            if (graph.uploaded().size() > MAX_ORIGINALS) {
                throw failure("ORIGINAL_LIMIT");
            }
            Path root = newDirectory(destination);
            Path originals = createPrivateDirectory(root.resolve(ORIGINALS_FIELD));
            var jsonTables = new LinkedHashMap<String, Object>();
            snapshot.tables().forEach((name, rows) -> jsonTables.put(
                    name,
                    rows.stream().map(RecoverySchema::jsonRow).toList()));
            byte[] metadata = JSON.writeValueAsBytes(Map.of(
                    TABLES_FIELD, jsonTables,
                    AUTHORITY_LEDGER_FIELD, ledgerJson(ledger)));
            if (metadata.length > MAX_METADATA_BYTES) {
                throw failure("METADATA_LIMIT");
            }
            writePrivate(root.resolve(METADATA_FILE), metadata);
            var erasedAssets = erasedAssets(ledger);
            var objects = new ArrayList<Original>();
            int unavailable = 0, stored = 0;
            long total = 0;
            for (var asset : graph.uploaded()) {
                Original original = original(asset, false);
                if ((total += original.byteSize()) > MAX_ORIGINAL_BYTES) {
                    throw failure("ORIGINAL_LIMIT");
                }
                boolean available = false;
                if (!erasedAssets.contains(original.assetId())) {
                    available = copyExportOriginal(originals, original);
                    if (available) {
                        stored++;
                    } else {
                        unavailable++;
                    }
                }
                objects.add(original.available(available));
            }
            var report = new ExportResult(
                    unavailable == 0,
                    graph.contributions(),
                    graph.memories(),
                    stored,
                    graph.stateCount("PENDING"),
                    graph.stateCount("FAILED"),
                    unavailable);
            var manifest = new LinkedHashMap<String, Object>();
            manifest.put(VERSION_FIELD, version);
            manifest.put(EVENT_KEY_FIELD, "kevin-mel-wedding");
            manifest.put(CREATED_AT_FIELD, at.toString());
            manifest.put(SCHEMA_FINGERPRINT_FIELD, snapshot.schema().fingerprint());
            manifest.put(AUTHORITY_IDENTITY_FIELD, authorityIdentity);
            manifest.put(METADATA_FIELD, Map.of(
                    BYTE_SIZE_FIELD, metadata.length,
                    SHA256_FIELD, sha256(metadata)));
            manifest.put(READY_FIELD, report.ready());
            manifest.put(COUNTS_FIELD, counts(report, version));
            manifest.put(ORIGINALS_FIELD, objects.stream().map(object -> object.json(version)).toList());
            byte[] encoded = JSON.writeValueAsBytes(manifest);
            if (encoded.length > MAX_MANIFEST_BYTES) {
                throw failure("MANIFEST_LIMIT");
            }
            writePrivate(root.resolve(MANIFEST_FILE), encoded);
            return report;
        } catch (RecoveryException failure) {
            throw failure;
        } catch (IOException | RuntimeException failure) {
            throw failure("EXPORT_UNCONFIRMED");
        }
    }

    private boolean copyExportOriginal(Path originals, Original original) throws IOException {
        try {
            byte[] bytes = storage.read(ORIGINALS_PREFIX + original.assetId(), MAX_MEDIA_BYTES)
                    .orElseThrow(() -> failure("ORIGINAL_UNAVAILABLE"));
            verify(bytes, original);
            writePrivate(originals.resolve(original.assetId().toString()), bytes);
            return true;
        } catch (RecoveryException failure) {
            return false;
        } catch (RuntimeException failure) {
            return false;
        }
    }

    public RestoreResult restoreFrom(Path bundle) {
        try {
            Instant now = clock.instant();
            var schema = RecoverySchema.requireReviewed(db);
            Prepared prepared = preflight(bundle, schema, now);
            List<DeletionRecord> ledger = readLedger(authority, now);
            prepared.graph().validatePlans(ledger, now);
            requireSuperset(ledger, prepared.packagedAuthority());
            requireSuperset(ledger, prepared.graph().packagedPlans());
            var erased = erasedAssets(ledger);
            for (var original : prepared.originals()) {
                if (!original.available() && !erased.contains(original.assetId())) {
                    throw failure("ORIGINAL_UNAVAILABLE");
                }
            }
            // A target tombstone from a previous failed import must be identical and
            // present in current authority.
            requireSuperset(ledger, readLedger(target, now));
            var transaction = new TransactionTemplate(manager);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
            return Objects.requireNonNull(transaction.execute(ignored -> {
                requireEmptyTarget(schema);
                RecoverySchema.insert(db, prepared.tables(), schema.bundleVersion());
                verifyImportedCounts(prepared.tables(), schema.bundleVersion());
                var retention = validatedRetention(schema, ledger);
                int published = publishOriginals(prepared, erased);
                for (var plan : ledger) {
                    target.record(plan);
                }
                // Replay exactly the fully preflighted authority snapshot; never discover new
                // delete plans mid-write.
                var replay = new RetentionService(retention, new FrozenLedger(target, ledger), clock);
                int applied = replay.replayLedger();
                verifyAfterReplay(prepared.tables(), ledger, schema.bundleVersion());
                var result = new RestoreResult(
                        prepared.graph().contributions(),
                        prepared.graph().memories(),
                        published,
                        applied);
                // Relationship/constraint checks execute in the same import transaction, before
                // commit.
                db.sql("SET CONSTRAINTS ALL IMMEDIATE").update();
                return result;
            }));
        } catch (RecoveryException failure) {
            throw failure;
        } catch (IOException | RuntimeException failure) {
            throw failure("RESTORE_UNCONFIRMED");
        }
    }

    private Prepared preflight(
            Path bundle,
            RecoverySchema.Reviewed schema,
            Instant now) throws IOException {
        Path root = checkedPath(bundle);
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            throw failure(INVALID_BUNDLE);
        }
        requireEntries(root, Set.of(MANIFEST_FILE, METADATA_FILE, ORIGINALS_FIELD));
        JsonNode manifest = JSON.readTree(readPrivate(root.resolve(MANIFEST_FILE), MAX_MANIFEST_BYTES));
        int version = manifestVersion(manifest, schema);
        Instant created = Instant.parse(RecoverySchema.string(manifest.get(CREATED_AT_FIELD)));
        if (created.isAfter(now)) {
            throw failure("FUTURE_BUNDLE");
        }
        byte[] encoded = readMetadata(root, manifest);
        JsonNode metadata = JSON.readTree(encoded);
        fields(metadata, TABLES_FIELD, AUTHORITY_LEDGER_FIELD);
        var tables = RecoverySchema.decode(metadata.get(TABLES_FIELD), version);
        var graph = new RecoveryMetadata(tables, created, version);
        List<DeletionRecord> packaged = decodeLedger(metadata.get(AUTHORITY_LEDGER_FIELD), created);
        graph.validatePlans(packaged, created);
        requireSuperset(packaged, graph.packagedPlans());
        JsonNode list = manifestOriginals(manifest, graph);
        var expected = new HashMap<UUID, Original>();
        for (var asset : graph.uploaded()) {
            expected.put(uuid(asset, "id"), original(asset, false));
        }
        var objects = new ArrayList<Original>();
        var names = new HashSet<String>();
        var ids = new HashSet<UUID>();
        int available = 0, unavailable = 0;
        long bytes = 0;
        var packagedErased = erasedAssets(packaged);
        for (JsonNode entry : list) {
            Original object = decodeOriginal(entry, expected, version, ids);
            if ((bytes += object.byteSize()) > MAX_ORIGINAL_BYTES) {
                throw failure(INVALID_BUNDLE);
            }
            String idText = object.assetId().toString();
            if (object.available()) {
                names.add(idText);
                available++;
                verify(readPrivate(root.resolve(ORIGINALS_FIELD).resolve(idText), MAX_MEDIA_BYTES), object);
            } else if (!packagedErased.contains(object.assetId())) {
                unavailable++;
            }
            objects.add(object);
        }
        requireOriginalDirectory(root, names);
        var report = new ExportResult(
                unavailable == 0,
                graph.contributions(),
                graph.memories(),
                available,
                graph.stateCount("PENDING"),
                graph.stateCount("FAILED"),
                unavailable);
        verifyManifestReport(manifest, report, version);
        return new Prepared(root, tables, graph, List.copyOf(objects), packaged);
    }

    private void requireEmptyTarget(RecoverySchema.Reviewed schema) {
        // Lock every archive table together. Accounts are deliberately not replaced or
        // exported.
        var targetTables = RecoverySchema.tables(schema.bundleVersion());
        db.sql("LOCK TABLE " + String.join(",", targetTables.stream().map(table -> table.name()).toList())
                + " IN ACCESS EXCLUSIVE MODE")
                .update();
        for (var table : targetTables) {
            if (db.sql(COUNT_QUERY_PREFIX + table.name()).query(Long.class).single() != 0) {
                throw failure("TARGET_NOT_EMPTY");
            }
        }
        // Link capabilities never travel in backups and must be freshly issued after
        // recovery.
        if (schema.bundleVersion() >= 7) {
            db.sql("LOCK TABLE memory_share_link IN ACCESS EXCLUSIVE MODE").update();
            if (db.sql("SELECT COUNT(*) FROM memory_share_link").query(Long.class).single() != 0) {
                throw failure("TARGET_NOT_EMPTY");
            }
        }
    }

    private RetentionRepository validatedRetention(RecoverySchema.Reviewed schema, List<DeletionRecord> ledger) {
        var retention = new RetentionRepository(
                db,
                manager,
                schema.bundleVersion() >= 3,
                schema.bundleVersion() >= 4,
                schema.bundleVersion() >= 5,
                schema.bundleVersion() >= 6);
        // All identities and staging paths must pass before the first external
        // mutation.
        for (var plan : ledger) {
            retention.validate(plan);
            retention.grants(plan);
        }
        return retention;
    }

    private int publishOriginals(Prepared prepared, Set<UUID> erased) {
        int published = 0;
        for (var original : prepared.originals()) {
            if (erased.contains(original.assetId())) {
                continue;
            }
            publishOriginal(prepared.root(), original);
            published++;
        }
        return published;
    }

    private void publishOriginal(Path root, Original original) {
        byte[] bytes = readAgain(
                root.resolve(ORIGINALS_FIELD).resolve(original.assetId().toString()),
                MAX_MEDIA_BYTES);
        verify(bytes, original);
        var existing = storage.read(ORIGINALS_PREFIX + original.assetId(), MAX_MEDIA_BYTES);
        if (existing.isPresent()) {
            if (!MessageDigest.isEqual(existing.get(), bytes)) {
                throw failure("TARGET_OBJECT_CONFLICT");
            }
        }
        // Production performs a conditional create and verifies exact bytes/type on a
        // conflict.
        // This also revalidates MIME when a matching object predated the current
        // attempt.
        if (storage instanceof R2ObjectStorage r2) {
            r2.publishRecovered(ORIGINALS_PREFIX + original.assetId(), bytes, original.contentType());
        } else if (existing.isEmpty()) {
            storage.publish(ORIGINALS_PREFIX + original.assetId(), bytes, original.contentType());
        }
        byte[] confirmed = storage.read(ORIGINALS_PREFIX + original.assetId(), MAX_MEDIA_BYTES)
                .orElseThrow(() -> failure("TARGET_OBJECT_UNCONFIRMED"));
        verify(confirmed, original);
    }

    private int manifestVersion(JsonNode manifest, RecoverySchema.Reviewed schema) {
        fields(
                manifest,
                VERSION_FIELD,
                EVENT_KEY_FIELD,
                CREATED_AT_FIELD,
                SCHEMA_FINGERPRINT_FIELD,
                AUTHORITY_IDENTITY_FIELD,
                METADATA_FIELD,
                READY_FIELD,
                COUNTS_FIELD,
                ORIGINALS_FIELD);
        int version = manifest.path(VERSION_FIELD).isInt() ? manifest.path(VERSION_FIELD).intValue() : 0;
        if (!schema.accepts(version, RecoverySchema.string(manifest.get(SCHEMA_FINGERPRINT_FIELD)))
                || !"kevin-mel-wedding".equals(RecoverySchema.string(manifest.get(EVENT_KEY_FIELD)))
                || !authorityIdentity.equals(RecoverySchema.string(manifest.get(AUTHORITY_IDENTITY_FIELD)))
                || !manifest.get(READY_FIELD).isBoolean()) {
            throw failure(INVALID_BUNDLE);
        }
        return version;
    }

    private static byte[] readMetadata(Path root, JsonNode manifest) throws IOException {
        fields(manifest.get(METADATA_FIELD), BYTE_SIZE_FIELD, SHA256_FIELD);
        byte[] encoded = readPrivate(root.resolve(METADATA_FILE), MAX_METADATA_BYTES);
        if (integer(manifest.get(METADATA_FIELD).get(BYTE_SIZE_FIELD)) != encoded.length
                || !sha256(encoded).equals(RecoverySchema.string(manifest.get(METADATA_FIELD).get(SHA256_FIELD)))) {
            throw failure("BUNDLE_INTEGRITY");
        }
        return encoded;
    }

    private static JsonNode manifestOriginals(JsonNode manifest, RecoveryMetadata graph) {
        JsonNode list = manifest.get(ORIGINALS_FIELD);
        if (!list.isArray() || list.size() > MAX_ORIGINALS || list.size() != graph.uploaded().size()) {
            throw failure(INVALID_BUNDLE);
        }
        return list;
    }

    private static void requireOriginalFields(JsonNode entry, int version) {
        if (version == 1) {
            fields(entry, ASSET_ID_FIELD, MEMORY_ID_FIELD, BYTE_SIZE_FIELD, SHA256_FIELD, CONTENT_TYPE_FIELD, AVAILABLE_FIELD);
        } else {
            fields(
                    entry,
                    ASSET_ID_FIELD,
                    MEMORY_ID_FIELD,
                    BYTE_SIZE_FIELD,
                    SHA256_FIELD,
                    CONTENT_TYPE_FIELD,
                    AVAILABLE_FIELD,
                    AUDIO_DURATION_FIELD,
                    AUDIO_CODEC_FIELD,
                    AUDIO_CONTAINER_FIELD);
        }
    }

    private static Original decodeOriginal(JsonNode entry, Map<UUID, Original> expected, int version, Set<UUID> ids) {
        requireOriginalFields(entry, version);
        String idText = RecoverySchema.string(entry.get(ASSET_ID_FIELD));
        UUID id = UUID.fromString(idText);
        if (!id.toString().equals(idText) || !entry.get(AVAILABLE_FIELD).isBoolean() || !ids.add(id)) {
            throw failure(INVALID_BUNDLE);
        }
        String memoryText = RecoverySchema.string(entry.get(MEMORY_ID_FIELD));
        UUID memory = UUID.fromString(memoryText);
        if (!memory.toString().equals(memoryText)) {
            throw failure(INVALID_BUNDLE);
        }
        Original want = expected.get(id);
        if (want == null) {
            throw failure(INVALID_BUNDLE);
        }
        Original object = new Original(
                id,
                memory,
                integer(entry.get(BYTE_SIZE_FIELD)),
                RecoverySchema.string(entry.get(SHA256_FIELD)),
                RecoverySchema.string(entry.get(CONTENT_TYPE_FIELD)),
                entry.get(AVAILABLE_FIELD).booleanValue(),
                version == 1 ? null : nullableInteger(entry.get(AUDIO_DURATION_FIELD)),
                version == 1 ? null : nullableString(entry.get(AUDIO_CODEC_FIELD)),
                version == 1 ? null : nullableString(entry.get(AUDIO_CONTAINER_FIELD)),
                want.expectedDurationMs());
        requireOriginalMatch(want, object);
        return object;
    }

    private static void requireOriginalMatch(Original want, Original object) {
        if (!want.memoryId().equals(object.memoryId())
                || want.byteSize() != object.byteSize()
                || !want.sha256().equals(object.sha256())
                || !want.contentType().equals(object.contentType())
                || !Objects.equals(want.audioDurationMs(), object.audioDurationMs())
                || !Objects.equals(want.audioCodec(), object.audioCodec())
                || !Objects.equals(want.audioContainer(), object.audioContainer())) {
            throw failure(INVALID_BUNDLE);
        }
    }

    private static void requireOriginalDirectory(Path root, Set<String> names) throws IOException {
        Path originals = checkedPath(root.resolve(ORIGINALS_FIELD));
        if (!Files.isDirectory(originals, LinkOption.NOFOLLOW_LINKS)) {
            throw failure(INVALID_BUNDLE);
        }
        requireEntries(originals, names);
    }

    private static void verifyManifestReport(JsonNode manifest, ExportResult report, int version) {
        if (manifest.get(READY_FIELD).booleanValue() != report.ready()) {
            throw failure(INVALID_BUNDLE);
        }
        JsonNode counts = manifest.get(COUNTS_FIELD);
        if (version == 1) {
            fields(
                    counts,
                    CONTRIBUTIONS_FIELD,
                    MEMORIES_FIELD,
                    ORIGINALS_FIELD,
                    "pendingPhotos",
                    "failedPhotos",
                    UNAVAILABLE_ORIGINALS_FIELD);
        } else {
            fields(
                    counts,
                    CONTRIBUTIONS_FIELD,
                    MEMORIES_FIELD,
                    ORIGINALS_FIELD,
                    "pendingMedia",
                    "failedMedia",
                    UNAVAILABLE_ORIGINALS_FIELD);
        }
        for (var count : counts(report, version).entrySet()) {
            if (integer(counts.get(count.getKey())) != count.getValue()) {
                throw failure(INVALID_BUNDLE);
            }
        }
    }

    private static void requireLedgerPage(DeletionStorage.Page page, int recordCount) {
        if (page == null
                || page.records().size() > 100
                || recordCount + page.records().size() > RecoverySchema.MAX_ROWS) {
            throw failure(INVALID_LEDGER);
        }
    }

    private static void requireLedgerCursor(String cursor, Set<String> seen) {
        if (cursor != null
                && (cursor.isBlank() || cursor.length() > 4096 || !seen.add(cursor) || seen.size() > 1000)) {
            throw failure(INVALID_LEDGER);
        }
    }

    private static void expectedOrganizationCounts(Map<String, Long> expected, Map<String, List<Map<String, Object>>> tables, Set<UUID> erasedMemories, int version) {
        if (version >= 4) {
            expected.put("album_membership", tables.get("album_membership").stream()
                    .filter(row -> !erasedMemories.contains(uuid(row, MEMORY_ID_COLUMN))).count());
        }
        if (version >= 5) {
            expected.put("timeline_event_memory", tables.get("timeline_event_memory").stream()
                    .filter(row -> !erasedMemories.contains(uuid(row, MEMORY_ID_COLUMN))).count());
        }
        if (version >= 6) {
            expected.put("memory_tag", tables.get("memory_tag").stream()
                    .filter(row -> !erasedMemories.contains(uuid(row, MEMORY_ID_COLUMN))).count());
        }
    }

    private static List<DeletionRecord> readLedger(
            DeletionStorage storage,
            Instant now) {
        var records = new ArrayList<DeletionRecord>();
        var seen = new HashSet<String>();
        String cursor = null;
        long bytes = 0;
        do {
            var page = storage.ledger(cursor, 100);
            requireLedgerPage(page, records.size());
            for (var record : page.records()) {
                if (record == null || now.isBefore(record.recordedAt())) {
                    throw failure(INVALID_LEDGER);
                }
                if ((bytes += record.encode().length + 1L) > MAX_METADATA_BYTES) {
                    throw failure("LEDGER_LIMIT");
                }
                records.add(record);
            }
            cursor = page.nextCursor();
            requireLedgerCursor(cursor, seen);
        } while (cursor != null);
        uniquePlans(records);
        return List.copyOf(records);
    }

    private static List<DeletionRecord> decodeLedger(
            JsonNode node,
            Instant now) {
        if (node == null || !node.isArray() || node.size() > RecoverySchema.MAX_ROWS) {
            throw failure(INVALID_LEDGER);
        }
        var records = new ArrayList<DeletionRecord>();
        for (var item : node) {
            DeletionRecord record = DeletionRecord.decode(JSON.writeValueAsBytes(item));
            if (now.isBefore(record.recordedAt())) {
                throw failure(INVALID_LEDGER);
            }
            records.add(record);
        }
        uniquePlans(records);
        return List.copyOf(records);
    }

    private static void uniquePlans(List<DeletionRecord> plans) {
        var ids = new HashSet<UUID>();
        for (var plan : plans) {
            if (!ids.add(plan.memoryId())) {
                throw failure(INVALID_LEDGER);
            }
        }
    }

    private static void requireSuperset(
            List<DeletionRecord> current,
            List<DeletionRecord> packaged) {
        var byId = new HashMap<UUID, DeletionRecord>();
        for (var record : current) {
            byId.put(record.memoryId(), record);
        }
        for (var record : packaged) {
            if (!record.equals(byId.get(record.memoryId()))) {
                throw failure("LEDGER_INCOMPLETE");
            }
        }
    }

    private static List<JsonNode> ledgerJson(List<DeletionRecord> ledger) {
        return ledger.stream().map(r -> JSON.readTree(r.encode())).toList();
    }

    private static Set<UUID> erasedAssets(List<DeletionRecord> ledger) {
        var ids = new HashSet<UUID>();
        for (var record : ledger) {
            if (record.assetId() != null) {
                ids.add(record.assetId());
            }
        }
        return ids;
    }

    private void verifyImportedCounts(
            Map<String, List<Map<String, Object>>> tables,
            int version) {
        for (var table : RecoverySchema.tables(version)) {
            if (db.sql(COUNT_QUERY_PREFIX + table.name()).query(Long.class).single() != tables.get(table.name())
                    .size()) {
                throw failure("IMPORT_COUNT_MISMATCH");
            }
        }
    }

    private void verifyAfterReplay(
            Map<String, List<Map<String, Object>>> tables,
            List<DeletionRecord> ledger,
            int version) {
        var erased = erasedAssets(ledger);
        var erasedMemories = new HashSet<UUID>();
        for (var plan : ledger) {
            erasedMemories.add(plan.memoryId());
        }
        var ledgerIds = new HashSet<UUID>();
        for (var row : tables.get("deletion_ledger")) {
            ledgerIds.add(uuid(row, MEMORY_ID_COLUMN));
        }
        var keyDigests = new HashSet<String>();
        for (var row : tables.get("erased_submission_key")) {
            keyDigests.add(text(row, "key_digest"));
        }
        for (var plan : ledger) {
            ledgerIds.add(plan.memoryId());
            keyDigests.add(plan.submissionKeyDigest());
        }
        var expected = new HashMap<String, Long>();
        for (var table : RecoverySchema.tables(version)) {
            expected.put(table.name(), (long) tables.get(table.name()).size());
        }
        expected.put("media_asset", tables.get("media_asset").stream()
                .filter(a -> !erased.contains(uuid(a, "id"))).count());
        expected.put("upload_grant", tables.get("upload_grant").stream()
                .filter(g -> !erased.contains(uuid(g, "media_asset_id"))).count());
        expected.put("deletion_ledger", (long) ledgerIds.size());
        expected.put("erased_submission_key", (long) keyDigests.size());
        expectedOrganizationCounts(expected, tables, erasedMemories, version);
        for (var count : expected.entrySet()) {
            if (db.sql(COUNT_QUERY_PREFIX + count.getKey()).query(Long.class).single().longValue() != count
                    .getValue().longValue()) {
                throw failure("REPLAY_COUNT_MISMATCH");
            }
        }
        new RecoveryMetadata(RecoverySchema.read(db, version), clock.instant(), version);
    }

    private static Original original(
            Map<String, Object> row,
            boolean available) {
        return new Original(
                uuid(row, "id"),
                uuid(row, MEMORY_ID_COLUMN),
                number(row, "byte_size"),
                text(row, "checksum_sha256"),
                text(row, "detected_format"),
                available,
                (Long) row.get("audio_duration_ms"),
                text(row, "audio_codec"),
                text(row, "audio_container"),
                (Long) row.get("expected_duration_ms"));
    }

    private void verify(
            byte[] bytes,
            Original original) {
        try {
            var expected = new PhotoRepository.Asset(
                    original.assetId(),
                    ORIGINALS_PREFIX + original.assetId(),
                    original.contentType(),
                    original.byteSize(),
                    original.sha256(),
                    "UPLOADED",
                    MediaTypes.AUDIO_TYPES.contains(original.contentType()) ? "AUDIO" : "PHOTO",
                    original.expectedDurationMs());
            if (MediaTypes.AUDIO_TYPES.contains(original.contentType())) {
                var actual = audioVerifier.verify(bytes, expected);
                if (!actual.contentType().equals(original.contentType())
                        || !actual.container().equals(original.audioContainer())
                        || !actual.codec().equals(original.audioCodec())
                        || !Long.valueOf(actual.durationMs()).equals(original.audioDurationMs())) {
                    throw failure("ORIGINAL_INTEGRITY");
                }
            } else {
                new PhotoVerifier().verify(bytes, expected);
            }
        } catch (RuntimeException failure) {
            throw failure("ORIGINAL_INTEGRITY");
        }
    }

    private static Map<String, Integer> counts(
            ExportResult report,
            int version) {
        return Map.of(
                CONTRIBUTIONS_FIELD, report.contributions(),
                MEMORIES_FIELD, report.memories(),
                ORIGINALS_FIELD, report.originals(),
                version == 1 ? "pendingPhotos" : "pendingMedia", report.pendingMedia(),
                version == 1 ? "failedPhotos" : "failedMedia", report.failedMedia(),
                UNAVAILABLE_ORIGINALS_FIELD, report.unavailableOriginals());
    }

    private static Long nullableInteger(JsonNode node) {
        if (node == null) {
            throw failure(INVALID_BUNDLE);
        }
        return node.isNull() ? null : integer(node);
    }

    private static String nullableString(JsonNode node) {
        if (node == null) {
            throw failure(INVALID_BUNDLE);
        }
        return node.isNull() ? null : RecoverySchema.string(node);
    }

    private static long integer(JsonNode node) {
        if (node == null || !node.isIntegralNumber() || !node.canConvertToLong() || node.longValue() < 0) {
            throw failure(INVALID_BUNDLE);
        }
        return node.longValue();
    }

    private static void fields(
            JsonNode node,
            String... names) {
        if (node == null || !node.isObject() || node.size() != names.length) {
            throw failure(INVALID_BUNDLE);
        }
        for (String name : names) {
            if (!node.has(name)) {
                throw failure(INVALID_BUNDLE);
            }
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception failure) {
            throw failure("HASH_UNAVAILABLE");
        }
    }

    private static Path checkedPath(Path path) throws IOException {
        if (path == null) {
            throw failure(INVALID_PATH);
        }
        Path absolute = path.toAbsolutePath().normalize();
        Path current = absolute.getRoot();
        for (Path component : absolute) {
            current = current.resolve(component);
            if (Files.isSymbolicLink(current)) {
                throw failure(INVALID_PATH);
            }
            if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)
                    && !current.toRealPath(LinkOption.NOFOLLOW_LINKS).equals(current.toRealPath())) {
                throw failure(INVALID_PATH);
            }
        }
        return absolute;
    }

    private static Path newDirectory(Path path) throws IOException {
        Path root = checkedPath(path);
        Path parent = root.getParent();
        if (parent == null
                || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)
                || Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
            throw failure("DESTINATION_EXISTS");
        }
        return createPrivateDirectory(root);
    }

    private static Path createPrivateDirectory(Path path) throws IOException {
        Path created;
        if (Files.getFileAttributeView(path.getParent(), PosixFileAttributeView.class) != null) {
            created = Files.createDirectory(path,
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        } else {
            created = Files.createDirectory(path);
        }
        ownerOnly(created, true);
        return created;
    }

    private static void writePrivate(
            Path path,
            byte[] bytes) throws IOException {
        checkedPath(path);
        if (Files.getFileAttributeView(path.getParent(), PosixFileAttributeView.class) != null) {
            Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        } else {
            Files.createFile(path);
        }
        ownerOnly(path, false);
        Files.write(path, bytes, StandardOpenOption.WRITE);
    }

    private static void ownerOnly(
            Path path,
            boolean directory) throws IOException {
        var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (posix != null) {
            var permissions = PosixFilePermissions.fromString(directory ? "rwx------" : "rw-------");
            posix.setPermissions(permissions);
            if (!posix.readAttributes().permissions().equals(permissions)) {
                throw failure("PRIVATE_PERMISSIONS_UNCONFIRMED");
            }
            return;
        }
        var acl = Files.getFileAttributeView(path, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (acl == null) {
            throw failure("PRIVATE_PERMISSIONS_UNAVAILABLE");
        }
        var owner = acl.getOwner();
        acl.setAcl(List.of(AclEntry.newBuilder()
                .setType(AclEntryType.ALLOW)
                .setPrincipal(owner)
                .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                .build()));
        if (acl.getAcl().stream().anyMatch(entry -> entry.type() == AclEntryType.ALLOW
                && !entry.principal().equals(owner))) {
            throw failure("PRIVATE_PERMISSIONS_UNCONFIRMED");
        }
    }

    private static byte[] readPrivate(
            Path path,
            int max) throws IOException {
        checkedPath(path);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > max) {
            throw failure("INVALID_BUNDLE_FILE");
        }
        try (var input = Files.newInputStream(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes = input.readNBytes(max + 1);
            if (bytes.length == 0 || bytes.length > max) {
                throw failure("INVALID_BUNDLE_FILE");
            }
            return bytes;
        }
    }

    private static byte[] readAgain(
            Path path,
            int max) {
        try {
            return readPrivate(path, max);
        } catch (IOException failure) {
            throw failure("BUNDLE_READ_UNCONFIRMED");
        }
    }

    private static void requireEntries(
            Path directory,
            Set<String> expected) throws IOException {
        var names = new HashSet<String>();
        try (var stream = Files.newDirectoryStream(directory)) {
            for (var entry : stream) {
                checkedPath(entry);
                if (!names.add(entry.getFileName().toString()) || names.size() > MAX_ORIGINALS + 3) {
                    throw failure(INVALID_BUNDLE);
                }
            }
        }
        if (!names.equals(expected)) {
            throw failure(INVALID_BUNDLE);
        }
    }

    private static RecoveryException failure(String code) {
        return new RecoveryException(code);
    }

    public record ExportResult(
            boolean ready,
            int contributions,
            int memories,
            int originals,
            int pendingMedia,
            int failedMedia,
            int unavailableOriginals) {
    }

    public record RestoreResult(
            int contributions,
            int memories,
            int originals,
            int replayedDeletions) {
    }

    private record Snapshot(
            RecoverySchema.Reviewed schema,
            Map<String, List<Map<String, Object>>> tables) {
        @Override
        public String toString() {
            return "RecoverySnapshot[redacted]";
        }
    }

    private record Prepared(
            Path root,
            Map<String, List<Map<String, Object>>> tables,
            RecoveryMetadata graph,
            List<Original> originals,
            List<DeletionRecord> packagedAuthority) {
        @Override
        public String toString() {
            return "PreparedRecovery[redacted]";
        }
    }

    private record Original(
            UUID assetId,
            UUID memoryId,
            long byteSize,
            String sha256,
            String contentType,
            boolean available,
            Long audioDurationMs,
            String audioCodec,
            String audioContainer,
            Long expectedDurationMs) {
        Original available(boolean value) {
            return new Original(
                    assetId,
                    memoryId,
                    byteSize,
                    sha256,
                    contentType,
                    value,
                    audioDurationMs,
                    audioCodec,
                    audioContainer,
                    expectedDurationMs);
        }

        Map<String, Object> json(int version) {
            var result = new LinkedHashMap<String, Object>(Map.of(
                    ASSET_ID_FIELD, assetId.toString(),
                    MEMORY_ID_FIELD, memoryId.toString(),
                    BYTE_SIZE_FIELD, byteSize,
                    SHA256_FIELD, sha256,
                    CONTENT_TYPE_FIELD, contentType,
                    AVAILABLE_FIELD, available));
            if (version >= 2) {
                result.put(AUDIO_DURATION_FIELD, audioDurationMs);
                result.put(AUDIO_CODEC_FIELD, audioCodec);
                result.put(AUDIO_CONTAINER_FIELD, audioContainer);
            }
            return result;
        }

        @Override
        public String toString() {
            return "RecoveryOriginal[redacted]";
        }
    }

    private record FrozenLedger(
            DeletionStorage delegate,
            List<DeletionRecord> plans) implements DeletionStorage {
        public void record(DeletionRecord plan) {
            delegate.record(plan);
        }

        public Page ledger(
                String cursor,
                int limit) {
            int start = cursor == null ? 0 : Integer.parseInt(cursor);
            int end = Math.min(plans.size(), start + limit);
            return new Page(plans.subList(start, end), end == plans.size() ? null : Integer.toString(end));
        }

        public void deleteOriginal(UUID asset) {
            delegate.deleteOriginal(asset);
        }

        public void deleteStaging(UUID grant) {
            delegate.deleteStaging(grant);
        }

        @Override
        public String toString() {
            return "FrozenRecoveryLedger[count=" + plans.size() + "]";
        }
    }
}
