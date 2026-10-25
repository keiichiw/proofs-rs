CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  origin_revision_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  actual_behavior TEXT NOT NULL,
  reproduction_steps TEXT NOT NULL,
  evidence_url TEXT,
  validity TEXT NOT NULL DEFAULT 'reported' CHECK(validity IN ('reported','confirmed','disputed','invalid','duplicate')),
  upstream_status TEXT NOT NULL DEFAULT 'not_reported' CHECK(upstream_status IN ('not_reported','reported_upstream','fix_proposed','fix_merged','released','wont_fix')),
  duplicate_of TEXT REFERENCES findings(id),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((validity='duplicate') = (duplicate_of IS NOT NULL)),
  CHECK(duplicate_of IS NULL OR duplicate_of<>id),
  FOREIGN KEY(report_id,origin_revision_no) REFERENCES report_revisions(report_id,revision_no)
);
CREATE TABLE finding_apis (
  finding_id TEXT NOT NULL REFERENCES findings(id),
  api_item_id TEXT NOT NULL REFERENCES api_items(id),
  PRIMARY KEY(finding_id,api_item_id)
);
CREATE TABLE finding_links (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  kind TEXT NOT NULL CHECK(kind IN ('issue','pr','commit','release','report')),
  url TEXT NOT NULL,
  version TEXT,
  target_report_id INTEGER,
  target_revision_no INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK((kind='release' AND version IS NOT NULL) OR kind<>'release'),
  CHECK((kind='report' AND target_report_id IS NOT NULL AND target_revision_no IS NOT NULL) OR (kind<>'report' AND target_report_id IS NULL AND target_revision_no IS NULL)),
  FOREIGN KEY(target_report_id,target_revision_no) REFERENCES report_revisions(report_id,revision_no)
);
CREATE TABLE finding_events (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  edit_version INTEGER NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('created','edited','link_added','link_deleted')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(finding_id,edit_version)
);
CREATE INDEX finding_report ON findings(report_id,created_at,id);
CREATE INDEX finding_duplicate ON findings(duplicate_of);
CREATE INDEX finding_link ON finding_links(finding_id,deleted_at);
CREATE UNIQUE INDEX finding_live_url ON finding_links(finding_id,url) WHERE deleted_at IS NULL;
CREATE TRIGGER fixed_finding BEFORE UPDATE OF id,report_id,origin_revision_no,created_at ON findings
BEGIN SELECT RAISE(ABORT,'immutable_finding_origin'); END;
CREATE TRIGGER finding_duplicate_cycle BEFORE UPDATE OF duplicate_of ON findings WHEN NEW.duplicate_of IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'constraint_finding_duplicate_cycle') WHERE EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT NEW.duplicate_of UNION SELECT f.duplicate_of FROM findings f JOIN chain c ON f.id=c.id WHERE f.duplicate_of IS NOT NULL
    ) SELECT 1 FROM chain WHERE id=NEW.id
  );
END;
CREATE TRIGGER finding_api_release BEFORE INSERT ON finding_apis WHEN NOT EXISTS (
  SELECT 1 FROM findings f JOIN reports p ON p.id=f.report_id JOIN api_items a ON a.release_id=p.release_id
  WHERE f.id=NEW.finding_id AND a.id=NEW.api_item_id
)
BEGIN SELECT RAISE(ABORT,'constraint_finding_api_release'); END;
CREATE TRIGGER finding_events_update BEFORE UPDATE ON finding_events WHEN NOT EXISTS(SELECT 1 FROM maintenance) AND NOT (
  NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL AND NEW.id=OLD.id AND NEW.finding_id=OLD.finding_id
  AND NEW.edit_version=OLD.edit_version AND NEW.action=OLD.action AND NEW.payload=OLD.payload AND NEW.created_at=OLD.created_at
)
BEGIN SELECT RAISE(ABORT,'immutable_finding_event'); END;
CREATE TRIGGER finding_events_delete BEFORE DELETE ON finding_events WHEN NOT EXISTS(SELECT 1 FROM maintenance)
BEGIN SELECT RAISE(ABORT,'immutable_finding_event'); END;
