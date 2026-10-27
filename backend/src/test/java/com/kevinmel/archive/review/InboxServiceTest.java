package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.kevinmel.archive.security.*;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;

class InboxServiceTest {
    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static final Instant TIME = Instant.parse("2026-10-09T12:34:56.123456Z");
    private final ArchiveAccountRepository accounts = mock(ArchiveAccountRepository.class);
    private final InboxRepository repository = mock(InboxRepository.class);
    private final ArchiveAccount couple = account("COUPLE", true, 1);
    private InboxService service;

    @BeforeEach void authorized() {
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(couple));
        service = service(true);
        authenticate(identity(couple));
    }
    @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); }

    @Test void pagesUseLastReturnedPositionRatherThanTheExtraRowAndAreImmutable() {
        var first = memory(50); var second = memory(40); var extra = memory(30);
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(first, second, extra), 3));
        var page = service.list(null, "2", null);
        assertThat(page.items()).containsExactly(first, second);
        assertThat(page.totalCount()).isEqualTo(3);
        assertThat(InboxCursor.decode(page.nextCursor(), "PENDING")).isEqualTo(new InboxCursor("PENDING", TIME, second.memoryId()));
        verify(repository).listPage(new InboxQuery("PENDING", 2, null));
        assertThatThrownBy(() -> page.items().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThat(page.toString()).doesNotContain("private guest", "private note", page.nextCursor());
    }

    @Test void lastAndEmptyPagesHaveNoCursor() {
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(memory(1)), 1))
                .thenReturn(new InboxRepository.InboxRows(List.of(), 0));
        assertThat(service.list("KEEP", "2", null).nextCursor()).isNull();
        var empty = service.list("ARCHIVED", "20", null);
        assertThat(empty.items()).isEmpty();
        assertThat(empty.nextCursor()).isNull();
        assertThat(empty.totalCount()).isZero();
        verify(accounts, times(2)).findById(ACCOUNT);
    }

    @Test void laterAndEmptyCursorPagesKeepTheFullSelectedCategoryTotal() {
        var cursor = new InboxCursor("PENDING", TIME, memory(2).memoryId());
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(memory(1)), 7))
                .thenReturn(new InboxRepository.InboxRows(List.of(), 7));
        var later = service.list("PENDING", "2", cursor.encode());
        assertThat(later.items()).containsExactly(memory(1));
        assertThat(later.nextCursor()).isNull();
        assertThat(later.totalCount()).isEqualTo(7);
        assertThat(service.list("PENDING", "2", cursor.encode()).totalCount()).isEqualTo(7);
        verify(repository, times(2)).listPage(new InboxQuery("PENDING", 2, cursor));
    }

    @Test void detailIsPrivateAndMissingMemoryIsSafe() {
        var detail = memory(1);
        when(repository.detail(detail.memoryId())).thenReturn(Optional.of(detail));
        assertThat(service.detail(detail.memoryId())).isEqualTo(detail);
        assertThat(detail.toString()).doesNotContain("private note", "private guest");
        when(repository.detail(detail.memoryId())).thenReturn(Optional.empty());
        rejects(() -> service.detail(detail.memoryId()), 404, "NOT_FOUND");
    }

    @Test void everyQueryRechecksAccountEnablementRatherThanTrustingPriorAccess() {
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(), 0));
        service.list("PENDING", "20", null);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account("COUPLE", false, 1)));
        rejects(() -> service.detail(memory(1).memoryId()), 401, "AUTH_REQUIRED");
        verify(accounts, times(2)).findById(ACCOUNT);
        verify(repository, never()).detail(any());
    }

    @Test void revokedMissingAndChangedAccountsAreDeniedBeforeReadingPrivateData() {
        for (Optional<ArchiveAccount> current : List.of(Optional.<ArchiveAccount>empty(),
                Optional.of(account("COUPLE", false, 1)), Optional.of(account("COUPLE", true, 2)),
                Optional.of(account("OPERATOR", true, 1)))) {
            when(accounts.findById(ACCOUNT)).thenReturn(current);
            rejects(() -> service.list("PENDING", "20", null), 401, "AUTH_REQUIRED");
            rejects(() -> service.detail(memory(1).memoryId()), 401, "AUTH_REQUIRED");
        }
        verifyNoInteractions(repository);
    }

    @Test void anonymousGenericAndNonCouplePrincipalsCannotUseTheServiceDirectly() {
        authenticate(null);
        rejects(() -> service.list(null, null, null), 401, "AUTH_REQUIRED");
        authenticate(new AnonymousAuthenticationToken("synthetic", "anonymous",
                List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS"))));
        rejects(() -> service.detail(memory(1).memoryId()), 401, "AUTH_REQUIRED");
        var generic = User.withUsername("synthetic").password("unused").roles("COUPLE").build();
        authenticate(UsernamePasswordAuthenticationToken.authenticated(generic, null, generic.getAuthorities()));
        rejects(() -> service.list(null, null, null), 403, "ARCHIVE_UNAVAILABLE");
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var current = account(role, true, 1);
            when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(current));
            authenticate(identity(current));
            rejects(() -> service.list(null, null, null), 403, "ARCHIVE_UNAVAILABLE");
        }
        verifyNoInteractions(repository);
    }

    @Test void closedRevealAndInvalidQueriesNeverReachTheRepository() {
        service = service(false);
        rejects(() -> service.list(null, null, null), 403, "ARCHIVE_UNAVAILABLE");
        service = service(true);
        rejects(() -> service.list("PUBLIC", "20", null), 400, "VALIDATION_FAILED");
        rejects(() -> service.list("PENDING", "101", null), 400, "VALIDATION_FAILED");
        rejects(() -> service.list("PENDING", "20", "bad-cursor"), 400, "INVALID_CURSOR");
        verifyNoInteractions(repository);
    }

    @Test void namedOperatorAdminCanReadBeforeRevealAndIsRevokedBeforeTheNextQuery() {
        var operator = new ArchiveAccount(ACCOUNT, "ryan-admin", "Synthetic Operator", "{noop}unused-fixture",
                "OPERATOR", true, 1);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(operator));
        authenticate(identity(operator));
        service = new InboxService(new ArchiveAuthorization(accounts,
                new ArchiveAccessPolicy("local", false, false, "", "ryan-admin", new MockEnvironment())), repository);
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(memory(1)), 1));
        assertThat(service.list("PENDING", "20", null).items()).containsExactly(memory(1));
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(new ArchiveAccount(ACCOUNT, operator.username(),
                operator.displayName(), operator.passwordHash(), "OPERATOR", false, 2)));
        rejects(() -> service.detail(memory(1).memoryId()), 401, "AUTH_REQUIRED");
        verify(repository, never()).detail(any());
    }

    private InboxService service(boolean revealed) {
        var policy = new ArchiveAccessPolicy("local", revealed, false, "", "", new MockEnvironment());
        return new InboxService(new ArchiveAuthorization(accounts, policy), repository);
    }
    private static ArchiveAccount account(String role, boolean enabled, long version) {
        return new ArchiveAccount(ACCOUNT, "synthetic-couple", "Synthetic Couple", "{noop}unused-fixture", role, enabled, version);
    }
    private static Authentication identity(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var identity = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        identity.eraseCredentials();
        return identity;
    }
    private static void authenticate(Authentication authentication) {
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
    }
    private static MemoryDetail memory(int number) {
        return new MemoryDetail(UUID.fromString("00000000-0000-4000-8000-" + String.format("%012d", number)),
                UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), "private guest", "TEXT",
                "private note", null, "PENDING", "COUPLE_ONLY", 1, TIME, TIME, null, null);
    }
    private static void rejects(Runnable operation, int status, String code) {
        assertThatThrownBy(operation::run).isInstanceOf(ApiException.class).satisfies(failure -> {
            assertThat(((ApiException) failure).status()).isEqualTo(status);
            assertThat(((ApiException) failure).code()).isEqualTo(code);
        });
    }
}
