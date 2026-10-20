package com.kevinmel.archive.portable;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.kevinmel.archive.web.ApiException;

final class ExportRequest {
    private ExportRequest() {
    }

    static UUID id(UUID id) {
        if (id == null || id.version() != 4 || id.variant() != 2) {
            throw invalid();
        }
        return id;
    }

    static UUID attempt(String value) {
        if (value == null
                || !value.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            throw invalid();
        }
        return UUID.fromString(value);
    }
    static void createCondition(String value) {
        if (value == null) {
            throw new ApiException(428, "PRECONDITION_REQUIRED", "Supply the export creation condition.");
        }
        if (!"*".equals(value)) {
            throw invalid();
        }
    }

    static void parameters(
            Map<String, String[]> actual,
            Set<String> allowed) {
        if (!allowed.containsAll(actual.keySet()) || actual.values().stream().anyMatch(v -> v.length != 1)) {
            throw invalid();
        }
    }

    static int limit(String raw) {
        if (raw == null) {
            return 20;
        }
        if (!raw.matches("[0-9]{1,2}")) {
            throw invalid();
        }
        int size = Integer.parseInt(raw);
        if (size < 1 || size > 50) {
            throw invalid();
        }
        return size;
    }

    static int offset(
            String cursor,
            UUID job,
            String kind,
            int count) {
        if (cursor == null) {
            return 0;
        }
        try {
            if (cursor.length() > 128) {
                throw invalid();
            }
            byte[] bytes = Base64.getUrlDecoder().decode(cursor);
            if (!Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).equals(cursor)) {
                throw invalid();
            }
            String[] fields = new String(bytes, StandardCharsets.UTF_8).split("\\|", -1);
            if (fields.length != 4
                    || !"1".equals(fields[0])
                    || !job.toString().equals(fields[1])
                    || !kind.equals(fields[2])
                    || !fields[3].matches("[1-9][0-9]{0,5}")) {
                throw invalid();
            }
            int offset = Integer.parseInt(fields[3]);
            if (offset > count) {
                throw invalid();
            }
            return offset;
        } catch (RuntimeException failure) {
            throw new ApiException(400, "INVALID_CURSOR", "Use the next page from this export.");
        }
    }

    static String cursor(
            UUID job,
            String kind,
            int offset) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(("1|" + job + "|" + kind + "|" + offset).getBytes(StandardCharsets.UTF_8));
    }

    static ApiException invalid() {
        return new ApiException(400, "VALIDATION_FAILED", "Use a valid export identity, part and request.");
    }

    static ApiException missing() {
        return new ApiException(404, "EXPORT_NOT_FOUND", "This temporary export is unavailable. Start a new export deliberately.");
    }

    static ApiException busy() {
        return new ApiException(409, "EXPORT_BUSY", "An export is preparing or downloading. Check progress before trying again.", 2);
    }

    static ApiException unavailable() {
        return new ApiException(410, "EXPORT_UNAVAILABLE", "This temporary export has ended. Start a new export deliberately.");
    }

    static ApiException notCached() {
        return new ApiException(409, "EXPORT_PART_UNAVAILABLE", "Read current export progress and prepare this part deliberately.");
    }
}
