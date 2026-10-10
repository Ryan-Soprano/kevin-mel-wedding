package com.kevinmel.archive.portable;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

class OwnedExportDirectoryTest {
    @TempDir Path temporary;

    @Test void exclusiveLifetimeLockPreservesAnotherLiveInstanceAndEveryOwnedPathHasPrivatePermissions() throws Exception {
        try(var first=OwnedExportDirectory.create(temporary);var second=OwnedExportDirectory.create(temporary)) {
            Path original=zip(first.path()); privatePermissions(first.path(),true); privatePermissions(first.path().resolve("owner.lock"),false); privatePermissions(original,false);
            assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isZero();
            assertThat(Files.readString(original)).isEqualTo("synthetic private bytes"); assertThat(first.path()).exists(); assertThat(second.path()).exists();
        }
        try(var children=Files.list(temporary)) { assertThat(children.toList()).isEmpty(); }
    }

    @Test void crashReleasedLockReclaimsOnlyItsReviewedOrphanAndNewInstanceNeverAdoptsOldDirectory() throws Exception {
        var crashed=OwnedExportDirectory.create(temporary); Path path=crashed.path(), original=zip(path); crashed.release();
        assertThat(original).exists(); assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isEqualTo(1);
        assertThat(path).doesNotExist();
        try(var fresh=OwnedExportDirectory.create(temporary)) { assertThat(fresh.path()).isNotEqualTo(path); privatePermissions(fresh.path(),true); }
    }

    @Test void unexpectedFilesMalformedOrOversizedMarkerAndUnrecognizedDirectoryNamesArePreservedAndRejectedLocksAreReleased() throws Exception {
        var unexpected=OwnedExportDirectory.create(temporary); Files.writeString(unexpected.path().resolve("unrecognized.txt"),"synthetic unknown file"); unexpected.release();
        var malformed=OwnedExportDirectory.create(temporary); malformed.release(); Files.writeString(malformed.path().resolve("owner.lock"),"invalid-format-marker");
        var oversized=OwnedExportDirectory.create(temporary); oversized.release(); Files.writeString(oversized.path().resolve("owner.lock"),"x".repeat(129));
        Path unknown=Files.createDirectory(temporary.resolve("kevin-mel-export-unrecognized")); Files.writeString(unknown.resolve("keep.txt"),"keep");
        assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isZero();
        for(Path path:List.of(unexpected.path(),malformed.path(),oversized.path())) {
            assertThat(path).exists();
            try(var channel=FileChannel.open(path.resolve("owner.lock"),StandardOpenOption.READ,StandardOpenOption.WRITE);var lock=channel.tryLock()) { assertThat(lock).isNotNull(); }
        }
        assertThat(Files.readString(unknown.resolve("keep.txt"))).isEqualTo("keep");
    }

    @Test void weakerDirectoryOrArtifactPermissionsCannotBeClaimedAsOwned() throws Exception {
        var weakDirectory=OwnedExportDirectory.create(temporary); weaken(weakDirectory.path(),true); weakDirectory.release();
        var weakFile=OwnedExportDirectory.create(temporary); Path original=zip(weakFile.path()); weaken(original,false); weakFile.release();
        assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isZero(); assertThat(weakDirectory.path()).exists(); assertThat(original).exists();
    }

    @Test @EnabledOnOs(OS.LINUX)
    void symlinkedArtifactsAreNeverFollowedAndOutsideBytesRemainUntouched() throws Exception {
        Path outside=temporary.resolve("outside.txt"); Files.writeString(outside,"outside synthetic marker");
        var orphan=OwnedExportDirectory.create(temporary); Path link=orphan.path().resolve(UUID.randomUUID()+".zip"); Files.createSymbolicLink(link,outside); orphan.release();
        assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isZero(); assertThat(Files.isSymbolicLink(link)).isTrue();
        assertThat(Files.readString(outside)).isEqualTo("outside synthetic marker");
    }

    @Test void failedValidatedOrphanCleanupRefusesNewAllocationAndNextSuccessfulSweepCanRetryWithoutLostOwnership() throws Exception {
        var orphan=OwnedExportDirectory.create(temporary); Path original=zip(orphan.path()); orphan.release();
        assertThatThrownBy(()->OwnedExportDirectory.create(temporary,path->{ if(path.equals(original)) throw new IOException("synthetic cleanup failure"); Files.deleteIfExists(path); })).isInstanceOf(PortableExportException.class);
        assertThat(original).exists();
        try(var children=Files.list(temporary)) { assertThat(children.toList()).containsExactly(orphan.path()); }
        try(var fresh=OwnedExportDirectory.create(temporary)) { assertThat(orphan.path()).doesNotExist(); assertThat(fresh.path()).exists(); }
    }

    @Test void currentCleanupFailureKeepsItsLockAndPostReleaseMarkerFailureStillAllowsAnExplicitCloseRetry() throws Exception {
        var fail=new java.util.concurrent.atomic.AtomicBoolean(true);
        var active=OwnedExportDirectory.create(temporary,path->{ if(path.getFileName().toString().endsWith(".zip")&&fail.get()) throw new IOException("synthetic cleanup failure"); Files.deleteIfExists(path); });
        Path original=zip(active.path());
        assertThatThrownBy(active::close).isInstanceOf(PortableExportException.class);
        assertThat(OwnedExportDirectory.reapAbandoned(temporary)).isZero(); assertThat(original).exists();
        fail.set(false); active.close(); assertThat(active.path()).doesNotExist();
        fail.set(true);
        var tail=OwnedExportDirectory.create(temporary,path->{ if(path.getFileName().toString().equals("owner.lock")&&fail.getAndSet(false)) throw new IOException("synthetic marker cleanup failure"); Files.deleteIfExists(path); });
        assertThatThrownBy(tail::close).isInstanceOf(PortableExportException.class); assertThat(tail.path()).exists();
        tail.close(); assertThat(tail.path()).doesNotExist();
    }

    private static Path zip(Path directory) throws Exception {
        Path path=directory.resolve(UUID.randomUUID()+".zip");
        if(Files.getFileAttributeView(directory,PosixFileAttributeView.class)!=null) Files.createFile(path,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        else { Files.createFile(path); var acl=Files.getFileAttributeView(path,AclFileAttributeView.class);
            acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(acl.getOwner()).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build())); }
        Files.writeString(path,"synthetic private bytes"); return path;
    }
    private static void privatePermissions(Path path,boolean directory) throws Exception {
        assertThat(Files.isSymbolicLink(path)).isFalse();
        var posix=Files.getFileAttributeView(path,PosixFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(posix!=null) assertThat(posix.readAttributes().permissions()).isEqualTo(PosixFilePermissions.fromString(directory?"rwx------":"rw-------"));
        else { var acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS); var owner=acl.getOwner();
            assertThat(acl.getAcl()).allMatch(entry->entry.type()!=AclEntryType.ALLOW||entry.principal().equals(owner)); }
    }
    private static void weaken(Path path,boolean directory) throws Exception {
        var posix=Files.getFileAttributeView(path,PosixFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(posix!=null) posix.setPermissions(PosixFilePermissions.fromString(directory?"rwxr-xr-x":"rw-r--r--"));
        else { var acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS); var entries=new java.util.ArrayList<>(acl.getAcl());
            var everyone=path.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByName("Everyone");
            entries.add(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(everyone).setPermissions(AclEntryPermission.READ_DATA).build()); acl.setAcl(entries); }
    }
}
