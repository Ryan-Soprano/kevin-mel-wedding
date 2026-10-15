package com.kevinmel.archive.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.ForwardedHeaderFilter;

class StagingAccessFilterTest {
    private static final String USER = "operator-test";
    private static final String PASSWORD = "synthetic-test-password-0123456789";
    private static final String ORIGIN = "https://staging.test";
    private final StagingAccessFilter filter = new StagingAccessFilter(true, USER, PASSWORD, ORIGIN);

    @Test void onlyGetHealthBypassesAuthentication() throws Exception {
        var health = request("GET", "/api/health", false, null);
        assertThat(pass(health).passed()).isTrue();
        for (String path : new String[]{"/", "/assets/app.js", "/api/contributions", "/api/health/", "/error"}) {
            var result = pass(request("GET", path, true, null));
            assertThat(result.passed()).isFalse();
            assertThat(result.response().getStatus()).isEqualTo(401);
            assertThat(result.response().getHeader("WWW-Authenticate")).contains("Basic");
            assertThat(result.response().getHeader("Cache-Control")).isEqualTo("no-store");
        }
        assertThat(pass(request("POST", "/api/health", true, null)).response().getStatus()).isEqualTo(401);
    }

    @Test void httpsAndExactCredentialsAreRequiredWithoutEchoingSecrets() throws Exception {
        assertThat(pass(request("GET", "/", true, basic(USER + ":" + PASSWORD))).passed()).isTrue();
        var insecure = pass(request("GET", "/", false, basic(USER + ":" + PASSWORD)));
        assertThat(insecure.passed()).isFalse();
        assertThat(insecure.response().getStatus()).isEqualTo(403);
        assertThat(insecure.response().getHeader("WWW-Authenticate")).isNull();
        for (String header : new String[]{"Basic !!!", "Bearer secret", basic(USER + ":wrong"),
                basic("wrong:" + PASSWORD), "Basic " + "a".repeat(2048)}) {
            var result = pass(request("POST", "/api/contributions", true, header));
            assertThat(result.passed()).isFalse();
            assertThat(result.response().getStatus()).isEqualTo(401);
            assertThat(result.response().getContentAsString()).doesNotContain(PASSWORD, USER, header);
        }
    }

    @Test void invalidOrMissingConfigurationFailsClosed() {
        for (String password : new String[]{"", " ".repeat(24), "too-short", "x".repeat(257), PASSWORD + "\n"}) {
            assertThatThrownBy(() -> new StagingAccessFilter(true, USER, password, ORIGIN)).isInstanceOf(IllegalStateException.class);
        }
        for (String username : new String[]{"", " ", "user:name", "user\nname"}) {
            assertThatThrownBy(() -> new StagingAccessFilter(true, username, PASSWORD, ORIGIN)).isInstanceOf(IllegalStateException.class);
        }
        for (String origin : new String[]{"", "http://staging.test", ORIGIN + "/", ORIGIN + "?x=1", "https://user@staging.test"}) {
            assertThatThrownBy(() -> new StagingAccessFilter(true, USER, PASSWORD, origin)).isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void springConfigurationDefaultsToAdmissionAndRequiresCredentialsUnlessExplicitlyDisabled() {
        var configuration = new ApplicationContextRunner()
                .withInitializer(context -> context.getEnvironment().setActiveProfiles("staging"))
                .withUserConfiguration(StagingAccessConfiguration.class)
                .withPropertyValues("MEMORY_ARCHIVE_STAGING_ORIGIN=" + ORIGIN);

        configuration.run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure())
                    .hasRootCauseInstanceOf(IllegalStateException.class);
        });
        configuration.withPropertyValues("MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=true").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure())
                    .hasRootCauseInstanceOf(IllegalStateException.class);
        });
        configuration.withPropertyValues("MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=false").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(FilterRegistrationBean.class);
        });
    }

    @Test
    void malformedAuthFlagFailsSpringStartupInsteadOfSilentlyOpeningTheSite() {
        var configuration = new ApplicationContextRunner()
                .withInitializer(context -> context.getEnvironment().setActiveProfiles("staging"))
                .withUserConfiguration(StagingAccessConfiguration.class)
                .withPropertyValues(
                        "MEMORY_ARCHIVE_STAGING_ORIGIN=" + ORIGIN,
                        "MEMORY_ARCHIVE_STAGING_USERNAME=" + USER,
                        "MEMORY_ARCHIVE_STAGING_PASSWORD=" + PASSWORD);
        for (String flag : new String[]{"not-a-boolean", ""}) {
            configuration.withPropertyValues("MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED=" + flag).run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                        .hasRootCauseInstanceOf(IllegalArgumentException.class);
            });
        }
    }

    @Test
    void explicitlyDisabledAdmissionAllowsGuestRoutesWithoutCredentialsOrChallenge() throws Exception {
        var publicAccess = new StagingAccessFilter(false, null, null, ORIGIN);
        for (String path : new String[]{"/", "/assets/app.js", "/api/contributions"}) {
            var result = pass(publicAccess, request("GET", path, true, null));
            assertThat(result.passed()).isTrue();
            assertThat(result.response().getHeader("WWW-Authenticate")).isNull();
            assertThat(result.response().getHeader("Cache-Control")).isEqualTo("no-store");
            assertThat(result.response().getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
            assertThat(result.response().getHeaders("Vary")).contains("Authorization");
        }
        var invalidCredentials = pass(publicAccess, request("POST", "/api/contributions", true, "Basic !!!"));
        assertThat(invalidCredentials.passed()).isTrue();
        assertThat(invalidCredentials.response().getHeader("WWW-Authenticate")).isNull();
    }

    @Test
    void disabledAdmissionStillRequiresHttpsAndTheExactApprovedOrigin() throws Exception {
        var publicAccess = new StagingAccessFilter(false, "", "", ORIGIN);
        var insecure = pass(publicAccess, request("GET", "/", false, null));
        assertThat(insecure.passed()).isFalse();
        assertThat(insecure.response().getStatus()).isEqualTo(403);
        assertThat(insecure.response().getContentAsString()).contains("STAGING_HTTPS_REQUIRED");
        assertThat(insecure.response().getHeader("WWW-Authenticate")).isNull();

        var wrongOrigin = request("POST", "/api/contributions", true, null);
        wrongOrigin.setServerName("unapproved.test");
        var rejected = pass(publicAccess, wrongOrigin);
        assertThat(rejected.passed()).isFalse();
        assertThat(rejected.response().getStatus()).isEqualTo(403);
        assertThat(rejected.response().getContentAsString()).contains("STAGING_ORIGIN_INVALID");
        assertThat(rejected.response().getHeader("WWW-Authenticate")).isNull();

        for (String origin : new String[]{"", "http://staging.test", ORIGIN + "/", ORIGIN + "?x=1"}) {
            assertThatThrownBy(() -> new StagingAccessFilter(false, null, null, origin))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void disabledAdmissionRetainsForwardedHttpsAndDownstreamCrossSiteRejection() throws Exception {
        var publicAccess = new StagingAccessFilter(false, null, null, ORIGIN);
        var forwarded = new ForwardedHeaderFilter();
        var request = request("POST", "/api/contributions", false, null);
        request.addHeader("X-Forwarded-Proto", "https");
        request.addHeader("X-Forwarded-Host", "staging.test");
        request.addHeader("X-Forwarded-Port", "443");
        request.addHeader("Origin", ORIGIN);
        var passed = new AtomicBoolean();
        forwarded.doFilter(request, new MockHttpServletResponse(), (req, res) ->
                publicAccess.doFilter(req, res, (inner, response) -> {
                    RequestOrigin.requireSameOrigin((jakarta.servlet.http.HttpServletRequest) inner);
                    passed.set(true);
                }));
        assertThat(passed).isTrue();

        var crossSite = request("POST", "/api/contributions", true, null);
        crossSite.addHeader("Origin", "https://other.test");
        assertThatThrownBy(() -> publicAccess.doFilter(crossSite, new MockHttpServletResponse(), (req, res) ->
                RequestOrigin.requireSameOrigin((jakarta.servlet.http.HttpServletRequest) req)))
                .isInstanceOfSatisfying(ApiException.class, failure ->
                        assertThat(failure.code()).isEqualTo("ORIGIN_INVALID"));
    }

    @Test void trustedProxyHttpsPreservesSameOriginButSpoofedHostAndCrossSiteFail() throws Exception {
        var forwarded = new ForwardedHeaderFilter();
        var request = request("POST", "/api/contributions", false, basic(USER + ":" + PASSWORD));
        request.addHeader("X-Forwarded-Proto", "https");
        request.addHeader("X-Forwarded-Host", "staging.test");
        request.addHeader("X-Forwarded-Port", "443");
        request.addHeader("Origin", ORIGIN);
        var passed = new AtomicBoolean();
        forwarded.doFilter(request, new MockHttpServletResponse(), (req, res) -> filter.doFilter(req, res, (inner, response) -> {
            RequestOrigin.requireSameOrigin((jakarta.servlet.http.HttpServletRequest) inner);
            passed.set(true);
        }));
        assertThat(passed).isTrue();
        request.removeAttribute("org.springframework.web.filter.ForwardedHeaderFilter.FILTERED");
        request.removeHeader("X-Forwarded-Host");
        request.addHeader("X-Forwarded-Host", "unapproved.test");
        var response = new MockHttpServletResponse();
        forwarded.doFilter(request, response, (req, res) -> filter.doFilter(req, res, (inner, result) -> passed.set(false)));
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("STAGING_ORIGIN_INVALID");
        var crossSite = request("POST", "/api/contributions", true, basic(USER + ":" + PASSWORD));
        crossSite.addHeader("Origin", "https://other.test");
        assertThatThrownBy(() -> filter.doFilter(crossSite, new MockHttpServletResponse(), (req, res) ->
                RequestOrigin.requireSameOrigin((jakarta.servlet.http.HttpServletRequest) req)))
                .isInstanceOfSatisfying(ApiException.class, failure -> assertThat(failure.code()).isEqualTo("ORIGIN_INVALID"));
    }

    private static String basic(String value) {
        return "Basic " + Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
    private static MockHttpServletRequest request(String method, String path, boolean secure, String header) {
        var request = new MockHttpServletRequest(method, path);
        request.setSecure(secure);
        request.setScheme(secure ? "https" : "http");
        request.setServerName("staging.test");
        request.setServerPort(secure ? 443 : 10000);
        if (header != null) request.addHeader("Authorization", header);
        return request;
    }
    private Result pass(MockHttpServletRequest request) throws Exception {
        return pass(filter, request);
    }

    private Result pass(StagingAccessFilter access, MockHttpServletRequest request) throws Exception {
        var response = new MockHttpServletResponse();
        var passed = new AtomicBoolean();
        access.doFilter(request, response, (req, res) -> passed.set(true));
        return new Result(passed.get(), response);
    }
    private record Result(boolean passed, MockHttpServletResponse response) {}
}
