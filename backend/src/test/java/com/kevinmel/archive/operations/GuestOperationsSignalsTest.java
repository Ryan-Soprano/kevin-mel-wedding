package com.kevinmel.archive.operations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import com.kevinmel.archive.security.AnonymousSubmissionFilter;
import com.kevinmel.archive.security.AnonymousThrottle;
import com.kevinmel.archive.security.SecurityErrorWriter;
import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiExceptionHandler;

class GuestOperationsSignalsTest {
    private static final String COMMIT = "a".repeat(40);
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-23T01:00:00Z"), ZoneOffset.UTC);
    private final GuestOperationsSignals signals = new GuestOperationsSignals(clock);
    private final GuestOperationsFilter observer = new GuestOperationsFilter(signals);

    @Test void onlyTechnicalGuestMutationFailuresAreObservedAndMediaIsASubset() throws Exception {
        for (int status : new int[]{200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 429}) {
            var response = new MockHttpServletResponse();
            observer.doFilter(request("POST", "/api/contributions"), response, (req, res) -> response.setStatus(status));
        }
        for (String path : new String[]{"/api/session", "/api/memories/contributions", "/api/health",
                "/api/contributions/a/memories/b/upload-failures"}) {
            var response = new MockHttpServletResponse();
            observer.doFilter(request("POST", path), response, (req, res) -> response.setStatus(503));
        }
        assertThat(count(GuestOperationsSignals.Category.GUEST_API_5XX)).isZero();
        var response = new MockHttpServletResponse();
        observer.doFilter(request("POST", "/api/contributions/a/memories/b/finalize"), response,
                (req, res) -> response.setStatus(503));
        assertThat(count(GuestOperationsSignals.Category.GUEST_API_5XX)).isEqualTo(1);
        assertThat(count(GuestOperationsSignals.Category.GUEST_MEDIA_5XX)).isEqualTo(1);
        assertThatThrownBy(() -> observer.doFilter(request("POST", "/api/contributions"), new MockHttpServletResponse(),
                (req, res) -> { throw new IllegalStateException("synthetic private marker"); }))
                .isInstanceOf(IllegalStateException.class);
        assertThat(count(GuestOperationsSignals.Category.GUEST_API_5XX)).isEqualTo(2);
    }

    @Test void plannedPauseAndBusyResponsesRemainPubliclyIdenticalButDoNotCreateTechnicalIncidents() throws Exception {
        var request = request("POST", "/api/contributions/a/memories/b/finalize");
        var response = new MockHttpServletResponse();
        observer.doFilter(request, response, (req, res) -> {
            var result = new ApiExceptionHandler().handleApi(ApiException.expectedUnavailable("Retry this memory.", 5), request);
            response.setStatus(result.getStatusCode().value());
            assertThat(result.getBody().error().code()).isEqualTo("MEDIA_UNAVAILABLE");
            assertThat(result.getHeaders().getFirst("Retry-After")).isEqualTo("5");
        });
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(count(GuestOperationsSignals.Category.GUEST_API_5XX)).isZero();
    }

    @Test void databaseAdmissionFailureOutsideMvcIsObservedWithoutReadingItsDiagnostics() throws Exception {
        var throttle = mock(AnonymousThrottle.class);
        when(throttle.reserve(any(), anyString(), any()))
                .thenThrow(new DataAccessResourceFailureException("synthetic private key and SQL marker"));
        var admission = new AnonymousSubmissionFilter(throttle, new SecurityErrorWriter(JsonMapper.builder().build()));
        var request = request("POST", "/api/contributions");
        request.addHeader("X-Api-Contract", "1");
        request.addHeader("Idempotency-Key", UUID.randomUUID().toString());
        var response = new MockHttpServletResponse();
        observer.doFilter(request, response, (req, res) -> admission.doFilter(req, res,
                (ignoredRequest, ignoredResponse) -> { throw new AssertionError("MVC must not run."); }));
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(count(GuestOperationsSignals.Category.GUEST_API_5XX)).isEqualTo(1);
        assertThat(JsonMapper.builder().build().writeValueAsString(signals.snapshot(COMMIT)))
                .doesNotContain("private", "SQL", "key", "message", "Exception");
    }

    @Test void reportedGrantsAreDeduplicatedAndTheSnapshotContainsOnlyTheFrozenFixedSchema() throws Exception {
        UUID grant = UUID.randomUUID();
        signals.reportUpload(grant); signals.reportUpload(grant); signals.reportUpload(UUID.randomUUID());
        var value = JsonMapper.builder().build().readTree(JsonMapper.builder().build().writeValueAsBytes(signals.snapshot(COMMIT)));
        assertThat(value.propertyNames()).containsExactlyInAnyOrder(
                "schemaVersion", "bootId", "startedAt", "observedAt", "renderCommit", "categories");
        assertThat(value.path("categories").propertyNames()).containsExactlyInAnyOrder(
                "GUEST_API_5XX", "GUEST_MEDIA_5XX", "CLIENT_UPLOAD_UNCONFIRMED");
        assertThat(value.path("startedAt").asString()).isEqualTo("2026-10-23T01:00:00.000Z");
        assertThat(value.path("categories").path("CLIENT_UPLOAD_UNCONFIRMED").path("count").asLong()).isEqualTo(2);
        assertThat(value.toString()).doesNotContain(grant.toString());
        assertThat(new GuestOperationsSignals(clock).snapshot(COMMIT).bootId()).isNotEqualTo(signals.snapshot(COMMIT).bootId());
    }

    @Test void privatePublicationUsesAtomicOwnerOnlyBoundedFilesAndRefusesLinksOrLoosePermissions(@TempDir Path directory)
            throws Exception {
        assumeTrue(directory.getFileSystem().supportedFileAttributeViews().contains("posix"));
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
        var writer = new GuestOperationsConfiguration.PrivateWriter(directory, signals, JsonMapper.builder().build(), COMMIT);
        writer.publish();
        var target = directory.resolve("guest-signals.json");
        assertThat(Files.size(target)).isLessThan(4096);
        assertThat(Files.getPosixFilePermissions(target)).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        signals.record(GuestOperationsSignals.Category.GUEST_API_5XX); writer.publish();
        try (var children = Files.list(directory)) {
            assertThat(children.map(path -> path.getFileName().toString()).toList()).containsExactly("guest-signals.json");
        }
        Files.setPosixFilePermissions(target, PosixFilePermissions.fromString("rw-r--r--"));
        assertThatThrownBy(writer::publish).isInstanceOf(java.io.IOException.class);
        Files.delete(target); Files.createSymbolicLink(target, directory.resolve("unowned"));
        assertThatThrownBy(writer::publish).isInstanceOf(java.io.IOException.class);
    }

    private long count(GuestOperationsSignals.Category category) { return signals.snapshot(COMMIT).categories().get(category.name()).count(); }
    private static MockHttpServletRequest request(String method, String path) { return new MockHttpServletRequest(method, path); }
}
