package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.net.URI;
import java.util.Base64;

import com.jayway.jsonpath.JsonPath;
import com.kevinmel.archive.health.HealthController;
import com.kevinmel.archive.media.ObjectStorage;
import com.kevinmel.archive.media.PlaybackController;
import com.kevinmel.archive.media.PlaybackRepository;
import com.kevinmel.archive.media.PlaybackService;
import com.kevinmel.archive.web.ApiException;
import jakarta.servlet.ServletRequestEvent;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcBuilderCustomizer;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.CannotCreateTransactionException;
import tools.jackson.databind.ObjectMapper;

@WebMvcTest(controllers = {HealthController.class, SessionController.class, PlaybackController.class}, properties = {
        "archive.environment=local", "archive.revealed=true"})
@Import({SecurityConfiguration.class, ArchiveAuthenticationConfiguration.class,
        ArchiveUserDetailsService.class, SessionService.class, ArchiveAccessPolicy.class,
        LoginThrottle.class, SecurityErrorWriter.class, ArchiveAuthorization.class, PlaybackService.class,
        SessionHttpTest.ServletLifecycle.class})
class SessionHttpTest {
    private static final UUID ACCOUNT_ID = UUID.fromString("a175650a-1459-498e-b87c-2b3ced947e62");
    private static final String USERNAME = "synthetic-couple";
    private static final String PASSWORD = "test-only-password-42";
    private static final String ORIGIN = "http://localhost";
    private static final UUID MEMORY_ID = UUID.fromString("0b43b549-f59e-4918-8e92-dac67234e8aa");
    private static final UUID OTHER_MEMORY_ID = UUID.fromString("04512cee-8a5a-4825-87eb-b08c8cb48e16");
    private static final UUID ASSET_ID = UUID.fromString("f1ffb9bd-22be-4fa1-86d4-5b625ae5c6ca");
    private static final String ORIGINAL_KEY = "originals/" + ASSET_ID;
    private static final Instant NOW = Instant.parse("2026-10-05T12:00:00Z");

    @Autowired MockMvc mvc;
    @Autowired PasswordEncoder encoder;
    @Autowired ObjectMapper mapper;
    @Autowired CsrfTokenRepository csrfTokens;
    @Autowired PlaybackService playbackService;
    @MockitoBean ArchiveAccountRepository accounts;
    @MockitoBean LoginThrottleRepository throttles;
    @MockitoBean PlaybackRepository media;
    @MockitoBean ObjectStorage storage;
    @MockitoBean Clock clock;
    private ArchiveAccount couple;

    @TestConfiguration(proxyBeanMethods = false)
    static class ServletLifecycle {
        @Bean
        MockMvcBuilderCustomizer captureConnectionPeer() {
            var listener = new RequestPeerCapture();
            // MockMvc bypasses container listeners; reproduce initialization before request filters.
            return builder -> builder.defaultRequest(get("/").with(request -> {
                listener.requestInitialized(new ServletRequestEvent(request.getServletContext(), request));
                return request;
            }));
        }
    }

    @BeforeEach
    void fixtures() {
        couple = new ArchiveAccount(ACCOUNT_ID, USERNAME, "Synthetic Couple", encoder.encode(PASSWORD),
                "COUPLE", true, 1);
        when(accounts.findByUsername(anyString())).thenReturn(Optional.empty());
        when(accounts.findById(any(UUID.class))).thenReturn(Optional.empty());
        when(throttles.reserve(anyList())).thenReturn(true);
        when(media.findPlayable(any(UUID.class))).thenReturn(Optional.empty());
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        store(couple);
    }

    @Test
    void archivePrincipalRetainsSpringUserEqualityAcrossMetadataAndCredentialErasure() {
        var principal = new ArchivePrincipal(couple);
        var springUser = new User(USERNAME, "different-fixture-password", false, false, false, false,
                principal.getAuthorities());
        var changedMetadata = new ArchivePrincipal(new ArchiveAccount(UUID.randomUUID(), USERNAME,
                "Changed display name", "another-fixture-password", "COUPLE", false, 2));
        var otherUsername = User.withUsername("synthetic-other-user").password("unused-fixture-password")
                .roles("COUPLE").build();

        assertThat(principal).isEqualTo(springUser).isEqualTo(changedMetadata).isNotEqualTo(otherUsername);
        assertThat(springUser).isEqualTo(principal).isEqualTo(changedMetadata);
        assertThat(changedMetadata).isEqualTo(principal).isEqualTo(springUser);
        assertThat(otherUsername).isNotEqualTo(principal);
        assertThat(principal.hashCode()).isEqualTo(springUser.hashCode()).isEqualTo(changedMetadata.hashCode());
        assertThat(List.of(principal).contains(springUser)).isTrue();
        assertThat(List.of(springUser).contains(principal)).isTrue();
        var users = new HashSet<User>(List.of(principal, springUser, changedMetadata));
        assertThat(users).hasSize(1).contains(principal, springUser, changedMetadata);

        var archiveToken = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        var springToken = UsernamePasswordAuthenticationToken.authenticated(springUser, null, springUser.getAuthorities());
        var changedToken = UsernamePasswordAuthenticationToken.authenticated(changedMetadata, null, changedMetadata.getAuthorities());
        assertThat(archiveToken).isEqualTo(springToken).isEqualTo(changedToken);
        assertThat(springToken).isEqualTo(archiveToken).isEqualTo(changedToken);
        assertThat(changedToken).isEqualTo(archiveToken).isEqualTo(springToken);
        assertThat(archiveToken.hashCode()).isEqualTo(springToken.hashCode()).isEqualTo(changedToken.hashCode());
        assertThat(List.of(archiveToken).contains(springToken)).isTrue();
        assertThat(List.of(springToken).contains(archiveToken)).isTrue();
        var tokens = new HashSet<Authentication>(List.of(archiveToken, springToken, changedToken));
        assertThat(tokens).hasSize(1).contains(archiveToken, springToken, changedToken);
        var restrictedToken = UsernamePasswordAuthenticationToken.authenticated(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_OPERATOR")));
        assertThat(archiveToken).isNotEqualTo(restrictedToken);
        assertThat(restrictedToken).isNotEqualTo(archiveToken);

        int userHash = principal.hashCode(), tokenHash = archiveToken.hashCode();
        archiveToken.eraseCredentials();
        springToken.eraseCredentials();
        changedToken.eraseCredentials();
        assertThat(principal.getPassword()).isNull();
        assertThat(springUser.getPassword()).isNull();
        assertThat(changedMetadata.getPassword()).isNull();
        assertThat(principal).isEqualTo(springUser);
        assertThat(springUser).isEqualTo(principal);
        assertThat(principal.hashCode()).isEqualTo(userHash);
        assertThat(archiveToken.hashCode()).isEqualTo(tokenHash);
        assertThat(users).hasSize(1).contains(principal, springUser, changedMetadata);
        assertThat(tokens).hasSize(1).contains(archiveToken, springToken, changedToken);
    }

    @Test
    void healthIsPublicAndAnonymousSessionIssuesAnUnpredictableToken() throws Exception {
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
        var first = anonymous();
        var second = anonymous();
        assertThat(first.token()).hasSizeGreaterThanOrEqualTo(16)
                .doesNotContain("\r", "\n");
        assertThat(second.token()).isNotEqualTo(first.token());
        assertThat(second.rawToken()).isNotEqualTo(first.rawToken());
        var refreshed = mvc.perform(get("/api/session").session(first.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.user").value(nullValue()))
                .andExpect(jsonPath("$.csrfToken").isString()).andReturn();
        assertThat(state(refreshed).rawToken()).isEqualTo(first.rawToken());
    }

    @Test
    void everySessionMethodRequiresTheSupportedContract() throws Exception {
        for (String version : new String[] {null, "", "2"}) {
            error(mvc.perform(contract(get("/api/session"), version)), 400, "UNSUPPORTED_CONTRACT");
            var anonymous = anonymous();
            error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), ORIGIN)
                    .contentType(MediaType.APPLICATION_JSON).content(loginBody(USERNAME, PASSWORD)), version)),
                    400, "UNSUPPORTED_CONTRACT");
            error(mvc.perform(contract(mutation(delete("/api/session"), anonymous, anonymous.token(), ORIGIN), version)),
                    400, "UNSUPPORTED_CONTRACT");
        }
        verify(accounts, never()).findByUsername(anyString());
    }

    @Test
    void successfulLoginRotatesSessionAndTokenAndPersistsOnlySafeIdentity() throws Exception {
        var anonymous = anonymous();
        String previousId = anonymous.session().getId();
        var result = login(anonymous, USERNAME, PASSWORD).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.user.displayName").value("Synthetic Couple"))
                .andReturn();
        var authenticated = state(result);
        assertThat(authenticated.session().getId()).isNotEqualTo(previousId);
        assertThat(authenticated.token()).isNotEqualTo(anonymous.token());
        assertThat(authenticated.rawToken()).isNotEqualTo(anonymous.rawToken());
        Map<String, Object> document = JsonPath.read(result.getResponse().getContentAsString(), "$");
        Map<String, Object> user = JsonPath.read(result.getResponse().getContentAsString(), "$.user");
        List<String> roles = JsonPath.read(result.getResponse().getContentAsString(), "$.user.roles");
        assertThat(document.keySet()).containsExactlyInAnyOrder("authenticated", "user", "csrfToken");
        assertThat(user.keySet()).containsExactlyInAnyOrder("displayName", "roles");
        assertThat(roles).containsExactly("COUPLE");
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain(USERNAME, PASSWORD, couple.passwordHash(), ACCOUNT_ID.toString(), "credentialsVersion");
        var context = (SecurityContext) authenticated.session()
                .getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        assertThat(context.getAuthentication().getCredentials()).isNull();
        assertThat(context.getAuthentication().getPrincipal()).isInstanceOf(ArchivePrincipal.class);
        assertThat(((ArchivePrincipal) context.getAuthentication().getPrincipal()).getPassword()).isNull();
        var refreshed = mvc.perform(get("/api/session").session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.csrfToken").isString()).andReturn();
        assertThat(state(refreshed).rawToken()).isEqualTo(authenticated.rawToken());
        // No inbox handler exists yet; reaching MVC proves couple authorization passed.
        mvc.perform(get("/api/memories").session(authenticated.session())).andExpect(status().isNotFound());
    }

    @Test
    void canonicalUsernameCanLoginWithoutChangingThePassword() throws Exception {
        login(anonymous(), "  SYNTHETIC-COUPLE  ", PASSWORD)
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
        error(login(anonymous(), USERNAME, " " + PASSWORD), 401, "INVALID_CREDENTIALS");
    }

    @Test
    void wrongUnknownAndDisabledAccountsHaveTheSameGenericFailure() throws Exception {
        var disabled = account("COUPLE", false, 1);
        when(accounts.findByUsername("disabled-fixture")).thenReturn(Optional.of(disabled));
        String message = null;
        for (String[] credentials : new String[][] {
                {USERNAME, "wrong-fixture-password"}, {"unknown-fixture", PASSWORD}, {"disabled-fixture", PASSWORD}}) {
            var anonymous = anonymous();
            var response = error(login(anonymous, credentials[0], credentials[1]), 401, "INVALID_CREDENTIALS");
            String currentMessage = JsonPath.read(response.getResponse().getContentAsString(), "$.error.message");
            if (message == null) message = currentMessage;
            assertThat(currentMessage).isEqualTo(message);
            assertThat(response.getResponse().getContentAsString())
                    .doesNotContain(credentials[0], credentials[1], "disabled", "UsernameNotFoundException");
            var refreshed = mvc.perform(get("/api/session").session(anonymous.session()).header("X-Api-Contract", "1"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false))
                    .andExpect(jsonPath("$.csrfToken").isString()).andReturn();
            assertThat(state(refreshed).rawToken()).isEqualTo(anonymous.rawToken());
        }
    }

    @Test
    void rejectedCredentialsPreserveAnExistingAuthenticatedSessionAndToken() throws Exception {
        var authenticated = authenticated();
        String sessionId = authenticated.session().getId();
        error(login(authenticated, USERNAME, "wrong-fixture-password"), 401, "INVALID_CREDENTIALS");
        assertThat(authenticated.session().getId()).isEqualTo(sessionId);
        var refreshed = mvc.perform(get("/api/session").session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.csrfToken").isString()).andReturn();
        assertThat(state(refreshed).rawToken()).isEqualTo(authenticated.rawToken());
    }

    @Test
    void operatorAndDeveloperCredentialsAndExistingSessionsCannotAccessTheArchive() throws Exception {
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var restricted = account(role, true, 1);
            store(restricted);
            var anonymous = anonymous();
            error(login(anonymous, USERNAME, PASSWORD), 403, "ARCHIVE_UNAVAILABLE");
            mvc.perform(get("/api/session").session(anonymous.session()).header("X-Api-Contract", "1"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
            error(mvc.perform(get("/api/memories").session(existingSession(restricted))),
                    403, "ARCHIVE_UNAVAILABLE");
        }
    }

    @Test
    void missingInvalidAndForeignCsrfTokensCannotMutateSessions() throws Exception {
        var anonymous = anonymous();
        var otherSession = anonymous();
        for (String token : new String[] {null, "invalid-fixture-token", otherSession.token()}) {
            error(mvc.perform(contract(mutation(post("/api/session"), anonymous, token, ORIGIN), "1")
                    .contentType(MediaType.APPLICATION_JSON).content(loginBody(USERNAME, PASSWORD))), 403, "CSRF_INVALID");
            error(mvc.perform(contract(mutation(delete("/api/session"), anonymous, token, ORIGIN), "1")),
                    403, "CSRF_INVALID");
        }
        verify(accounts, never()).findByUsername(anyString());
    }

    @Test
    void preLoginTokenIsRejectedAfterSuccessfulRotation() throws Exception {
        var anonymous = anonymous();
        var authenticated = state(login(anonymous, USERNAME, PASSWORD).andExpect(status().isOk()).andReturn());
        error(mvc.perform(contract(mutation(delete("/api/session"), authenticated, anonymous.token(), ORIGIN), "1")),
                403, "CSRF_INVALID");
        mvc.perform(get("/api/session").session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void foreignOriginAndCrossSiteMetadataCannotLoginOrLogout() throws Exception {
        var anonymous = anonymous();
        for (String origin : List.of("https://other.example", "null", "http://localhost.other.example")) {
            error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), origin), "1")
                    .contentType(MediaType.APPLICATION_JSON).content(loginBody(USERNAME, PASSWORD))), 403, "ORIGIN_INVALID");
            error(mvc.perform(contract(mutation(delete("/api/session"), anonymous, anonymous.token(), origin), "1")),
                    403, "ORIGIN_INVALID");
        }
        error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), ORIGIN), "1")
                .header("Sec-Fetch-Site", "cross-site").contentType(MediaType.APPLICATION_JSON)
                .content(loginBody(USERNAME, PASSWORD))), 403, "ORIGIN_INVALID");
        verify(accounts, never()).findByUsername(anyString());
    }

    @Test
    void malformedBodiesWrongTypesAndExtraFieldsAreRejected() throws Exception {
        var anonymous = anonymous();
        for (String body : List.of("", "{}", "null", "[]", "{broken",
                "{\"username\":3,\"password\":\"fixture\"}",
                "{\"username\":\"synthetic-couple\",\"password\":null}",
                "{\"username\":\"synthetic-couple\",\"password\":true}",
                "{\"username\":\"synthetic-couple\",\"password\":\"fixture\",\"roles\":[\"COUPLE\"]}")) {
            error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), ORIGIN), "1")
                    .contentType(MediaType.APPLICATION_JSON).content(body)), 400, "VALIDATION_FAILED");
        }
        error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), ORIGIN), "1")
                .contentType(MediaType.TEXT_PLAIN).content(loginBody(USERNAME, PASSWORD))), 400, "VALIDATION_FAILED");
        verify(accounts, never()).findByUsername(anyString());
    }

    @Test
    void oversizedKnownAndChunkedLoginBodiesAreRejectedBeforeCredentialWork() throws Exception {
        String credentials = loginBody(USERNAME, PASSWORD);
        String body = credentials + " ".repeat(4_097 - credentials.length());
        assertThat(body.getBytes(StandardCharsets.UTF_8)).hasSize(4_097);

        for (boolean chunked : List.of(false, true)) {
            var anonymous = anonymous();
            var result = error(
                    mvc.perform(loginRequestBody(anonymous, body, chunked)),
                    413,
                    "PAYLOAD_TOO_LARGE");

            assertThat(result.getResponse().getContentAsString())
                    .doesNotContain(USERNAME, PASSWORD);
        }

        verifyNoInteractions(throttles, accounts);
    }

    @Test
    void exactLoginBodyLimitStillAcceptsValidCredentialsWithEitherLengthMode() throws Exception {
        String credentials = loginBody(USERNAME, PASSWORD);
        String body = credentials + " ".repeat(4_096 - credentials.length());
        assertThat(body.getBytes(StandardCharsets.UTF_8)).hasSize(4_096);

        for (boolean chunked : List.of(false, true)) {
            var anonymous = anonymous();
            mvc.perform(loginRequestBody(anonymous, body, chunked))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(true))
                    .andExpect(jsonPath("$.user.displayName").value("Synthetic Couple"));
        }
    }

    @Test
    void loginBodyLimitCountsUtf8BytesBeforeCheckingPasswordLength() throws Exception {
        String body = loginBody(USERNAME, "\u00e9".repeat(2_048));
        assertThat(body.length()).isLessThan(4_096);
        assertThat(body.getBytes(StandardCharsets.UTF_8).length).isGreaterThan(4_096);

        for (boolean chunked : List.of(false, true)) {
            var anonymous = anonymous();
            error(
                    mvc.perform(loginRequestBody(anonymous, body, chunked)),
                    413,
                    "PAYLOAD_TOO_LARGE");
        }

        verifyNoInteractions(throttles, accounts);
    }

    @Test
    void emptyOversizedAndMalformedUnicodePasswordsAreGenericCredentialFailures() throws Exception {
        for (String password : List.of("", PASSWORD + "x".repeat(73), "\u00e9".repeat(37))) {
            error(login(anonymous(), USERNAME, password), 401, "INVALID_CREDENTIALS");
        }
        String slash = Character.toString(92);
        for (String surrogate : List.of("ud800", "udc00")) {
            var anonymous = anonymous();
            String body = "{\"username\":\"" + USERNAME + "\",\"password\":\"" + slash + surrogate + "\"}";
            error(mvc.perform(contract(mutation(post("/api/session"), anonymous, anonymous.token(), ORIGIN), "1")
                    .contentType(MediaType.APPLICATION_JSON).content(body)), 401, "INVALID_CREDENTIALS");
        }
    }

    @Test
    void loginStoreOutageReturnsASafeServiceFailureAndPreservesTheAnonymousSession() throws Exception {
        var anonymous = anonymous();
        when(accounts.findByUsername(USERNAME))
                .thenThrow(new DataAccessResourceFailureException("synthetic private login database diagnostic"));
        var result = error(login(anonymous, USERNAME, PASSWORD), 503, "SERVICE_UNAVAILABLE");
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("synthetic private", "database diagnostic", USERNAME, PASSWORD);
        var refreshed = mvc.perform(get("/api/session").session(anonymous.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false)).andReturn();
        assertThat(state(refreshed).rawToken()).isEqualTo(anonymous.rawToken());
    }

    @Test
    void blockedThrottleReturnsRetryAfterWithoutAuthenticating() throws Exception {
        when(throttles.reserve(anyList())).thenReturn(false);
        var result = error(login(anonymous(), USERNAME, PASSWORD), 429, "RATE_LIMITED");
        assertThat(Integer.parseInt(result.getResponse().getHeader("Retry-After"))).isPositive();
        assertThat(result.getResponse().getContentAsString()).doesNotContain(USERNAME, PASSWORD);
        verify(accounts, never()).findByUsername(anyString());
    }

    @Test
    void logoutInvalidatesTheSessionClearsTheCookieAndRejectsOldTokensAcrossCycles() throws Exception {
        var tokens = new HashSet<String>();
        for (int cycle = 0; cycle < 2; cycle++) {
            var anonymous = anonymous();
            assertThat(tokens.add(anonymous.rawToken())).isTrue();
            var authenticated = state(login(anonymous, USERNAME, PASSWORD).andExpect(status().isOk()).andReturn());
            assertThat(tokens.add(authenticated.rawToken())).isTrue();
            String sessionId = authenticated.session().getId();
            var logout = mvc.perform(contract(mutation(delete("/api/session"), authenticated, authenticated.token(), ORIGIN), "1"))
                    .andExpect(status().isNoContent()).andExpect(content().string("")).andReturn();
            assertThat(authenticated.session().isInvalid()).isTrue();
            String deletion = logout.getResponse().getHeaders("Set-Cookie").stream()
                    .filter(cookie -> cookie.startsWith("MEMORY_ARCHIVE_SESSION=")).findFirst().orElseThrow();
            assertThat(deletion).contains("Max-Age=0", "Path=/", "HttpOnly", "SameSite=Lax");
            error(mvc.perform(get("/api/memories").cookie(new Cookie("MEMORY_ARCHIVE_SESSION", sessionId))),
                    401, "AUTH_REQUIRED");
            var next = anonymous();
            error(mvc.perform(contract(mutation(delete("/api/session"), next, authenticated.token(), ORIGIN), "1")),
                    403, "CSRF_INVALID");
        }
    }

    @Test
    void privateArchiveRequiresAuthentication() throws Exception {
        error(mvc.perform(get("/api/memories")), 401, "AUTH_REQUIRED");
        error(mvc.perform(get("/api/memories/" + UUID.randomUUID())), 401, "AUTH_REQUIRED");
    }

    @Test
    void genericSpringPrincipalCannotUseCoupleAuthorityToAccessThePrivateArchive() throws Exception {
        for (String username : List.of("synthetic-other-user", USERNAME)) {
            var principal = User.withUsername(username).password("unused-fixture-password").roles("COUPLE").build();
            var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
            authentication.eraseCredentials();
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            var session = new MockHttpSession();
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
            error(mvc.perform(get("/api/memories").session(session)), 403, "ARCHIVE_UNAVAILABLE");
        }
    }

    @Test
    void accountRemovalDisablementVersionChangeAndRoleChangeInvalidateAccess() throws Exception {
        for (Optional<ArchiveAccount> replacement : List.of(Optional.<ArchiveAccount>empty(),
                Optional.of(account("COUPLE", false, 1)), Optional.of(account("COUPLE", true, 2)),
                Optional.of(account("OPERATOR", true, 1)))) {
            store(couple);
            var authenticated = authenticated();
            when(accounts.findById(ACCOUNT_ID)).thenReturn(replacement);
            error(mvc.perform(get("/api/memories").session(authenticated.session())), 401, "AUTH_REQUIRED");
            assertThat(authenticated.session().isInvalid()).isTrue();
        }
    }

    @Test
    void identityStoreOutageFailsClosedWithoutLeakingDiagnostics() throws Exception {
        var authenticated = authenticated();
        when(accounts.findById(ACCOUNT_ID))
                .thenThrow(new DataAccessResourceFailureException("synthetic private database diagnostic"));
        var result = error(mvc.perform(get("/api/memories").session(authenticated.session())),
                503, "SERVICE_UNAVAILABLE");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("synthetic private", "database diagnostic");
    }

    @Test
    void identityTransactionFailureReturnsASafeServiceErrorOnSessionRead() throws Exception {
        var authenticated = authenticated();
        when(accounts.findById(ACCOUNT_ID))
                .thenThrow(new CannotCreateTransactionException("synthetic private transaction diagnostic"));
        var result = error(mvc.perform(get("/api/session").session(authenticated.session())
                .header("X-Api-Contract", "1")), 503, "SERVICE_UNAVAILABLE");
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("synthetic private", "transaction diagnostic", USERNAME, PASSWORD);
    }

    @Test
    void staleIdentityOnSessionReadCreatesAFreshAnonymousSessionAndToken() throws Exception {
        var authenticated = authenticated();
        String previousId = authenticated.session().getId();
        when(accounts.findById(ACCOUNT_ID)).thenReturn(Optional.of(account("COUPLE", true, 2)));
        var result = mvc.perform(get("/api/session").session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.user").value(nullValue())).andReturn();
        var anonymous = state(result);
        assertThat(authenticated.session().isInvalid()).isTrue();
        assertThat(anonymous.session().getId()).isNotEqualTo(previousId);
        assertThat(anonymous.rawToken()).isNotEqualTo(authenticated.rawToken());
        error(mvc.perform(contract(mutation(delete("/api/session"), anonymous, authenticated.token(), ORIGIN), "1")),
                403, "CSRF_INVALID");
    }

    @Test
    void anonymousPrivateRequestsCannotUseMemoryIdsOrGuestCapabilitiesAsAuthentication() throws Exception {
        var anonymous = anonymous();
        for (ArchiveRoute route : privateRoutes()) {
            error(mvc.perform(privateRequest(route, anonymous)
                    .header("Idempotency-Key", UUID.randomUUID().toString())), 401, "AUTH_REQUIRED");
        }
        verifyNoInteractions(media, storage);
    }

    @Test
    void operatorAndDeveloperAreDeniedAcrossEveryPrivateArchiveRoute() throws Exception {
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var restricted = account(role, true, 1);
            store(restricted);
            var session = identitySession(restricted);
            for (ArchiveRoute route : privateRoutes()) {
                error(mvc.perform(privateRequest(route, session)), 403, "ARCHIVE_UNAVAILABLE");
            }
        }
        verifyNoInteractions(media, storage);
    }

    @Test
    void staleSessionsAreRejectedBeforeEveryPrivateArchiveRoute() throws Exception {
        for (ArchiveRoute route : privateRoutes()) {
            store(couple);
            var authenticated = authenticated();
            when(accounts.findById(ACCOUNT_ID)).thenReturn(Optional.of(account("COUPLE", true, 2)));
            error(mvc.perform(privateRequest(route, authenticated)), 401, "AUTH_REQUIRED");
            assertThat(authenticated.session().isInvalid()).isTrue();
        }
        verifyNoInteractions(media, storage);
    }

    @Test
    void directObjectPathsAreUnavailableToAnonymousAndEveryAuthenticatedRole() throws Exception {
        var paths = List.of("/originals/" + ASSET_ID, "/staging/" + ASSET_ID,
                "/objects/" + ASSET_ID, "/api/objects/" + ASSET_ID);
        var anonymous = anonymous();
        for (String path : paths) {
            error(mvc.perform(get(path).session(anonymous.session()).header("X-Api-Contract", "1")),
                    401, "AUTH_REQUIRED");
        }
        for (String role : List.of("COUPLE", "OPERATOR", "DEVELOPER")) {
            var account = account(role, true, 1);
            store(account);
            var session = identitySession(account);
            for (String path : paths) {
                error(mvc.perform(get(path).session(session.session()).header("X-Api-Contract", "1")),
                        403, "ARCHIVE_UNAVAILABLE");
            }
        }
        store(couple);
        var stale = identitySession(couple);
        when(accounts.findById(ACCOUNT_ID)).thenReturn(Optional.of(account("COUPLE", true, 2)));
        for (String path : paths) {
            error(mvc.perform(get(path).session(stale.session()).header("X-Api-Contract", "1")),
                    403, "ARCHIVE_UNAVAILABLE");
        }
        verifyNoInteractions(media, storage);
    }

    @Test
    void coupleSessionDoesNotCreateUnimplementedInboxDetailOrReviewActions() throws Exception {
        var authenticated = authenticated();
        mvc.perform(get("/api/memories").session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/memories/" + MEMORY_ID).session(authenticated.session()).header("X-Api-Contract", "1"))
                .andExpect(status().isNotFound());
        var review = mvc.perform(privateRequest(new ArchiveRoute("/api/memories/" + MEMORY_ID + "/review", true), authenticated))
                .andReturn();
        // Spring's static-resource fallback may report 405; neither status implements review.
        assertThat(review.getResponse().getStatus()).isIn(404, 405);
        error(mvc.perform(contract(mutation(patch("/api/memories/" + MEMORY_ID + "/review"),
                authenticated, null, ORIGIN), "1").contentType(MediaType.APPLICATION_JSON)
                .header("If-Match", "\"1\"").content("{\"reviewStatus\":\"KEEP\"}")), 403, "CSRF_INVALID");
        verifyNoInteractions(media, storage);
    }

    @Test
    void sessionAccessDoesNotExposeSignupRecoveryOrProviderRoutes() throws Exception {
        var anonymous = anonymous();
        var authenticated = authenticated();
        for (String path : List.of("/api/accounts", "/api/accounts/signup", "/api/accounts/recovery", "/api/auth/providers")) {
            error(mvc.perform(contract(mutation(post(path), anonymous, anonymous.token(), ORIGIN), "1")
                    .contentType(MediaType.APPLICATION_JSON).content("{}")), 401, "AUTH_REQUIRED");
            error(mvc.perform(contract(mutation(post(path), authenticated, authenticated.token(), ORIGIN), "1")
                    .contentType(MediaType.APPLICATION_JSON).content("{}")), 403, "ARCHIVE_UNAVAILABLE");
        }
        String credentials = Base64.getEncoder().encodeToString((USERNAME + ":" + PASSWORD).getBytes(StandardCharsets.UTF_8));
        error(mvc.perform(get("/api/memories/" + MEMORY_ID + "/playback")
                .header("X-Api-Contract", "1").header("Authorization", "Basic " + credentials)), 401, "AUTH_REQUIRED");
        verifyNoInteractions(media, storage);
    }

    @Test
    void couplePlaybackReturnsOnlyAShortLivedHttpsGrantForTheServerSelectedOriginal() throws Exception {
        when(media.findPlayable(MEMORY_ID)).thenReturn(Optional.of(playable()));
        var expires = NOW.plusSeconds(300);
        var grant = new ObjectStorage.ReadGrant("https://playback.example.test/synthetic-signed-resource", expires);
        when(storage.authorizeRead(ORIGINAL_KEY, "image/png", 47L, expires)).thenReturn(grant);
        var authenticated = authenticated();
        var result = mvc.perform(get("/api/memories/" + MEMORY_ID + "/playback").session(authenticated.session())
                .header("X-Api-Contract", "1").header("Idempotency-Key", UUID.randomUUID().toString())
                .param("objectKey", "staging/" + UUID.randomUUID()).param("contentType", "audio/wav").param("byteSize", "1"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)).andReturn();
        Map<String, Object> document = JsonPath.read(result.getResponse().getContentAsString(), "$");
        String url = JsonPath.read(result.getResponse().getContentAsString(), "$.url");
        String expiry = JsonPath.read(result.getResponse().getContentAsString(), "$.expiresAt");
        assertThat(document.keySet()).containsExactlyInAnyOrder("url", "expiresAt");
        assertThat(URI.create(url).getScheme()).isEqualTo("https");
        assertThat(Instant.parse(expiry)).isEqualTo(expires);
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("objectKey", "assetId", "contentType", "byteSize", USERNAME, PASSWORD);
        verify(media).findPlayable(MEMORY_ID);
        verify(storage).authorizeRead(ORIGINAL_KEY, "image/png", 47L, expires);
        verifyNoMoreInteractions(storage);
    }

    @Test
    void absentOrUnplayableMemoryIdsNeverMintAReadGrant() throws Exception {
        var authenticated = authenticated();
        for (UUID id : List.of(MEMORY_ID, OTHER_MEMORY_ID)) {
            error(mvc.perform(get("/api/memories/" + id + "/playback").session(authenticated.session())
                    .header("X-Api-Contract", "1")), 404, "NOT_FOUND");
        }
        verifyNoInteractions(storage);
    }

    @Test
    void invalidRepositoryKeyTypeOrSizeCannotBroadenPlaybackScope() throws Exception {
        var authenticated = authenticated();
        for (PlaybackRepository.PlayableMedia invalid : List.of(
                new PlaybackRepository.PlayableMedia(null, ORIGINAL_KEY, "image/png", 47),
                new PlaybackRepository.PlayableMedia(ASSET_ID, "staging/" + ASSET_ID, "image/png", 47),
                new PlaybackRepository.PlayableMedia(ASSET_ID, "originals/" + UUID.randomUUID(), "image/png", 47),
                new PlaybackRepository.PlayableMedia(ASSET_ID, "../../private", "image/png", 47),
                new PlaybackRepository.PlayableMedia(ASSET_ID, ORIGINAL_KEY, "audio/wav", 47),
                new PlaybackRepository.PlayableMedia(ASSET_ID, ORIGINAL_KEY, "image/png", 0),
                new PlaybackRepository.PlayableMedia(ASSET_ID, ORIGINAL_KEY, "image/png", 10000001))) {
            when(media.findPlayable(MEMORY_ID)).thenReturn(Optional.of(invalid));
            error(mvc.perform(get("/api/memories/" + MEMORY_ID + "/playback").session(authenticated.session())
                    .header("X-Api-Contract", "1")), 404, "NOT_FOUND");
        }
        verifyNoInteractions(storage);
    }

    @Test
    void playbackRequiresTheContractAndAWellFormedMemoryIdBeforeQueryingMedia() throws Exception {
        var authenticated = authenticated();
        for (String version : new String[] {null, "", "2"}) {
            error(mvc.perform(contract(get("/api/memories/" + MEMORY_ID + "/playback")
                    .session(authenticated.session()), version)), 400, "UNSUPPORTED_CONTRACT");
        }
        error(mvc.perform(get("/api/memories/not-an-id/playback").session(authenticated.session())
                .header("X-Api-Contract", "1")), 404, "NOT_FOUND");
        verifyNoInteractions(media, storage);
    }

    @Test
    void unavailablePlaybackStorageReturnsASafeMediaError() throws Exception {
        when(media.findPlayable(MEMORY_ID)).thenReturn(Optional.of(playable()));
        when(storage.authorizeRead(ORIGINAL_KEY, "image/png", 47L, NOW.plusSeconds(300)))
                .thenThrow(new ApiException(503, "MEDIA_UNAVAILABLE", "The media is temporarily unavailable."));
        var authenticated = authenticated();
        var result = error(mvc.perform(get("/api/memories/" + MEMORY_ID + "/playback")
                .session(authenticated.session()).header("X-Api-Contract", "1")), 503, "MEDIA_UNAVAILABLE");
        assertThat(result.getResponse().getContentAsString()).doesNotContain(ORIGINAL_KEY, "https://", USERNAME, PASSWORD);
    }

    @Test
    void playbackMetadataDatabaseFailureReturnsASafeServiceError() throws Exception {
        when(media.findPlayable(MEMORY_ID))
                .thenThrow(new DataAccessResourceFailureException("synthetic private playback SQL diagnostic"));
        var authenticated = authenticated();
        var result = error(mvc.perform(get("/api/memories/" + MEMORY_ID + "/playback")
                .session(authenticated.session()).header("X-Api-Contract", "1")), 503, "SERVICE_UNAVAILABLE");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("synthetic private", "SQL diagnostic", USERNAME, PASSWORD);
        verifyNoInteractions(storage);
    }

    @Test
    void directPlaybackServiceRejectsMissingUnauthenticatedAnonymousAndForeignIdentities() {
        directGuardDenies(null, 401, "AUTH_REQUIRED");
        directGuardDenies(UsernamePasswordAuthenticationToken.unauthenticated(new ArchivePrincipal(couple), "unused"),
                401, "AUTH_REQUIRED");
        directGuardDenies(new AnonymousAuthenticationToken("fixture-key", "anonymousUser",
                List.of(new SimpleGrantedAuthority("ROLE_COUPLE"))), 401, "AUTH_REQUIRED");
        for (String username : List.of("synthetic-other-user", USERNAME)) {
            var user = User.withUsername(username).password("unused-fixture-password").roles("COUPLE").build();
            directGuardDenies(UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities()),
                    403, "ARCHIVE_UNAVAILABLE");
        }
        verify(accounts, never()).findById(any(UUID.class));
    }

    @Test
    void directPlaybackServiceRevalidatesAccountStatusVersionUsernameAndRoleBeforeMediaQueries() {
        for (Optional<ArchiveAccount> replacement : List.of(Optional.<ArchiveAccount>empty(),
                Optional.of(account("COUPLE", false, 1)), Optional.of(account("COUPLE", true, 2)),
                Optional.of(account("OPERATOR", true, 1)), Optional.of(new ArchiveAccount(ACCOUNT_ID,
                        "changed-fixture-username", "Synthetic Couple", couple.passwordHash(), "COUPLE", true, 1)))) {
            when(accounts.findById(ACCOUNT_ID)).thenReturn(replacement);
            directGuardDenies(identity(couple), 401, "AUTH_REQUIRED");
        }
    }

    @Test
    void directPlaybackServiceRequiresCurrentCoupleAuthorityOnTheAccountAndAuthentication() {
        for (String role : List.of("OPERATOR", "DEVELOPER")) {
            var restricted = account(role, true, 1);
            store(restricted);
            directGuardDenies(identity(restricted), 403, "ARCHIVE_UNAVAILABLE");
        }
        store(couple);
        directGuardDenies(UsernamePasswordAuthenticationToken.authenticated(new ArchivePrincipal(couple), null, List.of()),
                403, "ARCHIVE_UNAVAILABLE");
    }

    @Test
    void directPlaybackServiceAccountStoreFailureNeverReachesMediaOrStorage() {
        when(accounts.findById(ACCOUNT_ID))
                .thenThrow(new CannotCreateTransactionException("synthetic private transaction diagnostic"));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(identity(couple));
        SecurityContextHolder.setContext(context);
        try {
            assertThatThrownBy(() -> playbackService.playback(MEMORY_ID)).isInstanceOf(CannotCreateTransactionException.class);
            verifyNoInteractions(media, storage);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Nested
    @TestPropertySource(properties = "archive.revealed=false")
    class BeforeReveal {
        @Test
        void validCoupleCannotLoginOrUseAnExistingSessionBeforeReveal() throws Exception {
            error(login(anonymous(), USERNAME, PASSWORD), 403, "ARCHIVE_UNAVAILABLE");
            var existing = existingSession(couple);
            error(mvc.perform(get("/api/memories").session(existing)), 403, "ARCHIVE_UNAVAILABLE");
            error(mvc.perform(get("/api/session").session(existing).header("X-Api-Contract", "1")),
                    403, "ARCHIVE_UNAVAILABLE");
        }

        @Test
        void revealGateRejectsEveryPrivateRouteBeforeMediaOrStorageQueries() throws Exception {
            var session = identitySession(couple);
            for (ArchiveRoute route : privateRoutes()) {
                error(mvc.perform(privateRequest(route, session)), 403, "ARCHIVE_UNAVAILABLE");
            }
            verifyNoInteractions(media, storage);
        }

        @Test
        void directPlaybackServiceAlsoEnforcesTheClosedRevealGate() {
            directGuardDenies(identity(couple), 403, "ARCHIVE_UNAVAILABLE");
        }
    }

    private void store(ArchiveAccount account) {
        when(accounts.findByUsername(account.username())).thenReturn(Optional.of(account));
        when(accounts.findById(account.id())).thenReturn(Optional.of(account));
    }

    private ArchiveAccount account(String role, boolean enabled, long version) {
        return new ArchiveAccount(ACCOUNT_ID, USERNAME, "Synthetic Couple", couple.passwordHash(), role, enabled, version);
    }

    private SessionState anonymous() throws Exception {
        return state(mvc.perform(get("/api/session").header("X-Api-Contract", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.user").value(nullValue())).andReturn());
    }

    private SessionState authenticated() throws Exception {
        return state(login(anonymous(), USERNAME, PASSWORD).andExpect(status().isOk()).andReturn());
    }

    private SessionState identitySession(ArchiveAccount account) throws Exception {
        var session = anonymous();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(identity(account));
        session.session().setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }

    private static Authentication identity(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        authentication.eraseCredentials();
        return authentication;
    }

    private void directGuardDenies(Authentication authentication, int expectedStatus, String expectedCode) {
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        try {
            assertThatThrownBy(() -> playbackService.playback(MEMORY_ID)).isInstanceOf(ApiException.class)
                    .satisfies(exception -> {
                        assertThat(((ApiException) exception).status()).isEqualTo(expectedStatus);
                        assertThat(((ApiException) exception).code()).isEqualTo(expectedCode);
                    });
            verifyNoInteractions(media, storage);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private static PlaybackRepository.PlayableMedia playable() {
        return new PlaybackRepository.PlayableMedia(ASSET_ID, ORIGINAL_KEY, "image/png", 47L);
    }

    private static List<ArchiveRoute> privateRoutes() {
        return List.of(new ArchiveRoute("/api/memories", false),
                new ArchiveRoute("/api/memories/" + MEMORY_ID, false),
                new ArchiveRoute("/api/memories/" + MEMORY_ID + "/review", true),
                new ArchiveRoute("/api/memories/" + MEMORY_ID + "/playback", false),
                new ArchiveRoute("/api/memories/" + OTHER_MEMORY_ID, false),
                new ArchiveRoute("/api/memories/" + OTHER_MEMORY_ID + "/review", true),
                new ArchiveRoute("/api/memories/" + OTHER_MEMORY_ID + "/playback", false));
    }

    private static MockHttpServletRequestBuilder privateRequest(ArchiveRoute route, SessionState session) {
        var request = route.review() ? patch(route.path()).contentType(MediaType.APPLICATION_JSON)
                .header("If-Match", "\"1\"").content("{\"reviewStatus\":\"KEEP\"}") : get(route.path());
        return contract(mutation(request, session, session.token(), ORIGIN), "1");
    }

    private ResultActions login(SessionState session, String username, String password) throws Exception {
        return mvc.perform(contract(mutation(post("/api/session"), session, session.token(), ORIGIN), "1")
                .contentType(MediaType.APPLICATION_JSON).content(loginBody(username, password)));
    }

    private static MockHttpServletRequestBuilder loginRequestBody(
            SessionState session,
            String body,
            boolean chunked) {
        var request = contract(
                mutation(post("/api/session"), session, session.token(), ORIGIN),
                "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8));

        if (chunked) {
            request.header("Transfer-Encoding", "chunked");
            request.with(original -> {
                // MockMvc does not decode a wire transfer; model the container's unknown length.
                var withoutLength = spy(original);
                doReturn(-1).when(withoutLength).getContentLength();
                doReturn(-1L).when(withoutLength).getContentLengthLong();
                return withoutLength;
            });
        }

        return request;
    }

    private String loginBody(String username, String password) {
        return mapper.writeValueAsString(Map.of("username", username, "password", password));
    }

    private SessionState state(MvcResult result) throws Exception {
        return new SessionState((MockHttpSession) result.getRequest().getSession(false),
                JsonPath.read(result.getResponse().getContentAsString(), "$.csrfToken"),
                csrfTokens.loadToken(result.getRequest()).getToken());
    }

    private static MockHttpServletRequestBuilder contract(MockHttpServletRequestBuilder request, String version) {
        return version == null ? request : request.header("X-Api-Contract", version);
    }

    private static MockHttpServletRequestBuilder mutation(MockHttpServletRequestBuilder request,
            SessionState session, String token, String origin) {
        request.session(session.session());
        if (token != null) request.header("X-CSRF-Token", token);
        if (origin != null) request.header("Origin", origin);
        return request;
    }

    private static MockHttpSession existingSession(ArchiveAccount account) {
        var principal = new ArchivePrincipal(account);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        authentication.eraseCredentials();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        var session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        return session;
    }

    private static MvcResult error(ResultActions response, int expectedStatus, String expectedCode) throws Exception {
        var result = response.andExpect(status().is(expectedStatus))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value(expectedCode)).andReturn();
        String requestId = JsonPath.read(result.getResponse().getContentAsString(), "$.error.requestId");
        assertThat(requestId).isNotBlank().isEqualTo(result.getResponse().getHeader("X-Request-ID"));
        assertThat(UUID.fromString(requestId)).isNotNull();
        return result;
    }

    private record SessionState(MockHttpSession session, String token, String rawToken) {}
    private record ArchiveRoute(String path, boolean review) {}
}
