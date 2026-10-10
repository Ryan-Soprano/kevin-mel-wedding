package com.kevinmel.archive.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

class ReadinessAdministrationTest {
    private static final String SECRET = "synthetic-secret-never-printed";
    @TempDir Path temporary;

    @Test void unsupportedCommandsTargetMismatchAndIncompleteExplicitTargetsNeverConnect() throws Exception {
        for (String[] args : List.of(new String[0], new String[]{"report"},
                new String[]{"--expect-environment", "unknown", "report"},
                new String[]{"--expect-environment", "local", "purge-expired"},
                new String[]{"--expect-environment", "local", "report", "--force"},
                new String[]{"--expect-environment", "local", "schema-check", "--prior-jar", " "})) {
            var result = run(args, Map.of());
            assertThat(result.exit()).isEqualTo(2); assertThat(result.calls()).isZero();
        }
        var help = run(new String[]{"--help"}, Map.of());
        assertThat(help.exit()).isZero(); assertThat(help.calls()).isZero();
        assertThat(help.out()).contains("read-only", "not profile files", "unchecked", "label is a guard");
        assertThat(run(report("production"), Map.of()).calls()).isZero();
        assertThat(run(report("production"), Map.of("archive.environment", "production")).exit()).isEqualTo(2);
        assertThat(run(new String[]{"--expect-environment", "local", "schema-check", "--prior-jar", SECRET}, Map.of()).exit()).isEqualTo(2);

        var explicit = new HashMap<String, Object>(Map.of("archive.environment", "production",
                "spring.datasource.url", "jdbc:postgresql://localhost/synthetic",
                "spring.datasource.username", SECRET, "spring.datasource.password", SECRET));
        assertThat(ReadinessAdministration.hasExplicitDatabaseTarget(settings(explicit), true)).isTrue();
        for (String key : List.of("spring.datasource.url", "spring.datasource.username", "spring.datasource.password")) {
            var missing = new HashMap<>(explicit); missing.remove(key);
            var blank = new HashMap<>(explicit); blank.put(key, " \t");
            assertThat(run(report("production"), missing).exit()).isEqualTo(2);
            assertThat(run(report("production"), blank).calls()).isZero();
        }
    }

    @Test void malformedGateBudgetIntervalAndJdbcSettingsAreRefusedWithoutEchoingTheirValues() throws Exception {
        for (var override : List.of(Map.<String, Object>of("archive.revealed", SECRET),
                Map.<String, Object>of("archive.audio.enabled", "TRUE"),
                Map.<String, Object>of("archive.media.max-original-bytes", "0"),
                Map.<String, Object>of("archive.media.max-staging-bytes", "-1"),
                Map.<String, Object>of("archive.retention.interval-ms", "59999"),
                Map.<String, Object>of("archive.retention.interval-ms", "86400001"),
                Map.<String, Object>of("spring.datasource.url", "jdbc:postgresql://" + SECRET + "@localhost/synthetic"))) {
            var result = run(report("local"), override);
            assertThat(result.exit()).isEqualTo(2); assertThat(result.calls()).isZero();
            assertThat(result.out() + result.err()).doesNotContain(SECRET, "jdbc:");
        }
    }

    @Test void unavailableDatabasePrintsOnlyFixedFailureAndConfiguredNotVerifiedGates() throws Exception {
        var result = run(report("local"), Map.of("archive.storage.enabled", "true", "archive.retention.enabled", "true"));
        assertThat(result.exit()).isEqualTo(1); assertThat(result.calls()).isEqualTo(1);
        assertThat(result.out()).contains("OPERATIONS_UNCONFIRMED", "DATABASE_UNAVAILABLE", "SCHEMA_UNCONFIRMED",
                "AGGREGATE_OBSERVATIONS_UNCONFIRMED", "STORAGE_ENABLED_UNCHECKED", "RETENTION_CONFIGURED_ENABLED_JOB_UNCHECKED",
                "RELEASE_READINESS_NOT_ESTABLISHED");
        assertThat(result.out() + result.err()).doesNotContain(SECRET, "SELECT", "SQLException", "jdbc:", "originals/");
    }

    @Test void timeoutReadOnlyOverridesCannotBeWeakenedThroughJdbcUrlParameters() {
        String url = ReadinessAdministration.boundedJdbcUrl("jdbc:postgresql://localhost:5432/synthetic?sslmode=require&currentSchema=fixture"
                + "&connectTimeout=0&socketTimeout=0&%73ocketTimeout=999&loginTimeout=0&cancelSignalTimeout=0&readOnly=false&readOnlyMode=never&options=ignored");
        assertThat(url).contains("sslmode=require", "currentSchema=fixture", "connectTimeout=5", "socketTimeout=10", "loginTimeout=10",
                "cancelSignalTimeout=2", "readOnly=true", "readOnlyMode=always", "statement_timeout%3D5000", "lock_timeout%3D2000");
        assertThat(url).doesNotContain("Timeout=0", "999", "readOnly=false", "readOnlyMode=never", "ignored");
        for (String invalid : List.of("jdbc:h2:mem:fixture", "jdbc:postgresql://user:secret@localhost/db",
                "jdbc:postgresql://localhost/db?password=secret", "jdbc:postgresql://localhost/db?%75ser=secret",
                "jdbc:postgresql://localhost/db#secret", "jdbc:postgresql://localhost:0/db")) {
            assertThatThrownBy(() -> ReadinessAdministration.boundedJdbcUrl(invalid)).isInstanceOf(RuntimeException.class);
        }
    }

    @Test void observedPassReportsConfiguredDisabledFeaturesAndDoesNotClaimLaunchReadiness() {
        var bytes = new ByteArrayOutputStream();
        var gates = ReadinessAdministration.gates(settings(Map.of()));
        var result = new OperationsReadiness.Report(OperationsReadiness.Database.AVAILABLE, OperationsReadiness.Schema.REVIEWED,
                OperationsReadiness.Status.OBSERVED_CHECKS_PASS, gates, new OperationsReadiness.Totals(1, 1, 0, 0, 0, 0, 0));
        ReadinessAdministration.print(result, new PrintStream(bytes, true, StandardCharsets.UTF_8));
        assertThat(result.exitCode()).isZero();
        assertThat(bytes.toString(StandardCharsets.UTF_8)).contains("STORAGE_DISABLED", "RETENTION_CONFIGURED_DISABLED_JOB_UNCHECKED",
                "NOTE_ADMISSION_HAS_NO_UPLOAD_PAUSE_GATE", "PROVIDER_BYTES_AND_INTEGRITY_UNCHECKED", "BACKUPS_AND_RPO_RTO_UNCHECKED");
        assertThat(OperationsReadiness.capacity(79, 100)).isEqualTo(OperationsReadiness.Capacity.BELOW_WARNING);
        assertThat(OperationsReadiness.capacity(80, 100)).isEqualTo(OperationsReadiness.Capacity.REVIEW_REQUIRED);
        assertThat(OperationsReadiness.capacity(100, 100)).isEqualTo(OperationsReadiness.Capacity.AT_LIMIT);
        assertThat(OperationsReadiness.capacity(101, 100)).isEqualTo(OperationsReadiness.Capacity.OVER_LIMIT);
        assertThat(OperationsReadiness.capacity(Long.MAX_VALUE - 1, Long.MAX_VALUE)).isEqualTo(OperationsReadiness.Capacity.REVIEW_REQUIRED);
    }

    @Test void runtimeMigrationInventoryRejectsUnknownMissingAndDuplicateResources() throws Exception {
        var current = OperationsSchema.bundled();
        Path complete = resources("complete", current);
        try (var loader = new URLClassLoader(new java.net.URL[]{complete.toUri().toURL()}, null)) {
            assertThat(OperationsSchema.bundled(loader)).isEqualTo(current);
        }
        Files.writeString(complete.resolve("db/migration/.gitkeep"), "SELECT 1;");
        try (var loader = new URLClassLoader(new java.net.URL[]{complete.toUri().toURL()}, null)) {
            assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
        }
        Files.delete(complete.resolve("db/migration/.gitkeep"));
        Files.writeString(complete.resolve("db/migration/V11__synthetic_unknown.sql"), "SELECT 1;");
        try (var loader = new URLClassLoader(new java.net.URL[]{complete.toUri().toURL()}, null)) {
            assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
        }
        Path second = resources("second", current);
        Path duplicate = resources("duplicate", current);
        try (var loader = new URLClassLoader(new java.net.URL[]{second.toUri().toURL(), duplicate.toUri().toURL()}, null)) {
            assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
        }
        Files.delete(second.resolve("db/migration/" + current.getLast().script()));
        try (var loader = new URLClassLoader(new java.net.URL[]{second.toUri().toURL()}, null)) {
            assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
        }
        Path flatJar = runtimeJar("flat-runtime", null);
        try (var loader = new URLClassLoader(new java.net.URL[]{flatJar.toUri().toURL()}, null)) {
            assertThat(OperationsSchema.bundled(loader)).isEqualTo(current);
        }
        // Deliberately omit nested-directory ZIP entries: a nonrecursive scan would overlook these files.
        for (String extra : List.of("nested/V11__synthetic_unknown.sql", "nested/" + current.getFirst().script(), "nested/.gitkeep")) {
            Path nestedJar = runtimeJar("nested-" + Integer.toUnsignedString(extra.hashCode()), extra);
            try (var loader = new URLClassLoader(new java.net.URL[]{nestedJar.toUri().toURL()}, null)) {
                assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
            }
        }
        String first = current.getFirst().script();
        Path repeated = resources("repeated-path", current);
        Path nested = repeated.resolve("db/migration/nested/db/migration/" + first);
        Files.createDirectories(nested.getParent()); Files.move(repeated.resolve("db/migration/" + first), nested);
        try (var loader = new URLClassLoader(new java.net.URL[]{repeated.toUri().toURL()}, null)) {
            assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
        }
        // The exact reviewed script count remains: the repeated path replaces V1, so name checks alone cannot refuse it.
        for (boolean bootLayout : List.of(false, true)) {
            Path validLayout = runtimeJar("layout-valid-" + bootLayout, null, null, bootLayout);
            Path repeatedJar = runtimeJar("layout-repeated-" + bootLayout, "nested/db/migration/" + first, first, bootLayout);
            for (Path fixture : List.of(validLayout, repeatedJar)) {
                var url = bootLayout ? new java.net.URL("jar:" + fixture.toUri().toURL() + "!/BOOT-INF/classes/") : fixture.toUri().toURL();
                try (var loader = new URLClassLoader(new java.net.URL[]{url}, null)) {
                    if (fixture.equals(validLayout)) assertThat(OperationsSchema.bundled(loader)).isEqualTo(current);
                    else assertThatThrownBy(() -> OperationsSchema.bundled(loader)).isInstanceOf(RuntimeException.class);
                }
            }
        }
    }

    @Test void priorJarMustBeBoundedExecutableAndExactManifestNeverLoadsItsClasses() throws Exception {
        Path valid = jar("valid", null, false);
        assertThat(OperationsSchema.priorJar(valid)).isEqualTo(OperationsSchema.bundled());
        Path changed = jar("changed", "-- synthetic changed migration\n", false);
        assertThat(OperationsSchema.priorJar(changed)).isNotEqualTo(OperationsSchema.bundled());
        assertThatThrownBy(() -> OperationsSchema.priorJar(jar("unknown", null, true))).isInstanceOf(RuntimeException.class);
        Path olderV9 = jar("older-v9", null, false, true);
        assertThatThrownBy(() -> OperationsSchema.priorJar(olderV9)).isInstanceOf(RuntimeException.class);
        Path malformed = temporary.resolve(SECRET); Files.writeString(malformed, SECRET);
        assertThatThrownBy(() -> OperationsSchema.priorJar(malformed)).isInstanceOf(Exception.class);
        var explicit = Map.<String, Object>of("spring.datasource.url", "jdbc:postgresql://localhost/synthetic",
                "spring.datasource.username", SECRET, "spring.datasource.password", SECRET);
        for (Path path : List.of(changed, malformed, olderV9)) {
            var result = run(new String[]{"--expect-environment", "local", "schema-check", "--prior-jar", path.toString()}, explicit);
            assertThat(result.exit()).isEqualTo(1); assertThat(result.calls()).isZero();
            assertThat(result.err()).contains("ROLLBACK_SCHEMA_UNCONFIRMED").doesNotContain(SECRET, path.toString());
        }
    }

    private Path resources(String name, List<OperationsSchema.Migration> migrations) throws Exception {
        Path root = temporary.resolve(name); Files.createDirectories(root.resolve("db/migration"));
        for (var migration : migrations) try (var input = OperationsSchema.class.getResourceAsStream("/db/migration/" + migration.script())) {
            Files.copy(input, root.resolve("db/migration/" + migration.script()));
        }
        return root;
    }
    private Path jar(String name, String change, boolean unknown) throws Exception {
        return jar(name, change, unknown, false);
    }
    private Path jar(String name, String change, boolean unknown, boolean omitLatest) throws Exception {
        Path path = temporary.resolve(name + ".jar");
        try (var zip = new ZipOutputStream(Files.newOutputStream(path))) {
            entry(zip, "META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nMain-Class: org.springframework.boot.loader.launch.JarLauncher\nStart-Class: com.kevinmel.archive.MemoryArchiveApplication\n\n".getBytes(StandardCharsets.UTF_8));
            entry(zip, "BOOT-INF/classes/com/kevinmel/archive/MemoryArchiveApplication.class", new byte[]{(byte) 0xca, (byte) 0xfe, (byte) 0xba, (byte) 0xbe});
            for (var migration : OperationsSchema.bundled()) try (var input = OperationsSchema.class.getResourceAsStream("/db/migration/" + migration.script())) {
                if (omitLatest && migration.version().equals("10")) continue;
                byte[] bytes = input.readAllBytes();
                if (change != null && migration.version().equals("10")) bytes = (new String(bytes, StandardCharsets.UTF_8) + change).getBytes(StandardCharsets.UTF_8);
                entry(zip, "BOOT-INF/classes/db/migration/" + migration.script(), bytes);
            }
            if (unknown) entry(zip, "BOOT-INF/classes/db/migration/V11__synthetic_unknown.sql", "SELECT 1;".getBytes(StandardCharsets.UTF_8));
        }
        return path;
    }
    private Path runtimeJar(String name, String extra) throws Exception {
        return runtimeJar(name, extra, null, false);
    }
    private Path runtimeJar(String name, String extra, String replaced, boolean bootLayout) throws Exception {
        Path path = temporary.resolve(name + ".jar");
        String prefix = bootLayout ? "BOOT-INF/classes/" : "";
        try (var zip = new ZipOutputStream(Files.newOutputStream(path))) {
            if (bootLayout) { entry(zip, "BOOT-INF/", new byte[0]); entry(zip, prefix, new byte[0]); }
            entry(zip, prefix + "db/", new byte[0]); entry(zip, prefix + "db/migration/", new byte[0]);
            for (var migration : OperationsSchema.bundled()) try (var input = OperationsSchema.class.getResourceAsStream("/db/migration/" + migration.script())) {
                if (!migration.script().equals(replaced)) entry(zip, prefix + "db/migration/" + migration.script(), input.readAllBytes());
            }
            if (extra != null) {
                byte[] bytes;
                if (replaced != null) try (var input = OperationsSchema.class.getResourceAsStream("/db/migration/" + replaced)) { bytes = input.readAllBytes(); }
                else bytes = extra.endsWith(".gitkeep") ? new byte[0] : "SELECT 1;".getBytes(StandardCharsets.UTF_8);
                entry(zip, prefix + "db/migration/" + extra, bytes);
            }
        }
        return path;
    }
    private static void entry(ZipOutputStream zip, String name, byte[] bytes) throws Exception { zip.putNextEntry(new ZipEntry(name)); zip.write(bytes); zip.closeEntry(); }
    private static String[] report(String environment) { return new String[]{"--expect-environment", environment, "report"}; }
    private static StandardEnvironment settings(Map<String, Object> explicit) {
        var settings = new StandardEnvironment();
        var names = new ArrayList<String>(); settings.getPropertySources().forEach(source -> names.add(source.getName()));
        names.forEach(settings.getPropertySources()::remove);
        settings.getPropertySources().addLast(new MapPropertySource("operationsDefaults", Map.of("archive.environment", "local",
                "spring.datasource.url", "jdbc:postgresql://localhost/synthetic", "spring.datasource.username", SECRET, "spring.datasource.password", SECRET)));
        settings.getPropertySources().addFirst(new MapPropertySource("syntheticExplicit", explicit));
        return settings;
    }
    private static Capture run(String[] args, Map<String, Object> properties) throws Exception {
        var out = new ByteArrayOutputStream(); var err = new ByteArrayOutputStream(); var calls = new AtomicInteger();
        DataSource source = mock(DataSource.class); when(source.getConnection()).thenThrow(new SQLException(SECRET + " jdbc: synthetic private query"));
        int exit = ReadinessAdministration.run(args, settings(properties), ignored -> { calls.incrementAndGet(); return source; },
                new PrintStream(out, true, StandardCharsets.UTF_8), new PrintStream(err, true, StandardCharsets.UTF_8));
        return new Capture(exit, out.toString(StandardCharsets.UTF_8), err.toString(StandardCharsets.UTF_8), calls.get());
    }
    private record Capture(int exit, String out, String err, int calls) { }
}
