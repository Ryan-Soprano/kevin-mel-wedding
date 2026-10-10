package com.kevinmel.archive.recovery;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.kevinmel.archive.media.R2ObjectStorage;
import com.kevinmel.archive.retention.DeletionRecord;
import com.kevinmel.archive.retention.DeletionStorage;

/** Privileged offline archive-data recovery. No HTTP listener, migration, scheduler or account access. */
public final class RecoveryAdministration {
    private RecoveryAdministration() { }

    public static void main(String[] args) { System.exit(run(args)); }

    static int run(String[] args) {
        if (args.length == 1 && "--help".equals(args[0])) {
            System.out.println("""
                    Offline note/photo/audio/album/timeline/tag archive-data export and restore (reviewed V8 through V13 migrations required):
                      --expect-environment <local|staging|production> export <new-private-directory>
                      --expect-environment <local|staging|production> restore <private-backup-directory>
                    An interactive console and exact confirmation are required. Stop source/target traffic,
                    finalization and maintenance; wait for outstanding upload permissions to expire, then
                    set MEMORY_ARCHIVE_RECOVERY_QUIESCED=true. Configure private database/R2 settings.
                    Restore requires an explicit empty database target and a different isolated R2 bucket.
                    MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_{ENDPOINT,BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY}
                    must identify the CURRENT authoritative source deletion ledger, never an old snapshot.
                    This is a sensitive operator recovery package, not a couple download or full DB backup.
                    Keep traffic stopped until counts, relationships, integrity and deletion replay are verified.
                    """);
            return 0;
        }
        if (args.length != 4 || !"--expect-environment".equals(args[0])
                || !Set.of("local", "staging", "production").contains(args[1])
                || !Set.of("export", "restore").contains(args[2]) || args[3].isBlank()) {
            System.err.println("Use --help. An environment, supported recovery command and private directory are required.");
            return 2;
        }
        var console = System.console();
        if (console == null) {
            System.err.println("An interactive system console is required; no recovery was started.");
            return 2;
        }
        try {
            LoggingSystem.get(RecoveryAdministration.class.getClassLoader())
                    .setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
            StandardEnvironment settings = settings();
            boolean restore = "restore".equals(args[2]);
            if (!args[1].equals(settings.getProperty("archive.environment", "local"))
                    || !"true".equals(settings.getProperty("archive.storage.enabled", "false"))
                    || !"true".equals(settings.getProperty("MEMORY_ARCHIVE_RECOVERY_QUIESCED", "false"))
                    || !hasExplicitDatabaseTarget(settings, restore || !"local".equals(args[1]))) {
                System.err.println("Target, private storage or quiescence settings are incomplete; no recovery was started.");
                return 2;
            }
            String endpoint = settings.getRequiredProperty("archive.storage.endpoint");
            String bucket = settings.getRequiredProperty("archive.storage.bucket");
            String authorityEndpoint = restore ? sourceSetting(settings, "ENDPOINT") : endpoint;
            String authorityBucket = restore ? sourceSetting(settings, "BUCKET") : bucket;
            if (restore && !distinctStorage(endpoint, bucket, authorityEndpoint, authorityBucket)) {
                System.err.println("Restore requires a different isolated storage target; no recovery was started.");
                return 2;
            }
            String confirmation = args[2] + " quiescent archive in " + args[1];
            if (!confirmation.equals(console.readLine("Privately verify the database, bucket and directory, then type '%s': ", confirmation))) {
                System.err.println("Confirmation did not match; no recovery was started.");
                return 2;
            }
            var source = new DriverManagerDataSource(settings.getRequiredProperty("spring.datasource.url"),
                    settings.getRequiredProperty("spring.datasource.username"),
                    settings.getRequiredProperty("spring.datasource.password"));
            Path directory = Path.of(args[3]);
            try (var storage = R2ObjectStorage.openPrivate(endpoint, bucket,
                    settings.getRequiredProperty("archive.storage.access-key-id"),
                    settings.getRequiredProperty("archive.storage.secret-access-key"))) {
                if (!restore) {
                    var service = new OperatorRecovery(source, storage, ledger(storage, true), ledger(storage, true),
                            Clock.systemUTC(), storageIdentity(endpoint, bucket));
                    var result = service.exportTo(directory);
                    console.printf("Export: %d contributions, %d memories, %d originals; %d pending media, %d failed media, %d unavailable originals. Restore-ready: %s.%n",
                            result.contributions(), result.memories(), result.originals(), result.pendingMedia(),
                            result.failedMedia(), result.unavailableOriginals(), result.ready());
                    return result.ready() ? 0 : 1;
                }
                try (var authority = R2ObjectStorage.openPrivate(authorityEndpoint, authorityBucket,
                        sourceSetting(settings, "ACCESS_KEY_ID"), sourceSetting(settings, "SECRET_ACCESS_KEY"))) {
                    var service = new OperatorRecovery(source, storage, ledger(authority, true), ledger(storage, false),
                            Clock.systemUTC(), storageIdentity(authorityEndpoint, authorityBucket));
                    var result = service.restoreFrom(directory);
                    console.printf("Restore: %d contributions, %d memories, %d originals; %d current deletion records replayed. Keep traffic stopped until operator verification completes.%n",
                            result.contributions(), result.memories(), result.originals(), result.replayedDeletions());
                    return 0;
                }
            }
        } catch (IOException | RuntimeException failure) {
            System.err.println("Recovery is unconfirmed. A private incomplete export or partial isolated object copy may remain. Keep traffic stopped and verify the target before retrying.");
            return 1;
        }
    }

    private static String sourceSetting(StandardEnvironment settings, String suffix) {
        String value = settings.getRequiredProperty("MEMORY_ARCHIVE_RECOVERY_SOURCE_R2_" + suffix);
        if (value.isBlank()) throw new IllegalArgumentException("Recovery authority is not configured.");
        return value;
    }

    static boolean distinctStorage(String targetEndpoint, String targetBucket, String sourceEndpoint, String sourceBucket) {
        return targetEndpoint != null && targetBucket != null && sourceEndpoint != null && sourceBucket != null
                && !targetEndpoint.isBlank() && !targetBucket.isBlank() && !sourceEndpoint.isBlank() && !sourceBucket.isBlank()
                && !(targetEndpoint.equals(sourceEndpoint) && targetBucket.equals(sourceBucket));
    }

    static String storageIdentity(String endpoint, String bucket) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((endpoint + "/" + bucket).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException failure) { throw new IllegalStateException("Integrity algorithm unavailable."); }
    }

    /** The authoritative source is mechanically read-only even if its server credential can write. */
    private static DeletionStorage ledger(R2ObjectStorage storage, boolean readOnly) {
        return new DeletionStorage() {
            private void writable() { if (readOnly) throw new IllegalStateException("The recovery authority is read-only."); }
            public Page ledger(String cursor, int limit) { return storage.deletionLedger(cursor, limit); }
            public void record(DeletionRecord record) { writable(); storage.recordDeletion(record); }
            public void deleteOriginal(UUID id) { writable(); storage.deleteRetainedOriginal(id); }
            public void deleteStaging(UUID id) { writable(); storage.deleteRetainedStaging(id); }
        };
    }

    private static StandardEnvironment settings() throws IOException {
        var defaults = new Properties();
        try (InputStream input = RecoveryAdministration.class.getResourceAsStream("/application.properties")) {
            if (input == null) throw new IllegalStateException("Application settings unavailable.");
            defaults.load(input);
        }
        var settings = new StandardEnvironment();
        settings.getPropertySources().addLast(new PropertiesPropertySource("recoveryDefaults", defaults));
        return settings;
    }

    static boolean hasExplicitDatabaseTarget(StandardEnvironment settings, boolean required) {
        if (!required) return true;
        for (String[] names : new String[][] {
                {"MEMORY_ARCHIVE_DB_URL", "spring.datasource.url"},
                {"MEMORY_ARCHIVE_DB_USERNAME", "spring.datasource.username"},
                {"MEMORY_ARCHIVE_DB_PASSWORD", "spring.datasource.password"}}) {
            boolean present = false;
            for (var source : settings.getPropertySources()) {
                if ("recoveryDefaults".equals(source.getName())) continue;
                for (String name : names) {
                    Object value = source.getProperty(name);
                    if (value instanceof String text && !text.isBlank()) present = true;
                }
            }
            if (!present) return false;
        }
        return true;
    }
}
