package com.kevinmel.archive.sharing;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Instant;
import java.util.*;
import com.kevinmel.archive.security.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(controllers = SharingController.class, properties = {"archive.environment=local", "archive.revealed=true"})
@Import({SecurityConfiguration.class, ArchiveAuthenticationConfiguration.class, ArchiveUserDetailsService.class,
        ArchiveAccessPolicy.class, SecurityErrorWriter.class})
class SharingHttpSecurityTest {
    private static final UUID ID = UUID.randomUUID(), ACCOUNT = UUID.randomUUID();
    @Autowired MockMvc mvc;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean SharingService sharing;
    private ArchiveAccount couple;
    @BeforeEach void currentCouple() {
        couple = account("COUPLE", true);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(couple));
    }
    @Test void publicReadersNeedNoSessionAndDoNotReachTheAccountStore() throws Exception {
        var memory = new SharedMemory(ID, "TEXT", "Synthetic shared note", null, null, null, null, "UNKNOWN", Instant.EPOCH, null);
        when(sharing.publicMemories(null, null)).thenReturn(new SharingService.SharedPage(List.of(memory), null));
        mvc.perform(get("/api/shared-memories")).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(jsonPath("$.items[0].textContent").value("Synthetic shared note"))
                .andExpect(jsonPath("$.items[0].guestName").doesNotExist())
                .andExpect(jsonPath("$.items[0].reviewStatus").doesNotExist());
        verifyNoInteractions(accounts);
    }
    @Test void issuingRequiresCsrfSameOriginAndBodylessRequest() throws Exception {
        mvc.perform(issue(session(couple))).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("CSRF_INVALID"));
        mvc.perform(issue(session(couple)).with(csrf().asHeader()).header("Origin", "https://other.invalid"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ORIGIN_INVALID"));
        mvc.perform(issue(session(couple)).with(csrf().asHeader()).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        verifyNoInteractions(sharing);
    }
    @Test void anonymousOperatorAndRevokedAccountsCannotIssueLinks() throws Exception {
        mvc.perform(issue(null).with(csrf().asHeader())).andExpect(status().isUnauthorized());
        var operator = account("OPERATOR", true);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(operator));
        mvc.perform(issue(session(operator)).with(csrf().asHeader())).andExpect(status().isForbidden());
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account("COUPLE", false)));
        mvc.perform(issue(session(couple)).with(csrf().asHeader())).andExpect(status().isUnauthorized());
        verifyNoInteractions(sharing);
    }
    @Test void successfulLinkReturnsItsNewRevisionAndSafeResponseHeaders() throws Exception {
        when(sharing.issueLink(ID, "\"2\"")).thenReturn(new SharingService.ShareLink(ID, 3, "/shared/" + ID + "#token=" + "A".repeat(43)));
        mvc.perform(issue(session(couple)).with(csrf().asHeader())).andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"3\""))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(jsonPath("$.revision").value(3));
    }
    private static MockHttpServletRequestBuilder issue(MockHttpSession session) {
        var request = post("/api/memories/" + ID + "/share-link").header("X-Api-Contract", "1").header("If-Match", "\"2\"");
        return session == null ? request : request.session(session);
    }
    private static ArchiveAccount account(String role, boolean enabled) {
        return new ArchiveAccount(ACCOUNT, "test-sharing", "Test Couple", "{noop}unused", role, enabled, 1);
    }
    private static MockHttpSession session(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }
}
