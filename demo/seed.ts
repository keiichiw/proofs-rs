import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import type { Env } from "../src/core";
import { CATALOG_EXTRACTOR_VERSION } from "../src/imports";
import { DEMO_SEED_VERSION, demoIDs as ids, demoUsers } from "./scenarios";

const date = "2026-09-21T12:00:00.000Z";
const version = `${DEMO_SEED_VERSION}:catalog-${CATALOG_EXTRACTOR_VERSION}`;
const file = (name: string) =>
  readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const quote = (value: unknown): string =>
  value == null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table: string, row: Record<string, unknown>) =>
  `INSERT OR IGNORE INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.values(row).map(quote).join(",")})`;

async function seedRepositoryFixtures(env: Pick<Env, "DB" | "ARCHIVE">) {
  const crates = (
    await env.DB.prepare("SELECT name FROM crates").all<{ name: string }>()
  ).results;
  for (const crate of crates) {
    await env.ARCHIVE.put(
      `local-demo/github/issue-templates/example/${crate.name}.json`,
      JSON.stringify({ hasTemplates: false }),
    );
    await env.ARCHIVE.put(
      `local-demo/crates.io/repositories/${encodeURIComponent(crate.name)}.json`,
      JSON.stringify({
        name: crate.name,
        repository: `https://github.com/example/${crate.name}`,
      }),
      { httpMetadata: { contentType: "application/json" } },
    );
  }
}

/** Uses real local D1/R2 bindings. Ready seeds are never reapplied over edits. */
export async function seedDemo(
  env: Pick<Env, "DB" | "ARCHIVE" | "TERMS_VERSION">,
) {
  const current = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='local_demo_seed'",
  ).first<{ value: string }>();
  if (current && ![version, `pending:${version}`].includes(current.value))
    throw new Error(
      "Demo fixture version changed. Run npm run demo:reset to rebuild the demo data.",
    );
  if (current?.value === version) {
    await seedRepositoryFixtures(env);
    return false;
  }
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings(key,value) VALUES('local_demo_seed',?)",
  )
    .bind(`pending:${version}`)
    .run();

  const sql = [
    ...splitSqlQuery(await file("staging-demo.sql")),
    ...splitSqlQuery(await file("staging-pagination.sql")),
  ];
  const add = (table: string, row: Record<string, unknown>) =>
    sql.push(insert(table, row));
  add("crates", {
    id: 900001,
    name: "findings-demo",
    description: "Synthetic UI examples. No verification was performed.",
  });
  add("releases", {
    id: 900001,
    crate_id: 900001,
    version: "1.0.0-demo.1",
    created_at: date,
  });
  add("crates", {
    id: 900002,
    name: "empty-demo",
    description: "Synthetic empty state.",
  });
  add("releases", {
    id: 900002,
    crate_id: 900002,
    version: "1.0.0-demo.1",
    created_at: date,
  });
  add("reports", {
    id: 900003,
    create_key: "local-demo-empty",
    release_id: 900002,
    author_id: demoUsers.author.id,
    created_at: date,
    updated_at: date,
  });
  add("report_revisions", {
    report_id: 900003,
    revision_no: 1,
    title: "Synthetic empty scope",
    explanation: "Empty UI states; no claims, findings or verification.",
    trusted_assumptions: "",
    tool_version_id: "73a0c890-b685-579c-9dd9-f8accc1fb5dd",
    environment: "",
    evidence_url: "",
    limitations: "Synthetic fixture.",
    created_at: date,
  });
  const apis = [
    [ids.claimOnlyAPI, "findings_demo::Buffer::len", "method", null, "Buffer"],
    [
      ids.findingOnlyAPI,
      "findings_demo::Reader::read_signed",
      "trait",
      "findings_demo::Reader",
      null,
    ],
    [
      ids.bothAPI,
      "findings_demo::Reader::take",
      "trait",
      "findings_demo::Reader",
      null,
    ],
  ] as const;
  for (const [id, path, category, trait, self] of apis) {
    add("api_items", {
      id,
      release_id: 900001,
      canonical_key: `demo:${path}`,
      display_path: path,
      kind: "method",
      is_unsafe: 0,
      signature: `fn ${path.split("::").at(-1)}(&self) /* synthetic */`,
      upstream_url: "https://example.com/synthetic-crate",
    });
    add("api_item_metadata", {
      api_item_id: id,
      category,
      trait_path: trait,
      self_type: self,
      method_name: path.split("::").at(-1),
      is_blanket: 0,
    });
  }
  for (const report of [ids.report, ids.findingOnlyReport]) {
    add("reports", {
      id: report,
      create_key: `local-demo-${report}`,
      release_id: 900001,
      author_id: demoUsers.author.id,
      created_at: date,
      updated_at: date,
    });
    for (const rev of report === ids.report ? [1, 2] : [1]) {
      add("report_revisions", {
        report_id: report,
        revision_no: rev,
        title:
          report === ids.report
            ? `Synthetic reader contracts and findings${rev === 1 ? " — initial revision" : ""}`
            : "Synthetic finding-only report",
        explanation:
          "Synthetic UI fixture. No verification was performed.\n\n" +
          "This paragraph exercises longer report explanations and Markdown rendering.\n\n".repeat(
            report === ids.report ? 12 : 1,
          ),
        trusted_assumptions: "Illustrative models only.",
        tool_version_id: "73a0c890-b685-579c-9dd9-f8accc1fb5dd",
        environment: "Local demo; no compiler or verifier was run.",
        evidence_url: "",
        limitations: "Not a real proof or bug report.",
        created_at: date,
      });
    }
  }
  for (const [index, api] of [ids.claimOnlyAPI, ids.bothAPI].entries()) {
    const claim =
      index === 0 ? ids.claim : "d0000000-0000-4000-8000-000000000007";
    add("claims", {
      id: claim,
      report_id: ids.report,
      api_item_id: api,
      created_at: date,
    });
    for (const rev of [1, 2])
      add("claim_revisions", {
        claim_id: claim,
        report_id: ids.report,
        report_revision: rev,
        position: index,
        title: index ? "Synthetic take contract" : "Synthetic length contract",
        precondition: "Synthetic valid input",
        explanation: "A display example; no theorem was checked.",
        trusted_assumptions: "",
        evidence_url: "",
        limitations: "No proof was run.",
      });
  }
  for (const [id, report, title, status, api] of [
    [
      ids.openFinding,
      ids.report,
      "Synthetic boundary failure while attempting a proof",
      "not_reported",
      ids.bothAPI,
    ],
    [
      ids.fixedFinding,
      ids.findingOnlyReport,
      "Synthetic signed-read issue fixed upstream",
      "released",
      ids.findingOnlyAPI,
    ],
  ] as const) {
    const body =
      "## Observation\n\nSynthetic example: an attempted proof leaves an obligation open.\n\n## Reproduction\n\n```rust\n// Demonstration only; no proof or native test was run.\n```\n\n## Scope\n\nThis is a UI fixture, not an actual verification result.";
    add("findings", {
      id,
      report_id: report,
      origin_revision_no: 1,
      title,
      body,
      validity: id === ids.fixedFinding ? "confirmed" : "reported",
      upstream_status: status,
      created_at: date,
      updated_at: date,
    });
    add("finding_apis", { finding_id: id, api_item_id: api });
    add("finding_events", {
      id: `${id}-created`,
      finding_id: id,
      edit_version: 1,
      actor_id: demoUsers.author.id,
      action: "created",
      payload: JSON.stringify({
        title,
        body,
        api_item_ids: [api],
        validity: id === ids.fixedFinding ? "confirmed" : "reported",
        upstream_status: status,
      }),
      created_at: date,
    });
  }
  for (const [kind, suffix] of [
    ["issue", "issues/1"],
    ["pr", "pull/2"],
    ["release", "releases/tag/v1.0.1"],
  ])
    add("finding_links", {
      id: `${ids.fixedFinding}-${kind}`,
      finding_id: ids.fixedFinding,
      kind,
      url: `https://github.com/example/synthetic-crate/${suffix}`,
      version: kind === "release" ? "1.0.1" : null,
      created_at: date,
    });
  for (let i = 1; i <= 55; i++)
    add("report_comments", {
      id: `local-demo-comment-${i}`,
      report_id: ids.report,
      sequence_no: i,
      revision_no: 2,
      author_id: i % 2 ? demoUsers.other.id : demoUsers.author.id,
      body: `Synthetic discussion comment ${i}. No verification was performed.`,
      created_at: date,
    });

  for (let i = 0; i < sql.length; i += 50)
    await env.DB.batch(sql.slice(i, i + 50).map((s) => env.DB.prepare(s)));
  await env.DB.prepare(
    "UPDATE users SET accepted_terms_version=? WHERE github_id BETWEEN -91004 AND -91001",
  )
    .bind(env.TERMS_VERSION)
    .run();

  // Synthetic snapshots are explicitly labelled. Current versions keep editing
  // existing reports from scheduling an external catalog import.
  const releases = (
    await env.DB.prepare(
      "SELECT r.id,c.name,r.version FROM releases r JOIN crates c ON c.id=r.crate_id",
    ).all<{ id: number; name: string; version: string }>()
  ).results;
  for (const release of releases) {
    const key = `local-demo/catalog/${release.id}.json`;
    const data = JSON.stringify({
      synthetic: true,
      message: "UI fixture only; not an extracted Rust catalog.",
    });
    await env.ARCHIVE.put(key, data);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO doc_snapshots(release_id,rustdoc_format,source_url,source_hash,r2_key,imported_at) VALUES(?,61,?,?,?,?)",
    )
      .bind(
        release.id,
        "https://example.com/synthetic-catalog",
        createHash("sha256").update(data).digest("hex"),
        key,
        date,
      )
      .run();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO catalog_versions(release_id,extractor_version) VALUES(?,?)",
    )
      .bind(release.id, CATALOG_EXTRACTOR_VERSION)
      .run();
    const dependencies =
      release.name === "findings-demo"
        ? [
            {
              crate: "pagination-demo",
              requirement: "=1.0.0-demo.1",
              kind: "normal",
              optional: false,
              target: null,
              reports: [],
            },
          ]
        : [];
    await env.ARCHIVE.put(
      `cache/crates.io/dependencies/${encodeURIComponent(release.name)}/${encodeURIComponent(release.version)}.json`,
      JSON.stringify(dependencies),
    );
  }
  const keys: string[] = JSON.parse(await file("layout-runs.json"));
  for (const [i, key] of keys.entries())
    await env.ARCHIVE.put(key, await file(`layout-run-${i}.sarif.json`), {
      httpMetadata: { contentType: "application/json" },
    });
  const dependency = await env.DB.prepare(
    "SELECT id FROM reports WHERE create_key='staging-pagination-v1-0'",
  ).first<{ id: number }>();
  if (!dependency) throw new Error("Missing dependency report fixture");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO report_dependencies(report_id,revision_no,crate,version,evidence_report_id,evidence_revision_no) VALUES(?,2,'pagination-demo','1.0.0-demo.1',?,1)",
  )
    .bind(ids.report, dependency.id)
    .run();
  const violations = await env.DB.prepare("PRAGMA foreign_key_check").all();
  if (violations.results.length)
    throw new Error("Demo fixture has foreign key violations");
  await seedRepositoryFixtures(env);
  await env.DB.prepare(
    "UPDATE settings SET value=? WHERE key='local_demo_seed'",
  )
    .bind(version)
    .run();
  return true;
}
