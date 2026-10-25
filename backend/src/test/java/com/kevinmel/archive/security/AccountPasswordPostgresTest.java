package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.kevinmel.archive.web.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = "archive.revealed=true")
class AccountPasswordPostgresTest {
    @Container @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17");
    @Autowired JdbcClient jdbc;
    @Autowired ArchiveAccountRepository accounts;
    @Autowired AccountPasswordService passwords;
    @Autowired PasswordEncoder encoder;
    @Autowired PlatformTransactionManager transactions;

    @Test void temporaryProvisioningAndRecoveryAreExplicitAndDuplicateCreationNeverReplacesCredentials() {
        String username = "synthetic-" + UUID.randomUUID();
        var admin = administrator();
        char[] temporary = "synthetic-temporary-secret".toCharArray();
        try {
            admin.createTemporary(username, "Synthetic Couple", temporary);
            var created = accounts.findByUsername(username).orElseThrow();
            assertThat(created.enabled()).isTrue();
            assertThat(created.passwordChangeRequired()).isTrue();
            assertThat(created.credentialsVersion()).isZero();
            assertThat(encoder.matches(new String(temporary), created.passwordHash())).isTrue();
            assertThatThrownBy(() -> admin.createTemporary(username, "Synthetic Couple",
                    "different-synthetic-secret".toCharArray())).isInstanceOf(AccountAdministrationStore.RejectedOperation.class);
            assertThat(accounts.findById(created.id()).orElseThrow()).isEqualTo(created);
            admin.resetPassword(username, "synthetic-recovery-secret".toCharArray());
            var recovered = accounts.findById(created.id()).orElseThrow();
            assertThat(recovered.passwordChangeRequired()).isFalse();
            assertThat(recovered.enabled()).isTrue();
            assertThat(recovered.credentialsVersion()).isEqualTo(1);
            assertThat(encoder.matches("synthetic-recovery-secret", recovered.passwordHash())).isTrue();
        } finally {
            java.util.Arrays.fill(temporary, '\0');
            delete(username);
        }
    }

    @Test void simultaneousPasswordChangesCommitOnlyOnceAndTheOldVersionNeverWinsAgain() throws Exception {
        String username = "synthetic-" + UUID.randomUUID();
        String current = "synthetic-temporary-secret";
        administrator().createTemporary(username, "Synthetic Couple", current.toCharArray());
        var before = accounts.findByUsername(username).orElseThrow();
        var principal = new ArchivePrincipal(before);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Callable<Boolean>> attempts = List.of(
                    () -> changeAfter(start, principal, current, "first-synthetic-new-secret"),
                    () -> changeAfter(start, principal, current, "second-synthetic-new-secret"));
            var futures = attempts.stream().map(pool::submit).toList();
            start.countDown();
            long successes = 0;
            for (var future : futures) if (future.get(20, TimeUnit.SECONDS)) successes++;
            assertThat(successes).isEqualTo(1);
            var after = accounts.findById(before.id()).orElseThrow();
            assertThat(after.credentialsVersion()).isEqualTo(1);
            assertThat(after.passwordChangeRequired()).isFalse();
            assertThat(encoder.matches(current, after.passwordHash())).isFalse();
            assertThat(encoder.matches("first-synthetic-new-secret", after.passwordHash())
                    ^ encoder.matches("second-synthetic-new-secret", after.passwordHash())).isTrue();
            assertThatThrownBy(() -> passwords.change(principal, current, "third-synthetic-new-secret"))
                    .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.code()).isEqualTo("PASSWORD_CHANGE_CONFLICT"));
            assertThat(accounts.findById(before.id()).orElseThrow()).isEqualTo(after);
        } finally { delete(username); }
    }

    @Test void migrationAddsFalseNotNullDefaultWithoutChangingExistingAccountCredentials() {
        String schema = "password_" + UUID.randomUUID().toString().replace("-", "");
        var data = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        var migration = Flyway.configure().dataSource(data).schemas(schema).defaultSchema(schema).target("14").load();
        migration.migrate();
        var scopedData = new DriverManagerDataSource(postgres.getJdbcUrl()
                + (postgres.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=" + schema,
                postgres.getUsername(), postgres.getPassword());
        var scoped = JdbcClient.create(scopedData);
        String hash = encoder.encode("existing-synthetic-operator-secret");
        try {
            scoped.sql("INSERT INTO archive_account (username,display_name,password_hash,role,enabled,credentials_version) VALUES ('synthetic-operator','Synthetic Operator',:hash,'OPERATOR',TRUE,7)")
                    .param("hash", hash).update();
            Flyway.configure().dataSource(data).schemas(schema).defaultSchema(schema).load().migrate();
            var account = new ArchiveAccountRepository(scoped).findByUsername("synthetic-operator").orElseThrow();
            assertThat(account.passwordChangeRequired()).isFalse();
            assertThat(account.enabled()).isTrue();
            assertThat(account.credentialsVersion()).isEqualTo(7);
            assertThat(account.passwordHash()).isEqualTo(hash);
            assertThatThrownBy(() -> scoped.sql("UPDATE archive_account SET password_change_required=NULL").update())
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        } finally { jdbc.sql("DROP SCHEMA " + schema + " CASCADE").update(); }
    }

    private boolean changeAfter(CountDownLatch start, ArchivePrincipal principal, String current, String replacement) throws Exception {
        start.await();
        try { passwords.change(principal, current, replacement); return true; }
        catch (ApiException conflict) { assertThat(conflict.code()).isEqualTo("PASSWORD_CHANGE_CONFLICT"); return false; }
    }
    private AccountAdministrationStore administrator() {
        return new AccountAdministrationStore(jdbc, encoder, transactions,
                AccountAdministrationStore.EnvironmentMode.LOCAL, true);
    }
    private void delete(String username) { jdbc.sql("DELETE FROM archive_account WHERE username=:username").param("username", username).update(); }
}
