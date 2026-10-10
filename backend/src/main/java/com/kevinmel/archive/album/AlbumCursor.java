package com.kevinmel.archive.album;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;
import com.kevinmel.archive.web.ApiException;

/** Private ordering position, never an access capability. */
public record AlbumCursor(Instant createdAt, UUID albumId, UUID revision, Long position) {
    public static AlbumCursor listing(Instant createdAt, UUID id) { return new AlbumCursor(createdAt, id, null, null); }
    public static AlbumCursor members(UUID id, UUID revision, long position) { return new AlbumCursor(null, id, revision, position); }
    public String encode() {
        String raw = revision == null ? "1|ALBUMS|" + createdAt + "|" + albumId : "1|MEMBERS|" + albumId + "|" + revision + "|" + position;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }
    public static AlbumCursor decode(String encoded, UUID expectedAlbum) {
        if (encoded == null || encoded.isEmpty() || encoded.length() > 256 || !encoded.matches("[A-Za-z0-9_-]+")) throw invalid();
        try {
            String[] values = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8).split("\\|", -1);
            AlbumCursor cursor;
            if (expectedAlbum == null) {
                if (values.length != 4 || !"1".equals(values[0]) || !"ALBUMS".equals(values[1])) throw invalid();
                Instant at = Instant.parse(values[2]); int year = at.atOffset(ZoneOffset.UTC).getYear();
                if (year < 1 || year > 9999 || at.getNano() % 1000 != 0) throw invalid();
                cursor = listing(at, uuid(values[3]));
            } else {
                if (values.length != 5 || !"1".equals(values[0]) || !"MEMBERS".equals(values[1])
                        || !expectedAlbum.equals(uuid(values[2])) || !values[4].matches("[1-9][0-9]{0,18}")) throw invalid();
                long position = Long.parseLong(values[4]);
                cursor = members(expectedAlbum, uuid(values[3]), position);
            }
            if (!cursor.encode().equals(encoded)) throw invalid();
            return cursor;
        } catch (IllegalArgumentException | java.time.DateTimeException malformed) { throw invalid(); }
    }
    private static UUID uuid(String raw) {
        UUID value = UUID.fromString(raw);
        if (value.version() != 4 || value.variant() != 2 || !value.toString().equals(raw)) throw invalid();
        return value;
    }
    private static ApiException invalid() { return new ApiException(400, "INVALID_CURSOR", "Reload this album page before trying again."); }
    @Override public String toString() { return "AlbumCursor[position=<redacted>]"; }
}
