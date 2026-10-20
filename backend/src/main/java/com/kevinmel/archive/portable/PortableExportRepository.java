package com.kevinmel.archive.portable;

import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.kevinmel.archive.media.MediaTypes;
import com.kevinmel.archive.review.InboxRepository;
import tools.jackson.databind.json.JsonMapper;

/** Short repeatable-read capture; no storage calls, locks, or account/capability columns. */
@Repository
public class PortableExportRepository {
    private static final String TIMELINE_EVENT_TABLE = "timeline_event";
    private static final String MEMORY_TABLE = "memory";
    private static final String ALBUM_TABLE = "album";

    static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String ELIGIBLE = InboxRepository.AVAILABLE.replace(":now", "CURRENT_TIMESTAMP")
            + " AND m.review_status <> 'DELETE'";
    private static final String MEMORY_SQL = """
            SELECT m.id, m.contribution_id, m.item_position, m.revision, m.memory_type, c.source, c.guest_name, m.review_status,
                m.text_content, m.caption, m.title, m.description, m.memory_date, m.date_precision, m.visibility,
                m.created_at, m.updated_at, a.id AS asset_id, a.detected_format, a.byte_size,
                a.checksum_sha256, a.audio_duration_ms, a.audio_container, a.audio_codec, a.original_filename
            FROM memory m JOIN contribution c ON c.id=m.contribution_id
            LEFT JOIN media_asset a ON a.memory_id=m.id WHERE
            """ + ELIGIBLE;
    private final DataSource data;
    private final PlatformTransactionManager manager;
    private final Clock clock;

    public PortableExportRepository(
            DataSource data,
            PlatformTransactionManager manager,
            Clock clock) {
        this.data = data;
        this.manager = manager;
        this.clock = clock;
    }

    public PortableSnapshot capture() {
        return transaction(TransactionDefinition.ISOLATION_REPEATABLE_READ).execute(ignored -> {
            try (var lease = new ConnectionLease(data)) {
                Connection connection = lease.connection;
                var budget = new Budget();
                var memories = new ArrayList<PortableSnapshot.Memory>();
                var originals = new ArrayList<PortableSnapshot.Original>();
                var validation = new LinkedHashMap<String, Map<UUID, String>>();
                var memoryTokens = new LinkedHashMap<UUID, String>();
                read(connection, MEMORY_SQL + " ORDER BY m.created_at, m.id", null, rs -> {
                    var row = memory(rs);
                    budget.row(row.memory());
                    memories.add(row.memory());
                    if (row.original() != null) {
                        budget.original(row.original());
                        originals.add(row.original());
                    }
                    memoryTokens.put(row.memory().memoryId(), fingerprint(row));
                });
                validation.put(MEMORY_TABLE, memoryTokens);
                Set<UUID> eligibleIds = Set.copyOf(memoryTokens.keySet());
                var albums = organizations(connection, ALBUM_TABLE, eligibleIds, null, budget);
                var events = organizations(connection, TIMELINE_EVENT_TABLE, eligibleIds, null, budget);
                var tags = organizations(connection, "tag", eligibleIds, null, budget);
                validation.put(ALBUM_TABLE, tokens(albums));
                validation.put(TIMELINE_EVENT_TABLE, tokens(events));
                validation.put("tag", tokens(tags));
                var snapshot = new PortableSnapshot(
                        clock.instant(),
                        memories,
                        originals,
                        albums.values().stream().map(Organization::album).toList(),
                        events.values().stream().map(Organization::event).toList(),
                        tags.values().stream().map(Organization::tag).toList(),
                        excluded(connection),
                        validation);
                if (JSON.writeValueAsBytes(snapshot.archiveData()).length > PortableSnapshot.MAX_METADATA_BYTES) {
                    throw new PortableExportException();
                }
                return snapshot;
            } catch (SQLException exception) {
                throw new PortableExportException();
            }
        });
    }

    /** REQUIRES_NEW prevents callers' old repeatable-read visibility from approving erased or changed content. */
    public boolean stillCurrent(PortableSnapshot snapshot) {
        return Boolean.TRUE.equals(transaction(TransactionDefinition.ISOLATION_READ_COMMITTED).execute(ignored -> {
            try (var lease = new ConnectionLease(data)) {
                Connection connection = lease.connection;
                var current = new HashMap<UUID, String>();
                Set<UUID> ids = snapshot.validation().get(MEMORY_TABLE).keySet();
                if (!ids.isEmpty()) {
                    read(
                            connection,
                            MEMORY_SQL + " AND m.id=ANY(?)",
                            ids,
                            rs -> {
                                var row = memory(rs);
                                current.put(row.memory().memoryId(), fingerprint(row));
                            });
                }
                if (!current.equals(snapshot.validation().get(MEMORY_TABLE))) {
                    return false;
                }
                for (String table : List.of(ALBUM_TABLE, TIMELINE_EVENT_TABLE, "tag")) {
                    var expected = snapshot.validation().get(table);
                    var records = organizations(connection, table, ids, expected.keySet(), new Budget());
                    if (!tokens(records).equals(expected)) {
                        return false;
                    }
                }
                return true;
            } catch (SQLException exception) {
                throw new PortableExportException();
            }
        }));
    }

    /** A fresh bounded per-original checkpoint; the coordinator also validates the full graph before publication. */
    public boolean originalStillCurrent(
            PortableSnapshot snapshot,
            PortableSnapshot.Original original) {
        String expected = snapshot.validation().get(MEMORY_TABLE).get(original.memoryId());
        if (expected == null) {
            return false;
        }
        return Boolean.TRUE.equals(transaction(TransactionDefinition.ISOLATION_READ_COMMITTED).execute(ignored -> {
            try (var lease = new ConnectionLease(data)) {
                Connection connection = lease.connection;
                var found = new ArrayList<String>(1);
                read(
                        connection,
                        MEMORY_SQL + " AND m.id=ANY(?)",
                        Set.of(original.memoryId()),
                        rs -> {
                            var row = memory(rs);
                            if (original.equals(row.original())) {
                                found.add(fingerprint(row));
                            }
                        });
                return found.size() == 1 && expected.equals(found.getFirst());
            } catch (SQLException exception) {
                throw new PortableExportException();
            }
        }));
    }

    private TransactionTemplate transaction(int isolation) {
        var transaction = new TransactionTemplate(manager);
        transaction.setReadOnly(true);
        transaction.setIsolationLevel(isolation);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setTimeout(60);
        return transaction;
    }

    private static MemoryRow memory(ResultSet rs) throws SQLException {
        String type = rs.getString("memory_type");
        UUID id = rs.getObject("id", UUID.class);
        PortableSnapshot.Original original = null;
        if (!"TEXT".equals(type)) {
            UUID asset = rs.getObject("asset_id", UUID.class);
            String mime = rs.getString("detected_format"), hash = rs.getString("checksum_sha256");
            long bytes = rs.getLong("byte_size");
            if (asset == null
                    || asset.version() != 4
                    || asset.variant() != 2
                    || hash == null
                    || !hash.matches("[0-9a-f]{64}")
                    || !MediaTypes.validTypeAndSize(mime, bytes)) {
                throw new PortableExportException();
            }
            original = new PortableSnapshot.Original(
                    id,
                    asset,
                    originalPath(asset, mime),
                    mime,
                    bytes,
                    hash,
                    rs.getObject("audio_duration_ms", Long.class),
                    rs.getString("audio_container"),
                    rs.getString("audio_codec"),
                    rs.getString("original_filename"));
        }
        var memory = new PortableSnapshot.Memory(
                id,
                rs.getObject("contribution_id", UUID.class),
                rs.getObject("item_position", Integer.class),
                type,
                rs.getString("source"),
                rs.getString("guest_name"),
                rs.getString("review_status"),
                rs.getString("text_content"),
                rs.getString("caption"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("memory_date"),
                rs.getString("date_precision"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                original == null ? null : original.assetId(),
                rs.getString("visibility"));
        return new MemoryRow(memory, original, rs.getLong("revision"));
    }

    static String originalPath(
            UUID id,
            String mime) {
        String extension = switch (mime) {
            case "image/jpeg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            case "audio/webm" -> "webm";
            case "audio/ogg" -> "ogg";
            case "audio/mp4" -> "m4a";
            default -> throw new PortableExportException();
        };
        return "originals/" + id + "." + extension;
    }

    private static Map<UUID, Organization> organizations(
            Connection connection,
            String table,
            Set<UUID> eligible,
            Set<UUID> selected,
            Budget budget) throws SQLException {
        var records = new LinkedHashMap<UUID, Organization>();
        if (selected != null && selected.isEmpty()) {
            return records;
        }
        captureOrganizationRows(connection, table, selected, budget, records);
        if (records.isEmpty()) {
            return records;
        }
        captureOrganizationLinks(connection, table, eligible, budget, records);
        return records;
    }

    private static void captureOrganizationRows(
            Connection connection,
            String table,
            Set<UUID> selected,
            Budget budget,
            Map<UUID, Organization> records) throws SQLException {
        boolean timeline = table.equals(TIMELINE_EVENT_TABLE);
        String fields = timeline ? "title, description, event_date, date_precision" : "name";
        read(
                connection,
                "SELECT id, revision, created_at, updated_at, " + fields + " FROM " + table
                        + " WHERE deleted_at IS NULL AND visibility='COUPLE_ONLY'" + (selected == null ? "" : " AND id=ANY(?)")
                        + (timeline ? " ORDER BY (event_date IS NULL), COALESCE(event_date,'') COLLATE \"C\", created_at, id" : " ORDER BY created_at, id"),
                selected,
                rs -> {
                    UUID id = rs.getObject("id", UUID.class);
                    var record = new Organization(
                            id,
                            rs.getObject("revision", UUID.class),
                            rs.getString(timeline ? "title" : "name"),
                            timeline ? rs.getString("description") : null,
                            timeline ? rs.getString("event_date") : null,
                            timeline ? rs.getString("date_precision") : null,
                            instant(rs, "created_at"),
                            instant(rs, "updated_at"));
                    budget.row(record.fields());
                    records.put(id, record);
                });
    }

    private static void captureOrganizationLinks(
            Connection connection,
            String table,
            Set<UUID> eligible,
            Budget budget,
            Map<UUID, Organization> records) throws SQLException {
        String links = switch (table) {
            case ALBUM_TABLE -> "album_membership";
            case TIMELINE_EVENT_TABLE -> "timeline_event_memory";
            default -> "memory_tag";
        };
        String parent = switch (table) {
            case ALBUM_TABLE -> "album_id";
            case TIMELINE_EVENT_TABLE -> "event_id";
            default -> "tag_id";
        };
        read(
                connection,
                "SELECT " + parent + ", memory_id" + (table.equals(ALBUM_TABLE) ? ", position" : "") + " FROM " + links
                        + " WHERE " + parent + "=ANY(?) ORDER BY " + parent + (table.equals(ALBUM_TABLE) ? ", position, memory_id" : ", memory_id"),
                records.keySet(),
                rs -> {
                    UUID id = rs.getObject(parent, UUID.class), memory = rs.getObject("memory_id", UUID.class);
                    String position = table.equals(ALBUM_TABLE) ? Long.toString(rs.getLong("position")) : null;
                    var link = new Link(memory, position);
                    budget.row(link);
                    records.get(id).allLinks.add(link);
                    if (eligible.contains(memory)) {
                        records.get(id).links.add(link);
                    }
                });
    }

    private static Map<UUID, String> tokens(Map<UUID, Organization> records) {
        var result = new LinkedHashMap<UUID, String>();
        records.forEach((id, row) -> result.put(id, fingerprint(List.of(row.fields(), row.allLinks))));
        return result;
    }

    private static Map<String, Long> excluded(Connection connection) throws SQLException {
        var result = new LinkedHashMap<String, Long>();
        read(connection, """
                SELECT count(*) FILTER (WHERE m.review_status='DELETE' OR m.purge_started_at IS NOT NULL OR m.purged_at IS NOT NULL) AS deleted,
                    count(*) FILTER (WHERE m.review_status<>'DELETE' AND m.purge_started_at IS NULL AND m.purged_at IS NULL
                        AND (
                """ + ELIGIBLE + ") IS NOT TRUE) AS unfinished FROM memory m JOIN contribution c ON c.id=m.contribution_id "
                + "LEFT JOIN media_asset a ON a.memory_id=m.id WHERE c.event_key='kevin-mel-wedding'", null, rs -> {
                    result.put("deletedOrPurgingMemories", rs.getLong("deleted"));
                    result.put("unfinishedOrUnavailableMemories", rs.getLong("unfinished"));
                });
        for (String table : List.of(ALBUM_TABLE, TIMELINE_EVENT_TABLE, "tag")) {
            read(
                    connection,
                    "SELECT count(*) AS total FROM " + table + " WHERE deleted_at IS NOT NULL",
                    null,
                    rs -> result.put(switch (table) {
                        case ALBUM_TABLE -> "deletedAlbums";
                        case TIMELINE_EVENT_TABLE -> "deletedTimelineEvents";
                        default -> "deletedTags";
                    }, rs.getLong("total")));
        }
        return result;
    }

    private static Instant instant(
            ResultSet rs,
            String column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static void read(
            Connection connection,
            String sql,
            Set<UUID> ids,
            RowReader reader) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            statement.setFetchSize(128);
            statement.setQueryTimeout(15);
            java.sql.Array array = ids == null ? null : connection.createArrayOf("uuid", ids.toArray(UUID[]::new));
            try {
                if (array != null) {
                    statement.setArray(1, array);
                }
                try (var rs = statement.executeQuery()) {
                    while (rs.next()) {
                        reader.read(rs);
                    }
                }
            } finally {
                if (array != null) {
                    array.free();
                }
            }
        }
    }

    static String fingerprint(Object value) {
        return sha256(JSON.writeValueAsBytes(value));
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Required digest unavailable.");
        }
    }

    @FunctionalInterface
    private interface RowReader {
        void read(ResultSet rs) throws SQLException;
    }

    private static final class ConnectionLease implements AutoCloseable {
        final DataSource data;
        final Connection connection;
        final int networkTimeout;

        ConnectionLease(DataSource data) throws SQLException {
            this.data = data;
            this.connection = DataSourceUtils.getConnection(data);
            try {
                networkTimeout = connection.getNetworkTimeout();
                connection.setNetworkTimeout(Runnable::run, 15_000);
            } catch (SQLException failure) {
                DataSourceUtils.releaseConnection(connection, data);
                throw failure;
            }
        }

        @Override
        public void close() throws SQLException {
            try {
                connection.setNetworkTimeout(Runnable::run, networkTimeout);
            } finally {
                DataSourceUtils.releaseConnection(connection, data);
            }
        }
    }

    private record MemoryRow(
            PortableSnapshot.Memory memory,
            PortableSnapshot.Original original,
            long revision) {
    }

    private record Link(
            UUID memoryId,
            String position) {
    }

    private static final class Organization {
        final UUID id, revision;
        final String name, description, date, precision;
        final Instant created, updated;
        final List<Link> links = new ArrayList<>(), allLinks = new ArrayList<>();
        Organization(
                UUID id,
                UUID revision,
                String name,
                String description,
                String date,
                String precision,
                Instant created,
                Instant updated) {
            this.id = id;
            this.revision = revision;
            this.name = name;
            this.description = description;
            this.date = date;
            this.precision = precision;
            this.created = created;
            this.updated = updated;
        }

        Object fields() {
            return java.util.Arrays.asList(id, revision, name, description, date, precision, created, updated);
        }

        PortableSnapshot.Album album() {
            return new PortableSnapshot.Album(
                    id,
                    name,
                    created,
                    updated,
                    links.stream().map(link -> new PortableSnapshot.AlbumMember(link.memoryId(), link.position())).toList());
        }

        PortableSnapshot.Event event() {
            return new PortableSnapshot.Event(
                    id,
                    name,
                    description,
                    date,
                    precision,
                    created,
                    updated,
                    links.stream().map(Link::memoryId).toList());
        }

        PortableSnapshot.Tag tag() {
            return new PortableSnapshot.Tag(
                    id,
                    name,
                    created,
                    updated,
                    links.stream().map(Link::memoryId).toList());
        }
    }
    private static final class Budget {
        int rows, bytes = 4096, originals;
        long originalBytes;

        void row(Object value) {
            if (++rows > PortableSnapshot.MAX_ROWS) {
                throw new PortableExportException();
            }
            bytes = Math.addExact(bytes, JSON.writeValueAsBytes(value).length + 2);
            if (bytes > PortableSnapshot.MAX_METADATA_BYTES) {
                throw new PortableExportException();
            }
        }

        void original(PortableSnapshot.Original original) {
            row(original);
            if (++originals > PortableSnapshot.MAX_ORIGINALS) {
                throw new PortableExportException();
            }
            originalBytes = Math.addExact(originalBytes, original.byteSize());
            if (originalBytes > PortableSnapshot.MAX_ORIGINAL_BYTES) {
                throw new PortableExportException();
            }
        }
    }
}
