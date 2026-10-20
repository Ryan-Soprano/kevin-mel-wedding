package com.kevinmel.archive.library;

import java.util.UUID;

public record TagQuery(int limit, String q, UUID memoryId, String fingerprint, LibraryCursor cursor) {
    public static TagQuery listing(String limit, String cursor, String suppliedQ, UUID memory) {
        String q = LibraryRequest.query(suppliedQ), scope = memory == null ? "TAGS" : "ATTACHED";
        String binding = LibraryCursor.fingerprint(q, memory == null ? null : memory.toString());
        return new TagQuery(LibraryRequest.limit(limit), q, memory, binding,
                cursor == null ? null : LibraryCursor.decode(cursor, scope, binding, null));
    }

    public static TagQuery members(UUID tag, String limit, String cursor) {
        return new TagQuery(LibraryRequest.limit(limit), null, null, null,
                cursor == null ? null : LibraryCursor.decode(cursor, "MEMBERS", null, tag));
    }

    @Override
    public String toString() {
        return "TagQuery[limit=" + limit + "]";
    }
}
