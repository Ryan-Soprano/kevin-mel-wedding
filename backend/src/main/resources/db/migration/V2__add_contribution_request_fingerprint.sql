-- V1 remains immutable. Record the original normalized creation payload identity.
ALTER TABLE contribution ADD COLUMN request_fingerprint VARCHAR(64);
ALTER TABLE contribution ADD CONSTRAINT contribution_request_fingerprint_valid
    CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');

-- Preserve rows/keys. Backfill only unambiguous single-text envelopes.
-- Other legacy keys stay reserved with NULL fingerprints; creation cannot reuse them.
WITH whitespace AS (
    SELECT U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' AS chars
), legacy_text AS (
    SELECT c.id, c.event_key, NULLIF(btrim(c.guest_name, w.chars), '') AS guest_name,
           btrim(m.text_content, w.chars) AS message
    FROM contribution c JOIN memory m ON m.contribution_id = c.id CROSS JOIN whitespace w
    WHERE m.memory_type = 'TEXT'
      AND (SELECT count(*) FROM memory sibling WHERE sibling.contribution_id = c.id) = 1
)
UPDATE contribution c SET request_fingerprint = encode(sha256(convert_to(jsonb_build_object(
    'eventKey', t.event_key, 'memoryType', 'TEXT', 'guestName', t.guest_name, 'message', t.message
)::text, 'UTF8')), 'hex')
FROM legacy_text t WHERE c.id = t.id;
