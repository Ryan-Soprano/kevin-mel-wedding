package com.kevinmel.archive.album;

import java.util.UUID;
import com.kevinmel.archive.web.ApiException;

public record AlbumQuery(int limit, AlbumCursor cursor) {
    public static AlbumQuery from(String suppliedLimit, String cursor, UUID albumId) {
        int limit = 20;
        if (suppliedLimit != null) {
            if (!suppliedLimit.matches("[0-9]{1,3}")) throw invalid();
            limit = Integer.parseInt(suppliedLimit);
        }
        if (limit < 1 || limit > 50) throw invalid();
        return new AlbumQuery(limit, cursor == null ? null : AlbumCursor.decode(cursor, albumId));
    }
    private static ApiException invalid() { return new ApiException(400, "VALIDATION_FAILED", "Use an album page size between 1 and 50."); }
}
