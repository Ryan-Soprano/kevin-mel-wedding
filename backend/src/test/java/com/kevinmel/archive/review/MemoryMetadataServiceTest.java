package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import com.kevinmel.archive.security.ArchiveAuthorization;
import com.kevinmel.archive.web.ApiException;

class MemoryMetadataServiceTest {
    @Test void authorityRevokedDuringMetadataWriteSuppressesThePrivateResult() {
        var authorization = mock(ArchiveAuthorization.class);
        var repository = mock(InboxRepository.class);
        var allowed = new AtomicBoolean(true);
        doAnswer(call -> {
            if (!allowed.get()) throw new ApiException(401, "AUTH_REQUIRED", "Synthetic revoked account.");
            return null;
        }).when(authorization).requireCoupleAccess();
        Instant now = Instant.parse("2026-10-11T12:00:00Z");
        UUID id = UUID.randomUUID();
        var memory = new MemoryDetail(id, UUID.randomUUID(), null, "TEXT", "Private synthetic note",
                null, "KEEP", "COUPLE_ONLY", 1, now.minusSeconds(10), now.minusSeconds(1), null, null);
        when(repository.lockDetail(id)).thenReturn(Optional.of(memory));
        when(repository.changeMetadata(eq(memory), any(), eq(now))).thenAnswer(call -> {
            allowed.set(false);
            return memory;
        });
        var service = new MemoryMetadataService(authorization, repository, Clock.fixed(now, ZoneOffset.UTC));
        var body = Map.<String, Object>of("title", "New title", "description", "Private context",
                "memoryDate", "2024", "datePrecision", "YEAR");

        assertThatThrownBy(() -> service.edit(id, body, "\"1\""))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(401);
                    assertThat(failure.code()).isEqualTo("AUTH_REQUIRED");
                });
        verify(repository).changeMetadata(eq(memory), any(), eq(now));
    }
}
