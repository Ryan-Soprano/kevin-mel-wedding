package com.kevinmel.archive.operations;

import java.io.IOException;
import java.io.PrintStream;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.function.Function;

import javax.sql.DataSource;

import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Private read-only console. Starts no server, application context, migration, scheduler or provider client. */
public final class ReadinessAdministration {
    private static final String LOCAL_ENVIRONMENT = "local";
    private static final String DB_URL_PROPERTY = "spring.datasource.url";
    private static final String DB_USERNAME_PROPERTY = "spring.datasource.username";
    private static final String DB_PASSWORD_PROPERTY = "spring.datasource.password";


    private static final String DEFAULTS = "operationsDefaults";
    private static final Set<String> BOUNDED_PROPERTIES = Set.of(
            "connecttimeout",
            "sockettimeout",
            "logintimeout",
            "cancelsignaltimeout",
            "readonly",
            "readonlymode",
            "options");

    private ReadinessAdministration() {
    }

    public static void main(String[] args) {
        System.exit(run(args));
    }

    static int run(String[] args) {
        try {
            LoggingSystem logging = LoggingSystem.get(ReadinessAdministration.class.getClassLoader());
            logging.setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
            logging.setLogLevel("org.springframework.jdbc", LogLevel.OFF);
            java.util.logging.Logger.getLogger("org.postgresql").setLevel(java.util.logging.Level.OFF);
            return run(
                    args,
                    settings(),
                    ReadinessAdministration::database,
                    System.out,
                    System.err);
        } catch (Exception failure) {
            System.err.println("OPERATIONS_UNCONFIRMED: no readiness claim; private settings could not be verified.");
            return 1;
        }
    }

    static int run(
            String[] args,
            StandardEnvironment settings,
            Function<StandardEnvironment, DataSource> databaseFactory,
            PrintStream out,
            PrintStream err) {
        if (args.length == 1 && "--help".equals(args[0])) {
            out.println("""
                    Private read-only operations observations; no server, migration, maintenance or provider access:
                      --expect-environment <local|staging|production> report
                      --expect-environment <local|staging|production> schema-check --prior-jar <private-jar>
                    Reads base application.properties plus private environment/JVM overrides, not profile files.
                    Nonlocal reports and every schema-check require explicit database URL, username and password.
                    The environment label is a guard, not proof of the actual target; verify it privately first.
                    Exit 0 means only observed database checks passed or exact rollback migration compatibility.
                    Storage access, actual retention job health, backups, RPO/RTO and release readiness are unchecked.
                    No interactive confirmation is needed for these read-only commands. No private values are printed.
                    """);
            return 0;
        }
        boolean report = args.length == 3 && "report".equals(args[2]);
        boolean guard = args.length == 5
                && "schema-check".equals(args[2])
                && "--prior-jar".equals(args[3])
                && !args[4].isBlank();
        if (!validCommand(args, report, guard)) {
            err.println("OPERATIONS_REFUSED: use --help and a supported target command.");
            return 2;
        }
        OperationsReadiness.Gates gates;
        try {
            gates = verifiedSettings(settings, args[1], guard);
        } catch (RuntimeException invalid) {
            err.println("OPERATIONS_REFUSED: target or private settings are incomplete or invalid; no database check started.");
            return 2;
        }
        try {
            return inspect(args, settings, databaseFactory, out, gates, guard);
        } catch (Exception failure) {
            err.println(guard
                    ? "ROLLBACK_SCHEMA_UNCONFIRMED"
                    : "OPERATIONS_UNCONFIRMED: no readiness claim; private checks did not complete.");
            return 1;
        }
    }

    private static boolean validCommand(String[] args, boolean report, boolean guard) {
        return (report || guard)
                && "--expect-environment".equals(args[0])
                && Set.of(LOCAL_ENVIRONMENT, "staging", "production").contains(args[1]);
    }

    private static OperationsReadiness.Gates verifiedSettings(
            StandardEnvironment settings,
            String environment,
            boolean guard) {
        if (!environment.equals(settings.getProperty("archive.environment", LOCAL_ENVIRONMENT))
                || !hasExplicitDatabaseTarget(settings, guard || !LOCAL_ENVIRONMENT.equals(environment))) {
            throw OperationsSchema.rejected();
        }
        var gates = gates(settings);
        boundedJdbcUrl(settings.getRequiredProperty(DB_URL_PROPERTY));
        if (settings.getRequiredProperty(DB_USERNAME_PROPERTY).isBlank()
                || settings.getRequiredProperty(DB_PASSWORD_PROPERTY).isBlank()) {
            throw OperationsSchema.rejected();
        }
        return gates;
    }

    private static int inspect(
            String[] args,
            StandardEnvironment settings,
            Function<StandardEnvironment, DataSource> databaseFactory,
            PrintStream out,
            OperationsReadiness.Gates gates,
            boolean guard) throws Exception {
        // Validate the arbitrary prior artifact before contacting the database.
        var current = guard ? OperationsSchema.bundled() : null;
        if (guard && !current.equals(OperationsSchema.priorJar(Path.of(args[4])))) {
            throw OperationsSchema.rejected();
        }
        DataSource source = databaseFactory.apply(settings);
        if (guard) {
            try (var connection = source.getConnection()) {
                OperationsReadiness.readOnly(connection);
                OperationsSchema.requireCurrent(connection, current);
                connection.rollback();
            }
            out.println("ROLLBACK_SCHEMA_MATCH");
            return 0;
        }
        var result = new OperationsReadiness(source, gates).inspect();
        print(result, out);
        return result.exitCode();
    }

    static void print(
            OperationsReadiness.Report report,
            PrintStream out) {
        var gates = report.gates();
        out.printf(
                "OPERATIONS_%s%nDATABASE_%s%nSCHEMA_%s%n",
                report.status(),
                report.database(),
                report.schema());
        out.printf(
                "UPLOAD_ADMISSION_%s%nNOTE_ADMISSION_HAS_NO_UPLOAD_PAUSE_GATE%nREVEAL_%s%nAUDIO_ADMISSION_%s%n",
                gates.uploadsPaused() ? "PAUSED" : "OPEN",
                gates.revealed() ? "CONFIGURED_OPEN" : "CONFIGURED_CLOSED",
                gates.audioEnabled() ? "CONFIGURED_ENABLED" : "CONFIGURED_DISABLED");
        out.printf(
                "STORAGE_%s%nRETENTION_%s%nRETENTION_INTERVAL_MILLIS %d%n",
                gates.storageEnabled() ? "ENABLED_UNCHECKED" : "DISABLED",
                gates.retentionEnabled() ? "CONFIGURED_ENABLED_JOB_UNCHECKED" : "CONFIGURED_DISABLED_JOB_UNCHECKED",
                gates.retentionIntervalMillis());
        if (report.totals() != null) {
            var totals = report.totals();
            out.printf(
                    "ORIGINAL_RESERVATION_BYTES %d LIMIT %d STATUS %s%nSTAGING_RESERVATION_BYTES %d LIMIT %d STATUS %s%n",
                    totals.reservedOriginalBytes(),
                    gates.maxOriginalBytes(),
                    OperationsReadiness.capacity(totals.reservedOriginalBytes(), gates.maxOriginalBytes()),
                    totals.reservedStagingBytes(),
                    gates.maxStagingBytes(),
                    OperationsReadiness.capacity(totals.reservedStagingBytes(), gates.maxStagingBytes()));
            out.printf(
                    "PENDING_MEDIA %d%nFAILED_MEDIA %d%nLIVE_UPLOAD_GRANTS %d%nOVERDUE_RETENTION %d%nUNFINISHED_DELETION_PLANS %d%n",
                    totals.pendingMedia(),
                    totals.failedMedia(),
                    totals.liveGrants(),
                    totals.overdueRetention(),
                    totals.unfinishedDeletionPlans());
        } else {
            out.println("AGGREGATE_OBSERVATIONS_UNCONFIRMED");
        }
        out.println("PROVIDER_BYTES_AND_INTEGRITY_UNCHECKED; RETENTION_JOB_HEALTH_UNCHECKED; BACKUPS_AND_RPO_RTO_UNCHECKED; RELEASE_READINESS_NOT_ESTABLISHED");
    }

    static OperationsReadiness.Gates gates(StandardEnvironment settings) {
        return new OperationsReadiness.Gates(
                bool(settings, "archive.media.uploads-paused", false),
                bool(settings, "archive.revealed", false),
                bool(settings, "archive.audio.enabled", false),
                bool(settings, "archive.storage.enabled", false),
                bool(settings, "archive.retention.enabled", false),
                Long.parseLong(settings.getProperty("archive.media.max-original-bytes", "7500000000")),
                Long.parseLong(settings.getProperty("archive.media.max-staging-bytes", "7500000000")),
                Long.parseLong(settings.getProperty("archive.retention.interval-ms", "300000")));
    }

    private static boolean bool(
            StandardEnvironment settings,
            String name,
            boolean fallback) {
        String value = settings.getProperty(name, Boolean.toString(fallback));
        if (!Set.of("true", "false").contains(value)) {
            throw OperationsSchema.rejected();
        }
        return "true".equals(value);
    }

    static boolean hasExplicitDatabaseTarget(
            StandardEnvironment settings,
            boolean required) {
        if (!required) {
            return true;
        }
        for (String[] names : new String[][] {
                {"MEMORY_ARCHIVE_DB_URL", DB_URL_PROPERTY},
                {"MEMORY_ARCHIVE_DB_USERNAME", DB_USERNAME_PROPERTY},
                {"MEMORY_ARCHIVE_DB_PASSWORD", DB_PASSWORD_PROPERTY}}) {
            if (!hasExplicitProperty(settings, names)) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasExplicitProperty(StandardEnvironment settings, String[] names) {
        boolean present = false;
        for (var source : settings.getPropertySources()) {
            if (DEFAULTS.equals(source.getName())) {
                continue;
            }
            for (String name : names) {
                if (source.getProperty(name) instanceof String value && !value.isBlank()) {
                    present = true;
                }
            }
        }
        return present;
    }

    private static DataSource database(StandardEnvironment settings) {
        return new DriverManagerDataSource(
                boundedJdbcUrl(settings.getRequiredProperty(DB_URL_PROPERTY)),
                settings.getRequiredProperty(DB_USERNAME_PROPERTY),
                settings.getRequiredProperty(DB_PASSWORD_PROPERTY));
    }

    static String boundedJdbcUrl(String raw) {
        if (raw == null || raw.length() > 4096 || !raw.startsWith("jdbc:postgresql://")) {
            throw OperationsSchema.rejected();
        }
        URI uri = URI.create(raw.substring(5));
        requireJdbcLocation(uri);
        var query = unboundedQuery(uri);
        query.addAll(List.of(
                "connectTimeout=5",
                "socketTimeout=10",
                "loginTimeout=10",
                "cancelSignalTimeout=2",
                "readOnly=true",
                "readOnlyMode=always",
                "options=" + URLEncoder.encode("-c statement_timeout=5000 -c lock_timeout=2000", StandardCharsets.UTF_8)));
        return raw.split("\\?", 2)[0] + "?" + String.join("&", query);
    }

    private static void requireJdbcLocation(URI uri) {
        if (uri.getHost() == null
                || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null
                || uri.getPort() == 0
                || uri.getPort() > 65535
                || uri.getRawPath() == null
                || uri.getRawPath().length() < 2) {
            throw OperationsSchema.rejected();
        }
    }

    private static List<String> unboundedQuery(URI uri) {
        var query = new ArrayList<String>();
        if (uri.getRawQuery() != null) {
            for (String parameter : uri.getRawQuery().split("&", -1)) {
                String key = URLDecoder.decode(parameter.split("=", 2)[0], StandardCharsets.UTF_8)
                        .toLowerCase(Locale.ROOT);
                if (Set.of("user", "password").contains(key) || key.isBlank()) {
                    throw OperationsSchema.rejected();
                }
                if (!BOUNDED_PROPERTIES.contains(key)) {
                    query.add(parameter);
                }
            }
        }
        return query;
    }

    private static StandardEnvironment settings() throws IOException {
        var defaults = new Properties();
        try (var input = ReadinessAdministration.class.getResourceAsStream("/application.properties")) {
            if (input == null) {
                throw OperationsSchema.rejected();
            }
            defaults.load(input);
        }
        var settings = new StandardEnvironment();
        settings.getPropertySources().addLast(new PropertiesPropertySource(DEFAULTS, defaults));
        return settings;
    }
}
