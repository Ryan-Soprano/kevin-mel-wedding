package com.kevinmel.archive.sharing;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import java.util.*;

import com.kevinmel.archive.media.*;
import com.kevinmel.archive.review.*;
import com.kevinmel.archive.security.*;
import com.kevinmel.archive.web.ApiException;

import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class SharingServiceTest {
    private static final UUID ID = UUID.randomUUID(),
            ASSET = UUID.randomUUID(),
            ACCOUNT = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");
    private final SharingRepository shares = mock(SharingRepository.class);
    private final InboxRepository inbox = mock(InboxRepository.class);
    private final PlaybackRepository media = mock(PlaybackRepository.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final ArchiveAuthorization authorization = mock(ArchiveAuthorization.class);
    private final SharingService service = new SharingService(
            shares,
            inbox,
            media,
            storage,
            authorization,
            Clock.fixed(NOW, ZoneOffset.UTC));

    @AfterEach
    void clearIdentity() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void secretLinkReadUsesOnlyCanonicalHashedCapabilityAndNoCoupleAuthority() {
        String token = "A".repeat(43);
        var safe = SharedMemory.from(memory("TEXT", "FRIENDS_FAMILY", 2));
        when(shares.accessible(ID, ShareTokens.digest(token)))
                .thenReturn(Optional.of(safe));
        assertThat(service.detail(ID, token))
                .isSameAs(safe);
        verify(shares).accessible(ID, ShareTokens.digest(token));
        verifyNoInteractions(authorization, inbox, media, storage);
        assertThat(ShareTokens.digest("B".repeat(43)))
                .isNull();
        assertThat(ShareTokens.digest("x".repeat(100_000)))
                .isNull();
    }

    @Test
    void unavailableOrRevokedTokenNeverTouchesPrivateMediaOrStorage() {
        when(shares.accessibleDetail(ID, null, true))
                .thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.playback(ID, null))
                .isInstanceOf(ApiException.class)
                .satisfies(failure -> assertThat(((ApiException) failure).status())
                        .isEqualTo(404));
        verifyNoInteractions(inbox, media, storage, authorization);
    }

    @Test
    void verifiedSharedMediaGetsExactlyFiveMinutesAndUnsafeOriginalsCannotBeSigned() {
        when(shares.accessibleDetail(ID, null, true))
                .thenReturn(Optional.of(memory("PHOTO", "PUBLIC", 3)));
        var original = new PlaybackRepository.PlayableMedia(
                ASSET,
                "originals/" + ASSET,
                "image/png",
                100);
        when(media.findPlayable(ID))
                .thenReturn(Optional.of(original));
        service.playback(ID, null);
        verify(storage).authorizeRead(
                "originals/" + ASSET,
                "image/png",
                100,
                NOW.plusSeconds(300));
        clearInvocations(storage);
        for (var invalid : List.of(
                new PlaybackRepository.PlayableMedia(
                        ASSET,
                        "staging/" + ASSET,
                        "image/png",
                        100),
                new PlaybackRepository.PlayableMedia(
                        ASSET,
                        "originals/" + ASSET,
                        "image/svg+xml",
                        100),
                new PlaybackRepository.PlayableMedia(
                        ASSET,
                        "originals/" + ASSET,
                        "image/png",
                        10_000_001))) {
            when(media.findPlayable(ID))
                    .thenReturn(Optional.of(invalid));
            assertThatThrownBy(() -> service.playback(ID, null))
                    .isInstanceOf(ApiException.class);
        }
        verifyNoInteractions(storage);
    }

    @Test
    void linkRotationRequiresCurrentRevisionAndCurrentCoupleAndAuditsItsRevision() {
        var account = new ArchiveAccount(
                ACCOUNT,
                "test-couple",
                "Test Couple",
                "{noop}unused",
                "COUPLE",
                true,
                1);
        var principal = new ArchivePrincipal(account);
        SecurityContextHolder.getContext()
                .setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                        principal,
                        null,
                        principal.getAuthorities()));
        var before = memory("TEXT", "FRIENDS_FAMILY", 2);
        var after = memory("TEXT", "FRIENDS_FAMILY", 3);
        when(inbox.lockDetail(ID))
                .thenReturn(Optional.of(before));
        when(inbox.changeReview(before, "KEEP", null, NOW))
                .thenReturn(after);
        var link = service.issueLink(ID, "\"2\"");
        assertThat(link.revision())
                .isEqualTo(3);
        String token = link.url().substring(link.url().indexOf("#token=") + 7);
        assertThat(token)
                .hasSize(43);
        var hash = ArgumentCaptor.forClass(String.class);
        verify(shares).issue(eq(ID), hash.capture(), eq(NOW));
        assertThat(hash.getValue())
                .hasSize(64)
                .isEqualTo(ShareTokens.digest(token))
                .isNotEqualTo(token);
        verify(inbox).auditReview(before, after, ACCOUNT, NOW);
        verify(authorization, times(3)).requireCoupleAccess();
        clearInvocations(shares);
        assertThatThrownBy(() -> service.issueLink(ID, "\"1\""))
                .isInstanceOf(ApiException.class)
                .satisfies(failure -> assertThat(((ApiException) failure).status())
                        .isEqualTo(412));
        verifyNoInteractions(shares);
    }

    @Test
    void linksCannotBeIssuedForPrivatePublicOrDeletedMemories() {
        for (String visibility : List.of("COUPLE_ONLY", "PUBLIC")) {
            when(inbox.lockDetail(ID))
                    .thenReturn(Optional.of(memory("TEXT", visibility, 2)));
            assertThatThrownBy(() -> service.issueLink(ID, "\"2\""))
                    .isInstanceOf(ApiException.class);
        }
        verifyNoInteractions(shares);
        verify(inbox, never()).changeReview(any(), anyString(), any(), any());
    }

    private static MemoryDetail memory(
            String type,
            String visibility,
            int revision) {
        var asset = "PHOTO".equals(type)
                ? new MemoryDetail.PhotoMedia(
                        "Private filename.png",
                        "image/png",
                        100,
                        "a".repeat(64),
                        null,
                        "UPLOADED")
                : null;
        return new MemoryDetail(
                ID,
                UUID.randomUUID(),
                "Private Guest Name",
                type,
                "TEXT".equals(type) ? "Synthetic note" : null,
                "PHOTO".equals(type) ? "Synthetic caption" : null,
                "KEEP",
                visibility,
                revision,
                NOW.minusSeconds(60),
                NOW,
                null,
                asset);
    }
}
