package com.kevinmel.archive.retention;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.util.Properties;
import java.util.Set;

import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;

import com.kevinmel.archive.media.R2ObjectStorage;

/** Offline, console-only maintenance. No HTTP listener, moderation choices or component scan. */
public final class RetentionAdministration {
    private static final String LOCAL_ENVIRONMENT = "local";


    private RetentionAdministration() {
    }

    public static void main(String[] args) {
        System.exit(run(args));
    }

    static int run(String[] args) {
        if (args.length == 1 && "--help".equals(args[0])) {
            System.out.println("""
                    Offline retention maintenance (reviewed V13 migration must already be applied):
                      --expect-environment <local|staging|production> purge-expired
                      --expect-environment <local|staging|production> replay-ledger
                    An interactive console and exact confirmation are required. Configure the database and
                    private R2 server credentials through the existing environment settings. For recovery,
                    keep collection/private traffic stopped until complete ledger replay succeeds.
                    """);
            return 0;
        }
        if (!validCommand(args)) {
            System.err.println("Use --help. A target environment and supported maintenance command are required.");
            return 2;
        }
        var console = System.console();
        if (console == null) {
            System.err.println("An interactive system console is required; no maintenance was started.");
            return 2;
        }
        try {
            // Never log SDK errors, JDBC URLs, request bodies or credentials from this privileged process.
            LoggingSystem.get(RetentionAdministration.class.getClassLoader())
                    .setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
            StandardEnvironment settings = settings();
            if (!args[1].equals(settings.getProperty("archive.environment", LOCAL_ENVIRONMENT))
                    || !"true".equals(settings.getProperty("archive.storage.enabled", "false"))) {
                System.err.println("The configured target/storage does not match this command; no maintenance was started.");
                return 2;
            }
            if (!hasExplicitDatabaseTarget(settings, args[1])) {
                System.err.println("Nonlocal maintenance requires explicit private database settings; no maintenance was started.");
                return 2;
            }
            String confirmation = args[2] + " in " + args[1];
            if (!confirmation.equals(console.readLine("Verify the private target, then type '%s': ", confirmation))) {
                System.err.println("Confirmation did not match; no maintenance was started.");
                return 2;
            }
            return maintain(args[2], console, settings);
        } catch (IOException | RuntimeException failure) {
            System.err.println("Maintenance is unconfirmed and may be partial. Keep recovery traffic stopped; inspect private diagnostics and retry.");
            return 1;
        }
    }

    private static boolean validCommand(String[] args) {
        return args.length == 3 && "--expect-environment".equals(args[0])
                && Set.of(LOCAL_ENVIRONMENT, "staging", "production").contains(args[1])
                && Set.of("purge-expired", "replay-ledger").contains(args[2]);
    }

    private static int maintain(String command, java.io.Console console, StandardEnvironment settings) {
        var source = new DriverManagerDataSource(
                settings.getRequiredProperty("spring.datasource.url"),
                settings.getRequiredProperty("spring.datasource.username"),
                settings.getRequiredProperty("spring.datasource.password"));
        try (var storage = R2ObjectStorage.openPrivate(
                settings.getRequiredProperty("archive.storage.endpoint"),
                settings.getRequiredProperty("archive.storage.bucket"),
                settings.getRequiredProperty("archive.storage.access-key-id"),
                settings.getRequiredProperty("archive.storage.secret-access-key"))) {
            var service = new RetentionService(
                    new RetentionRepository(
                            JdbcClient.create(source),
                            new JdbcTransactionManager(source)),
                    RetentionConfiguration.adapt(storage),
                    Clock.systemUTC());
            if ("replay-ledger".equals(command)) {
                console.printf(
                        "Ledger replay completed for %d records. Verify restored data before reopening traffic.%n",
                        service.replayLedger());
                return 0;
            }
            var result = service.purgeBatch(20);
            console.printf(
                    "Expired-decision batch: %d purged, %d unconfirmed. Unconfirmed work retains its retry plan.%n",
                    result.purged(),
                    result.failed());
            return result.failed() == 0 ? 0 : 1;
        }
    }

    private static StandardEnvironment settings() throws IOException {
        Properties defaults = new Properties();
        try (InputStream input = RetentionAdministration.class.getResourceAsStream("/application.properties")) {
            if (input == null) {
                throw new IllegalStateException("Application settings are unavailable.");
            }
            defaults.load(input);
        }
        var settings = new StandardEnvironment();
        settings.getPropertySources()
                .addLast(new PropertiesPropertySource("retentionDefaults", defaults));
        return settings;
    }

    static boolean hasExplicitDatabaseTarget(
            StandardEnvironment settings,
            String environment) {
        if (LOCAL_ENVIRONMENT.equals(environment)) {
            return true;
        }
        for (String[] names : new String[][] {
                {"MEMORY_ARCHIVE_DB_URL", "spring.datasource.url"},
                {"MEMORY_ARCHIVE_DB_USERNAME", "spring.datasource.username"},
                {"MEMORY_ARCHIVE_DB_PASSWORD", "spring.datasource.password"}
        }) {
            if (!hasExplicitProperty(settings, names)) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasExplicitProperty(StandardEnvironment settings, String[] names) {
        boolean present = false;
        for (var source : settings.getPropertySources()) {
            if ("retentionDefaults".equals(source.getName())) {
                continue;
            }
            for (var name : names) {
                Object value = source.getProperty(name);
                if (value instanceof String text && !text.isBlank()) {
                    present = true;
                }
            }
        }
        return present;
    }
}
