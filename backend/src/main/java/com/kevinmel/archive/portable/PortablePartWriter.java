package com.kevinmel.archive.portable;

import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.kevinmel.archive.media.MediaTypes;
import com.kevinmel.archive.media.ObjectStorage;

/** One bounded, owner-only ZIP. Verified immutable bytes are copied unchanged; no URLs or provider calls in the reader. */
@Component
public class PortablePartWriter {
    private static final String ARTICLE_START = "<article><h3>";
    private static final String DESCRIPTION_LABEL = "Description";

    public static final long MAX_PART_ORIGINAL_BYTES = 67_108_864L;
    public static final int MAX_PART_ORIGINALS = 50;
    public static final long MAX_ARTIFACT_BYTES = 83_886_080L;
    private static final int READER_ROWS = 1000;
    private static final DateTimeFormatter DISPLAY_TIME = DateTimeFormatter.ofPattern("MMM d, uuuu, h:mm a z", Locale.US)
            .withZone(ZoneId.of("America/New_York"));
    private final ObjectStorage storage;
    private final FileCleaner cleaner;

    @Autowired
    public PortablePartWriter(ObjectStorage storage) {
        this(storage, Files::deleteIfExists);
    }

    PortablePartWriter(ObjectStorage storage, FileCleaner cleaner) {
        this.storage = storage;
        this.cleaner = cleaner;
    }

    public List<OriginalPart> plan(PortableSnapshot snapshot) {
        return planParts(snapshot.originals());
    }

    static List<OriginalPart> planParts(List<PortableSnapshot.Original> originals) {
        var parts = new ArrayList<OriginalPart>();
        var rows = new ArrayList<PortableSnapshot.Original>();
        var ids = new HashSet<UUID>();
        long bytes = 0, total = 0;
        if (originals.size() > PortableSnapshot.MAX_ORIGINALS) {
            throw new PortableExportException();
        }
        for (var original : originals) {
            validate(original);
            if (!ids.add(original.assetId())) {
                throw new PortableExportException();
            }
            total = Math.addExact(total, original.byteSize());
            if (total > PortableSnapshot.MAX_ORIGINAL_BYTES) {
                throw new PortableExportException();
            }
            if (rows.size() == MAX_PART_ORIGINALS || bytes + original.byteSize() > MAX_PART_ORIGINAL_BYTES) {
                parts.add(new OriginalPart(parts.size(), rows));
                rows = new ArrayList<>();
                bytes = 0;
            }
            rows.add(original);
            bytes += original.byteSize();
        }
        if (!rows.isEmpty()) {
            parts.add(new OriginalPart(parts.size(), rows));
        }
        return List.copyOf(parts);
    }

    public PreparedPart writeOriginalPart(
            PortableSnapshot snapshot,
            OriginalPart part,
            Path destination,
            BooleanSupplier alive) {
        return writeOriginalPart(snapshot, part, destination, alive, ignored -> alive.getAsBoolean());
    }

    public PreparedPart writeOriginalPart(
            PortableSnapshot snapshot,
            OriginalPart part,
            Path destination,
            BooleanSupplier alive,
            Predicate<PortableSnapshot.Original> originalCurrent) {
        var plan = plan(snapshot);
        if (part.index() < 0 || part.index() >= plan.size() || !plan.get(part.index()).equals(part)) {
            throw new PortableExportException();
        }
        return write(destination, alive, zip -> {
            var outcomes = new ArrayList<OriginalOutcome>();
            for (var original : part.originals()) {
                outcomes.add(writeOriginal(zip, original, alive, originalCurrent));
            }
            entry(zip, "parts/part-" + (part.index() + 1) + ".json", json(Map.of(
                    "format", "portable-original-part",
                    "partNumber", part.index() + 1,
                    "capturedAt", snapshot.capturedAt(),
                    "originals", outcomes,
                    "complete", outcomes.stream().allMatch(row -> row.status() == Status.INCLUDED))), alive);
            entry(zip, "parts/README-part-" + (part.index() + 1) + ".txt", utf8(instructions()), alive);
            return outcomes;
        });
    }

    private OriginalOutcome writeOriginal(ZipOutputStream zip, PortableSnapshot.Original original,
            BooleanSupplier alive, Predicate<PortableSnapshot.Original> originalCurrent) throws IOException {
        check(alive);
        if (!originalCurrent.test(original)) {
            throw new CancellationException("Portable original changed.");
        }
        OriginalRead read = readOriginal(original);
        check(alive); // callback failures are never converted into an original warning
        if (!originalCurrent.test(original)) {
            throw new CancellationException("Portable original changed.");
        }
        if (read.status() == Status.INCLUDED) {
            entry(zip, original.path(), read.content(), alive);
        }
        return new OriginalOutcome(original.memoryId(), original.assetId(), read.status(), original.path(),
                read.status() == Status.INCLUDED ? original.byteSize() : 0,
                read.status() == Status.INCLUDED ? original.sha256() : null);
    }

    private OriginalRead readOriginal(PortableSnapshot.Original original) {
        try {
            var read = storage.read("originals/" + original.assetId(), MediaTypes.maxBytesForMemoryType(
                    MediaTypes.PHOTO_TYPES.contains(original.contentType()) ? "PHOTO" : "AUDIO"));
            if (read.isEmpty()) {
                return new OriginalRead(null, Status.MISSING);
            }
            byte[] content = read.get();
            Status status = content.length == original.byteSize()
                    && PortableExportRepository.sha256(content).equals(original.sha256())
                    ? Status.INCLUDED : Status.INTEGRITY_MISMATCH;
            return new OriginalRead(content, status);
        } catch (CancellationException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            return new OriginalRead(null, Status.READ_FAILED);
        }
    }

    private record OriginalRead(byte[] content, Status status) { }

    public PreparedPart writeIndexPart(
            PortableSnapshot snapshot,
            List<OriginalOutcome> outcomes,
            Path destination,
            BooleanSupplier alive) {
        plan(snapshot);
        // validate every path/tuple even when no original part was requested here
        Map<UUID, OriginalOutcome> byAsset = validateOutcomes(snapshot, outcomes);
        byte[] archive = json(snapshot.archiveData());
        if (archive.length > PortableSnapshot.MAX_METADATA_BYTES) {
            throw new PortableExportException();
        }
        boolean complete = outcomes.stream().allMatch(row -> row.status() == Status.INCLUDED);
        return write(destination, alive, zip -> {
            entry(zip, "archive.json", archive, alive);
            entry(zip, "manifest.json", json(Map.of(
                    "format", "portable-delivery-manifest",
                    "version", 1,
                    "capturedAt", snapshot.capturedAt(),
                    "complete", complete,
                    "originalPartCount", snapshot.originalPartCount(),
                    "includedOriginals", outcomes.stream().filter(row -> row.status() == Status.INCLUDED).count(),
                    "originals", outcomes)), alive);
            entry(zip, "archive.txt", utf8(text(snapshot, byAsset)), alive);
            entry(zip, "index.html", utf8(html(snapshot, byAsset, complete)), alive);
            entry(zip, "README.txt", utf8(instructions() + "\nDelivery: " + (complete ? "All captured originals were included." :
                    "INCOMPLETE: at least one captured original could not be included. See manifest.json and archive.txt for each outcome.")
                    + "\nThis is a portable copy, not a restorable application database. Private accounts, credentials, retry keys, provider keys, grants, audit and erasure records are deliberately excluded.\n"), alive);
            return List.copyOf(outcomes);
        });
    }

    private PreparedPart write(
            Path destination,
            BooleanSupplier alive,
            ZipWork work) {
        check(alive);
        try (var artifact = new PartialArtifact(destination, cleaner)) {
            return writeArtifact(artifact, alive, work);
        }
    }

    private PreparedPart writeArtifact(
            PartialArtifact artifact,
            BooleanSupplier alive,
            ZipWork work) {
        try {
            Path path = checkedDestination(artifact.destination);
            Path parent = path.getParent();
            if (Files.getFileAttributeView(parent, PosixFileAttributeView.class) != null) {
                Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            } else {
                Files.createFile(path);
            }
            artifact.created = true;
            confirmPrivate(path, false, true);
            List<OriginalOutcome> outcomes;
            try (var output = new LimitedOutput(Files.newOutputStream(path, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS));
                    var zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
                outcomes = work.run(zip);
            }
            check(alive);
            long bytes = Files.size(path);
            if (bytes < 1 || bytes > MAX_ARTIFACT_BYTES) {
                throw new PortableExportException();
            }
            String hash;
            try (var input = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
                var digest = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[65_536];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    check(alive);
                    digest.update(buffer, 0, count);
                }
                hash = HexFormat.of().formatHex(digest.digest());
            }
            check(alive);
            var prepared = new PreparedPart(bytes, hash, outcomes);
            artifact.complete = true;
            return prepared;
        } catch (IOException | java.security.NoSuchAlgorithmException exception) {
            throw new PortableExportException();
        }
    }

    @FunctionalInterface
    interface FileCleaner {
        void delete(Path path) throws IOException;
    }

    private static final class PartialArtifact implements AutoCloseable {
        private final Path destination;
        private final FileCleaner cleaner;
        private boolean created;
        private boolean complete;

        private PartialArtifact(Path destination, FileCleaner cleaner) {
            this.destination = destination;
            this.cleaner = cleaner;
        }

        @Override
        public void close() {
            if (created && !complete) {
                try {
                    cleaner.delete(destination.toAbsolutePath().normalize());
                } catch (IOException exception) {
                    throw new PortableExportException();
                }
            }
        }
    }

    private static Path checkedDestination(Path destination) throws IOException {
        Path path = destination.toAbsolutePath().normalize();
        Path parent = path.getParent();
        if (parent == null
                || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(parent)
                || Files.exists(path, LinkOption.NOFOLLOW_LINKS)
                || Files.getFileStore(parent).getUsableSpace() < MAX_ARTIFACT_BYTES + MediaTypes.AUDIO_MAX_BYTES) {
            throw new PortableExportException();
        }
        confirmPrivate(parent, true, false);
        return path;
    }

    private static void entry(
            ZipOutputStream zip,
            String name,
            byte[] bytes,
            BooleanSupplier alive) throws IOException {
        check(alive);
        var crc = new CRC32();
        crc.update(bytes);
        var entry = new ZipEntry(name);
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(bytes.length);
        entry.setCompressedSize(bytes.length);
        entry.setCrc(crc.getValue());
        entry.setTime(0);
        zip.putNextEntry(entry);
        for (int offset = 0; offset < bytes.length; offset += 65_536) {
            check(alive);
            zip.write(bytes, offset, Math.min(65_536, bytes.length - offset));
        }
        zip.closeEntry();
        check(alive);
    }

    private static void validate(PortableSnapshot.Original row) {
        if (row.assetId() == null
                || row.assetId().version() != 4
                || row.assetId().variant() != 2
                || row.memoryId() == null
                || row.sha256() == null
                || !row.sha256().matches("[0-9a-f]{64}")
                || !MediaTypes.validTypeAndSize(row.contentType(), row.byteSize())
                || !PortableExportRepository.originalPath(row.assetId(), row.contentType()).equals(row.path())) {
            throw new PortableExportException();
        }
        validateAudioMetadata(row);
    }

    private static void validateAudioMetadata(PortableSnapshot.Original row) {
        boolean audio = MediaTypes.AUDIO_TYPES.contains(row.contentType());
        if (audio ? row.durationMs() == null
                || !MediaTypes.audioMetadataMatches(row.contentType(), row.audioContainer(), row.audioCodec(), row.durationMs())
                : row.durationMs() != null || row.audioContainer() != null || row.audioCodec() != null) {
            throw new PortableExportException();
        }
    }

    private static Map<UUID, OriginalOutcome> validateOutcomes(
            PortableSnapshot snapshot,
            List<OriginalOutcome> outcomes) {
        var byAsset = new HashMap<UUID, OriginalOutcome>();
        for (var outcome : outcomes) {
            if (outcome == null || outcome.status() == null || byAsset.put(outcome.assetId(), outcome) != null) {
                throw new PortableExportException();
            }
        }
        if (byAsset.size() != snapshot.originals().size()) {
            throw new PortableExportException();
        }
        for (var original : snapshot.originals()) {
            validateOutcome(original, byAsset.get(original.assetId()));
        }
        return byAsset;
    }

    private static void validateOutcome(PortableSnapshot.Original original, OriginalOutcome outcome) {
        if (outcome == null
                || !original.memoryId().equals(outcome.memoryId())
                || !original.path().equals(outcome.path())
                || (outcome.status() == Status.INCLUDED ? outcome.byteSize() != original.byteSize()
                || !original.sha256().equals(outcome.sha256())
                : outcome.byteSize() != 0 || outcome.sha256() != null)) {
            throw new PortableExportException();
        }
    }

    private static String text(
            PortableSnapshot snapshot,
            Map<UUID, OriginalOutcome> outcomes) {
        var text = new StringBuilder("Kevin & Mel — private portable archive\nCaptured: ").append(displayTime(snapshot.capturedAt()))
                .append("\nTimes are shown in Eastern time, including daylight saving. Machine-readable timestamps remain UTC.\n")
                .append("Memory dates are provided dates, not submission dates. YEAR and MONTH dates remain partial; UNKNOWN means no date was supplied.\n")
                .append("Excluded counts: ").append(snapshot.excludedCounts()).append("\n\nMEMORIES\n");
        for (var memory : snapshot.memories()) {
            text.append("\nMemory ").append(memory.memoryId()).append("\nType: ").append(memory.memoryType()).append("; review: ").append(memory.reviewStatus())
                    .append("\nFrom: ").append(attribution(memory)).append("\nContribution: ").append(memory.contributionId()).append("; item position: ").append(memory.itemPosition())
                    .append("\nProvided date: ").append(date(memory.memoryDate(), memory.datePrecision())).append("\nSaved on: ").append(displayTime(memory.createdAt())).append('\n');
            labeled(text, "Title", memory.title());
            labeled(text, DESCRIPTION_LABEL, memory.description());
            labeled(text, "Note", memory.text());
            labeled(text, "Caption", memory.caption());
            if (memory.assetId() != null) {
                var outcome = outcomes.get(memory.assetId());
                text.append("Original: ").append(outcome.path()).append(" — ").append(outcome.status()).append('\n');
            }
        }
        text.append("\nALBUMS (member positions are exact decimal integers)\n");
        for (var album : snapshot.albums()) {
            text.append('\n').append(album.name()).append(" [").append(album.id()).append("]\n");
            for (var member : album.members()) {
                text.append(member.position()).append(": ").append(member.memoryId()).append('\n');
            }
        }
        text.append("\nLIFE TIMELINE\n");
        for (var event : snapshot.events()) {
            text.append('\n').append(event.title()).append(" [").append(event.id()).append("]\nProvided date: ")
                    .append(date(event.eventDate(), event.datePrecision())).append('\n');
            labeled(text, DESCRIPTION_LABEL, event.description());
            text.append("Memories: ").append(event.memoryIds()).append('\n');
        }
        text.append("\nTAGS\n");
        for (var tag : snapshot.tags()) {
            text.append('\n').append(tag.name()).append(" [").append(tag.id()).append("]\nMemories: ").append(tag.memoryIds()).append('\n');
        }
        return text.toString();
    }

    private static String html(
            PortableSnapshot snapshot,
            Map<UUID, OriginalOutcome> outcomes,
            boolean complete) {
        Set<UUID> visible = snapshot.memories().stream()
                .limit(READER_ROWS)
                .map(memory -> memory.memoryId())
                .collect(java.util.stream.Collectors.toSet());
        var html = new StringBuilder("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">")
                .append("<title>Kevin &amp; Mel — portable archive</title><style>body{max-width:60rem;margin:2rem auto;padding:0 1rem;font:1rem/1.6 system-ui;color:#242424}article{border-top:1px solid #bbb;padding:1rem 0}p,li{overflow-wrap:anywhere;white-space:pre-wrap}a{color:#174c87}nav a{margin-right:1rem}</style></head><body><h1>Kevin &amp; Mel — private archive</h1>")
                .append("<p>Extract every original part and the final index part into the same folder. Keep this folder private.</p><p>")
                .append(complete ? "All captured originals were included." : "INCOMPLETE: some captured originals are missing, could not be read, or failed integrity checks. See each original outcome below.")
                .append("</p><p>This page shows bounded previews (up to 1,000 rows per section and 512 characters per text). <a href=\"archive.txt\">Read the complete human-readable archive</a>, <a href=\"archive.json\">machine-readable archive</a>, or <a href=\"manifest.json\">original delivery outcomes</a>.</p>")
                .append("<p>Provided dates preserve their YEAR, MONTH or DAY precision. “Date unknown” means none was supplied. “Saved on” is the submission time, shown in Eastern time with daylight saving.</p><p>Excluded counts: ")
                .append(escape(snapshot.excludedCounts().toString())).append("</p><nav><a href=\"#memories\">Memories</a><a href=\"#albums\">Albums</a><a href=\"#timeline\">Life timeline</a><a href=\"#tags\">Tags</a></nav><h2 id=\"memories\">Memories</h2>");
        for (var memory : snapshot.memories().stream().limit(READER_ROWS).toList()) {
            html.append("<article id=\"memory-").append(memory.memoryId()).append("\"><h3>").append(escape(memory.title() == null ? memory.memoryType() + " memory" : excerpt(memory.title())))
                    .append("</h3><p>").append(escape(attribution(memory))).append(" · ").append(escape(memory.reviewStatus())).append("</p><p>Provided date: ")
                    .append(escape(date(memory.memoryDate(), memory.datePrecision()))).append("<br>Saved on: <time datetime=\"").append(memory.createdAt())
                    .append("\">").append(escape(displayTime(memory.createdAt()))).append("</time></p>");
            paragraph(html, DESCRIPTION_LABEL, memory.description());
            paragraph(html, "Note", memory.text());
            paragraph(html, "Caption", memory.caption());
            if (memory.assetId() != null) {
                var outcome = outcomes.get(memory.assetId());
                html.append("<p>Original: ").append(outcome.status());
                if (outcome.status() == Status.INCLUDED) {
                    html.append(" — <a href=\"").append(outcome.path()).append("\">Open original file</a>");
                }
                html.append("</p>");
            }
            html.append("<p>Memory ID: ").append(memory.memoryId()).append("</p></article>");
        }
        html.append("<h2 id=\"albums\">Albums</h2>");
        for (var album : snapshot.albums().stream().limit(READER_ROWS).toList()) {
            html.append(ARTICLE_START).append(escape(excerpt(album.name()))).append("</h3><ol>");
            for (var member : album.members().stream().limit(READER_ROWS).toList()) {
                html.append("<li>Position ").append(member.position()).append(": ").append(memoryLink(member.memoryId(), visible)).append("</li>");
            }
            html.append("</ol><p>Total members: ").append(album.members().size()).append(". Full ordering is in archive.txt and archive.json.</p></article>");
        }
        html.append("<h2 id=\"timeline\">Life timeline</h2>");
        for (var event : snapshot.events().stream().limit(READER_ROWS).toList()) {
            html.append(ARTICLE_START).append(escape(excerpt(event.title()))).append("</h3><p>").append(escape(date(event.eventDate(), event.datePrecision()))).append("</p>");
            paragraph(html, DESCRIPTION_LABEL, event.description());
            members(html, event.memoryIds(), visible);
            html.append("</article>");
        }
        html.append("<h2 id=\"tags\">Tags</h2>");
        for (var tag : snapshot.tags().stream().limit(READER_ROWS).toList()) {
            html.append(ARTICLE_START).append(escape(excerpt(tag.name()))).append("</h3>");
            members(html, tag.memoryIds(), visible);
            html.append("</article>");
        }
        return html.append("</body></html>").toString();
    }

    private static void members(
            StringBuilder html,
            List<UUID> ids,
            Set<UUID> visible) {
        html.append("<ul>");
        for (UUID id : ids.stream().limit(READER_ROWS).toList()) {
            html.append("<li>").append(memoryLink(id, visible)).append("</li>");
        }
        html.append("</ul><p>Total linked memories: ").append(ids.size()).append(". Full links are in archive.txt and archive.json.</p>");
    }

    private static String memoryLink(
            UUID id,
            Set<UUID> visible) {
        return visible.contains(id) ? "<a href=\"#memory-" + id + "\">" + id + "</a>" : id + " — <a href=\"archive.txt\">see complete archive</a>";
    }

    private static void paragraph(
            StringBuilder html,
            String label,
            String value) {
        if (value != null) {
            html.append("<p>").append(label).append(": ").append(escape(excerpt(value))).append("</p>");
        }
    }

    private static void labeled(
            StringBuilder text,
            String label,
            String value) {
        if (value != null) {
            text.append(label).append(": ").append(value).append('\n');
        }
    }

    private static String attribution(PortableSnapshot.Memory memory) {
        return "COUPLE".equals(memory.source()) ? "Couple memory" : memory.guestName() == null ? "Anonymous guest" : memory.guestName();
    }

    private static String date(
            String date,
            String precision) {
        return date == null ? "Date unknown" : date + " (" + precision + ")";
    }

    private static String displayTime(Instant instant) {
        return DISPLAY_TIME.format(instant);
    }

    private static String excerpt(String value) {
        if (value.length() <= 512) {
            return value;
        }
        int end = Character.isHighSurrogate(value.charAt(511)) ? 511 : 512;
        return value.substring(0, end) + "… [continued in archive.txt]";
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private static byte[] json(Object value) {
        return PortableExportRepository.JSON.writeValueAsBytes(value);
    }

    private static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String instructions() {
        return "Kevin & Mel — private portable archive\n\nDownload every original part and the final index part. Extract ALL ZIPs into the SAME folder, preserving their relative paths. Then open index.html; archive.txt has complete readable notes and organization, archive.json the complete machine-readable data, and manifest.json every original outcome. This folder needs no app, account, cookie, JavaScript or network. Original filenames are metadata only; originals use safe asset-UUID filenames. Verify included originals using their SHA-256 and byte size in archive.json/manifest.json. A complete delivery means all captured eligible originals were included, not that excluded deleted or unfinished memories were recovered.\n\nEach part is private. Protect your downloaded files. Changes or deletions after delivery cannot recall existing copies. Albums, events and tags are organization; they contain links to memories, not duplicate originals. Partial dates remain partial.\n";
    }

    private static void check(BooleanSupplier alive) {
        if (!alive.getAsBoolean()) {
            throw new CancellationException("Portable archive preparation stopped.");
        }
    }

    private static void confirmPrivate(
            Path path,
            boolean directory,
            boolean establish) throws IOException {
        if (establish) {
            var owner = Files.getOwner(path.getParent(), LinkOption.NOFOLLOW_LINKS);
            if (!Files.getOwner(path, LinkOption.NOFOLLOW_LINKS).equals(owner)) {
                throw new PortableExportException();
            }
        }
        var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (posix != null) {
            var permissions = PosixFilePermissions.fromString(directory ? "rwx------" : "rw-------");
            if (establish) {
                posix.setPermissions(permissions);
            }
            if (!posix.readAttributes().permissions().equals(permissions)) {
                throw new PortableExportException();
            }
            return;
        }
        var acl = Files.getFileAttributeView(path, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (acl == null) {
            throw new PortableExportException();
        }
        var owner = acl.getOwner();
        if (establish) {
            acl.setAcl(List.of(AclEntry.newBuilder()
                    .setType(AclEntryType.ALLOW)
                    .setPrincipal(owner)
                    .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                    .build()));
        }
        if (acl.getAcl().stream().anyMatch(entry -> entry.type() == AclEntryType.ALLOW && !entry.principal().equals(owner))) {
            throw new PortableExportException();
        }
    }

    @FunctionalInterface
    private interface ZipWork {
        List<OriginalOutcome> run(ZipOutputStream zip) throws IOException;
    }

    private static final class LimitedOutput extends FilterOutputStream {
        long count;
        LimitedOutput(OutputStream output) {
            super(output);
        }
        @Override
        public void write(int value) throws IOException {
            reserve(1);
            out.write(value);
        }
        @Override
        public void write(
                byte[] bytes,
                int offset,
                int length) throws IOException {
            reserve(length);
            out.write(bytes, offset, length);
        }
        private void reserve(int length) throws IOException {
            if (length < 0 || count + length > MAX_ARTIFACT_BYTES) {
                throw new IOException("Portable artifact size limit.");
            }
            count += length;
        }
    }

    public record OriginalPart(
            int index,
            List<PortableSnapshot.Original> originals) {
        public OriginalPart {
            originals = List.copyOf(originals);
        }
    }

    public record PreparedPart(
            long byteSize,
            String sha256,
            List<OriginalOutcome> outcomes) {
        public PreparedPart {
            outcomes = List.copyOf(outcomes);
        }
    }

    public record OriginalOutcome(
            UUID memoryId,
            UUID assetId,
            Status status,
            String path,
            long byteSize,
            String sha256) {
    }

    public enum Status {
        INCLUDED,
                MISSING,
                INTEGRITY_MISMATCH,
                READ_FAILED
    }
}
