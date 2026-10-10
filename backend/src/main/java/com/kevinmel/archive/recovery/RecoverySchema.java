package com.kevinmel.archive.recovery;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.CRC32;

import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;

/** Strict V8/v1, V9/v2 and V10/v3 archive schemas; no account or application configuration material. */
final class RecoverySchema {
    static final int MAX_ROWS = 100_000;
    private static final String ASSET_COLUMNS = "id:u memory_id:u object_key:s original_filename:s detected_format:s byte_size:l checksum_sha256:s upload_state:s created_at:t updated_at:t declared_content_type:s? expected_byte_size:l? expected_checksum_sha256:s?";
    private static final List<String> AUDIO_COLUMNS = List.of("expected_duration_ms", "audio_duration_ms", "audio_codec", "audio_container");
    private static final List<Table> LEGACY_TABLES = List.of(
        table("contribution", "id:u event_key:s guest_name:s? idempotency_key:s created_at:t request_fingerprint:s?"),
        table("memory", "id:u contribution_id:u memory_type:s text_content:s? review_status:s visibility:s created_at:t updated_at:t client_item_id:u? caption:s? item_position:i? revision:i delete_after:t? purge_started_at:t? purged_at:t?"),
        table("media_asset", ASSET_COLUMNS),
        table("upload_grant", "id:u media_asset_id:u object_key:s created_at:t expires_at:t"),
        table("review_audit", "memory_id:u actor_account_id:u from_status:s to_status:s before_revision:i after_revision:i acted_at:t"),
        table("deletion_ledger", "memory_id:u contribution_id:u asset_id:u? submission_key_digest:s delete_after:t recorded_at:t purged_at:t?"),
        table("erased_submission_key", "key_digest:s erased_at:t"));
    private static final List<Table> AUDIO_TABLES = LEGACY_TABLES.stream().map(table -> table.name().equals("media_asset")
        ? table("media_asset", ASSET_COLUMNS + " expected_duration_ms:l? audio_duration_ms:l? audio_codec:s? audio_container:s?") : table).toList();
    static final List<Table> TABLES = AUDIO_TABLES.stream().map(table -> switch (table.name()) {
        case "contribution" -> table("contribution", table.definition() + " source:s author_account_id:u?");
        case "memory" -> table("memory", table.definition() + " title:s? description:s? memory_date:s? date_precision:s");
        default -> table;
    }).toList();
    private static final List<String> MIGRATIONS = List.of(
        "V1__create_memory_archive_schema.sql", "V2__add_contribution_request_fingerprint.sql", "V3__add_photo_upload_lifecycle.sql",
        "V4__create_archive_accounts.sql", "V5__create_login_throttle.sql", "V6__add_inbox_revision.sql",
        "V7__add_private_review_retention.sql", "V8__anonymous_submission_protection.sql", "V9__add_verified_audio_lifecycle.sql",
        "V10__add_couple_authored_memories.sql");

    static Reviewed requireReviewed(JdbcClient db) {
        try {
            // Resource names are obtained from actual reviewed migration history below; never from bundle paths.
            var allHistory = db.sql("SELECT version, script, checksum, type, success FROM flyway_schema_history ORDER BY installed_rank")
                .query((rs, row) -> new Migration(rs.getString("version"), rs.getString("script"),
                    rs.getInt("checksum"), rs.getString("type"), rs.getBoolean("success"))).list();
            // Flyway may record creation of a named isolated schema before its SQL migrations.
            var history = new ArrayList<Migration>(); boolean schemaMarker = false;
            for (var migration : allHistory) {
                if ("SCHEMA".equals(migration.type())) {
                    if (schemaMarker || !history.isEmpty() || migration.version() != null || !migration.success()) throw invalid();
                    schemaMarker = true;
                } else history.add(migration);
            }
            if (history.size() < 8 || history.size() > MIGRATIONS.size()) throw invalid();
            var digest = MessageDigest.getInstance("SHA-256");
            var fingerprints = new LinkedHashMap<Integer, String>();
            for (int i = 0; i < history.size(); i++) {
                Migration migration = history.get(i);
                if (!Integer.toString(i + 1).equals(migration.version()) || !migration.success()
                        || !"SQL".equals(migration.type()) || !migration.script().equals(MIGRATIONS.get(i))) throw invalid();
                byte[] bytes;
                try (var input = RecoverySchema.class.getResourceAsStream("/db/migration/" + migration.script())) {
                    if (input == null) throw invalid();
                    bytes = input.readNBytes(100_001);
                }
                if (bytes.length > 100_000) throw invalid();
                CRC32 crc = new CRC32(); StringBuilder canonical = new StringBuilder();
                try (var reader = new BufferedReader(new InputStreamReader(new java.io.ByteArrayInputStream(bytes), StandardCharsets.UTF_8))) {
                    String line; boolean first = true;
                    while ((line = reader.readLine()) != null) {
                        if (first && line.startsWith("\uFEFF")) line = line.substring(1);
                        first = false; crc.update(line.getBytes(StandardCharsets.UTF_8)); canonical.append(line).append('\n');
                    }
                }
                if ((int) crc.getValue() != migration.checksum()) throw invalid();
                digest.update(migration.script().getBytes(StandardCharsets.UTF_8)); digest.update((byte) 0);
                digest.update(canonical.toString().getBytes(StandardCharsets.UTF_8)); digest.update((byte) 0);
                if (i >= 7) fingerprints.put(i - 6, HexFormat.of().formatHex(((MessageDigest) digest.clone()).digest()));
            }
            int bundleVersion = history.size() - 7;
            requireColumns(db, tables(bundleVersion));
            return new Reviewed(bundleVersion, fingerprints.get(bundleVersion), Map.copyOf(fingerprints));
        } catch (RecoveryException failure) { throw failure; }
        catch (Exception failure) { throw invalid(); }
    }

    private static void requireColumns(JdbcClient db, List<Table> definitions) {
        for (var table : definitions) {
            var actual = db.sql("SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :name")
                .param("name", table.name()).query((rs, row) -> new PhysicalColumn(rs.getString("column_name"), rs.getString("udt_name"), "YES".equals(rs.getString("is_nullable")))).list();
            if (actual.size() != table.columns().size()) throw invalid();
            for (var column : table.columns()) {
                var found = actual.stream().filter(c -> c.name().equals(column.name())).findFirst().orElseThrow(RecoverySchema::invalid);
                boolean compatible = switch (column.type()) {
                    case 'u' -> found.type().equals("uuid");
                    case 't' -> found.type().equals("timestamptz");
                    case 'i' -> found.type().equals("int4");
                    case 'l' -> found.type().equals("int8");
                    default -> java.util.Set.of("text", "varchar", "bpchar").contains(found.type());
                };
                if (!compatible || column.nullable() != found.nullable()) throw invalid();
            }
        }
    }

    static Map<String, List<Map<String, Object>>> read(JdbcClient db) {
        return read(db, 3);
    }

    static Map<String, List<Map<String, Object>>> read(JdbcClient db, int version) {
        var result = new LinkedHashMap<String, List<Map<String, Object>>>();
        var encodedSize = new java.util.concurrent.atomic.AtomicLong(1024);
        var writer = tools.jackson.databind.json.JsonMapper.builder().build();
        long total = 0;
        for (Table table : tables(version)) {
            long count = db.sql("SELECT COUNT(*) FROM " + table.name()).query(Long.class).single();
            if ((total += count) > MAX_ROWS) throw new RecoveryException("METADATA_LIMIT");
            String order = table.name().equals("review_audit") ? "memory_id, after_revision" : table.columns().getFirst().name();
            result.put(table.name(), db.sql("SELECT " + table.columnNames() + " FROM " + table.name() + " ORDER BY " + order)
                .query((rs, position) -> {
                    var row = table.read(rs);
                    if (encodedSize.addAndGet(writer.writeValueAsBytes(jsonRow(row)).length + 1L) > OperatorRecovery.MAX_METADATA_BYTES) {
                        throw new RecoveryException("METADATA_LIMIT");
                    }
                    return row;
                }).list());
        }
        return result;
    }

    static Map<String, List<Map<String, Object>>> decode(JsonNode node, int version) {
        if (node == null || !node.isObject() || node.size() != TABLES.size()) throw invalid();
        var result = new LinkedHashMap<String, List<Map<String, Object>>>();
        int total = 0;
        for (Table table : tables(version)) {
            JsonNode rows = node.get(table.name());
            if (rows == null || !rows.isArray() || (total += rows.size()) > MAX_ROWS) throw invalid();
            var decoded = new ArrayList<Map<String, Object>>();
            for (JsonNode row : rows) {
                var value = table.decode(row);
                if (version == 1 && table.name().equals("media_asset")) AUDIO_COLUMNS.forEach(name -> value.put(name, null));
                if (version < 3 && table.name().equals("contribution")) {
                    value.put("source", "GUEST"); value.put("author_account_id", null);
                }
                if (version < 3 && table.name().equals("memory")) {
                    value.put("title", null); value.put("description", null); value.put("memory_date", null);
                    value.put("date_precision", "UNKNOWN");
                }
                decoded.add(value);
            }
            result.put(table.name(), List.copyOf(decoded));
        }
        return result;
    }

    static void insert(JdbcClient db, Map<String, List<Map<String, Object>>> rows, int targetVersion) {
        for (Table table : tables(targetVersion)) {
            for (var row : rows.get(table.name())) {
                var query = db.sql("INSERT INTO " + table.name() + " (" + table.columnNames() + ") VALUES ("
                    + String.join(",", table.columns().stream().map(c -> ":" + c.name()).toList()) + ")");
                for (Column column : table.columns()) {
                    Object value = row.get(column.name());
                    if (value instanceof Instant instant) value = OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
                    query = query.param(column.name(), value);
                }
                query.update();
            }
        }
    }

    static Map<String, Object> jsonRow(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        row.forEach((key, value) -> result.put(key, value instanceof Instant || value instanceof UUID ? value.toString() : value));
        return result;
    }
    static RecoveryException invalid() { return new RecoveryException("INVALID_METADATA"); }
    private static List<Table> tables(int version) {
        if (version == 1) return LEGACY_TABLES;
        if (version == 2) return AUDIO_TABLES;
        if (version == 3) return TABLES;
        throw invalid();
    }
    record Reviewed(int bundleVersion, String fingerprint, Map<Integer, String> fingerprints) {
        boolean accepts(int version, String suppliedFingerprint) {
            return version >= 1 && version <= bundleVersion && suppliedFingerprint.equals(fingerprints.get(version));
        }
    }
    private static Table table(String name, String definition) {
        var columns = new ArrayList<Column>();
        for (String part : definition.split(" ")) {
            String[] field = part.split(":");
            columns.add(new Column(field[0], field[1].charAt(0), field[1].endsWith("?")));
        }
        return new Table(name, List.copyOf(columns));
    }
    record Table(String name, List<Column> columns) {
        String definition() { return String.join(" ", columns.stream().map(c -> c.name() + ":" + c.type() + (c.nullable() ? "?" : "")).toList()); }
        String columnNames() { return String.join(",", columns.stream().map(Column::name).toList()); }
        Map<String, Object> read(ResultSet rs) throws SQLException {
            var row = new LinkedHashMap<String, Object>();
            for (Column column : columns) {
                Object value = switch (column.type()) {
                    case 'u' -> rs.getObject(column.name(), UUID.class);
                    case 't' -> { var time = rs.getObject(column.name(), OffsetDateTime.class); yield time == null ? null : time.toInstant(); }
                    case 'i' -> rs.getObject(column.name(), Integer.class);
                    case 'l' -> rs.getObject(column.name(), Long.class);
                    default -> rs.getString(column.name());
                };
                row.put(column.name(), value);
            }
            return row;
        }
        Map<String, Object> decode(JsonNode node) {
            if (!node.isObject() || node.size() != columns.size()) throw invalid();
            var row = new LinkedHashMap<String, Object>();
            for (Column column : columns) row.put(column.name(), column.decode(node.get(column.name())));
            return row;
        }
    }
    record Column(String name, char type, boolean nullable) {
        Object decode(JsonNode node) {
            if (node == null) throw invalid();
            if (node.isNull()) { if (!nullable) throw invalid(); return null; }
            try {
                return switch (type) {
                    case 'u' -> { String text = string(node); UUID id = UUID.fromString(text); if (!id.toString().equals(text)) throw invalid(); yield id; }
                    case 't' -> { String text = string(node); Instant instant = Instant.parse(text); if (!instant.toString().equals(text)) throw invalid(); yield instant; }
                    case 'i' -> { if (!node.isIntegralNumber() || !node.canConvertToInt()) throw invalid(); yield node.intValue(); }
                    case 'l' -> { if (!node.isIntegralNumber() || !node.canConvertToLong()) throw invalid(); yield node.longValue(); }
                    default -> string(node);
                };
            } catch (RuntimeException failure) { throw invalid(); }
        }
    }
    static String string(JsonNode node) { if (node == null || !node.isString()) throw invalid(); return node.asString(); }
    private record Migration(String version, String script, int checksum, String type, boolean success) { }
    private record PhysicalColumn(String name, String type, boolean nullable) { }
}
