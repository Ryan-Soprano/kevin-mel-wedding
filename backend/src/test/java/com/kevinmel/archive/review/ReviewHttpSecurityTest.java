package com.kevinmel.archive.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.kevinmel.archive.security.*;
import com.kevinmel.archive.album.AlbumMemberships;
import com.kevinmel.archive.timeline.TimelineMemberships;
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
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(controllers = ReviewController.class, properties = {"archive.environment=local", "archive.revealed=true"})
@Import({SecurityConfiguration.class, ArchiveAuthenticationConfiguration.class, ArchiveUserDetailsService.class,
        ArchiveAccessPolicy.class, SecurityErrorWriter.class, ArchiveAuthorization.class, ReviewService.class})
class ReviewHttpSecurityTest {
    private static final UUID ACCOUNT = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static final UUID MEMORY = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static final Instant NOW = Instant.parse("2026-10-09T12:34:56.123456Z");
    @Autowired MockMvc mvc;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean InboxRepository repository;
    @MockitoBean AlbumMemberships albums;
    @MockitoBean TimelineMemberships timeline;
    @MockitoBean Clock clock;
    private ArchiveAccount couple;

    @BeforeEach void fixtures() {
        couple = account("COUPLE", true, 1);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(couple));
        when(clock.instant()).thenReturn(NOW);
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(detail("PENDING", 1)));
        when(repository.changeReview(any(), anyString(), any(), any())).thenReturn(detail("KEEP", 2));
    }
    @Test void successfulPatchIsPrivateAndReturnsExactRevisionETag() throws Exception {
        var result = mvc.perform(request(session(couple)).with(csrf().asHeader()))
                .andExpect(status().isOk()).andExpect(header().string("ETag", "\"2\""))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.reviewStatus").value("KEEP"))
                .andExpect(jsonPath("$.revision").value(2)).andExpect(jsonPath("$.visibility").value("COUPLE_ONLY")).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("objectKey", "https://", "idempotencyKey", "csrfToken", "password");
        verify(repository).auditReview(any(), any(), eq(ACCOUNT), eq(NOW));
        verify(accounts, atLeast(2)).findById(ACCOUNT);
    }
    @Test void currentSameStateHasUnchangedETagWithoutWriteOrAudit() throws Exception {
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(detail("KEEP", 1)));
        mvc.perform(request(session(couple)).with(csrf().asHeader()))
                .andExpect(status().isOk()).andExpect(header().string("ETag", "\"1\"")).andExpect(jsonPath("$.revision").value(1));
        verify(repository, never()).changeReview(any(), anyString(), any(), any());
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void staleEvenSameTargetReturns412WithoutPrivatePayload() throws Exception {
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.of(detail("KEEP", 2)));
        var result = mvc.perform(request(session(couple)).with(csrf().asHeader()))
                .andExpect(status().isPreconditionFailed()).andExpect(jsonPath("$.error.code").value("REVIEW_CONFLICT")).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain(MEMORY.toString(), "synthetic private content");
        verify(repository, never()).auditReview(any(), any(), any(), any());
    }
    @Test void csrfIsRequiredIndependentlyOfCoupleRole() throws Exception {
        mvc.perform(request(session(couple))).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("CSRF_INVALID"));
        verifyNoInteractions(repository);
    }
    @Test void crossOriginCannotReviewWithOtherwiseValidSessionAndCsrf() throws Exception {
        mvc.perform(request(session(couple)).header("Origin", "https://other.invalid").with(csrf().asHeader()))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ORIGIN_INVALID"));
        verifyNoInteractions(repository);
    }
    @Test void missingOrMalformedContractRevisionAndBodyCannotWrite() throws Exception {
        mvc.perform(request(session(couple)).with(r -> { r.removeHeader("X-Api-Contract"); return r; }).with(csrf().asHeader()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("UNSUPPORTED_CONTRACT"));
        mvc.perform(request(session(couple)).with(r -> { r.removeHeader("If-Match"); return r; }).with(csrf().asHeader()))
                .andExpect(status().isPreconditionRequired()).andExpect(jsonPath("$.error.code").value("PRECONDITION_REQUIRED"));
        mvc.perform(request(session(couple)).with(r -> { r.removeHeader("If-Match"); r.addHeader("If-Match", "*"); return r; }).with(csrf().asHeader()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mvc.perform(request(session(couple)).content("{\"reviewStatus\":\"KEEP\",\"visibility\":\"PUBLIC\"}").with(csrf().asHeader()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        verifyNoInteractions(repository);
    }
    @Test void anonymousOperatorDeveloperAndRevokedAccountsCannotMutate() throws Exception {
        mvc.perform(request(null).with(csrf().asHeader())).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var current = account(role, true, 1);
            when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(current));
            mvc.perform(request(session(current)).with(csrf().asHeader())).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
        }
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account("COUPLE", false, 1)));
        mvc.perform(request(session(couple)).with(csrf().asHeader())).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
        verifyNoInteractions(repository);
    }
    @Test void unavailableSelectionIs404AndDatabaseFailureIsSanitized503() throws Exception {
        when(repository.lockDetail(MEMORY)).thenReturn(Optional.empty());
        mvc.perform(request(session(couple)).with(csrf().asHeader())).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
        when(repository.lockDetail(MEMORY)).thenThrow(new DataAccessResourceFailureException("private SQL synthetic secret"));
        var result = mvc.perform(request(session(couple)).with(csrf().asHeader())).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE")).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private SQL", "synthetic secret", MEMORY.toString());
    }
    @Nested @TestPropertySource(properties = "archive.revealed=false")
    class BeforeReveal {
        @Test void validCoupleAndCsrfStillCannotReviewBeforeReveal() throws Exception {
            mvc.perform(request(session(couple)).with(csrf().asHeader())).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
            verifyNoInteractions(repository);
        }
    }
    private static MockHttpServletRequestBuilder request(MockHttpSession session) {
        var request = patch("/api/memories/" + MEMORY + "/review").header("X-Api-Contract", "1").header("If-Match", "\"1\"")
                .contentType(MediaType.APPLICATION_JSON).content("{\"reviewStatus\":\"KEEP\"}");
        return session == null ? request : request.session(session);
    }
    private static ArchiveAccount account(String role, boolean enabled, long version) {
        return new ArchiveAccount(ACCOUNT, "synthetic-review", "Synthetic Couple", "{noop}unused", role, enabled, version);
    }
    private static MockHttpSession session(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }
    private static MemoryDetail detail(String status, int revision) {
        return new MemoryDetail(MEMORY, UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), null, "TEXT",
                "synthetic private content", null, status, "COUPLE_ONLY", revision, NOW.minusSeconds(5), NOW, null, null);
    }
}
