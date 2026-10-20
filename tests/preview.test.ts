import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderPreview, type Snapshot } from "../preview/render";
import { createViews } from "../src/site-views";
import { claimTitle } from "../web/claim-title";
import { renderRecordedRun } from "../web/recorded-run";

function fixture(): Snapshot {
  return {
    server: "https://staging.example",
    warnings: [],
    report: {
      id: null,
      title: "Local report",
      crate: "demo",
      version: "1.0.0",
      explanation: "## Details\n**Overview** <script>alert(1)</script>",
      trusted_assumptions: "Shared trust",
      limitations: "Shared limits",
      environment: "Local environment",
      evidence_url: "https://github.com/demo/repo/tree/abc",
      run_ids: ["run"],
      tool: "Kani",
      tool_version: "1",
      tool_version_id: "kani-1",
      tool_limitations: "Tool limits",
      direct_dependencies: null,
      dependencies: [
        {
          crate: "dep",
          report: 42,
          revision: 2,
          version: "1.0.0",
          withdrawn: true,
        },
      ],
      claims: [
        {
          id: "preview-claim-0",
          api_item_id: "api-f",
          display_path: "demo::f",
          signature: "pub fn f(x: u8)",
          kind: "function",
          is_unsafe: 0,
          claim_number: 1,
          title: "",
          precondition: "x > 0",
          explanation: "**Claim text**",
          evidence_url: "https://github.com/demo/repo/blob/abc/lib.rs#L1",
          trusted_assumptions: "Claim trust",
          limitations: "Claim limits",
        },
      ],
    },
    sarif: {
      runs: [
        {
          invocations: [
            {
              executableLocation: { uri: "cargo" },
              arguments: ["kani"],
              workingDirectory: { uri: "./" },
              executionSuccessful: true,
              exitCode: 0,
              startTimeUtc: "2026-10-18T00:00:00Z",
              endTimeUtc: "2026-10-18T00:00:01Z",
              stdout: { index: 0 },
            },
          ],
          artifacts: [{ contents: { text: "log <script>unsafe</script>" } }],
          versionControlProvenance: [
            {
              repositoryUri: "https://github.com/demo/repo",
              revisionId: "abc",
            },
          ],
          properties: {
            proofs: {
              contracts: [
                {
                  harness: "check_f",
                  api_paths: ["demo::f"],
                  precondition: "x > 0",
                },
              ],
            },
          },
          results: [
            {
              kind: "pass",
              message: { text: "Verified f" },
              properties: { harness: "check_f" },
            },
          ],
        },
      ],
    },
  };
}

test("preview uses production report, claim, Markdown and recorded-run rendering", () => {
  const data = fixture();
  const views = createViews(
    { user: null },
    { show_star_karma: false },
    () => "",
  );
  const preview = new JSDOM(renderPreview(data, "/report").html);
  const production = new JSDOM(views.reportBody(data.report));
  for (const selector of [
    ".report-explanation",
    ".report-limitations",
    ".report-environment",
  ]) {
    assert.equal(
      preview.window.document.querySelector(selector)!.textContent,
      production.window.document.querySelector(selector)!.textContent,
    );
  }
  const claim = {
    ...data.report.claims[0],
    title: claimTitle("", "demo::f", "Kani", "1"),
    tool: "Kani",
    tool_version: "1",
    tool_version_id: "kani-1",
    tool_limitations: "Tool limits",
    shared_trusted_assumptions: "Shared trust",
    shared_limitations: "Shared limits",
  };
  const localClaim = new JSDOM(
    renderPreview(data, "/claim/preview-claim-0").html,
  );
  const liveClaim = new JSDOM(views.claimContent(claim));
  for (const selector of ["h1", ".signature", ".report-explanation"]) {
    assert.equal(
      localClaim.window.document.querySelector(selector)!.innerHTML,
      liveClaim.window.document.querySelector(selector)!.innerHTML,
    );
  }
  assert.deepEqual(
    [...localClaim.window.document.querySelectorAll(".report-section")].map(
      (e) => e.textContent,
    ),
    [...liveClaim.window.document.querySelectorAll(".report-section")].map(
      (e) => e.textContent,
    ),
  );
  const localRun = new JSDOM(renderPreview(data, "/runs/run").html);
  const liveRun = new JSDOM(
    renderRecordedRun(
      data.sarif,
      "run",
      0,
      { ...data.report, id: "preview" },
      true,
    ),
  );
  assert.equal(
    localRun.window.document.querySelector(".recorded-run")!.textContent,
    liveRun.window.document.querySelector(".recorded-run")!.textContent,
  );
  for (const dom of [
    preview,
    production,
    localClaim,
    liveClaim,
    localRun,
    liveRun,
  ])
    dom.window.close();
});

test("preview routes stay local, metadata links use configured origin, and no actions are exposed", () => {
  const data = fixture();
  const dom = new JSDOM(renderPreview(data, "/report").html);
  const d = dom.window.document;
  assert(d.body.textContent.includes("Local preview — not published"));
  assert(d.body.textContent.includes("New report"));
  assert(!d.body.textContent.includes("Report #null"));
  assert(d.querySelector('a[href="/claim/preview-claim-0"]'));
  assert.equal(
    d.querySelector(".api-name")!.getAttribute("href"),
    "/claim/preview-claim-0",
  );
  assert.equal(
    d.querySelector('a[href="https://staging.example/api/api-f"]'),
    null,
  );
  assert.equal(
    renderPreview(data, d.querySelector(".api-name")!.getAttribute("href")!)
      .status,
    200,
  );
  assert(d.querySelector('a[href="https://staging.example/report/42?v=2"]'));
  assert(
    d.querySelector('a[href="https://staging.example/tool-version/kani-1"]'),
  );
  assert(d.querySelector('a[href="/runs/run#logs"]'));
  assert(d.querySelector('a[href="/api/v1/runs/run/sarif"]'));
  assert.equal(d.querySelector("form"), null);
  assert.equal(d.querySelector(".star-controls"), null);
  assert.equal(d.querySelector(".markdown-body script"), null);
  assert.equal(d.querySelector('link[rel="canonical"]'), null);
  data.report.claims[0].api_item_id = "preview-api-0";
  data.warnings.push("API mapping unverified: <f>");
  const missing = new JSDOM(renderPreview(data, "/claim/preview-claim-0").html);
  assert(
    missing.window.document.body.textContent.includes(
      "API mapping unverified: <f>",
    ),
  );
  assert.equal(
    missing.window.document.querySelector('a[href*="/api/preview-api-"]'),
    null,
  );
  assert.equal(renderPreview(data, "/claim/missing").status, 404);
  data.report.id = 12;
  data.report.base_revision = 3;
  assert(
    renderPreview(data, "/report").html.includes(
      "Draft revision of report #12 (based on v3)",
    ),
  );
  assert.equal(data.report.claims[0].title, "");
  dom.window.close();
  missing.window.close();
});
