package com.kevinmel.archive.portable;

/** Fixed, content-free failure; never includes database/provider errors or local paths. */
public final class PortableExportException extends RuntimeException {
    public PortableExportException() {
        super("The portable archive could not be prepared within its safety limits.");
    }
}
