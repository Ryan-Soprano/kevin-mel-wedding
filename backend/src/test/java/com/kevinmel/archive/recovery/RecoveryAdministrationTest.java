package com.kevinmel.archive.recovery;

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

class RecoveryAdministrationTest {
    @Test void helpAndUnsupportedInputsCannotStartRecovery() {
        var out = new ByteArrayOutputStream();
        var err = new ByteArrayOutputStream();
        PrintStream previousOut = System.out;
        PrintStream previousErr = System.err;
        try {
            System.setOut(new PrintStream(out, true, StandardCharsets.UTF_8));
            System.setErr(new PrintStream(err, true, StandardCharsets.UTF_8));
            assertThat(RecoveryAdministration.run(new String[] { "--help" })).isZero();
            for (String[] args : List.of(new String[0], new String[] { "export" },
                    new String[] { "--expect-environment", "unknown", "restore", "private-fixture" },
                    new String[] { "--expect-environment", "production", "delete", "private-fixture" },
                    new String[] { "--expect-environment", "local", "export", " " },
                    new String[] { "--expect-environment", "local", "restore", "private-fixture", "--force" })) {
                assertThat(RecoveryAdministration.run(args)).isEqualTo(2);
            }
            if (System.console() == null) {
                for (String command : List.of("export", "restore")) {
                    assertThat(RecoveryAdministration.run(new String[] {
                            "--expect-environment", "local", command, "private-fixture" })).isEqualTo(2);
                }
            }
        } finally { System.setOut(previousOut); System.setErr(previousErr); }
        assertThat(out.toString(StandardCharsets.UTF_8)).contains("interactive console", "CURRENT authoritative",
                "different isolated", "full DB backup", "traffic stopped");
        assertThat(err.toString(StandardCharsets.UTF_8)).contains("--help", "supported recovery command");
    }

    @Test void restoreNeedsExplicitDatabaseEvenForLocalAndBlankSettingsCannotSatisfyIt() {
        var values = new HashMap<String, Object>(Map.of("MEMORY_ARCHIVE_DB_URL", "jdbc:postgresql://synthetic.example/fixture",
                "MEMORY_ARCHIVE_DB_USERNAME", "synthetic-user", "MEMORY_ARCHIVE_DB_PASSWORD", "synthetic-password"));
        assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(Map.of()), false)).isTrue();
        assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(Map.of()), true)).isFalse();
        assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(values), true)).isTrue();
        for (String name : List.copyOf(values.keySet())) {
            var missing = new HashMap<>(values); missing.remove(name);
            var blank = new HashMap<>(values); blank.put(name, " \t");
            assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(missing), true)).isFalse();
            assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(blank), true)).isFalse();
        }
        assertThat(RecoveryAdministration.hasExplicitDatabaseTarget(isolated(Map.of(
                "spring.datasource.url", "jdbc:postgresql://synthetic.example/fixture",
                "spring.datasource.username", "synthetic-user", "spring.datasource.password", "synthetic-password")), true)).isTrue();
    }

    @Test void sameSourceBucketIsRejectedAndAuthorityIdentityBindsBothEndpointAndBucket() {
        String sourceEndpoint = "https://00000000000000000000000000000001.r2.cloudflarestorage.com";
        String secondEndpoint = "https://00000000000000000000000000000002.r2.cloudflarestorage.com";
        assertThat(RecoveryAdministration.distinctStorage(sourceEndpoint, "fixture", sourceEndpoint, "fixture")).isFalse();
        assertThat(RecoveryAdministration.distinctStorage(sourceEndpoint, "isolated", sourceEndpoint, "fixture")).isTrue();
        assertThat(RecoveryAdministration.distinctStorage(secondEndpoint, "fixture", sourceEndpoint, "fixture")).isTrue();
        assertThat(RecoveryAdministration.distinctStorage(sourceEndpoint, " ", sourceEndpoint, "fixture")).isFalse();
        assertThat(RecoveryAdministration.storageIdentity(sourceEndpoint, "fixture")).matches("[0-9a-f]{64}")
                .isEqualTo(RecoveryAdministration.storageIdentity(sourceEndpoint, "fixture"))
                .isNotEqualTo(RecoveryAdministration.storageIdentity(secondEndpoint, "fixture"))
                .isNotEqualTo(RecoveryAdministration.storageIdentity(sourceEndpoint, "isolated"));
    }

    private static StandardEnvironment isolated(Map<String, Object> explicit) {
        var settings = new StandardEnvironment();
        var names = new java.util.ArrayList<String>();
        settings.getPropertySources().forEach(source -> names.add(source.getName()));
        names.forEach(settings.getPropertySources()::remove);
        settings.getPropertySources().addLast(new MapPropertySource("recoveryDefaults", Map.of(
                "spring.datasource.url", "jdbc:postgresql://localhost/default-fixture",
                "spring.datasource.username", "default-user", "spring.datasource.password", "default-password")));
        settings.getPropertySources().addFirst(new MapPropertySource("syntheticExplicitTarget", explicit));
        return settings;
    }
}
