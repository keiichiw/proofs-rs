-- Preserve existing findings and their immutable event history while moving
-- author prose to a single Markdown body. Historical events retain their shape.
ALTER TABLE findings ADD COLUMN body TEXT NOT NULL DEFAULT '';
UPDATE findings SET body =
  '## Expected behavior' || char(10) || char(10) || expected_behavior || char(10) || char(10) ||
  '## Actual behavior' || char(10) || char(10) || actual_behavior || char(10) || char(10) ||
  '## Reproduction steps' || char(10) || char(10) || reproduction_steps;
ALTER TABLE findings DROP COLUMN expected_behavior;
ALTER TABLE findings DROP COLUMN actual_behavior;
ALTER TABLE findings DROP COLUMN reproduction_steps;
