package com.kevinmel.archive.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Synthetic tones only; no microphone recordings or private fixture media are checked in. */
public final class AudioFixtures {
    private AudioFixtures() {}
    public static byte[] audio(String type, double seconds) {
        return generate(type, seconds, List.of());
    }
    public static byte[] generate(String type, double seconds, List<String> extra) {
        return generate(type, seconds, extra, type.equals("audio/mp4") ? "aac" : "libopus");
    }
    public static byte[] audioWithCodec(String type, double seconds, String codec) {
        return generate(type, seconds, List.of(), codec);
    }
    private static byte[] generate(String type, double seconds, List<String> extra, String codec) {
        String executable = System.getenv().getOrDefault("MEMORY_ARCHIVE_FFMPEG", "ffmpeg");
        Path output = null;
        try {
            output = Files.createTempFile("archive-synthetic-tone-", type.equals("audio/mp4") ? ".m4a" : type.equals("audio/ogg") ? ".ogg" : ".webm");
            var command = new ArrayList<>(List.of(executable, "-y", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                    "sine=frequency=440:sample_rate=48000:duration=" + seconds));
            command.addAll(extra);
            command.addAll(List.of("-c:a", codec, "-b:a", "32k"));
            command.add(output.toString());
            Process process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(30, TimeUnit.SECONDS)) { process.destroyForcibly(); throw new IllegalStateException("Synthetic audio generation timed out."); }
            if (process.exitValue() != 0) throw new IllegalStateException("Synthetic audio generation failed.");
            return Files.readAllBytes(output);
        } catch (IOException | InterruptedException failed) {
            if (failed instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IllegalStateException("FFmpeg is required for audio verification tests.", failed);
        } finally {
            if (output != null) try { Files.deleteIfExists(output); } catch (IOException ignored) {}
        }
    }
}
