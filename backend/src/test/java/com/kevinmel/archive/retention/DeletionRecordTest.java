package com.kevinmel.archive.retention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class DeletionRecordTest {
    private static final UUID MEMORY = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static final UUID CONTRIBUTION = UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    private static final UUID ASSET = UUID.fromString("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    private static final String KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private static final Instant DEADLINE = Instant.parse("2026-10-09T12:00:00.123456Z");

    @Test void contentFreeRecordsRoundTripBothTextAndPhotoWithoutExportingCapabilities() {
        for (UUID asset : new UUID[] { null, ASSET }) {
            var record = record(asset);
            byte[] encoded = record.encode();
            assertThat(encoded.length).isLessThan(DeletionRecord.MAX_BYTES);
            assertThat(DeletionRecord.decode(encoded)).isEqualTo(record);
            assertThat(new String(encoded, StandardCharsets.UTF_8))
                    .contains("\"version\":1", "\"eventKey\":\"kevin-mel-wedding\"", "\"submissionKeyDigest\"")
                    .doesNotContain(KEY, "idempotencyKey", "guestName", "textContent", "caption", "originalFilename", "originals/", "staging/");
            assertThat(record.toString()).isEqualTo("DeletionRecord[memoryId=" + MEMORY + "]")
                    .doesNotContain(CONTRIBUTION.toString(), KEY, record.submissionKeyDigest());
        }
    }

    @Test void exactSchemaRejectsCoercionExtraFieldsDuplicatesTrailingTokensAndNoncanonicalIds() {
        String valid = new String(record(ASSET).encode(), StandardCharsets.UTF_8);
        var invalid = List.of(
                valid.replace("\"version\":1", "\"version\":\"1\""),
                valid.replace("\"version\":1", "\"version\":1.0"),
                valid.replace("\"version\":1", "\"version\":4294967297"),
                valid.replace("\"version\":1", "\"version\":1,\"version\":1"),
                valid + " {}",
                valid.substring(0, valid.length() - 1) + ",\"caption\":\"private\"}",
                valid.replace("\"assetId\":\"" + ASSET + "\",", ""),
                valid.replace(MEMORY.toString(), MEMORY.toString().toUpperCase(Locale.ROOT)),
                valid.replace(MEMORY.toString(), "b-b-4b-8b-b"),
                valid.replace("\"assetId\":\"" + ASSET + "\"", "\"assetId\":false"),
                valid.replace("kevin-mel-wedding", "other-event"),
                valid.replace(record(ASSET).submissionKeyDigest(), "A".repeat(64)),
                valid.replace("\"deleteAfter\":\"" + DEADLINE + "\"", "\"deleteAfter\":123"),
                valid.replace("\"recordedAt\":\"" + DEADLINE + "\"", "\"recordedAt\":\"2026-10-08T12:00:00Z\""),
                "[]", "null", "{", "{\"private\":\"synthetic secret\"}");
        for (String bytes : invalid) {
            assertThatThrownBy(() -> DeletionRecord.decode(bytes.getBytes(StandardCharsets.UTF_8)))
                    .as(bytes).isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("Invalid deletion record.").hasNoCause();
        }
    }

    @Test void payloadLimitIsBytesAndAllowsWhitespaceOnlyWithinTheBound() {
        byte[] valid = record(null).encode();
        byte[] atLimit = (new String(valid, StandardCharsets.UTF_8) + " ".repeat(DeletionRecord.MAX_BYTES - valid.length))
                .getBytes(StandardCharsets.UTF_8);
        assertThat(DeletionRecord.decode(atLimit)).isEqualTo(record(null));
        for (byte[] invalid : new byte[][] { null, new byte[0], new byte[DeletionRecord.MAX_BYTES + 1] }) {
            assertThatThrownBy(() -> DeletionRecord.decode(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void invalidIdentityOrImpossibleDeletionTimeCannotCreateEvidence() {
        assertThatThrownBy(() -> new DeletionRecord(null, CONTRIBUTION, null, SubmissionKeyDigest.sha256(KEY), DEADLINE, DEADLINE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DeletionRecord(MEMORY, null, null, SubmissionKeyDigest.sha256(KEY), DEADLINE, DEADLINE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DeletionRecord(MEMORY, CONTRIBUTION, null, KEY, DEADLINE, DEADLINE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new DeletionRecord(MEMORY, CONTRIBUTION, null, SubmissionKeyDigest.sha256(KEY), DEADLINE, DEADLINE.minusNanos(1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void randomCapabilitiesHaveOneCanonicalDigestWhileLegacyReservationsRemainExact() {
        assertThat(SubmissionKeyDigest.sha256(KEY))
                .isEqualTo("303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e");
        assertThat(SubmissionKeyDigest.sha256(KEY.toUpperCase(Locale.ROOT))).isEqualTo(SubmissionKeyDigest.sha256(KEY));
        assertThat(SubmissionKeyDigest.sha256("Legacy-reserved-key")).matches("[0-9a-f]{64}")
                .isNotEqualTo(SubmissionKeyDigest.sha256("legacy-reserved-key"))
                .isNotEqualTo(SubmissionKeyDigest.sha256(" Legacy-reserved-key"));
        for (String invalid : new String[] { null, "", " \t\n" }) {
            assertThatThrownBy(() -> SubmissionKeyDigest.sha256(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void ledgerPagesCopyRecordsAndHideCursorAndDigestFromDiagnostics() {
        var records = new ArrayList<>(List.of(record(null)));
        var page = new DeletionStorage.Page(records, "private-continuation-fixture");
        records.clear();
        assertThat(page.records()).containsExactly(record(null));
        assertThatThrownBy(() -> page.records().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThat(page.toString()).isEqualTo("DeletionPage[count=1]");
    }

    private static DeletionRecord record(UUID asset) {
        return new DeletionRecord(MEMORY, CONTRIBUTION, asset, SubmissionKeyDigest.sha256(KEY), DEADLINE, DEADLINE);
    }
}
