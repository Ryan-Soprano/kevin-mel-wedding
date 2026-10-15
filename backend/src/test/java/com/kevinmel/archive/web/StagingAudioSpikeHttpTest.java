package com.kevinmel.archive.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import com.kevinmel.archive.security.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(controllers = StagingAudioSpikeController.class, properties = {
        "MEMORY_ARCHIVE_STAGING_USERNAME=synthetic-spike",
        "MEMORY_ARCHIVE_STAGING_PASSWORD=synthetic-spike-password-0123456789",
        "MEMORY_ARCHIVE_STAGING_ORIGIN=https://spike.test",
        "logging.level.org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration=ERROR"})
@ActiveProfiles("staging")
@Import({SecurityConfiguration.class, SecurityErrorWriter.class, StagingAccessConfiguration.class})
class StagingAudioSpikeHttpTest {
    @Autowired MockMvc mvc;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean ArchiveAccessPolicy policy;
    static MockHttpServletRequestBuilder admitted(String path) {
        String credentials = Base64.getEncoder().encodeToString(
                "synthetic-spike:synthetic-spike-password-0123456789".getBytes(StandardCharsets.UTF_8));
        return get(path).secure(true).header("Authorization", "Basic " + credentials).with(request -> {
            request.setScheme("https"); request.setServerName("spike.test"); request.setServerPort(443); return request;
        });
    }
    @Test void stagingAdmissionIsStillMandatoryAndAllowsOnlyExactGetResources() throws Exception {
        mvc.perform(admitted("/staging/audio").with(request -> { request.removeHeader("Authorization"); return request; }))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("STAGING_AUTH_REQUIRED"));
        mvc.perform(admitted("/staging/audio")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("Synthetic staging route fixture")))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Security-Policy", org.hamcrest.Matchers.containsString("connect-src 'none'")))
                .andExpect(header().string("Permissions-Policy", "microphone=(self), camera=(), geolocation=()"));
        for (String path : new String[]{"/staging/audio/missing.js", "/staging-audio/index.html", "/spikes/audio/index.html"}) {
            mvc.perform(admitted(path)).andExpect(status().isUnauthorized());
        }
        mvc.perform(admitted("/staging/audio").with(request -> { request.setMethod("POST"); return request; }))
                .andExpect(status().isForbidden());
    }
}

@WebMvcTest(controllers = StagingAudioSpikeController.class, properties = {
        "logging.level.org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration=ERROR"})
@ActiveProfiles("local")
@Import({SecurityConfiguration.class, SecurityErrorWriter.class})
class LocalAudioSpikeExclusionTest {
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext context;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean ArchiveAccessPolicy policy;
    @Test void nonStagingProfileCannotServeTheRecorderEvenWhenThePrivateResourceExists() throws Exception {
        assertThat(context.getBeansOfType(StagingAudioSpikeController.class)).isEmpty();
        for (String path : new String[]{"/staging/audio", "/staging/audio/recorder.js", "/staging/audio/probe-model.js", "/staging/audio/style.css"}) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
        }
    }
}

@WebMvcTest(controllers = StagingAudioSpikeController.class, properties = {
        "MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=false",
        "MEMORY_ARCHIVE_STAGING_ORIGIN=https://spike.test",
        "logging.level.org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration=ERROR"})
@ActiveProfiles("staging")
@Import({SecurityConfiguration.class, SecurityErrorWriter.class, StagingAccessConfiguration.class})
class PublicStagingAudioSpikeExclusionTest {
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext context;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean ArchiveAccessPolicy policy;

    private static MockHttpServletRequestBuilder publicRequest(String path) {
        return get(path).secure(true).with(request -> {
            request.setScheme("https");
            request.setServerName("spike.test");
            request.setServerPort(443);
            return request;
        });
    }

    @Test
    void disablingBrowserAdmissionRemovesEveryDisposableProbeRoute() throws Exception {
        assertThat(context.getBeansOfType(StagingAudioSpikeController.class)).isEmpty();
        for (String path : new String[]{
                "/staging/audio",
                "/staging/audio/",
                "/staging/audio/recorder.js",
                "/staging/audio/probe-model.js",
                "/staging/audio/style.css"}) {
            var response = mvc.perform(publicRequest(path))
                    .andExpect(status().isNotFound())
                    .andExpect(header().doesNotExist("WWW-Authenticate"))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andReturn().getResponse();
            assertThat(response.getContentType()).isNotEqualTo("text/html");
            assertThat(response.getContentAsString()).doesNotContain(
                    "<html", "Synthetic staging route fixture", "MediaRecorder", "default-src");
        }
    }

    @Test
    void publicStagingStillDeniesAnonymousPrivateArchiveRoutesWithoutABrowserChallenge() throws Exception {
        for (String path : new String[]{
                "/api/memories",
                "/api/memories/11111111-1111-4111-8111-111111111111/playback",
                "/api/albums",
                "/api/timeline",
                "/api/library",
                "/api/tags",
                "/api/exports"}) {
            mvc.perform(publicRequest(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"))
                    .andExpect(header().doesNotExist("WWW-Authenticate"))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
    }
}
