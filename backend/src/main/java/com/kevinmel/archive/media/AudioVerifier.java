package com.kevinmel.archive.media;

import com.kevinmel.archive.web.ApiException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Bounded full decoding of an original; decoded PCM is counted and discarded, never persisted. */
@Component
public class AudioVerifier {
    public static final long MAX_BYTES = 25_000_000;
    public static final long MAX_DURATION_MS = 120_000;
    private static final long MAX_PCM_BYTES = 120L * 48_000 * 2;
    private static final int TIMEOUT_SECONDS = 20;
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int[] OGG_CRC = oggCrcTable();
    private final String ffmpeg;
    private final String ffprobe;
    private final ProcessFactory processes;
    private final long timeoutMillis;
    private volatile boolean available;

    public AudioVerifier() {
        this(System.getenv().getOrDefault("MEMORY_ARCHIVE_FFMPEG", "ffmpeg"),
                System.getenv().getOrDefault("MEMORY_ARCHIVE_FFPROBE", "ffprobe"));
    }

    @Autowired
    public AudioVerifier(@Value("${archive.audio.ffmpeg:ffmpeg}") String ffmpeg,
                         @Value("${archive.audio.ffprobe:ffprobe}") String ffprobe) {
        this(ffmpeg, ffprobe, AudioVerifier::startDecoder, TIMEOUT_SECONDS * 1000L);
    }

    AudioVerifier(String ffmpeg, String ffprobe, ProcessFactory processes, long timeoutMillis) {
        this.ffmpeg = ffmpeg;
        this.ffprobe = ffprobe;
        this.processes = processes;
        this.timeoutMillis = timeoutMillis;
    }

    /** Missing tools are an operational failure and must not mark an otherwise retryable upload FAILED. */
    public synchronized void requireAvailable() {
        if (available) return;
        for (String executable : List.of(ffmpeg, ffprobe)) {
            Result result = run(List.of(executable, "-version"), 65_536, true);
            if (result.exit() != 0 || result.bytes() == 0) throw unavailable();
        }
        available = true;
    }

    public Verified verify(byte[] bytes, PhotoRepository.Asset expected) {
        if (bytes == null || bytes.length == 0 || bytes.length != expected.byteSize()
                || bytes.length > MAX_BYTES || !List.of("audio/webm", "audio/ogg", "audio/mp4").contains(expected.contentType()))
            throw invalid();
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (!MessageDigest.isEqual(hash.getBytes(StandardCharsets.US_ASCII),
                    expected.checksum().getBytes(StandardCharsets.US_ASCII))) throw invalid();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        checkContainerHeader(bytes, expected.contentType());
        requireAvailable();
        Path directory = null;
        Path original = null;
        try {
            directory = privateDirectory();
            original = directory.resolve("original");
            privateFile(original);
            Files.write(original, bytes);
            List<String> input = inputOptions(expected.contentType(), original);
            var probe = new ArrayList<>(List.of(ffprobe, "-v", "warning", "-max_alloc", "67108864", "-threads", "1"));
            probe.addAll(input.subList(0, input.size() - 2));
            probe.addAll(List.of("-show_entries", "format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels,duration",
                    "-of", "json", original.toString()));
            Result inspected = run(probe, 65_536, true);
            if (inspected.exit() != 0 || inspected.errors()) throw invalid();
            JsonNode metadata;
            try { metadata = JSON.readTree(inspected.output()); }
            catch (tools.jackson.core.JacksonException malformed) { throw invalid(); }
            JsonNode streams = metadata.path("streams");
            if (!streams.isArray() || streams.size() != 1) throw invalid();
            JsonNode stream = streams.get(0);
            String codec = stream.path("codec_name").asText();
            if (!"audio".equals(stream.path("codec_type").asText())
                    || stream.path("channels").asInt() < 1 || stream.path("channels").asInt() > 2
                    || stream.path("sample_rate").asInt() < 8_000 || stream.path("sample_rate").asInt() > 96_000)
                throw invalid();
            String container = switch (expected.contentType()) {
                case "audio/webm" -> "webm";
                case "audio/ogg" -> "ogg";
                case "audio/mp4" -> "mp4";
                default -> throw invalid();
            };
            if (!(container.equals("mp4") ? codec.equals("aac") : codec.equals("opus"))) throw invalid();
            checkHeaderDuration(metadata.path("format").path("duration"));
            checkHeaderDuration(stream.path("duration"));
            var decode = new ArrayList<>(List.of(ffmpeg, "-nostdin", "-v", "warning", "-max_alloc", "67108864", "-xerror", "-err_detect", "explode", "-threads", "1"));
            decode.addAll(input);
            // Fill timestamp gaps with silence so container timing cannot bypass the playback duration cap.
            decode.addAll(List.of("-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "48000",
                    "-af", "aresample=async=1:first_pts=0", "-threads", "1", "-f", "s16le", "pipe:1"));
            Result decoded = run(decode, MAX_PCM_BYTES, false);
            if (decoded.exit() != 0 || decoded.errors() || decoded.bytes() == 0 || decoded.bytes() % 2 != 0) throw invalid();
            long durationMs = (decoded.bytes() / 2 * 1000 + 47_999) / 48_000;
            if (durationMs < 1 || durationMs > MAX_DURATION_MS) throw invalid();
            return new Verified(expected.contentType(), container, codec, durationMs);
        } catch (IOException storageFailure) {
            throw unavailable();
        } catch (IllegalArgumentException malformed) {
            throw invalid();
        } finally {
            if (original != null) try { Files.deleteIfExists(original); } catch (IOException ignored) { /* no logs of private paths */ }
            if (directory != null) try { Files.deleteIfExists(directory); } catch (IOException ignored) { /* no logs of private paths */ }
        }
    }

    private static Process startDecoder(List<String> command) throws IOException {
        var builder = new ProcessBuilder(command);
        var environment = builder.environment();
        environment.clear();
        // Decoder children need no database, storage or application secrets, nor FFREPORT log settings.
        for (String name : List.of("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP")) {
            String value = System.getenv(name);
            if (value != null) environment.put(name, value);
        }
        environment.put("LC_ALL", "C");
        return builder.start();
    }

    private static void checkContainerHeader(byte[] bytes, String type) {
        if (type.equals("audio/ogg")) {
            checkOggPages(bytes);
        } else if (type.equals("audio/mp4")) {
            if (bytes.length < 16 || !new String(bytes, 4, 4, StandardCharsets.US_ASCII).equals("ftyp")) throw invalid();
            long length = java.nio.ByteBuffer.wrap(bytes, 0, 4).getInt() & 0xffffffffL;
            if (length < 16 || length > bytes.length || length > 4096) throw invalid();
            String brand = new String(bytes, 8, 4, StandardCharsets.US_ASCII);
            if (!List.of("isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "M4A ", "dash", "cmfc").contains(brand)) throw invalid();
        } else {
            if (bytes.length < 5 || java.nio.ByteBuffer.wrap(bytes, 0, 4).getInt() != 0x1a45dfa3) throw invalid();
            int[] position = {4};
            long headerLength = vint(bytes, position, false);
            if (headerLength > 4096 || headerLength > bytes.length - position[0]) throw invalid();
            int end = position[0] + (int) headerLength;
            boolean webm = false;
            while (position[0] < end) {
                long id = vint(bytes, position, true);
                long size = vint(bytes, position, false);
                if (size > end - position[0]) throw invalid();
                if (id == 0x4282) {
                    if (webm || size != 4 || !new String(bytes, position[0], 4, StandardCharsets.US_ASCII).equals("webm")) throw invalid();
                    webm = true;
                }
                position[0] += (int) size;
            }
            if (!webm || position[0] != end) throw invalid();
        }
    }

    private static void checkOggPages(byte[] bytes) {
        int offset = 0, sequence = 0;
        long serial = -1;
        boolean continued = false, ended = false;
        while (offset < bytes.length) {
            if (ended || bytes.length - offset < 27 || !new String(bytes, offset, 4, StandardCharsets.US_ASCII).equals("OggS")
                    || bytes[offset + 4] != 0) throw invalid();
            int flags = bytes[offset + 5] & 255;
            if ((flags & ~7) != 0 || ((flags & 1) != 0) != continued || ((flags & 2) != 0) != (sequence == 0)) throw invalid();
            var header = java.nio.ByteBuffer.wrap(bytes, offset + 14, 12).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            long pageSerial = header.getInt() & 0xffffffffL;
            if (serial < 0) serial = pageSerial;
            if (pageSerial != serial || header.getInt() != sequence++) throw invalid();
            int expectedCrc = header.getInt();
            int segments = bytes[offset + 26] & 255;
            if (segments == 0 || bytes.length - offset < 27 + segments) throw invalid();
            int length = 27 + segments;
            for (int i = 0; i < segments; i++) length += bytes[offset + 27 + i] & 255;
            if (length > bytes.length - offset) throw invalid();
            int crc = 0;
            for (int i = 0; i < length; i++) {
                int value = i >= 22 && i <= 25 ? 0 : bytes[offset + i] & 255;
                crc = (crc << 8) ^ OGG_CRC[((crc >>> 24) ^ value) & 255];
            }
            if (crc != expectedCrc) throw invalid();
            continued = (bytes[offset + 26 + segments] & 255) == 255;
            ended = (flags & 4) != 0;
            if (ended && continued) throw invalid();
            offset += length;
        }
        if (!ended || continued) throw invalid();
    }

    private static int[] oggCrcTable() {
        int[] table = new int[256];
        for (int i = 0; i < table.length; i++) {
            int remainder = i << 24;
            for (int bit = 0; bit < 8; bit++) remainder = (remainder << 1) ^ (remainder < 0 ? 0x04c11db7 : 0);
            table[i] = remainder;
        }
        return table;
    }

    private static long vint(byte[] bytes, int[] position, boolean identifier) {
        if (position[0] >= bytes.length) throw invalid();
        int first = bytes[position[0]++] & 255;
        int marker = 128, length = 1;
        while (marker > 0 && (first & marker) == 0) { marker >>= 1; length++; }
        if (marker == 0 || length > (identifier ? 4 : 8) || position[0] + length - 1 > bytes.length) throw invalid();
        long value = identifier ? first : first & (marker - 1);
        for (int i = 1; i < length; i++) value = (value << 8) | (bytes[position[0]++] & 255);
        if (value < 0) throw invalid();
        return value;
    }

    private static List<String> inputOptions(String type, Path file) {
        var options = new ArrayList<>(List.of("-protocol_whitelist", "file,pipe", "-format_whitelist", "matroska,webm,ogg,mov",
                "-f", type.equals("audio/mp4") ? "mov" : type.equals("audio/ogg") ? "ogg" : "matroska"));
        // MOV external data references stay disabled; originals cannot name other local files.
        if (type.equals("audio/mp4")) options.addAll(List.of("-enable_drefs", "0", "-use_absolute_path", "0"));
        options.addAll(List.of("-i", file.toString()));
        return options;
    }

    private static void checkHeaderDuration(JsonNode value) {
        if (value.isMissingNode() || value.isNull() || value.asText().equals("N/A")) return;
        try {
            double seconds = Double.parseDouble(value.asText());
            // Codec padding is removed during decoding. The exact cap is checked on decoded PCM below.
            if (!Double.isFinite(seconds) || seconds < 0 || seconds > 120.1) throw invalid();
        } catch (NumberFormatException malformed) { throw invalid(); }
    }

    private Result run(List<String> command, long outputLimit, boolean retain) {
        Process process;
        try { process = processes.start(command); }
        catch (IOException unavailable) { throw unavailable(); }
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var stdout = workers.submit(() -> drain(process.getInputStream(), outputLimit, retain, process));
            var stderr = workers.submit(() -> drain(process.getErrorStream(), 65_536, false, process));
            try {
                if (!process.waitFor(timeoutMillis, TimeUnit.MILLISECONDS)) throw unavailable();
                Drain out = stdout.get(2, TimeUnit.SECONDS);
                Drain err = stderr.get(2, TimeUnit.SECONDS);
                if (out.exceeded() || err.exceeded()) throw invalid();
                return new Result(process.exitValue(), out.count(), out.output(), err.count() > 0);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw unavailable();
            } catch (ExecutionException | TimeoutException failed) { throw unavailable(); }
            finally {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                // Native file handles must be released before verify() removes its private original.
                boolean wasInterrupted = Thread.interrupted();
                try { process.waitFor(2, TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { wasInterrupted = true; }
                finally { if (wasInterrupted) Thread.currentThread().interrupt(); }
                try { process.getInputStream().close(); process.getErrorStream().close(); process.getOutputStream().close(); }
                catch (IOException ignored) { /* never expose decoder output or file names */ }
                stdout.cancel(true);
                stderr.cancel(true);
            }
        }
    }

    private static Drain drain(InputStream input, long limit, boolean retain, Process process) throws IOException {
        var output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long count = 0;
        boolean exceeded = false;
        try (input) {
            for (int read; (read = input.read(buffer)) != -1;) {
                count += read;
                if (count > limit) { exceeded = true; process.destroyForcibly(); break; }
                if (retain) output.write(buffer, 0, read);
            }
        }
        return new Drain(count, output.toByteArray(), exceeded);
    }

    private static Path privateDirectory() throws IOException {
        Path parent = Path.of(System.getProperty("java.io.tmpdir"));
        Path directory = Files.getFileAttributeView(parent, PosixFileAttributeView.class) != null
                ? Files.createTempDirectory(parent, "archive-audio-", PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")))
                : Files.createTempDirectory(parent, "archive-audio-");
        try { secure(directory, true); }
        catch (IOException failure) { Files.deleteIfExists(directory); throw failure; }
        return directory;
    }

    private static void privateFile(Path file) throws IOException {
        if (Files.getFileAttributeView(file.getParent(), PosixFileAttributeView.class) != null)
            Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        else Files.createFile(file);
        secure(file, false);
    }

    private static void secure(Path path, boolean directory) throws IOException {
        var acl = Files.getFileAttributeView(path, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (acl != null) {
            var builder = AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(Files.getOwner(path))
                    .setPermissions(EnumSet.allOf(AclEntryPermission.class));
            if (directory) builder.setFlags(java.nio.file.attribute.AclEntryFlag.DIRECTORY_INHERIT, java.nio.file.attribute.AclEntryFlag.FILE_INHERIT);
            acl.setAcl(List.of(builder.build()));
        } else if (Files.getFileAttributeView(path, PosixFileAttributeView.class) == null)
            throw new IOException("Private temporary storage is unavailable.");
    }

    public record Verified(String contentType, String container, String codec, long durationMs) {}
    @FunctionalInterface interface ProcessFactory { Process start(List<String> command) throws IOException; }
    private record Drain(long count, byte[] output, boolean exceeded) {}
    private record Result(int exit, long bytes, byte[] output, boolean errors) {}
    static ApiException invalid() { return new ApiException(422, "INVALID_MEDIA", "The uploaded audio could not be verified. Choose a valid recording and try again."); }
    private static ApiException unavailable() { return new ApiException(503, "MEDIA_UNAVAILABLE", "Audio verification is temporarily unavailable. Keep your recording and retry shortly.", 60); }
}
