package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.kevinmel.archive.security.*;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class ReviewServiceTest {
    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static final UUID MEMORY = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static final Instant NOW = Instant.parse("2026-10-09T12:34:56.123456Z");
    private final ArchiveAccountRepository accounts = mock(ArchiveAccountRepository.class);
    private final InboxRepository repository = mock(InboxRepository.class);
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private ReviewService service;

    @BeforeEach void couple() {
        var account = account(true, 1);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account));
        var principal = new ArchivePrincipal(account);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
        service = service(true);
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(memory("PENDING", 1, null)));
        when(repository.changeReview(any(), anyString(), any(), any())).thenAnswer(call -> {
            MemoryDetail before = call.getArgument(0);
            return changed(before, call.getArgument(1), call.getArgument(2), call.getArgument(3));
        });
    }
    @AfterEach void clear() { SecurityContextHolder.clearContext(); }

    @Test void actualChangeRecordsActorAndRevisionExactlyOnce() {
        var before = memory("PENDING", 1, null);
        var after = service.review(MEMORY, Map.of("reviewStatus", "KEEP"), "\"1\"");
        assertThat(after.reviewStatus()).isEqualTo("KEEP");
        assertThat(after.revision()).isEqualTo(2);
        assertThat(after.visibility()).isEqualTo("COUPLE_ONLY");
        verify(repository).changeReview(before, "KEEP", null, NOW);
        verify(repository).auditReview(before, after, ACCOUNT, NOW);
    }
    @Test void currentSameStateIsExactNoOpIncludingDeletionDeadline() {
        for (String status : List.of("PENDING", "KEEP", "ARCHIVED", "DELETE")) {
            var before = memory(status, 3, "DELETE".equals(status) ? NOW.plusSeconds(60) : null);
            when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(before));
            assertThat(service.review(MEMORY, Map.of("reviewStatus", status), "\"3\"")).isSameAs(before);
        }
        verify(repository, never()).changeReview(any(), anyString(), any(), any());
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void staleEvenMatchingStateRequiresDeliberateReload() {
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(memory("KEEP", 2, null)));
        rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "KEEP"), "\"1\""), 412, "REVIEW_CONFLICT");
        verify(repository, never()).changeReview(any(), anyString(), any(), any());
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void firstDeleteGetsThirtyDaysAndRestoreClearsDeadlineForEveryPrivateDestination() {
        var deleted = service.review(MEMORY, Map.of("reviewStatus", "DELETE"), "\"1\"");
        assertThat(deleted.deleteAfter()).isEqualTo(NOW.plus(Duration.ofDays(30)));
        for (String status : List.of("PENDING", "KEEP", "ARCHIVED")) {
            when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(deleted));
            var restored = service.review(MEMORY, Map.of("reviewStatus", status), "\"2\"");
            assertThat(restored.deleteAfter()).isNull();
            assertThat(restored.reviewStatus()).isEqualTo(status);
            assertThat(restored.revision()).isEqualTo(3);
        }
    }
    @Test void expiryCheckedAfterLockAndExactDeadlineIsUnavailable() {
        for (Instant deadline : List.of(NOW, NOW.minusSeconds(1))) {
            when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(memory("DELETE", 2, deadline)));
            rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "PENDING"), "\"2\""), 404, "NOT_FOUND");
        }
        verify(repository, never()).changeReview(any(), anyString(), any(), any());
    }
    @Test void missingOrPurgedRepositorySelectionIsUnavailable() {
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.empty());
        rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "KEEP"), "\"1\""), 404, "NOT_FOUND");
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void accountRevocationAndRevealGatePrecedeParsingAndPrivateQueries() {
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account(false, 1)));
        rejects(() -> service.review(MEMORY, null, null), 401, "AUTH_REQUIRED");
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account(true, 2)));
        rejects(() -> service.review(MEMORY, null, null), 401, "AUTH_REQUIRED");
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account(true, 1)));
        service = service(false);
        rejects(() -> service.review(MEMORY, null, null), 403, "ARCHIVE_UNAVAILABLE");
        verifyNoInteractions(repository);
    }
    @Test void badInputsNeverLockOrChangeAnything() {
        rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "KEEP"), null), 428, "PRECONDITION_REQUIRED");
        rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "PUBLIC"), "\"1\""), 400, "VALIDATION_FAILED");
        verifyNoInteractions(repository);
    }

    @Test void queuedRequestRechecksRevocationAfterAcquiringTheMemoryLock() {
        when(repository.lockDetail(MEMORY)).thenAnswer(call -> {
            when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account(false, 1)));
            return Optional.of(memory("PENDING", 1, null));
        });
        rejects(() -> service.review(MEMORY, Map.of("reviewStatus", "KEEP"), "\"1\""), 401, "AUTH_REQUIRED");
        verify(accounts, times(2)).findById(ACCOUNT);
        verify(repository, never()).changeReview(any(), anyString(), any(), any());
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void futureUpdatedTimestampCannotExtendTheDeletionRetentionInterval() {
        var ordinary = memory("PENDING", 1, null);
        var future = new MemoryDetail(ordinary.memoryId(), ordinary.contributionId(), ordinary.guestName(),
                ordinary.memoryType(), ordinary.textContent(), ordinary.caption(), ordinary.reviewStatus(),
                ordinary.visibility(), ordinary.revision(), ordinary.createdAt(), NOW.plus(Duration.ofDays(2)), null, null);
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(future));
        var deleted = service.review(MEMORY, Map.of("reviewStatus", "DELETE"), "\"1\"");
        assertThat(deleted.deleteAfter()).isEqualTo(NOW.plus(Duration.ofDays(30)));
        assertThat(deleted.updatedAt()).isEqualTo(future.updatedAt());
    }

    private ReviewService service(boolean revealed) {
        return new ReviewService(new ArchiveAuthorization(accounts,
                new ArchiveAccessPolicy("local", revealed, false, "", "", new MockEnvironment())), repository, clock);
    }
    private static ArchiveAccount account(boolean enabled, long version) {
        return new ArchiveAccount(ACCOUNT, "synthetic-review", "Synthetic Couple", "{noop}unused", "COUPLE", enabled, version);
    }
    private static MemoryDetail memory(String status, int revision, Instant deadline) {
        return new MemoryDetail(MEMORY, UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), null, "TEXT",
                "Private synthetic note", null, status, "COUPLE_ONLY", revision, NOW.minusSeconds(10), NOW.minusSeconds(1), deadline, null);
    }
    private static MemoryDetail changed(MemoryDetail before, String status, Instant deadline, Instant time) {
        return new MemoryDetail(before.memoryId(), before.contributionId(), before.guestName(), before.memoryType(),
                before.textContent(), before.caption(), status, before.visibility(), before.revision()+1,
                before.createdAt(), time, deadline, before.media());
    }
    private static void rejects(Runnable operation, int status, String code) {
        assertThatThrownBy(operation::run).isInstanceOf(ApiException.class).satisfies(failure -> {
            assertThat(((ApiException) failure).status()).isEqualTo(status);
            assertThat(((ApiException) failure).code()).isEqualTo(code);
        });
    }
}
