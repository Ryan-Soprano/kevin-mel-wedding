package com.kevinmel.archive.recovery;

/** Deliberately excludes filenames, content, capabilities, SQL and provider errors. */
public final class RecoveryException extends IllegalStateException {
    private final String code;
    RecoveryException(String code) {
        super("Archive recovery could not be confirmed (" + code + "). Keep traffic stopped.");
        this.code = code;
    }
    public String code() { return code; }
}
