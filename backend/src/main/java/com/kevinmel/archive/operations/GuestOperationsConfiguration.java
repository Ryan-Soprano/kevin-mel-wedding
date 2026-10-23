package com.kevinmel.archive.operations;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import tools.jackson.databind.ObjectMapper;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class GuestOperationsConfiguration {
    @Bean
    FilterRegistrationBean<GuestOperationsFilter> guestOperationsObserver(GuestOperationsSignals signals) {
        var registration = new FilterRegistrationBean<>(new GuestOperationsFilter(signals));
        // Security/staging admission first; bounded anonymous admission and MVC run inside this observer.
        registration.setOrder(-95);
        registration.addUrlPatterns("/*");
        return registration;
    }

    @Configuration
    @EnableScheduling
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnProperty(name = "archive.operations.signals-enabled", havingValue = "true")
    static class Publication {
        private final PrivateWriter writer;

        Publication(GuestOperationsSignals signals, ObjectMapper mapper,
                @Value("${RENDER_GIT_COMMIT:}") String commit) throws IOException {
            writer = new PrivateWriter(Path.of("/home/archive/.operations"), signals, mapper, commit);
        }

        @Scheduled(fixedDelay = 30_000, initialDelay = 0)
        void publish() {
            // A failed write leaves the old timestamp. The independent reader must alert on stale/missing data.
            try { writer.publish(); } catch (IOException | RuntimeException failure) { /* Never log private diagnostics. */ }
        }
    }

    static final class PrivateWriter {
        private final Path directory;
        private final GuestOperationsSignals signals;
        private final ObjectMapper mapper;
        private final String commit;

        PrivateWriter(Path directory, GuestOperationsSignals signals, ObjectMapper mapper, String commit) throws IOException {
            if (!commit.matches("[0-9a-f]{40}")) throw new IllegalArgumentException("Operational signal release is unconfirmed.");
            this.directory = directory.toAbsolutePath().normalize();
            this.signals = signals;
            this.mapper = mapper;
            this.commit = commit;
            requirePrivateDirectory();
        }

        private void requirePrivateDirectory() throws IOException {
            for (Path part = directory; part != null; part = part.getParent()) {
                if (Files.isSymbolicLink(part)) throw new IOException("Operational signal directory is unconfirmed.");
            }
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                    || !Files.getPosixFilePermissions(directory, LinkOption.NOFOLLOW_LINKS)
                            .equals(PosixFilePermissions.fromString("rwx------"))) {
                throw new IOException("Operational signal directory is unconfirmed.");
            }
            var current = directory.getFileSystem().getUserPrincipalLookupService()
                    .lookupPrincipalByName(System.getProperty("user.name"));
            if (!current.equals(Files.getOwner(directory, LinkOption.NOFOLLOW_LINKS))) {
                throw new IOException("Operational signal owner is unconfirmed.");
            }
        }

        void publish() throws IOException {
            requirePrivateDirectory();
            Path target = directory.resolve("guest-signals.json");
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)
                    && (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)
                        || !Files.getPosixFilePermissions(target, LinkOption.NOFOLLOW_LINKS)
                                .equals(PosixFilePermissions.fromString("rw-------"))
                        || !Files.getOwner(target, LinkOption.NOFOLLOW_LINKS)
                                .equals(Files.getOwner(directory, LinkOption.NOFOLLOW_LINKS)))) {
                throw new IOException("Operational signal target is unconfirmed.");
            }
            byte[] bytes = mapper.writeValueAsBytes(signals.snapshot(commit));
            if (bytes.length > 4096) throw new IOException("Operational signal size is unconfirmed.");
            Path temporary = Files.createTempFile(directory, ".signals-", ".tmp",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            try {
                Files.write(temporary, bytes);
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally {
                Files.deleteIfExists(temporary);
            }
        }
    }
}
