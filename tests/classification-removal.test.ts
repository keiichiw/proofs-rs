import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  assertStaging,
  cleanupSQL,
  migration,
} from "../scripts/remove-staging-classification.mjs";

const read = (name: string) =>
  readFileSync(new URL("../" + name, import.meta.url), "utf8");
test("staging cleanup is scoped to affected reports, their dependents and old runs", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    new URL("../migrations/", import.meta.url),
  ).sort())
    db.exec(read("migrations/" + file));
  db.exec(read("fixtures/staging-demo.sql"));
  // Reintroduce only the obsolete column to exercise the one-time cleanup.
  db.exec(
    "ALTER TABLE claims ADD COLUMN property TEXT NOT NULL DEFAULT 'fixture'; CREATE TABLE d1_migrations(name TEXT UNIQUE); INSERT INTO reports(id,create_key,release_id,author_id,created_at,updated_at) SELECT 9000,'unaffected-empty-report',release_id,author_id,created_at,updated_at FROM reports LIMIT 1;",
  );
  db.exec(
    "INSERT INTO idempotency_keys SELECT author_id,'report_revision:'||id,'revision-key','hash','1',created_at FROM reports WHERE id<>9000 LIMIT 1; INSERT INTO idempotency_keys SELECT author_id,'report','keep-key','hash','9000',created_at FROM reports WHERE id=9000;",
  );
  const retained = [
    "users",
    "notification_preferences",
    "crates",
    "releases",
    "api_items",
    "api_item_metadata",
    "tools",
    "tool_versions",
    "audit_events",
  ];
  const before = retained.map((table) =>
    db.prepare(`SELECT * FROM ${table}`).all(),
  );
  db.exec("BEGIN");
  db.exec(cleanupSQL(read("migrations/" + migration)));
  db.exec("COMMIT");
  assert.deepEqual(
    retained.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
    before,
  );
  assert.deepEqual(
    db
      .prepare("SELECT id FROM reports")
      .all()
      .map((r) => r.id),
    [9000],
  );
  for (const table of [
    "claims",
    "claim_revisions",
    "report_revisions",
    "claim_stars",
    "report_stars",
    "report_comments",
    "report_comment_history",
    "report_comment_votes",
    "verification_runs",
    "report_runs",
    "maintenance",
  ])
    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,
      0,
      table,
    );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM idempotency_keys").get()!.n,
    1,
  );
  assert.equal(
    db.prepare("SELECT key FROM idempotency_keys").get()!.key,
    "keep-key",
  );
  assert.equal(
    db.prepare("SELECT name FROM d1_migrations").get()!.name,
    migration,
  );
  assert(
    !db
      .prepare("PRAGMA table_info(claims)")
      .all()
      .some((c) => c.name === "property"),
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.exec(read("fixtures/staging-demo.sql"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
test("cleanup refuses production and unexpected resource bindings", () => {
  const config = JSON.parse(read("wrangler.json"));
  assert.doesNotThrow(() => assertStaging(config));
  for (const mutate of [
    (c: any) => {
      c.vars.ENVIRONMENT = "production";
    },
    (c: any) => {
      c.name = "proofs-rs";
    },
    (c: any) => {
      c.d1_databases[0].database_name = "production";
    },
    (c: any) => {
      c.r2_buckets[0].bucket_name = "production";
    },
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(() => assertStaging(changed), /Only the existing staging/);
  }
});
