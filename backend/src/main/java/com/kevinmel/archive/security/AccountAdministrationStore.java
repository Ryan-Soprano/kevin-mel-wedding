package com.kevinmel.archive.security;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Console administration only; this class is deliberately not a Spring web bean. */
public final class AccountAdministrationStore {

    private static final Pattern USERNAME = Pattern.compile("[a-z0-9][a-z0-9._-]{2,99}");

    public enum EnvironmentMode {
        LOCAL, STAGING, PRODUCTION;

        public static EnvironmentMode parse(String value) {
            if (value == null) {
                throw new RejectedOperation("Environment must be local, staging, or production.");
            }
            return switch (value) {
                case "local" -> LOCAL;
                case "staging" -> STAGING;
                case "production" -> PRODUCTION;
                default -> throw new RejectedOperation("Environment must be local, staging, or production.");
            };
        }
    }

    public enum Role {
        COUPLE, OPERATOR, DEVELOPER;

        public static Role parse(String value) {
            try {
                return valueOf(value);
            } catch (IllegalArgumentException | NullPointerException failure) {
                throw new RejectedOperation("Role must be COUPLE, OPERATOR, or DEVELOPER.");
            }
        }
    }

    /** Only these messages may be displayed; database/encoder exceptions are never echoed. */
    public static final class RejectedOperation extends IllegalArgumentException {
        public RejectedOperation(String safeMessage) {
            super(safeMessage);
        }
    }

    private record ManagedAccount(UUID id, String username, Role role) { }

    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate transactions;
    private final EnvironmentMode environment;
    private final boolean revealed;

    public AccountAdministrationStore(JdbcClient jdbc, PasswordEncoder passwordEncoder,
            PlatformTransactionManager transactionManager, EnvironmentMode environment, boolean revealed) {
        this.jdbc = Objects.requireNonNull(jdbc);
        this.passwordEncoder = Objects.requireNonNull(passwordEncoder);
        this.transactions = new TransactionTemplate(Objects.requireNonNull(transactionManager));
        this.environment = Objects.requireNonNull(environment);
        this.revealed = revealed;
    }

    /** Creates a disabled account. Activation is always a separate, confirmed command. */
    public void create(String username, String displayName, Role role, char[] password) {
        validateUsername(username);
        validateDisplayName(displayName);
        requireAllowedAccess(username, role);
        if (environment == EnvironmentMode.PRODUCTION && role == Role.COUPLE
                && !displayName.equals(username.equals("kevin") ? "Kevin" : "Melanie")) {
            throw new RejectedOperation("Production couple display names must be Kevin or Melanie.");
        }
        String passwordHash = encodePassword(password);
        transactions.executeWithoutResult(status -> {
            int inserted = jdbc.sql("""
                    INSERT INTO archive_account (username, display_name, password_hash, role, enabled)
                    VALUES (:username, :displayName, :passwordHash, :role, FALSE)
                    ON CONFLICT (username) DO NOTHING
                    """)
                .param("username", username)
                .param("displayName", displayName)
                .param("passwordHash", passwordHash)
                .param("role", role.name())
                .update();
            if (inserted != 1) {
                throw new RejectedOperation("Account already exists; use reset-password to recover it.");
            }
        });
    }

    /** Replaces the hash and revokes all sessions through the credentials version. */
    public void resetPassword(String username, char[] password) {
        validateUsername(username);
        String passwordHash = encodePassword(password);
        transactions.executeWithoutResult(status -> {
            ManagedAccount account = accountForUpdate(username);
            requireAllowedAccess(account.username(), account.role());
            jdbc.sql("""
                    UPDATE archive_account
                    SET password_hash = :passwordHash,
                        credentials_version = credentials_version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :id
                    """)
                .param("passwordHash", passwordHash)
                .param("id", account.id())
                .update();
        });
    }

    /** Every enable/disable command revokes existing sessions, even if the flag was already set. */
    public void setEnabled(String username, boolean enabled) {
        validateUsername(username);
        transactions.executeWithoutResult(status -> {
            ManagedAccount account = accountForUpdate(username);
            // Disabling remains possible before reveal or for an out-of-policy account.
            if (enabled) {
                requireAllowedAccess(account.username(), account.role());
            }
            jdbc.sql("""
                    UPDATE archive_account
                    SET enabled = :enabled,
                        credentials_version = credentials_version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :id
                    """)
                .param("enabled", enabled)
                .param("id", account.id())
                .update();
        });
    }

    public static void validateUsername(String username) {
        if (username == null || !USERNAME.matcher(username).matches()) {
            throw new RejectedOperation(
                "Username must be 3-100 lowercase letters, digits, dots, underscores, or hyphens, starting with a letter or digit.");
        }
    }

    private static void validateDisplayName(String displayName) {
        if (displayName == null || displayName.isBlank() || displayName.length() > 100
                || displayName.codePoints().anyMatch(Character::isISOControl)
                || !StandardCharsets.UTF_8.newEncoder().canEncode(displayName)) {
            throw new RejectedOperation("Display name must be 1-100 characters with no control characters.");
        }
    }

    private void requireAllowedAccess(String username, Role role) {
        if (role == null) {
            throw new RejectedOperation("Role must be COUPLE, OPERATOR, or DEVELOPER.");
        }
        if (environment == EnvironmentMode.PRODUCTION && role == Role.DEVELOPER) {
            throw new RejectedOperation("Developer accounts are allowed only in local or staging environments.");
        }
        if (role == Role.COUPLE) {
            if (!revealed) {
                throw new RejectedOperation("Couple account creation, recovery, and activation require the reveal gate.");
            }
            if (environment == EnvironmentMode.PRODUCTION
                    && !username.equals("kevin") && !username.equals("melanie")) {
                throw new RejectedOperation("Production COUPLE usernames must be kevin or melanie, with separate accounts.");
            }
        }
    }

    private ManagedAccount accountForUpdate(String username) {
        return jdbc.sql("""
                SELECT id, username, role FROM archive_account WHERE username = :username FOR UPDATE
                """)
            .param("username", username)
            .query((rs, rowNumber) -> new ManagedAccount(
                rs.getObject("id", UUID.class), rs.getString("username"), Role.parse(rs.getString("role"))))
            .optional()
            .orElseThrow(() -> new RejectedOperation("Account does not exist."));
    }

    private String encodePassword(char[] password) {
        if (password == null || Character.codePointCount(password, 0, password.length) < 15) {
            throw new RejectedOperation("Use a unique password or passphrase of at least 15 characters.");
        }
        if (password.length > 72) {
            throw new RejectedOperation("Password must fit within 72 UTF-8 bytes for the configured encoder.");
        }
        ByteBuffer utf8 = null;
        try {
            utf8 = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .encode(CharBuffer.wrap(password));
            if (utf8.remaining() > 72) {
                throw new RejectedOperation("Password must fit within 72 UTF-8 bytes for the configured encoder.");
            }
            return passwordEncoder.encode(CharBuffer.wrap(password));
        } catch (CharacterCodingException failure) {
            throw new RejectedOperation("Password contains invalid Unicode.");
        } finally {
            if (utf8 != null && utf8.hasArray()) {
                Arrays.fill(utf8.array(), (byte) 0);
            }
        }
    }
}
