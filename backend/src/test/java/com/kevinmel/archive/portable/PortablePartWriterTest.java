package com.kevinmel.archive.portable;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipFile;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.kevinmel.archive.media.ObjectStorage;
import tools.jackson.databind.JsonNode;

/** Verified storage contract fixtures, not image/audio decoder or provider acceptance. */
class PortablePartWriterTest {
    private static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");
    @TempDir Path temporary;

    @Test void extractedMixedArchiveHasExactStoredOriginalsFullNotesOrderedOrganizationAndAnInertEscapedReader() throws Exception {
        Path directory = privateDirectory(); var storage = new Storage(); var writer = new PortablePartWriter(storage);
        byte[] photo = new byte[] {1, 2, 3, 4}, audio = new byte[] {5, 6, 7};
        var first = original(photo, "image/png", "../../unsafe-photo.png");
        var second = original(audio, "audio/webm", "<script>unsafe.webm</script>");
        storage.bytes.put(first.assetId(), photo); storage.bytes.put(second.assetId(), audio);
        String longNote = "Complete note <script>alert('private')</script> & \"quoted\" " + "🌻".repeat(600);
        var note = memory(UUID.randomUUID(), "TEXT", "GUEST", null, longNote, null, "2020", "YEAR");
        var photoMemory = memory(first.memoryId(), "PHOTO", "GUEST", "Guest <img src=x onerror=alert(1)>", null, first.assetId(), "2020-05", "MONTH");
        var audioMemory = memory(second.memoryId(), "AUDIO", "COUPLE", null, null, second.assetId(), null, "UNKNOWN");
        UUID album = UUID.randomUUID(), event = UUID.randomUUID(), tag = UUID.randomUUID();
        var snapshot = snapshot(List.of(note, photoMemory, audioMemory), List.of(first, second),
                List.of(new PortableSnapshot.Album(album, "<script>Album</script>", NOW, NOW,
                        List.of(new PortableSnapshot.AlbumMember(first.memoryId(), "1"), new PortableSnapshot.AlbumMember(note.memoryId(), Long.toString(Long.MAX_VALUE))))),
                List.of(new PortableSnapshot.Event(event, "Life & love", "Event details", "2020-02-29", "DAY", NOW, NOW, List.of(second.memoryId()))),
                List.of(new PortableSnapshot.Tag(tag, "<b>Shared tag</b>", NOW, NOW, List.of(first.memoryId(), second.memoryId()))));
        var originalZip = directory.resolve("original-part.zip");
        var prepared = writer.writeOriginalPart(snapshot, writer.plan(snapshot).getFirst(), originalZip, () -> true);
        assertThat(prepared.byteSize()).isEqualTo(Files.size(originalZip));
        assertThat(prepared.sha256()).isEqualTo(PortableExportRepository.sha256(Files.readAllBytes(originalZip)));
        assertThat(prepared.outcomes()).allMatch(row -> row.status() == PortablePartWriter.Status.INCLUDED);
        extract(originalZip, directory);
        assertThat(Files.readAllBytes(directory.resolve(first.path()))).isEqualTo(photo);
        assertThat(Files.readAllBytes(directory.resolve(second.path()))).isEqualTo(audio);
        Path indexZip = directory.resolve("index-part.zip");
        writer.writeIndexPart(snapshot, prepared.outcomes(), indexZip, () -> true); extract(indexZip, directory);
        String html = Files.readString(directory.resolve("index.html")), text = Files.readString(directory.resolve("archive.txt"));
        JsonNode archive = PortableExportRepository.JSON.readTree(Files.readAllBytes(directory.resolve("archive.json")));
        assertThat(archive.get("memories").get(0).get("text").asString()).isEqualTo(longNote);
        assertThat(archive.get("albums").get(0).get("members").get(1).get("position").asString()).isEqualTo(Long.toString(Long.MAX_VALUE));
        assertThat(archive.toString()).doesNotContain("revision", "object_key", "author_account_id", "idempotency", "grant", "validation");
        assertThat(text).contains(longNote, "2020 (YEAR)", "2020-05 (MONTH)", "2020-02-29 (DAY)", "Date unknown", "Anonymous guest", "Couple memory");
        assertThat(html).contains("&lt;script&gt;Album&lt;/script&gt;", "&lt;img src=x onerror=alert(1)&gt;", "continued in archive.txt", "up to 1,000 rows", first.path());
        assertThat(html).doesNotContain("<script", "<img", "javascript:", "https://", "http://", "fetch(", "onerror=\"");
        assertThat(PortableExportRepository.JSON.readTree(Files.readAllBytes(directory.resolve("manifest.json"))).get("complete").asBoolean()).isTrue();
        assertThat(Files.readString(directory.resolve("README.txt"))).contains("SAME folder", "no app, account, cookie, JavaScript or network", "not a restorable application database");
        try (var zip = new ZipFile(originalZip.toFile())) { assertThat(zip.stream().toList()).allMatch(entry -> entry.getMethod() == java.util.zip.ZipEntry.STORED); }
        assertPrivate(originalZip);
    }

    @Test void missingWrongSizeWrongHashAndReadFailureRemainExplicitAndNeverPublishBadBytes() throws Exception {
        Path directory = privateDirectory(); var storage = new Storage(); var writer = new PortablePartWriter(storage);
        var originals = List.of(original(new byte[] {1, 2}, "image/png", "missing.png"), original(new byte[] {3, 4}, "image/png", "size.png"),
                original(new byte[] {5, 6}, "image/png", "hash.png"), original(new byte[] {7, 8}, "image/png", "failed.png"));
        storage.bytes.put(originals.get(1).assetId(), new byte[] {3}); storage.bytes.put(originals.get(2).assetId(), new byte[] {5, 7});
        storage.failed = originals.get(3).assetId();
        var snapshot = snapshot(originals.stream().map(row -> memory(row.memoryId(), "PHOTO", "GUEST", null, null, row.assetId(), null, "UNKNOWN")).toList(), originals, List.of(), List.of(), List.of());
        var prepared = writer.writeOriginalPart(snapshot, writer.plan(snapshot).getFirst(), directory.resolve("originals.zip"), () -> true);
        assertThat(prepared.outcomes()).extracting(PortablePartWriter.OriginalOutcome::status).containsExactly(
                PortablePartWriter.Status.MISSING, PortablePartWriter.Status.INTEGRITY_MISMATCH, PortablePartWriter.Status.INTEGRITY_MISMATCH, PortablePartWriter.Status.READ_FAILED);
        assertThat(prepared.outcomes()).allMatch(row -> row.byteSize() == 0 && row.sha256() == null);
        try (var zip = new ZipFile(directory.resolve("originals.zip").toFile())) { assertThat(zip.stream().map(java.util.zip.ZipEntry::getName).toList()).noneMatch(name -> name.startsWith("originals/")); }
        writer.writeIndexPart(snapshot, prepared.outcomes(), directory.resolve("index.zip"), () -> true); extract(directory.resolve("index.zip"), directory);
        assertThat(Files.readString(directory.resolve("index.html"))).contains("INCOMPLETE", "MISSING", "INTEGRITY_MISMATCH", "READ_FAILED").doesNotContain("Open original file");
        String manifest = Files.readString(directory.resolve("manifest.json"));
        assertThat(manifest).contains("\"complete\":false", "\"includedOriginals\":0").doesNotContain("sensitive provider message");
    }

    @Test void partPlanningBoundsCountPayloadAndTotalAndRejectsUntrustedPathsBeforeFileCreation() throws Exception {
        var writer = new PortablePartWriter(new Storage()); var rows = new ArrayList<PortableSnapshot.Original>();
        for (int index = 0; index < 51; index++) rows.add(original(new byte[] {1}, "image/png", "same-name.png"));
        assertThat(writer.plan(snapshot(List.of(), rows, List.of(), List.of(), List.of()))).extracting(part -> part.originals().size()).containsExactly(50, 1);
        rows.clear(); for (int index = 0; index < 3; index++) rows.add(descriptor(25_000_000));
        assertThat(writer.plan(snapshot(List.of(), rows, List.of(), List.of(), List.of()))).extracting(part -> part.originals().size()).containsExactly(2, 1);
        rows.clear(); for (int index = 0; index < 301; index++) rows.add(descriptor(25_000_000));
        var excessive = snapshot(List.of(), rows, List.of(), List.of(), List.of());
        assertThatThrownBy(() -> writer.plan(excessive)).isInstanceOf(PortableExportException.class);
        var valid = original(new byte[] {1}, "image/png", "display-only.png");
        var unsafe = new PortableSnapshot.Original(valid.memoryId(), valid.assetId(), "../outside.png", valid.contentType(), valid.byteSize(), valid.sha256(), null, null, null, valid.originalFilename());
        assertThatThrownBy(() -> writer.plan(snapshot(List.of(), List.of(unsafe), List.of(), List.of(), List.of()))).isInstanceOf(PortableExportException.class);
        var tooMany = new ArrayList<PortableSnapshot.Original>(); for (int index=0;index<10_001;index++) tooMany.add(original(new byte[] {1}, "image/png", "one.png"));
        assertThatThrownBy(() -> writer.plan(snapshot(List.of(), tooMany, List.of(), List.of(), List.of()))).isInstanceOf(PortableExportException.class);
    }

    @Test void staleOrRevokedOriginalAfterReadDeletesOwnedPartialFileAndDbCheckpointsScaleWithFilesNotBytes() throws Exception {
        Path directory = privateDirectory(); var storage = new Storage(); var writer = new PortablePartWriter(storage);
        byte[] bytes = new byte[1_000_000]; var original = original(bytes, "image/png", "large.png"); storage.bytes.put(original.assetId(), bytes);
        var snapshot = snapshot(List.of(memory(original.memoryId(), "PHOTO", "GUEST", null, null, original.assetId(), null, "UNKNOWN")), List.of(original), List.of(), List.of(), List.of());
        var checkpoints = new AtomicInteger();
        writer.writeOriginalPart(snapshot, writer.plan(snapshot).getFirst(), directory.resolve("valid.zip"), () -> true, ignored -> { checkpoints.incrementAndGet(); return true; });
        assertThat(checkpoints.get()).isEqualTo(2);
        checkpoints.set(0); Path aborted = directory.resolve("aborted.zip");
        assertThatThrownBy(() -> writer.writeOriginalPart(snapshot, writer.plan(snapshot).getFirst(), aborted, () -> true,
                ignored -> checkpoints.incrementAndGet() == 1)).isInstanceOf(CancellationException.class);
        assertThat(checkpoints.get()).isEqualTo(2); assertThat(aborted).doesNotExist();
        var alive = new AtomicBoolean(true); storage.onRead = () -> alive.set(false);
        assertThatThrownBy(() -> writer.writeOriginalPart(snapshot, writer.plan(snapshot).getFirst(), aborted, alive::get, ignored -> true)).isInstanceOf(CancellationException.class);
        assertThat(aborted).doesNotExist();
    }

    @Test void finalIndexRequiresCompleteExactOutcomeIdentityAndMetadataLimitAndNeverOverwritesExistingFiles() throws Exception {
        Path directory = privateDirectory(); var writer = new PortablePartWriter(new Storage());
        var original = original(new byte[] {1}, "image/png", "safe.png");
        var snapshot = snapshot(List.of(), List.of(original), List.of(), List.of(), List.of()); Path destination = directory.resolve("index.zip");
        assertThatThrownBy(() -> writer.writeIndexPart(snapshot, List.of(), destination, () -> true)).isInstanceOf(PortableExportException.class);
        var lie = new PortablePartWriter.OriginalOutcome(original.memoryId(), original.assetId(), PortablePartWriter.Status.INCLUDED, original.path(), 2, original.sha256());
        assertThatThrownBy(() -> writer.writeIndexPart(snapshot, List.of(lie), destination, () -> true)).isInstanceOf(PortableExportException.class);
        var outcome = new PortablePartWriter.OriginalOutcome(original.memoryId(), original.assetId(), PortablePartWriter.Status.MISSING, original.path(), 0, null);
        assertThatThrownBy(() -> writer.writeIndexPart(snapshot, List.of(outcome, outcome), destination, () -> true)).isInstanceOf(PortableExportException.class);
        var enormous = snapshot(List.of(memory(UUID.randomUUID(), "TEXT", "GUEST", null, "x".repeat(PortableSnapshot.MAX_METADATA_BYTES), null, null, "UNKNOWN")), List.of(), List.of(), List.of(), List.of());
        assertThatThrownBy(() -> writer.writeIndexPart(enormous, List.of(), destination, () -> true)).isInstanceOf(PortableExportException.class);
        assertThat(destination).doesNotExist(); Files.writeString(destination, "existing-owned-marker");
        assertThatThrownBy(() -> writer.writeIndexPart(snapshot, List.of(outcome), destination, () -> true)).isInstanceOf(PortableExportException.class);
        assertThat(Files.readString(destination)).isEqualTo("existing-owned-marker");
    }

    static PortableSnapshot snapshot(List<PortableSnapshot.Memory> memories, List<PortableSnapshot.Original> originals, List<PortableSnapshot.Album> albums,
            List<PortableSnapshot.Event> events, List<PortableSnapshot.Tag> tags) {
        return new PortableSnapshot(NOW, memories, originals, albums, events, tags, Map.of("deletedOrPurgingMemories", 2L, "unfinishedOrUnavailableMemories", 1L), Map.of());
    }
    static PortableSnapshot.Memory memory(UUID id, String type, String source, String name, String text, UUID asset, String date, String precision) {
        return new PortableSnapshot.Memory(id, UUID.randomUUID(), "TEXT".equals(type) ? null : 0, type, source, name, "KEEP", text,
                "TEXT".equals(type) ? null : "Caption <&>", "Title <&>", null, date, precision, NOW, NOW, asset);
    }
    private static PortableSnapshot.Original original(byte[] bytes, String mime, String name) {
        UUID asset = UUID.randomUUID(); boolean audio = mime.startsWith("audio/");
        return new PortableSnapshot.Original(UUID.randomUUID(), asset, PortableExportRepository.originalPath(asset, mime), mime, bytes.length,
                PortableExportRepository.sha256(bytes), audio ? 1000L : null, audio ? "webm" : null, audio ? "opus" : null, name);
    }
    private static PortableSnapshot.Original descriptor(long bytes) {
        UUID asset = UUID.randomUUID(); return new PortableSnapshot.Original(UUID.randomUUID(), asset, PortableExportRepository.originalPath(asset, "audio/webm"), "audio/webm", bytes, "a".repeat(64), 1000L, "webm", "opus", "recording.webm");
    }
    private Path privateDirectory() throws Exception {
        Path path = temporary.resolve(UUID.randomUUID().toString()); Files.createDirectory(path);
        var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class);
        if (posix != null) posix.setPermissions(PosixFilePermissions.fromString("rwx------"));
        else { var acl = Files.getFileAttributeView(path, AclFileAttributeView.class); acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW)
                .setPrincipal(acl.getOwner()).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build())); }
        return path;
    }
    private static void assertPrivate(Path path) throws Exception {
        var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (posix != null) assertThat(posix.readAttributes().permissions()).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        else { var acl = Files.getFileAttributeView(path, AclFileAttributeView.class); var owner=acl.getOwner(); assertThat(acl.getAcl()).allMatch(entry -> entry.type()!=AclEntryType.ALLOW || entry.principal().equals(owner)); }
    }
    private static void extract(Path archive, Path directory) throws Exception {
        try (var zip = new ZipFile(archive.toFile())) {
            for (var entry : zip.stream().toList()) {
                Path path = directory.resolve(entry.getName()).normalize(); assertThat(path.startsWith(directory.toAbsolutePath().normalize())).isTrue();
                Files.createDirectories(path.getParent()); try (var input = zip.getInputStream(entry)) { Files.copy(input, path); }
            }
        }
    }
    private static final class Storage implements ObjectStorage {
        final Map<UUID, byte[]> bytes = new HashMap<>(); UUID failed; Runnable onRead = () -> {};
        @Override public Optional<byte[]> read(String key, int maxBytes) { UUID id = UUID.fromString(key.substring("originals/".length())); onRead.run();
            if (id.equals(failed)) throw new IllegalStateException("sensitive provider message"); return Optional.ofNullable(bytes.get(id)); }
        @Override public void requireAvailable() { throw new AssertionError("Notes-only export must not contact storage."); }
        @Override public UploadGrant authorize(UUID id,String key,String type,long bytes,Instant expires) { throw new AssertionError("No grants."); }
        @Override public ReadGrant authorizeRead(String key,String type,long bytes,Instant expires) { throw new AssertionError("No signed URLs."); }
        @Override public void publish(String key,byte[] bytes,String type) { throw new AssertionError("No provider writes."); }
    }
}
