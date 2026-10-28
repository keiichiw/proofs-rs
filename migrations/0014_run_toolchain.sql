-- A projection of validated immutable SARIF for revision-scoped list displays.
-- Historical Runs remain unchanged; missing provenance means unrecorded.
ALTER TABLE verification_runs ADD COLUMN toolchain_json TEXT;
