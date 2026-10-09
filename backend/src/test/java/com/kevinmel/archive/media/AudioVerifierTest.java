package com.kevinmel.archive.media;

import static org.junit.jupiter.api.Assertions.*;
import com.kevinmel.archive.web.ApiException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.channels.FileChannel;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AudioVerifierTest {
    private final AudioVerifier verifier = new AudioVerifier();

    @ParameterizedTest
    @ValueSource(strings = {"audio/webm", "audio/ogg", "audio/mp4"})
    void fullyDecodesSupportedOriginalsAndPreservesInput(String type) {
        byte[] original = AudioFixtures.audio(type, 1.25);
        byte[] before = original.clone();
        var verified = verifier.verify(original, asset(original, type));
        assertEquals(type, verified.contentType());
        assertEquals(type.substring(6), verified.container());
        assertEquals(type.equals("audio/mp4") ? "aac" : "opus", verified.codec());
        assertTrue(verified.durationMs() >= 1_240 && verified.durationMs() <= 1_280, "Actual decoded duration: " + verified.durationMs());
        assertArrayEquals(before, original);
    }

    @ParameterizedTest
    @ValueSource(strings = {"audio/webm", "audio/ogg", "audio/mp4"})
    void rejectsOverTwoMinutesEvenWithShortClientClaim(String type) {
        byte[] original = AudioFixtures.audio(type, 121);
        assertInvalid(() -> verifier.verify(original, asset(original, type)));
    }

    @Test void enforcesDecodedCapWhenStreamingWebmHasNoHeaderDuration() {
        byte[] original = AudioFixtures.generate("audio/webm", 121, List.of("-live", "1"));
        assertInvalid(() -> verifier.verify(original, asset(original, "audio/webm")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"audio/webm", "audio/ogg", "audio/mp4"})
    void acceptsTwoMinuteBoundaryWithoutAddingCodecStartupPadding(String type) {
        byte[] boundary = AudioFixtures.audio(type, 120);
        assertEquals(120_000, verifier.verify(boundary, asset(boundary, type)).durationMs());
    }

    @Test void rejectsMatroskaDisguisedAsWebm() {
        byte[] matroska = AudioFixtures.generate("audio/webm", 1, List.of("-f", "matroska"));
        assertInvalid(() -> verifier.verify(matroska, asset(matroska, "audio/webm")));
    }

    @Test void rejectsStreamingWebmJustBeyondTwoMinutes() {
        byte[] original = AudioFixtures.generate("audio/webm", 120.01, List.of("-live", "1"));
        assertInvalid(() -> verifier.verify(original, asset(original, "audio/webm")));
    }

    @Test void countsInteriorTimestampGapInPlaybackDuration() {
        byte[] original = AudioFixtures.generate("audio/webm", 2,
                List.of("-af", "asetpts=PTS+gte(T\\,1)/TB", "-live", "1"));
        long actual = verifier.verify(original, asset(original, "audio/webm")).durationMs();
        assertTrue(actual >= 2_990 && actual <= 3_010, "Timestamp gap duration: " + actual);
    }

    @Test void rejectsTimestampGapThatExceedsCapWithoutHeaderDuration() {
        byte[] original = AudioFixtures.generate("audio/webm", 2,
                List.of("-af", "asetpts=PTS+gte(T\\,1)*119/TB", "-live", "1"));
        assertInvalid(() -> verifier.verify(original, asset(original, "audio/webm")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"audio/webm", "audio/ogg", "audio/mp4"})
    void rejectsTruncatedOriginals(String type) {
        byte[] original = AudioFixtures.audio(type, 2);
        byte[] truncated = Arrays.copyOf(original, original.length / 2);
        assertInvalid(() -> verifier.verify(truncated, asset(truncated, type)));
    }

    @Test void rejectsWrongDeclaredContainer() {
        byte[] original = AudioFixtures.audio("audio/webm", 1);
        assertInvalid(() -> verifier.verify(original, asset(original, "audio/ogg")));
    }

    @Test void rejectsWrongHashAndByteSize() {
        byte[] original = AudioFixtures.audio("audio/webm", 1);
        var expected = asset(original, "audio/webm");
        original[original.length - 5] ^= 1;
        assertInvalid(() -> verifier.verify(original, expected));
        assertInvalid(() -> verifier.verify(Arrays.copyOf(original, original.length - 1), expected));
    }

    @Test void rejectsEmptyUnknownAndOversizeBeforeStartingDecoder() {
        var absent = new AudioVerifier("not-an-installed-ffmpeg", "not-an-installed-ffprobe");
        assertInvalid(() -> absent.verify(new byte[0], asset(new byte[0], "audio/webm")));
        assertInvalid(() -> absent.verify(new byte[] {1, 2, 3}, asset(new byte[] {1, 2, 3}, "audio/mpeg")));
        byte[] huge = new byte[(int) AudioVerifier.MAX_BYTES + 1];
        assertInvalid(() -> absent.verify(huge, asset(huge, "audio/webm")));
    }

    @Test void missingRuntimeIsRetryableWithoutPrivateErrorDetails() {
        byte[] original = AudioFixtures.audio("audio/webm", 1);
        var absent = new AudioVerifier("/missing/private-runtime/ffmpeg", "/missing/private-runtime/ffprobe");
        ApiException failure = assertThrows(ApiException.class, () -> absent.verify(original, asset(original, "audio/webm")));
        assertEquals(503, failure.status());
        assertEquals("MEDIA_UNAVAILABLE", failure.code());
        assertEquals(60, failure.retryAfterSeconds());
        assertFalse(failure.getMessage().contains("private-runtime"));
    }

    @Test void rejectsVideoTrackAndAdditionalAudioTrack() {
        byte[] video = AudioFixtures.generate("audio/webm", 1,
                List.of("-f", "lavfi", "-i", "color=c=black:s=16x16:d=1", "-map", "0:a", "-map", "1:v", "-c:v", "libvpx"));
        assertInvalid(() -> verifier.verify(video, asset(video, "audio/webm")));
        byte[] multiple = AudioFixtures.generate("audio/webm", 1, List.of("-map", "0:a", "-map", "0:a"));
        assertInvalid(() -> verifier.verify(multiple, asset(multiple, "audio/webm")));
    }

    @Test void rejectsUnapprovedCodecAndMoreThanTwoChannels() {
        byte[] vorbis = AudioFixtures.audioWithCodec("audio/ogg", 1, "libvorbis");
        assertInvalid(() -> verifier.verify(vorbis, asset(vorbis, "audio/ogg")));
        byte[] surround = AudioFixtures.generate("audio/ogg", 1, List.of("-ac", "6"));
        assertInvalid(() -> verifier.verify(surround, asset(surround, "audio/ogg")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"hang", "overflow"})
    void terminatesNativeDecoderBeforeRemovingItsPrivateOriginal(String mode) throws Exception {
        byte[] original = AudioFixtures.audio("audio/webm", 1);
        var path = new AtomicReference<Path>();
        var child = new AtomicReference<Process>();
        String ffmpeg = System.getenv().getOrDefault("MEMORY_ARCHIVE_FFMPEG", "ffmpeg");
        String ffprobe = System.getenv().getOrDefault("MEMORY_ARCHIVE_FFPROBE", "ffprobe");
        String java = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString();
        String classpath = Path.of(AudioVerifierTest.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
        var controlled = new AudioVerifier(ffmpeg, ffprobe, command -> {
            if (!command.contains("pipe:1")) return new ProcessBuilder(command).start();
            Path privateOriginal = Path.of(command.get(command.indexOf("-i") + 1));
            path.set(privateOriginal);
            Process process = new ProcessBuilder(java, "-cp", classpath, DecoderProbe.class.getName(), mode, privateOriginal.toString()).start();
            child.set(process);
            return process;
        }, 2_000);
        ApiException failure = assertThrows(ApiException.class, () -> controlled.verify(original, asset(original, "audio/webm")));
        assertEquals(mode.equals("hang") ? 503 : 422, failure.status());
        assertNotNull(child.get());
        assertFalse(child.get().isAlive());
        assertFalse(Files.exists(path.get()));
        assertFalse(Files.exists(path.get().getParent()));
    }

    /** A real subprocess holding the verifier's input file open until it is forcibly terminated. */
    public static class DecoderProbe {
        public static void main(String[] args) throws Exception {
            try (var original = FileChannel.open(Path.of(args[1]), StandardOpenOption.READ)) {
                if (args[0].equals("overflow")) {
                    byte[] block = new byte[8192];
                    for (int i = 0; i < 1500; i++) System.out.write(block);
                    System.out.flush();
                }
                Thread.sleep(30_000);
                original.size();
            }
        }
    }

    static PhotoRepository.Asset asset(byte[] original, String type) {
        try {
            return new PhotoRepository.Asset(UUID.randomUUID(), "unused/original", type, original.length,
                    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original)), "UNVERIFIED", "AUDIO", 1_000L);
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static void assertInvalid(org.junit.jupiter.api.function.Executable verify) {
        ApiException failure = assertThrows(ApiException.class, verify);
        assertEquals(422, failure.status());
        assertEquals("INVALID_MEDIA", failure.code());
    }
}
