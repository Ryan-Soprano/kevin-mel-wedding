package com.kevinmel.archive.portable;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
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
import java.nio.file.attribute.UserPrincipal;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

/** A process-lifetime exclusive lock, not a persistent job identity. Never adopts an old directory. */
public final class OwnedExportDirectory implements AutoCloseable {
    private static final String PREFIX="kevin-mel-export-", MARKER="owner.lock", MAGIC="kevin-mel-portable-directory-v1\n";
    private static final String UUID_PATTERN="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
    private static final int MAX_SCAN=256, MAX_MARKER_BYTES=128;
    private final Path path;
    private final UserPrincipal owner;
    private final Deleter cleaner;
    private FileChannel channel;
    private FileLock lock;
    private boolean tailPending;
    private OwnedExportDirectory(Path path,UserPrincipal owner,FileChannel channel,FileLock lock,Deleter cleaner) {
        this.path=path;this.owner=owner;this.channel=channel;this.lock=lock;this.cleaner=cleaner;
    }
    public Path path() { return path; }

    /** Reaping first refuses new allocation if a fully validated orphan cannot be removed. */
    public static OwnedExportDirectory create(Path parent) {
        return create(parent,Files::deleteIfExists);
    }
    static OwnedExportDirectory create(Path parent,Deleter cleaner) {
        reapAbandoned(parent,cleaner);
        Path directory=null; FileChannel channel=null; FileLock lock=null;
        try {
            Path root=checkedParent(parent); UserPrincipal owner=currentOwner(root);
            UUID id=UUID.randomUUID(); directory=root.resolve(PREFIX+id);
            if(Files.getFileAttributeView(root,PosixFileAttributeView.class)!=null)
                Files.createDirectory(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            else Files.createDirectory(directory);
            privatePath(directory,owner,true,true);
            Path marker=directory.resolve(MARKER);
            if(Files.getFileAttributeView(directory,PosixFileAttributeView.class)!=null)
                Files.createFile(marker,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            else Files.createFile(marker);
            privatePath(marker,owner,false,true);
            channel=FileChannel.open(marker,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
            lock=channel.tryLock(); if(lock==null) throw new IOException();
            ByteBuffer bytes=ByteBuffer.wrap((MAGIC+id+"\n").getBytes(StandardCharsets.UTF_8));
            while(bytes.hasRemaining()) channel.write(bytes); channel.force(true);
            return new OwnedExportDirectory(directory,owner,channel,lock,cleaner);
        } catch(IOException|RuntimeException failure) {
            release(lock,channel);
            if(directory!=null) {
                try { Files.deleteIfExists(directory.resolve(MARKER)); Files.deleteIfExists(directory); }
                catch(IOException ignored) { /* An incomplete, unmarked directory is not adopted or swept. */ }
            }
            throw new PortableExportException();
        }
    }

    /** Bounded scan; only a completely reviewed directory with an obtainable exclusive lock can be reclaimed. */
    public static int reapAbandoned(Path parent) {
        return reapAbandoned(parent,Files::deleteIfExists);
    }
    static int reapAbandoned(Path parent,Deleter cleaner) {
        try {
            Path root=checkedParent(parent); UserPrincipal owner=currentOwner(root); int seen=0,reaped=0;
            try(var entries=Files.newDirectoryStream(root,PREFIX+"*")) {
                for(Path path:entries) {
                    if(++seen>MAX_SCAN) break;
                    String name=path.getFileName().toString();
                    if(!name.matches(PREFIX+UUID_PATTERN)) continue;
                    FileChannel channel=null; FileLock lock=null; List<Path> files; boolean reviewed=false;
                    try {
                        privatePath(path,owner,true,false); Path marker=path.resolve(MARKER); privatePath(marker,owner,false,false);
                        channel=FileChannel.open(marker,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
                        try { lock=channel.tryLock(); } catch(OverlappingFileLockException live) { continue; }
                        if(lock==null) continue;
                        files=review(path,owner,channel); reviewed=true;
                    } catch(IOException|PortableExportException suspicious) { continue; }
                    finally {
                        // Keep the claim through deletion; rejected/live candidates release their handles here.
                        if(!reviewed) { release(lock,channel); channel=null; }
                    }
                    try {
                        for(Path file:files) cleaner.delete(file);
                    } catch(IOException cleanupFailure) { throw new PortableExportException(); }
                    finally { release(lock,channel); }
                    cleaner.delete(path.resolve(MARKER)); cleaner.delete(path); reaped++;
                }
            }
            return reaped;
        } catch(IOException exception) { throw new PortableExportException(); }
    }

    /** Retains the exclusive lock on deletion failure so current cleanup can be retried safely. */
    @Override public synchronized void close() {
        if(channel==null) { if(tailPending) finishTail(); return; }
        try {
            var files=review(path,owner,channel);
            for(Path file:files) cleaner.delete(file);
            tailPending=true;
            release();
            finishTail();
        } catch(IOException exception) { throw new PortableExportException(); }
    }
    private void finishTail() {
        FileChannel claimed=null; FileLock claim=null;
        try {
            if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS)) { tailPending=false; return; }
            privatePath(path,owner,true,false); Path marker=path.resolve(MARKER);
            if(Files.exists(marker,LinkOption.NOFOLLOW_LINKS)) {
                privatePath(marker,owner,false,false);
                claimed=FileChannel.open(marker,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
                claim=claimed.tryLock(); if(claim==null || !review(path,owner,claimed).isEmpty()) throw new IOException();
                release(claim,claimed); claim=null;claimed=null;
                cleaner.delete(marker);
            }
            cleaner.delete(path); tailPending=false;
        } catch(IOException|OverlappingFileLockException exception) { throw new PortableExportException(); }
        finally { release(claim,claimed); }
    }
    /** Final failed shutdown/crash simulation: leaves files private, unlocked, and eligible for a later validated sweep. */
    public synchronized void release() {
        release(lock,channel); lock=null;channel=null;
    }
    private static List<Path> review(Path path,UserPrincipal owner,FileChannel channel) throws IOException {
        privatePath(path,owner,true,false); Path marker=path.resolve(MARKER); privatePath(marker,owner,false,false);
        String id=path.getFileName().toString().substring(PREFIX.length());
        if(channel.size()<1 || channel.size()>MAX_MARKER_BYTES) throw new IOException();
        ByteBuffer bytes=ByteBuffer.allocate(MAX_MARKER_BYTES+1); channel.position(0);
        while(bytes.hasRemaining() && channel.read(bytes)>0) { }
        String contents=new String(bytes.array(),0,bytes.position(),StandardCharsets.UTF_8);
        if(!contents.equals(MAGIC+id+"\n")) throw new IOException();
        var files=new java.util.ArrayList<Path>(); int count=0;
        try(var entries=Files.newDirectoryStream(path)) {
            for(Path file:entries) {
                if(++count>2) throw new IOException();
                String name=file.getFileName().toString();
                if(name.equals(MARKER)) continue;
                if(!name.matches(UUID_PATTERN+"\\.zip")) throw new IOException();
                privatePath(file,owner,false,false);
                if(Files.size(file)>PortablePartWriter.MAX_ARTIFACT_BYTES) throw new IOException();
                files.add(file);
            }
        }
        return List.copyOf(files);
    }
    private static Path checkedParent(Path parent) throws IOException {
        Path root=parent.toAbsolutePath().normalize();
        if(!Files.isDirectory(root,LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(root)) throw new IOException(); return root;
    }
    private static UserPrincipal currentOwner(Path root) throws IOException {
        if(Files.getFileAttributeView(root,PosixFileAttributeView.class)!=null) return accessPrincipal(root);
        // Verify the Windows token's actual creation owner rather than guessing a potentially ambiguous account name.
        Path probe=Files.createTempFile(root,"portable-empty-owner-probe-",".tmp");
        try {
            var actual=Files.getOwner(probe,LinkOption.NOFOLLOW_LINKS);
            var acl=Files.getFileAttributeView(probe,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS); if(acl==null) throw new IOException();
            acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(actual).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
            if(acl.getAcl().stream().anyMatch(entry->entry.type()==AclEntryType.ALLOW&&!entry.principal().equals(actual))) throw new IOException();
            return actual;
        } finally { Files.deleteIfExists(probe); }
    }
    private static UserPrincipal accessPrincipal(Path path) throws IOException { return path.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByName(System.getProperty("user.name")); }
    private static void privatePath(Path path,UserPrincipal owner,boolean directory,boolean establish) throws IOException {
        if(Files.isSymbolicLink(path) || (directory?!Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS):!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))) throw new IOException();
        if(!Files.getOwner(path,LinkOption.NOFOLLOW_LINKS).equals(owner)) throw new IOException();
        var posix=Files.getFileAttributeView(path,PosixFileAttributeView.class,LinkOption.NOFOLLOW_LINKS);
        if(posix!=null) {
            var permissions=PosixFilePermissions.fromString(directory?"rwx------":"rw-------");
            if(establish) posix.setPermissions(permissions);
            if(!posix.readAttributes().permissions().equals(permissions)) throw new IOException(); return;
        }
        var acl=Files.getFileAttributeView(path,AclFileAttributeView.class,LinkOption.NOFOLLOW_LINKS); if(acl==null) throw new IOException();
        if(establish) acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(owner).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
        if(acl.getAcl().stream().anyMatch(entry->entry.type()==AclEntryType.ALLOW&&!entry.principal().equals(owner))) throw new IOException();
    }
    @FunctionalInterface interface Deleter { void delete(Path path) throws IOException; }
    private static void release(FileLock lock,FileChannel channel) {
        try { if(lock!=null&&lock.isValid()) lock.release(); } catch(IOException ignored) { }
        try { if(channel!=null) channel.close(); } catch(IOException ignored) { }
    }
}
