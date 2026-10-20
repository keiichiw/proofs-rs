-- References belong to immutable claim revisions; statements remain in SARIF.
CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL,
  report_revision INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES verification_runs(id),
  harness TEXT NOT NULL,
  PRIMARY KEY (claim_id, report_revision),
  FOREIGN KEY (claim_id, report_revision) REFERENCES claim_revisions(claim_id, report_revision)
);
