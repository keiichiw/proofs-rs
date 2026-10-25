-- Existing snapshots deliberately have no version until reindexed.
-- Internal extractor version; unrelated to report revisions or crate versions.
CREATE TABLE catalog_versions (
  release_id INTEGER PRIMARY KEY REFERENCES doc_snapshots(release_id) ON DELETE CASCADE,
  extractor_version INTEGER NOT NULL CHECK(extractor_version >= 1)
);
