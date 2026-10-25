package com.kevinmel.archive.security;

import java.io.Console;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Properties;
import java.security.SecureRandom;

import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;

import com.kevinmel.archive.security.AccountAdministrationStore.EnvironmentMode;
import com.kevinmel.archive.security.AccountAdministrationStore.RejectedOperation;
import com.kevinmel.archive.security.AccountAdministrationStore.Role;

/** A deliberately separate, console-only entry point; no server, component scan, or storage clients. */
public final class AccountAdministration {
    private static final String CREATE_COMMAND = "create";


    private record Command(EnvironmentMode expectedEnvironment, String action, String username,
            String displayName, Role role) { }

    private AccountAdministration() { }

    public static void main(String[] args) {
        System.exit(run(args));
    }

    static int run(String[] args) {
        if (args.length == 1 && args[0].equals("--help")) {
            printUsage();
            return 0;
        }
        try {
            Command command = parse(args);
            Console console = System.console();
            if (console == null) {
                throw new RejectedOperation(
                    "An interactive system console is required. Run directly in a terminal without input/output redirection.");
            }

            // DriverManagerDataSource can log JDBC URLs at DEBUG; keep credential material out of logs.
            LoggingSystem logging = LoggingSystem.get(AccountAdministration.class.getClassLoader());
            logging.setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
            logging.setLogLevel("org.springframework.jdbc", LogLevel.OFF);
            logging.setLogLevel("org.postgresql", LogLevel.OFF);

            StandardEnvironment properties = loadProperties();
            EnvironmentMode actualEnvironment = EnvironmentMode.parse(
                properties.getProperty("archive.environment", "local"));
            if (actualEnvironment != command.expectedEnvironment()) {
                throw new RejectedOperation("Configured environment does not match --expect-environment. No account was changed.");
            }
            String revealSetting = properties.getProperty("archive.revealed", "false");
            if (!revealSetting.equals("true") && !revealSetting.equals("false")) {
                throw new RejectedOperation("archive.revealed must be explicitly true or false.");
            }

            DriverManagerDataSource dataSource = new DriverManagerDataSource(
                properties.getRequiredProperty("spring.datasource.url"),
                properties.getRequiredProperty("spring.datasource.username"),
                properties.getRequiredProperty("spring.datasource.password"));
            AccountAdministrationStore store = new AccountAdministrationStore(
                JdbcClient.create(dataSource), PasswordEncoderFactories.createDelegatingPasswordEncoder(),
                new JdbcTransactionManager(dataSource), actualEnvironment, revealSetting.equals("true"));

            String confirmation = command.action() + " " + command.username() + " in "
                + actualEnvironment.name().toLowerCase(java.util.Locale.ROOT);
            console.printf("Account command: %s%n", confirmation);
            if (command.action().equals(CREATE_COMMAND)) {
                console.printf("Role: %s. New accounts are disabled until a separate enable command.%n", command.role());
            } else if (command.action().equals("create-temporary")) {
                console.printf("Role: COUPLE. This account will be enabled and must change its temporary password before archive access.%n");
            }
            String answer = console.readLine("Type '%s' to continue: ", confirmation);
            if (!confirmation.equals(answer)) {
                throw new RejectedOperation("Confirmation did not match. No account was changed.");
            }

            applyCommand(console, store, command);
            console.printf("Account command committed.%n");
            return 0;
        } catch (RejectedOperation rejection) {
            System.err.println(rejection.getMessage());
            return 2;
        } catch (IOException | RuntimeException failure) {
            // Never echo SQL, connection strings, passwords/hashes, or a stack trace.
            System.err.println("Account command failed. Success was not confirmed; inspect the target database with password-safe diagnostics before retrying.");
            return 1;
        }
    }

    private static void applyCommand(Console console, AccountAdministrationStore store, Command command) {
        switch (command.action()) {
            case CREATE_COMMAND, "reset-password" -> writePassword(console, store, command);
            case "create-temporary" -> createTemporary(console, store, command.username(), command.displayName());
            case "enable" -> store.setEnabled(command.username(), true);
            case "disable" -> store.setEnabled(command.username(), false);
            default -> throw new RejectedOperation("Unsupported account command.");
        }
    }

    static void createTemporary(Console console, AccountAdministrationStore store, String username, String displayName) {
        char[] password = temporaryPassword(new SecureRandom());
        try {
            store.createTemporary(username, displayName, password);
            // The transaction has committed. Never send this through stdout, stderr, logging, or a file.
            console.writer().printf("Temporary password for %s: ", username);
            console.writer().println(password);
            console.writer().flush();
            if (console.writer().checkError()) throw new RejectedOperation(
                    "The account was created, but console delivery was not confirmed. Do not retry creation; use console recovery.");
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    static char[] temporaryPassword(SecureRandom random) {
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        char[] value = new char[32];
        for (int i = 0; i < value.length; i++) value[i] = alphabet.charAt(random.nextInt(alphabet.length()));
        return value;
    }

    private static void writePassword(Console console, AccountAdministrationStore store, Command command) {
        char[] password = null;
        char[] repeated = null;
        try {
            password = console.readPassword("New password (at least 15 characters, at most 72 UTF-8 bytes): ");
            repeated = console.readPassword("Repeat new password: ");
            if (password == null || repeated == null || !Arrays.equals(password, repeated)) {
                throw new RejectedOperation("Passwords did not match. No account was changed.");
            }
            if (command.action().equals(CREATE_COMMAND)) {
                store.create(command.username(), command.displayName(), command.role(), password);
            } else {
                store.resetPassword(command.username(), password);
            }
        } finally {
            if (password != null) {
                Arrays.fill(password, '\0');
            }
            if (repeated != null) {
                Arrays.fill(repeated, '\0');
            }
        }
    }

    private static Command parse(String[] args) {
        if (args.length < 4 || !args[0].equals("--expect-environment")) {
            throw new RejectedOperation("Use --help for account commands. --expect-environment is required.");
        }
        EnvironmentMode expectedEnvironment = EnvironmentMode.parse(args[1]);
        String action = args[2];
        String username = args[3];
        AccountAdministrationStore.validateUsername(username);
        return switch (action) {
            case CREATE_COMMAND -> {
                if (args.length != 6) {
                    throw new RejectedOperation("create requires username, display name, and role; passwords are read only from the console.");
                }
                yield new Command(expectedEnvironment, action, username, args[4], Role.parse(args[5]));
            }
            case "create-temporary" -> {
                if (args.length != 5) throw new RejectedOperation(
                        "create-temporary requires only username and display name; a temporary password is generated internally.");
                yield new Command(expectedEnvironment, action, username, args[4], Role.COUPLE);
            }
            case "reset-password", "enable", "disable" -> {
                if (args.length != 4) {
                    throw new RejectedOperation("This command requires only the username; passwords are read only from the console.");
                }
                yield new Command(expectedEnvironment, action, username, null, null);
            }
            default -> throw new RejectedOperation("Supported commands: create, create-temporary, reset-password, enable, disable.");
        };
    }

    private static StandardEnvironment loadProperties() throws IOException {
        Properties defaults = new Properties();
        try (InputStream input = AccountAdministration.class.getResourceAsStream("/application.properties")) {
            if (input == null) {
                throw new RejectedOperation("application.properties was not found. Build the backend before running account commands.");
            }
            defaults.load(input);
        }
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addLast(new PropertiesPropertySource("accountDefaults", defaults));
        return environment;
    }

    private static void printUsage() {
        System.out.println("""
                Console-only account administration (no HTTP endpoints):
                  --expect-environment <local|staging|production> create <username> <display-name> <COUPLE|OPERATOR|DEVELOPER>
                  --expect-environment <local|staging|production> create-temporary <username> <display-name>
                  --expect-environment <local|staging|production> reset-password <username>
                  --expect-environment <local|staging|production> enable <username>
                  --expect-environment <local|staging|production> disable <username>
                Passwords are accepted only through hidden console prompts. New accounts are disabled.
                create-temporary generates a COUPLE password, displays it only after commit on the real console,
                and enables the account with archive access blocked until the first password change.
                Use the account-access runbook to configure the target and reveal gate.
                """);
    }
}
