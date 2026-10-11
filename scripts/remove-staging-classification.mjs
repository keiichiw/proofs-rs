// One-time staging cleanup; no old-format support is added to the application.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const migration = "0008_remove_claim_classification.sql";
export function assertStaging(config) {
  if (
    config.name !== "proofs-rs-staging" ||
    config.vars?.ENVIRONMENT !== "staging" ||
    config.d1_databases?.find((x) => x.binding === "DB")?.database_name !==
      "proofs-rs-staging-reports-v1" ||
    config.r2_buckets?.find((x) => x.binding === "ARCHIVE")?.bucket_name !==
      "proofs-rs-staging-reports-v1"
  )
    throw Error("Only the existing staging resources may be cleaned");
}
export function cleanupSQL(schemaChange) {
  return `
INSERT INTO maintenance(id) VALUES(1);
CREATE TABLE classification_cleanup_reports AS SELECT DISTINCT report_id AS id FROM claims;
CREATE TABLE classification_cleanup_runs AS SELECT id FROM verification_runs;
CREATE TABLE classification_cleanup_events AS
 SELECT id FROM outbox_events WHERE aggregate_id IN
 (SELECT id FROM report_comments WHERE report_id IN (SELECT id FROM classification_cleanup_reports));
DELETE FROM email_delivery_events WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE event_id IN (SELECT id FROM classification_cleanup_events));
DELETE FROM email_deliveries WHERE event_id IN (SELECT id FROM classification_cleanup_events);
DELETE FROM outbox_events WHERE id IN (SELECT id FROM classification_cleanup_events);
DELETE FROM report_comment_votes WHERE comment_id IN (SELECT id FROM report_comments WHERE report_id IN (SELECT id FROM classification_cleanup_reports));
DELETE FROM report_comment_history WHERE comment_id IN (SELECT id FROM report_comments WHERE report_id IN (SELECT id FROM classification_cleanup_reports));
DELETE FROM idempotency_keys WHERE operation IN (SELECT 'comment:' || id FROM classification_cleanup_reports);
DELETE FROM report_comments WHERE report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM claim_stars WHERE claim_id IN (SELECT id FROM claims WHERE report_id IN (SELECT id FROM classification_cleanup_reports));
DELETE FROM report_stars WHERE report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM report_dependencies WHERE report_id IN (SELECT id FROM classification_cleanup_reports) OR evidence_report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM report_runs WHERE report_id IN (SELECT id FROM classification_cleanup_reports) OR run_id IN (SELECT id FROM classification_cleanup_runs);
DELETE FROM claim_revisions WHERE report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM claims WHERE report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM report_revisions WHERE report_id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM idempotency_keys WHERE (operation='report' AND resource_id IN (SELECT CAST(id AS TEXT) FROM classification_cleanup_reports)) OR operation IN (SELECT 'report_revision:' || id FROM classification_cleanup_reports);
DELETE FROM reports WHERE id IN (SELECT id FROM classification_cleanup_reports);
DELETE FROM run_dependencies WHERE run_id IN (SELECT id FROM classification_cleanup_runs);
DELETE FROM verification_runs WHERE id IN (SELECT id FROM classification_cleanup_runs);
${schemaChange}
INSERT INTO d1_migrations(name) VALUES('${migration}');
DROP TABLE classification_cleanup_events;
DROP TABLE classification_cleanup_runs;
DROP TABLE classification_cleanup_reports;
DELETE FROM maintenance WHERE id=1;
`;
}
async function main(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assertStaging(config);
  const database = config.d1_databases.find((x) => x.binding === "DB");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw Error("Cloudflare credentials missing");
  async function query(sql) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database.database_id}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql }),
      },
    );
    const body = await response.json();
    if (!response.ok || !body.success || body.result.some((x) => !x.success))
      throw Error("Staging cleanup D1 query failed");
    return body.result;
  }
  const [applied] = await query(
    `SELECT name FROM d1_migrations WHERE name='${migration}'`,
  );
  if (applied.results.length) {
    console.log("Staging classification cleanup already applied");
    return;
  }
  const [counts, runs] = await query(
    "SELECT COUNT(DISTINCT report_id) reports,COUNT(*) claims FROM claims; SELECT id,r2_key FROM verification_runs;",
  );
  console.log(
    `Removing affected staging data: ${counts.results[0].reports} reports, ${counts.results[0].claims} claims, ${runs.results.length} recorded runs`,
  );
  const schemaChange = await readFile(
    new URL(`../migrations/${migration}`, import.meta.url),
    "utf8",
  );
  await query(cleanupSQL(schemaChange));
  // Delete only the objects whose old-format registrations were removed.
  const bucket = config.r2_buckets.find(
    (x) => x.binding === "ARCHIVE",
  ).bucket_name;
  for (const run of runs.results)
    execFileSync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "delete",
        `${bucket}/${run.r2_key}`,
        "--remote",
        "--config",
        configPath,
      ],
      { stdio: "inherit" },
    );
  const [foreignKeys] = await query("PRAGMA foreign_key_check");
  if (foreignKeys.results.length)
    throw Error("Staging foreign key check failed");
  console.log("Affected staging data removed; unrelated tables retained");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main(process.argv[2]);
