package com.kevinmel.archive.portable;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Actual security filter chain; valid non-couple and unrevealed sessions never reach export work. */
@WebMvcTest(controllers=ExportController.class,properties={"archive.environment=local","archive.revealed=true"})
@Import({SecurityConfiguration.class,ArchiveAuthenticationConfiguration.class,ArchiveUserDetailsService.class,ArchiveAccessPolicy.class,SecurityErrorWriter.class})
class ExportHttpSecurityTest {
    private static final UUID ACCOUNT=UUID.randomUUID(),EXPORT=UUID.randomUUID();
    @Autowired MockMvc mvc;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean ExportJobService jobs;
    @Test void enabledOperatorAndDeveloperCannotReadDiscoverPrepareOrDownload()throws Exception {
        for(String role:List.of("OPERATOR","DEVELOPER")) {
            var account=account(role,true,1);when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account));
            for(String path:List.of("/api/exports/current","/api/exports/"+EXPORT,"/api/exports/"+EXPORT+"/parts/1/download?generation="+UUID.randomUUID(),"/api/exports/"+EXPORT+"/"))
                mvc.perform(get(path).session(session(account)).header("X-Api-Contract","1")).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
            mvc.perform(post("/api/exports/"+EXPORT+"/parts/1/prepare").session(session(account)).with(csrf().asHeader()).header("X-Api-Contract","1").header("Idempotency-Key",UUID.randomUUID())).andExpect(status().isForbidden());
        }
        verifyNoInteractions(jobs);
    }
    @Test void revokedCurrentAccountCannotDeliverAnOtherwiseValidCoupleSession()throws Exception {
        var account=account("COUPLE",true,1);when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account("COUPLE",false,1)));
        mvc.perform(get("/api/exports/current").session(session(account)).header("X-Api-Contract","1")).andExpect(status().isUnauthorized());
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account("COUPLE",true,2)));
        mvc.perform(get("/api/exports/"+EXPORT+"/parts/1/download?generation="+UUID.randomUUID()).session(session(account)).header("X-Api-Contract","1")).andExpect(status().isUnauthorized());
        verifyNoInteractions(jobs);
    }
    @Nested @TestPropertySource(properties="archive.revealed=false")
    class BeforeReveal {
        @Test void validCoupleCannotCreateReadDiscoverOrDownloadBeforeReveal()throws Exception {
            var account=account("COUPLE",true,1);when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(account));
            for(String path:List.of("/api/exports/current","/api/exports/"+EXPORT,"/api/exports/"+EXPORT+"/parts/1/download?generation="+UUID.randomUUID()))
                mvc.perform(get(path).session(session(account)).header("X-Api-Contract","1")).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ARCHIVE_UNAVAILABLE"));
            mvc.perform(put("/api/exports/"+EXPORT).session(session(account)).with(csrf().asHeader()).header("X-Api-Contract","1").header("If-None-Match","*")).andExpect(status().isForbidden());
            verifyNoInteractions(jobs);
        }
    }
    private static ArchiveAccount account(String role,boolean enabled,long version){return new ArchiveAccount(ACCOUNT,"synthetic-export-security","Synthetic Export","{noop}unused",role,enabled,version);}
    private static MockHttpSession session(ArchiveAccount account){var principal=new ArchivePrincipal(account);var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal,null,principal.getAuthorities()));var session=new MockHttpSession();session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,context);return session;}
}
