-- Applied V1-V8 stay immutable. Audio shares the existing private upload lifecycle.
ALTER TABLE media_asset DROP CONSTRAINT media_expected_size;
ALTER TABLE media_asset ADD CONSTRAINT media_expected_size
    CHECK (expected_byte_size IS NULL OR expected_byte_size BETWEEN 1 AND 25000000);

ALTER TABLE media_asset ADD COLUMN expected_duration_ms BIGINT;
ALTER TABLE media_asset ADD COLUMN audio_duration_ms BIGINT;
ALTER TABLE media_asset ADD COLUMN audio_codec VARCHAR(32);
ALTER TABLE media_asset ADD COLUMN audio_container VARCHAR(32);

ALTER TABLE media_asset ADD CONSTRAINT media_expected_audio_duration
    CHECK (expected_duration_ms IS NULL OR expected_duration_ms BETWEEN 1 AND 120000);
ALTER TABLE media_asset ADD CONSTRAINT media_verified_audio_metadata CHECK (
    (audio_duration_ms IS NULL AND audio_codec IS NULL AND audio_container IS NULL
        AND (expected_duration_ms IS NULL OR upload_state IN ('PENDING', 'FAILED')))
    OR
    (expected_duration_ms IS NOT NULL AND audio_duration_ms BETWEEN 1 AND 120000
        AND audio_duration_ms IS NOT NULL AND audio_codec IS NOT NULL AND audio_container IS NOT NULL
        AND upload_state = 'UPLOADED'
        AND ((detected_format = 'audio/webm' AND audio_container = 'webm' AND audio_codec = 'opus')
            OR (detected_format = 'audio/ogg' AND audio_container = 'ogg' AND audio_codec = 'opus')
            OR (detected_format = 'audio/mp4' AND audio_container = 'mp4' AND audio_codec = 'aac')))
);
