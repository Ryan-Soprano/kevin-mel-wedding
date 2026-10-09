package com.kevinmel.archive.retention;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

class RetentionAdministrationTest {
    @Test void helpAndUnsupportedCommandsCannotStartMaintenance() {
        var out = new ByteArrayOutputStream();
        var err = new ByteArrayOutputStream();
        PrintStream previousOut = System.out;
        PrintStream previousErr = System.err;
        try {
            System.setOut(new PrintStream(out, true, StandardCharsets.UTF_8));
            System.setErr(new PrintStream(err, true, StandardCharsets.UTF_8));
            assertThat(RetentionAdministration.run(new String[] { "--help" })).isZero();
            for (String[] args : List.of(new String[0], new String[] { "purge-expired" },
                    new String[] { "--expect-environment", "unknown", "purge-expired" },
                    new String[] { "--expect-environment", "production", "delete-now" })) {
                assertThat(RetentionAdministration.run(args)).isEqualTo(2);
            }
        } finally {
            System.setOut(previousOut); System.setErr(previousErr);
        }
        assertThat(out.toString(StandardCharsets.UTF_8)).contains("replay-ledger", "purge-expired", "interactive console", "traffic stopped");
        assertThat(err.toString(StandardCharsets.UTF_8)).contains("supported maintenance command", "--help");
    }

    @Test void localDefaultsAreAllowedButRemoteDefaultsAloneAreNeverAnExplicitTarget() {
        var settings = isolated(Map.of());
        assertThat(RetentionAdministration.hasExplicitDatabaseTarget(settings, "local")).isTrue();
        assertThat(RetentionAdministration.hasExplicitDatabaseTarget(settings, "staging")).isFalse();
        assertThat(RetentionAdministration.hasExplicitDatabaseTarget(settings, "production")).isFalse();
    }

    @Test void incompleteOrBlankRemoteDatabaseSettingsRemainRejected() {
        var complete = new HashMap<String, Object>(Map.of("MEMORY_ARCHIVE_DB_URL", "jdbc:postgresql://synthetic.example/fixture",
                "MEMORY_ARCHIVE_DB_USERNAME", "synthetic-user", "MEMORY_ARCHIVE_DB_PASSWORD", "synthetic-password"));
        for (String name : List.copyOf(complete.keySet())) {
            var missing = new HashMap<>(complete); missing.remove(name);
            var blank = new HashMap<>(complete); blank.put(name, " \t");
            for (String environment : List.of("staging", "production")) {
                assertThat(RetentionAdministration.hasExplicitDatabaseTarget(isolated(missing), environment)).isFalse();
                assertThat(RetentionAdministration.hasExplicitDatabaseTarget(isolated(blank), environment)).isFalse();
            }
        }
    }

    @Test void completeEnvironmentNamesOrDirectDatasourcePropertiesSpecifyTheRemoteTarget() {
        for (Map<String, Object> properties : List.of(
                Map.<String, Object>of("MEMORY_ARCHIVE_DB_URL", "jdbc:postgresql://synthetic.example/fixture", "MEMORY_ARCHIVE_DB_USERNAME", "synthetic-user", "MEMORY_ARCHIVE_DB_PASSWORD", "synthetic-password"),
                Map.<String, Object>of("spring.datasource.url", "jdbc:postgresql://synthetic.example/fixture", "spring.datasource.username", "synthetic-user", "spring.datasource.password", "synthetic-password"))) {
            for (String environment : List.of("staging", "production")) {
                assertThat(RetentionAdministration.hasExplicitDatabaseTarget(isolated(properties), environment)).isTrue();
            }
        }
    }

    private static StandardEnvironment isolated(Map<String, Object> explicit) {
        var settings = new StandardEnvironment();
        var names = new java.util.ArrayList<String>();
        settings.getPropertySources().forEach(source -> names.add(source.getName()));
        names.forEach(settings.getPropertySources()::remove);
        settings.getPropertySources().addLast(new MapPropertySource("retentionDefaults", Map.of(
                "spring.datasource.url", "jdbc:postgresql://localhost/default-fixture",
                "spring.datasource.username", "default-user", "spring.datasource.password", "default-password")));
        settings.getPropertySources().addFirst(new MapPropertySource("syntheticExplicitTarget", explicit));
        return settings;
    }
}
