package com.kevinmel.archive.security;

import java.nio.charset.StandardCharsets;

import com.kevinmel.archive.web.ApiException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Verifies and replaces credentials while holding the current account row lock. */
@Service
public class AccountPasswordService {
    private final ArchiveAccountRepository accounts;
    private final PasswordEncoder encoder;
    private final ArchiveAccessPolicy policy;

    public AccountPasswordService(ArchiveAccountRepository accounts, PasswordEncoder encoder, ArchiveAccessPolicy policy) {
        this.accounts = accounts;
        this.encoder = encoder;
        this.policy = policy;
    }

    @Transactional
    public ArchiveAccount change(ArchivePrincipal principal, String currentPassword, String newPassword) {
        validateNewPassword(newPassword);
        ArchiveAccount account = accounts.findByIdForUpdate(principal.getAccountId()).orElseThrow(AccountPasswordService::conflict);
        if (!account.enabled() || account.credentialsVersion() != principal.getCredentialsVersion()
                || !account.username().equals(principal.getUsername())
                || account.passwordChangeRequired() != principal.isPasswordChangeRequired()
                || principal.getAuthorities().stream().noneMatch(a -> a.getAuthority().equals("ROLE_" + account.role()))
                || !policy.allowsSession(new ArchivePrincipal(account))) throw conflict();
        if (!validCurrentPassword(currentPassword) || !encoder.matches(currentPassword, account.passwordHash())) {
            throw new ApiException(401, "INVALID_CREDENTIALS", "The current password is incorrect.");
        }
        if (encoder.matches(newPassword, account.passwordHash())) {
            throw new ApiException(400, "VALIDATION_FAILED", "Choose a different password.");
        }
        String hash = encoder.encode(newPassword);
        if (!accounts.replacePassword(account.id(), account.credentialsVersion(), hash)) throw conflict();
        return new ArchiveAccount(account.id(), account.username(), account.displayName(), hash, account.role(),
                true, Math.addExact(account.credentialsVersion(), 1), false);
    }

    static void validateNewPassword(String password) {
        if (password == null || password.length() > 72 || password.indexOf('\0') >= 0
                || !StandardCharsets.UTF_8.newEncoder().canEncode(password)
                || password.codePointCount(0, password.length()) < 8
                || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ApiException(400, "VALIDATION_FAILED", "Use at least 8 characters and at most 72 UTF-8 bytes for your new password.");
        }
    }

    private static boolean validCurrentPassword(String password) {
        return password != null && !password.isEmpty() && password.length() <= 72
                && StandardCharsets.UTF_8.newEncoder().canEncode(password)
                && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    private static ApiException conflict() {
        return new ApiException(409, "PASSWORD_CHANGE_CONFLICT", "Your account changed. Sign in again before changing your password.");
    }
}
