package com.kevinmel.archive.contribution;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.kevinmel.archive.web.ApiException;
import com.kevinmel.archive.web.ApiException.FieldError;

public record ContributionRequest(String guestName, String message) {
    private static final String FIELD_GUEST_NAME = "guestName";
    private static final String FIELD_MESSAGE = "message";
    private static final String SINGLE_TRIM_WHITESPACE = " \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff";

    /**
     * Validate the raw JSON types/UTF-16 lengths before normalizing its content.
     */
    public static ContributionRequest from(Map<String, Object> body) {
        List<FieldError> errors = new ArrayList<>();
        if (!Set.of(FIELD_GUEST_NAME, FIELD_MESSAGE).containsAll(body.keySet())) {
            throw new ApiException(400, "VALIDATION_FAILED", "The request contains unsupported fields.");
        }
        Object name = body.get(FIELD_GUEST_NAME);
        Object text = body.get(FIELD_MESSAGE);
        if (name != null && !validName(name)) {
            errors.add(new FieldError(FIELD_GUEST_NAME, "SIZE", "Your name must be 100 characters or fewer."));
        }
        if (!validMessage(text)) {
            errors.add(new FieldError(FIELD_MESSAGE, "INVALID_TEXT", "Write a message between 1 and 5,000 characters."));
        } else if (trim((String) text).isEmpty()) {
            errors.add(new FieldError(FIELD_MESSAGE, "NOT_BLANK", "Please write a message before submitting."));
        }
        if (!errors.isEmpty()) {
            throw new ApiException(400, "VALIDATION_FAILED", "Please check the highlighted fields.", errors);
        }
        String normalizedName = name == null ? "" : trim((String) name);
        return new ContributionRequest(
                normalizedName.isEmpty() ? null : normalizedName,
                trim((String) text));
    }

    private static boolean validName(Object name) {
        return name instanceof String value && value.length() <= 100 && storable(value);
    }

    private static boolean validMessage(Object text) {
        return text instanceof String value && value.length() <= 5000 && storable(value);
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
        return (c >= '\u0009' && c <= '\r') || (c >= '\u2000' && c <= '\u200a')
                || SINGLE_TRIM_WHITESPACE.indexOf(c) >= 0;
    }
}
