package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.security.SecureRandom;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class AccountPasswordPolicyTest {
    @Test void unicodePolicyCountsCodePointsAndRejectsEncoderTruncationAndMalformedUnicode() {
        for (String valid : new String[] {"a".repeat(8), "a".repeat(72), "😀".repeat(8), "😀".repeat(18), "é".repeat(36)}) {
            assertThatCode(() -> AccountPasswordService.validateNewPassword(valid)).doesNotThrowAnyException();
        }
        for (String invalid : new String[] {"a".repeat(7), "a".repeat(73), "😀".repeat(7), "😀".repeat(19),
                "é".repeat(37), "valid-synthetic-\ud800", "valid-synthetic-\udc00", "valid-synthetic-\0"}) {
            assertThatThrownBy(() -> AccountPasswordService.validateNewPassword(invalid)).isInstanceOf(ApiException.class);
        }
    }
    @Test void generatedTemporaryPasswordsHaveThePolicyLengthAndUseSecureRandomBoundedAlphabet() {
        char[] first = AccountAdministration.temporaryPassword(new SecureRandom());
        char[] second = AccountAdministration.temporaryPassword(new SecureRandom());
        try {
            assertThat(first.length).isEqualTo(32);
            assertThat(second.length).isEqualTo(32);
            assertThat(java.util.Arrays.equals(first, second)).isFalse();
            for (char c : first) assertThat("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_").contains(String.valueOf(c));
            assertThatCode(() -> AccountPasswordService.validateNewPassword(new String(first))).doesNotThrowAnyException();
        } finally { java.util.Arrays.fill(first, '\0'); java.util.Arrays.fill(second, '\0'); }
    }
}
