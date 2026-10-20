import { createViews } from "../src/site-views";
import { pageLayout } from "../web/page-layout";
import { claimTitle } from "../web/claim-title";
import { renderRecordedRun } from "../web/recorded-run";

export interface Snapshot {
  report: any;
  sarif: any;
  warnings: string[];
  server: string;
}
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function previewPage(title: string, content: string, server: string) {
  return pageLayout(
    title,
    content,
    "Local preview",
    null,
    (p) => server + p,
    true,
  );
}
export function renderPreview(
  snapshot: Snapshot,
  path: string,
): { status: number; html: string } {
  // Enrich a copy: a later request must not inherit changes to a prior snapshot.
  const report = structuredClone(snapshot.report);
  // Publication trims editorial strings before persisting them.
  const trimFields = (value: any, fields: string[]) => {
    for (const field of fields)
      if (typeof value[field] === "string") value[field] = value[field].trim();
  };
  const prose = [
    "title",
    "explanation",
    "trusted_assumptions",
    "limitations",
    "evidence_url",
  ];
  trimFields(report, [...prose, "environment"]);
  for (const claim of report.claims)
    trimFields(claim, [...prose, "precondition"]);
  report.claims = report.claims.map((claim: any) => ({
    ...claim,
    title: claimTitle(
      claim.title ?? "",
      claim.display_path,
      report.tool,
      report.tool_version,
    ),
    tool: report.tool,
    tool_version: report.tool_version,
    tool_version_id: report.tool_version_id,
    tool_limitations: report.tool_limitations,
    tool_limitations_updated_at: report.tool_limitations_updated_at,
    shared_trusted_assumptions: report.trusted_assumptions,
    shared_limitations: report.limitations,
  }));
  const claimHref = (id: string) => `/claim/${encodeURIComponent(id)}`;
  const views = createViews(
    { user: null },
    { show_star_karma: false },
    () => "",
    {
      preview: true,
      external: (p) => snapshot.server + p,
      claim: claimHref,
    },
  );
  const warnings = snapshot.warnings.length
    ? `<aside aria-label="Preview warnings"><h2>Preview warnings</h2><ul>${snapshot.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></aside>`
    : "";
  const runId = report.run_ids[0];
  const run = (logs: boolean) =>
    renderRecordedRun(
      snapshot.sarif,
      runId,
      0,
      { ...report, id: report.id ?? "preview" },
      logs,
      {
        claim: claimHref,
        sarif: `/api/v1/runs/${encodeURIComponent(runId)}/sarif`,
        logs: `/runs/${encodeURIComponent(runId)}#logs`,
      },
    );
  let title = report.title;
  let status = 200;
  let body: string;
  if (path === "/" || path === "/report") {
    const revision =
      report.id == null
        ? "New report"
        : `Draft revision of report #${esc(report.id)} (based on v${esc(report.base_revision)})`;
    body = `${views.reportContent(report)}<p class="meta">${esc(report.crate)} ${esc(report.version)} · ${revision}</p>${views.reportBody(report, run(true))}<p><a href="/runs/${encodeURIComponent(runId)}#logs">Open recorded run</a></p>${views.reportAPIs(report)}`;
  } else if (path.startsWith("/claim/")) {
    const claim = report.claims.find((c: any) => claimHref(c.id) === path);
    if (claim) {
      title = claim.title;
      body = `<p><a href="/report">← ${esc(report.title)}</a></p>${views.claimContent(claim)}`;
    } else {
      status = 404;
      body =
        '<h1>Claim not found</h1><p>This claim is not in the current draft. <a href="/report">Return to report</a></p>';
    }
  } else if (path === `/runs/${encodeURIComponent(runId)}`) {
    title = "Recorded run";
    body = `<p><a href="/report">← ${esc(report.title)}</a></p><h1>Recorded run</h1>${run(true)}`;
  } else {
    status = 404;
    body =
      '<h1>Page not found</h1><p><a href="/report">Return to report</a></p>';
  }
  return { status, html: previewPage(title, warnings + body, snapshot.server) };
}
