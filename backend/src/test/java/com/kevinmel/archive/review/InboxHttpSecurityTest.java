package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.kevinmel.archive.security.*;
import com.kevinmel.archive.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = InboxController.class, properties = {
        "archive.environment=local", "archive.revealed=true"})
@Import({SecurityConfiguration.class, ArchiveAuthenticationConfiguration.class, ArchiveUserDetailsService.class,
        ArchiveAccessPolicy.class, SecurityErrorWriter.class, ArchiveAuthorization.class, InboxService.class})
class InboxHttpSecurityTest {
    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static final UUID MEMORY = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static final Instant TIME = Instant.parse("2026-10-09T12:34:56.123456Z");
    private static final String KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    @Autowired MockMvc mvc;
    @Autowired InboxService service;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean InboxRepository repository;
    private ArchiveAccount couple;

    @BeforeEach void fixtures() {
        couple = account("COUPLE", true, 1);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(couple));
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(), 0));
        when(repository.detail(any())).thenReturn(Optional.empty());
    }

    @Test void anonymousAndGuestCapabilitiesNeverReturnPrivateContent() throws Exception {
        for (String path : List.of("/api/memories", "/api/memories/" + MEMORY)) {
            var result = mvc.perform(get(path).header("X-Api-Contract", "1").header("Idempotency-Key", KEY))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"))
                    .andExpect(header().string("Cache-Control", "no-store")).andReturn();
            assertThat(result.getResponse().getContentAsString()).doesNotContain(MEMORY.toString(), KEY, "private note");
        }
        verifyNoInteractions(repository);
    }

    @Test void authorizedListUsesRealServiceAndReturnsDecoderCompatiblePrivateText() throws Exception {
        var detail = text();
        when(repository.listPage(any())).thenReturn(new InboxRepository.InboxRows(List.of(detail), 1));
        var result = mvc.perform(get("/api/memories").session(session(couple)).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.totalCount").value(1))
                .andExpect(jsonPath("$.items[0].memoryId").value(MEMORY.toString()))
                .andExpect(jsonPath("$.items[0].guestName").value(nullValue()))
                .andExpect(jsonPath("$.items[0].textContent").value("<script>synthetic markup</script>"))
                .andExpect(jsonPath("$.items[0].revision").value(7))
                .andExpect(jsonPath("$.items[0].deleteAfter").value(nullValue()))
                .andExpect(jsonPath("$.items[0].media").value(nullValue())).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain(
                "objectKey", "uploadUrl", "idempotencyKey", "csrfToken", "passwordHash");
        verify(repository).listPage(new InboxQuery("PENDING", 20, null));
        // Filter and service both reload authority; the service does not trust HTTP alone.
        verify(accounts, atLeast(2)).findById(ACCOUNT);
    }

    @Test void authorizedPhotoDetailHasRevisionETagAndMetadataButNoRetrievalPermission() throws Exception {
        var detail = new MemoryDetail(MEMORY, UUID.randomUUID(), "Synthetic Guest", "PHOTO", null,
                "Synthetic caption", "PENDING", "COUPLE_ONLY", 3, TIME, TIME, null,
                new MemoryDetail.PhotoMedia("original.png", "image/png", 100, "a".repeat(64), null, "UPLOADED"));
        when(repository.detail(MEMORY)).thenReturn(Optional.of(detail));
        var result = mvc.perform(get("/api/memories/" + MEMORY).session(session(couple)).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(header().string("ETag", "\"3\""))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.revision").value(3))
                .andExpect(jsonPath("$.media.originalFilename").value("original.png"))
                .andExpect(jsonPath("$.media.durationSeconds").value(nullValue())).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("objectKey", "originals/", "uploadUrl", "https://", KEY);
    }

    @Test void contractAndQueryValidationDoNotQueryPrivateRows() throws Exception {
        var session = session(couple);
        mvc.perform(get("/api/memories").session(session))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("UNSUPPORTED_CONTRACT"));
        for (String parameter : List.of("PUBLIC", "pending")) {
            mvc.perform(get("/api/memories").session(session).header("X-Api-Contract", "1").param("reviewStatus", parameter))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mvc.perform(get("/api/memories").session(session).header("X-Api-Contract", "1").param("limit", "101"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mvc.perform(get("/api/memories").session(session).header("X-Api-Contract", "1").param("cursor", "bad-cursor"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        verifyNoInteractions(repository);
    }

    @Test void missingAndMalformedMemoryIDsAreSafe() throws Exception {
        for (String id : List.of(MEMORY.toString(), "not-an-id")) {
            mvc.perform(get("/api/memories/" + id).session(session(couple)).header("X-Api-Contract", "1"))
                    .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
    }

    @Test void revocationInvalidatesTheSessionBeforeEitherPrivateRoute() throws Exception {
        for (Optional<ArchiveAccount> current : List.of(Optional.<ArchiveAccount>empty(),
                Optional.of(account("COUPLE", false, 1)), Optional.of(account("COUPLE", true, 2)),
                Optional.of(account("OPERATOR", true, 1)))) {
            when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(couple));
            var session = session(couple);
            when(accounts.findById(ACCOUNT)).thenReturn(current);
            mvc.perform(get("/api/memories/" + MEMORY).session(session).header("X-Api-Contract", "1"))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
            assertThat(session.isInvalid()).isTrue();
        }
        verifyNoInteractions(repository);
    }

    @Test void operatorDeveloperAndGenericCoupleAuthorityDoNotGrantArchiveAccess() throws Exception {
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var account = account(role, true, 1);
            when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account));
            mvc.perform(get("/api/memories").session(session(account)).header("X-Api-Contract", "1"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
        }
        var generic = User.withUsername("synthetic").password("unused").roles("COUPLE").build();
        var identity = UsernamePasswordAuthenticationToken.authenticated(generic, null, generic.getAuthorities());
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(identity);
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        mvc.perform(get("/api/memories").session(session).header("X-Api-Contract", "1"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
        verifyNoInteractions(repository);
    }

    @Test void databaseOutageNeverSerializesPrivateDiagnostics() throws Exception {
        when(repository.listPage(any())).thenThrow(new DataAccessResourceFailureException("private SQL original-key synthetic-password"));
        var result = mvc.perform(get("/api/memories").session(session(couple)).header("X-Api-Contract", "1"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private SQL", "original-key", "synthetic-password");
    }

    @Nested
    @TestPropertySource(properties = "archive.revealed=false")
    class BeforeReveal {
        @Test void listAndDetailRemainUnavailableEvenForExistingCoupleSession() throws Exception {
            for (String path : List.of("/api/memories", "/api/memories/" + MEMORY)) {
                mvc.perform(get(path).session(session(couple)).header("X-Api-Contract", "1"))
                        .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
            }
            verifyNoInteractions(repository);
        }
    }

    private static ArchiveAccount account(String role, boolean enabled, long version) {
        return new ArchiveAccount(ACCOUNT, "synthetic-couple", "Synthetic Couple", "{noop}unused-fixture", role, enabled, version);
    }
    private static MockHttpSession session(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var identity = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        identity.eraseCredentials();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(identity);
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }
    private static MemoryDetail text() {
        return new MemoryDetail(MEMORY, UUID.randomUUID(), null, "TEXT", "<script>synthetic markup</script>", null,
                "PENDING", "COUPLE_ONLY", 7, TIME, TIME, null, null);
    }
}
