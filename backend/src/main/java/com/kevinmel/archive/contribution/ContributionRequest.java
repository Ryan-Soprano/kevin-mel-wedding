package com.kevinmel.archive.contribution;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiException.FieldError;

public record ContributionRequest(String guestName, String message) {
    /**
     * Validate the raw JSON types/UTF-16 lengths before normalizing its content.
     */
    public static ContributionRequest from(Map<String, Object> body) {
        List<FieldError> errors = new ArrayList<>();
        if (!Set.of("guestName", "message").containsAll(body.keySet())) {
            throw new ApiException(400, "VALIDATION_FAILED", "The request contains unsupported fields.");
        }
        Object name = body.get("guestName");
        Object text = body.get("message");
        if (name != null
                && (!(name instanceof String)
                        || ((String) name).length() > 100
                        || !storable((String) name))) {
            errors.add(new FieldError("guestName", "SIZE", "Your name must be 100 characters or fewer."));
        }
        if (!(text instanceof String)
                || ((String) text).length() > 5000
                || !storable((String) text)) {
            errors.add(new FieldError("message", "INVALID_TEXT", "Write a message between 1 and 5,000 characters."));
        } else if (trim((String) text).isEmpty()) {
            errors.add(new FieldError("message", "NOT_BLANK", "Please write a message before submitting."));
        }
        if (!errors.isEmpty()) {
            throw new ApiException(400, "VALIDATION_FAILED", "Please check the highlighted fields.", errors);
        }
        String normalizedName = name == null ? "" : trim((String) name);
        return new ContributionRequest(
                normalizedName.isEmpty() ? null : normalizedName,
                trim((String) text));
    }

    // ECMAScript String.trim(): Java trim()/strip() each use a different whitespace set.
    public static String trim(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && whitespace(value.charAt(start))) {
            start++;
        }
        while (end > start && whitespace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(start, end);
    }

    public static boolean storable(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == 0 || Character.isLowSurrogate(c)) {
                return false;
            }
            if (Character.isHighSurrogate(c)) {
                if (++i == value.length() || !Character.isLowSurrogate(value.charAt(i))) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean whitespace(char c) {
        return (c >= '\u0009' && c <= '\r') || c == ' ' || c == '\u00a0' || c == '\u1680'
                || (c >= '\u2000' && c <= '\u200a') || c == '\u2028' || c == '\u2029'
                || c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff';
    }
}
