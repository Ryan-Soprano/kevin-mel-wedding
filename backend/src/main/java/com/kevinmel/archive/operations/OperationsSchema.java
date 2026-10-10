package com.kevinmel.archive.operations;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipFile;
import java.util.jar.Manifest;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/** Read-only checks against the reviewed immutable scripts, not Flyway's permissive future defaults. */
final class OperationsSchema {
    private static final int MAX_SCRIPT_BYTES = 100_000;
    private static final String PREFIX = "BOOT-INF/classes/db/migration/";
    private static final List<String> SCRIPTS = List.of(
            "V1__create_memory_archive_schema.sql", "V2__add_contribution_request_fingerprint.sql",
            "V3__add_photo_upload_lifecycle.sql", "V4__create_archive_accounts.sql",
            "V5__create_login_throttle.sql", "V6__add_inbox_revision.sql",
            "V7__add_private_review_retention.sql", "V8__anonymous_submission_protection.sql",
            "V9__add_verified_audio_lifecycle.sql", "V10__add_couple_authored_memories.sql", "V11__add_private_albums.sql");
    private static final Map<String, String> COLUMNS = Map.ofEntries(
            Map.entry("contribution", "id:uuid event_key:varchar guest_name:varchar? idempotency_key:varchar created_at:timestamptz request_fingerprint:varchar? source:varchar author_account_id:uuid?"),
            Map.entry("memory", "id:uuid contribution_id:uuid memory_type:varchar text_content:text? review_status:varchar visibility:varchar created_at:timestamptz updated_at:timestamptz client_item_id:uuid? caption:varchar? item_position:int4? revision:int4 delete_after:timestamptz? purge_started_at:timestamptz? purged_at:timestamptz? title:varchar? description:varchar? memory_date:varchar? date_precision:varchar"),
            Map.entry("album", "id:uuid name:varchar? visibility:varchar revision:uuid created_at:timestamptz updated_at:timestamptz deleted_at:timestamptz?"),
            Map.entry("album_membership", "album_id:uuid memory_id:uuid position:int8"),
            Map.entry("media_asset", "id:uuid memory_id:uuid object_key:varchar original_filename:varchar detected_format:varchar byte_size:int8 checksum_sha256:varchar upload_state:varchar created_at:timestamptz updated_at:timestamptz declared_content_type:varchar? expected_byte_size:int8? expected_checksum_sha256:varchar? expected_duration_ms:int8? audio_duration_ms:int8? audio_codec:varchar? audio_container:varchar?"),
            Map.entry("upload_grant", "id:uuid media_asset_id:uuid object_key:varchar created_at:timestamptz expires_at:timestamptz"),
            Map.entry("archive_account", "id:uuid username:varchar display_name:varchar password_hash:varchar role:varchar enabled:bool credentials_version:int8 created_at:timestamptz updated_at:timestamptz"),
            Map.entry("archive_login_throttle", "bucket_key:bpchar window_started_at:timestamptz attempts:int4"),
            Map.entry("archive_anonymous_throttle", "bucket_key:varchar window_started_at:timestamptz attempts:int4"),
            Map.entry("review_audit", "memory_id:uuid actor_account_id:uuid from_status:varchar to_status:varchar before_revision:int4 after_revision:int4 acted_at:timestamptz"),
            Map.entry("deletion_ledger", "memory_id:uuid contribution_id:uuid asset_id:uuid? submission_key_digest:bpchar delete_after:timestamptz recorded_at:timestamptz purged_at:timestamptz?"),
            Map.entry("erased_submission_key", "key_digest:bpchar erased_at:timestamptz"));

    private OperationsSchema() { }

    static List<Migration> bundled() throws Exception {
        return bundled(OperationsSchema.class.getClassLoader());
    }

    static List<Migration> bundled(ClassLoader loader) throws Exception {
        var resources = new LinkedHashMap<String, org.springframework.core.io.Resource>();
        var resolver = new PathMatchingResourcePatternResolver(loader);
        resolver.setUseCaches(false);
        var roots = new ArrayList<String>();
        for (var root : resolver.getResources("classpath*:db/migration/")) {
            String location = root.getURL().toExternalForm();
            if (!location.endsWith("/")) throw rejected();
            roots.add(location);
        }
        for (var resource : resolver.getResources("classpath*:db/migration/**/*")) {
            String script = resource.getFilename();
            // Flyway recursively scans this location. Nested files/aliases cannot silently escape the exact inventory.
            String location = resource.getURL().toExternalForm();
            if (script == null || roots.stream().noneMatch(root -> location.equals(root + script))) throw rejected();
            // The pre-existing directory marker contains no code (empty or one LF/CRLF).
            if (".gitkeep".equals(script)) {
                try (var input = resource.getInputStream()) { requireMarker(input); }
                continue;
            }
            if (!SCRIPTS.contains(script) || resources.putIfAbsent(script, resource) != null) throw rejected();
        }
        if (resources.size() != SCRIPTS.size()) throw rejected();
        var result = new ArrayList<Migration>();
        for (int i = 0; i < SCRIPTS.size(); i++) {
            try (var input = resources.get(SCRIPTS.get(i)).getInputStream()) {
                result.add(migration(i, input));
            }
        }
        return List.copyOf(result);
    }

    /** Read only regular bounded executable JARs; never extract or load their classes. */
    static List<Migration> priorJar(Path path) throws Exception {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 268_435_456L) throw rejected();
        try (var jar = new ZipFile(path.toFile(), StandardCharsets.UTF_8)) {
            if (jar.size() > 20_000) throw rejected();
            var manifestEntry = jar.getEntry("META-INF/MANIFEST.MF");
            var applicationEntry = jar.getEntry("BOOT-INF/classes/com/kevinmel/archive/MemoryArchiveApplication.class");
            if (manifestEntry == null || manifestEntry.getSize() < 1 || manifestEntry.getSize() > 8192
                    || applicationEntry == null || applicationEntry.getSize() < 4 || applicationEntry.getSize() > 1_048_576) throw rejected();
            try (var input = jar.getInputStream(manifestEntry)) {
                byte[] bytes = input.readNBytes(8193);
                if (bytes.length > 8192) throw rejected();
                var attributes = new Manifest(new ByteArrayInputStream(bytes)).getMainAttributes();
                if (!"org.springframework.boot.loader.launch.JarLauncher".equals(attributes.getValue("Main-Class"))
                        || !"com.kevinmel.archive.MemoryArchiveApplication".equals(attributes.getValue("Start-Class"))) throw rejected();
            }
            try (var input = jar.getInputStream(applicationEntry)) {
                if (!java.util.Arrays.equals(input.readNBytes(4), new byte[]{(byte) 0xca, (byte) 0xfe, (byte) 0xba, (byte) 0xbe})) throw rejected();
            }
            var entries = new LinkedHashMap<String, java.util.zip.ZipEntry>();
            var all = jar.entries();
            while (all.hasMoreElements()) {
                var entry = all.nextElement();
                if (entry.getName().startsWith(PREFIX) && !entry.isDirectory()) {
                    String script = entry.getName().substring(PREFIX.length());
                    if (".gitkeep".equals(script)) {
                        if (entry.getSize() < 0 || entry.getSize() > 2) throw rejected();
                        try (var input = jar.getInputStream(entry)) { requireMarker(input); }
                        continue;
                    }
                    if (!SCRIPTS.contains(script) || entry.getSize() < 1 || entry.getSize() > MAX_SCRIPT_BYTES
                            || entries.putIfAbsent(script, entry) != null) throw rejected();
                }
            }
            if (entries.size() != SCRIPTS.size()) throw rejected();
            var result = new ArrayList<Migration>();
            for (int i = 0; i < SCRIPTS.size(); i++) {
                try (var input = jar.getInputStream(entries.get(SCRIPTS.get(i)))) { result.add(migration(i, input)); }
            }
            return List.copyOf(result);
        }
    }

    static void requireCurrent(Connection connection, List<Migration> bundled) throws SQLException {
        var history = new ArrayList<Migration>();
        boolean marker = false;
        try (var statement = OperationsReadiness.statement(connection,
                "SELECT version,script,checksum,type,success FROM flyway_schema_history ORDER BY installed_rank")) {
            statement.setMaxRows(SCRIPTS.size() + 2);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) {
                    if ("SCHEMA".equals(rows.getString("type"))) {
                        if (marker || !history.isEmpty() || rows.getString("version") != null || !rows.getBoolean("success")) throw rejected();
                        marker = true;
                    } else {
                        if (!"SQL".equals(rows.getString("type")) || !rows.getBoolean("success")) throw rejected();
                        Object checksum = rows.getObject("checksum");
                        if (!(checksum instanceof Integer number)) throw rejected();
                        history.add(new Migration(rows.getString("version"), rows.getString("script"), number, null));
                    }
                }
            }
        }
        if (history.size() != bundled.size()) throw rejected();
        for (int i = 0; i < bundled.size(); i++) {
            var expected = bundled.get(i); var actual = history.get(i);
            if (!expected.version().equals(actual.version()) || !expected.script().equals(actual.script())
                    || expected.checksum() != actual.checksum()) throw rejected();
        }
        requireColumns(connection);
    }

    private static void requireColumns(Connection connection) throws SQLException {
        var actual = new LinkedHashMap<String, Map<String, String>>();
        var tables = List.copyOf(COLUMNS.keySet());
        try (var statement = OperationsReadiness.statement(connection, """
                SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name IN (
                """ + String.join(",", java.util.Collections.nCopies(tables.size(), "?")) + ")")) {
            for (int i = 0; i < tables.size(); i++) statement.setString(i + 1, tables.get(i));
            statement.setMaxRows(501);
            try (var rows = statement.executeQuery()) {
                while (rows.next()) actual.computeIfAbsent(rows.getString("table_name"), ignored -> new LinkedHashMap<>())
                        .put(rows.getString("column_name"), rows.getString("udt_name") + ("YES".equals(rows.getString("is_nullable")) ? "?" : ""));
            }
        }
        if (actual.size() != COLUMNS.size()) throw rejected();
        for (var table : COLUMNS.entrySet()) {
            String[] expected = table.getValue().split(" ");
            var columns = actual.get(table.getKey());
            if (columns == null || columns.size() != expected.length) throw rejected();
            for (String column : expected) {
                String[] parts = column.split(":");
                if (!parts[1].equals(columns.get(parts[0]))) throw rejected();
            }
        }
    }

    private static Migration migration(int position, InputStream input) throws Exception {
        if (input == null) throw rejected();
        byte[] bytes = input.readNBytes(MAX_SCRIPT_BYTES + 1);
        if (bytes.length < 1 || bytes.length > MAX_SCRIPT_BYTES) throw rejected();
        CRC32 crc = new CRC32(); var canonical = new StringBuilder();
        try (var reader = new BufferedReader(new InputStreamReader(new ByteArrayInputStream(bytes),
                StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)))) {
            String line; boolean first = true;
            while ((line = reader.readLine()) != null) {
                if (first && line.startsWith("\uFEFF")) line = line.substring(1);
                first = false;
                crc.update(line.getBytes(StandardCharsets.UTF_8)); canonical.append(line).append('\n');
            }
        }
        return new Migration(Integer.toString(position + 1), SCRIPTS.get(position), (int) crc.getValue(),
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8))));
    }

    private static void requireMarker(InputStream input) throws IOException {
        byte[] bytes = input.readNBytes(3);
        if (bytes.length != 0 && !java.util.Arrays.equals(bytes, new byte[]{'\n'})
                && !java.util.Arrays.equals(bytes, new byte[]{'\r', '\n'})) throw rejected();
    }

    static IllegalStateException rejected() { return new IllegalStateException("Schema verification is unconfirmed."); }
    record Migration(String version, String script, int checksum, String digest) { }
}
