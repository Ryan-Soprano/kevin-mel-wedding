package com.kevinmel.archive.library;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/** Only opaque identities and a one-way filter binding are included, never private search text or dates. */
public record LibraryCursor(String scope,String fingerprint,UUID anchorId,UUID tagId,UUID revision) {
    public static String fingerprint(String... fields) {
        try {
            var hash=MessageDigest.getInstance("SHA-256");
            for(String field:fields) {
                if(field==null) hash.update((byte)0);
                else { hash.update((byte)1); byte[] bytes=field.getBytes(StandardCharsets.UTF_8);
                    hash.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.length).array()); hash.update(bytes); }
            }
            return HexFormat.of().formatHex(hash.digest());
        } catch(java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable."); }
    }
    public String encode() {
        String value="MEMBERS".equals(scope) ? "1|MEMBERS|"+tagId+"|"+revision+"|"+anchorId : "1|"+scope+"|"+fingerprint+"|"+anchorId;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
    public static LibraryCursor decode(String raw,String scope,String fingerprint,UUID tag) {
        try {
            if(raw==null || raw.length()>256 || !raw.matches("[A-Za-z0-9_-]+")) throw LibraryRequest.cursor();
            String[] parts=new String(Base64.getUrlDecoder().decode(raw),StandardCharsets.UTF_8).split("\\|",-1);
            LibraryCursor result;
            if("MEMBERS".equals(scope)) {
                if(parts.length!=5 || !parts[0].equals("1") || !parts[1].equals(scope)) throw LibraryRequest.cursor();
                UUID id=canonical(parts[2],true), revision=canonical(parts[3],true), anchor=canonical(parts[4],false);
                if(!id.equals(tag)) throw LibraryRequest.cursor(); result=new LibraryCursor(scope,null,anchor,id,revision);
            } else {
                if(parts.length!=4 || !parts[0].equals("1") || !parts[1].equals(scope) || !parts[2].equals(fingerprint)) throw LibraryRequest.cursor();
                result=new LibraryCursor(scope,fingerprint,canonical(parts[3],!"LIBRARY".equals(scope)),null,null);
            }
            if(!raw.equals(result.encode())) throw LibraryRequest.cursor(); return result;
        } catch(IllegalArgumentException invalid) { throw LibraryRequest.cursor(); }
    }
    private static UUID canonical(String raw,boolean v4) {
        UUID id=UUID.fromString(raw);
        if(!id.toString().equals(raw) || v4 && (id.version()!=4 || id.variant()!=2)) throw LibraryRequest.cursor(); return id;
    }
    @Override public String toString() { return "LibraryCursor[scope="+scope+"]"; }
}
