import { renderMarkdown } from "../src/markdown";
import type { DraftSnapshot } from "./render";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const section = (title: string, value: unknown) =>
  value
    ? `<section class="report-section"><h2>${esc(title)}</h2><div class="markdown-body">${renderMarkdown(String(value).trim(), 2)}</div></section>`
    : "";
const mappingHref = (id: string) => `/claim/${encodeURIComponent(id)}`;
export const draftBanner =
  '<aside role="status"><strong>Unverified draft</strong><p>Configuration only. No verification run, theorem audit, API signature lookup or evidence is included.</p></aside>';

/** Render configured intent only; this path never consumes recorded evidence. */
export function renderDraftPreview(snapshot: DraftSnapshot, path: string) {
  const report = snapshot.report;
  const mappings: any[] = report.mappings;
  const findings: any[] = report.findings ?? [];
  const context = () =>
    section("What is trusted", report.trusted_assumptions) +
    section("Technical limitations", report.limitations);
  const finding = (f: any, i: number, compact = false) =>
    `<article class="finding" id="finding-draft-${i + 1}"><h3><a href="/finding/draft-${i + 1}">${esc(f.title.trim())}</a></h3><p class="meta">Local Finding draft · Not submitted</p>${f.api_paths?.length ? `<p>Configured APIs: ${f.api_paths.map((api: string) => `<code>${esc(api.trim())}</code>`).join(", ")}</p>` : ""}${compact ? "" : `<div class="markdown-body">${renderMarkdown(f.body.trim(), 3)}</div>`}</article>`;
  let title = report.title.trim();
  let status = 200;
  let content: string;
  if (path === "/" || path === "/report") {
    const rows = mappings
      .map(
        (m, i) =>
          `<tr><td><a href="${mappingHref(m.id)}">Mapping #${i + 1}</a><br><code>${esc(m.api)}</code></td><td><code>${esc(m.module)}</code><br><code>${esc(m.theorem)}</code></td><td class="plain-text code">${esc(m.precondition || "None stated in configuration")}</td></tr>`,
      )
      .join("");
    content = `<h1>${esc(title)}</h1><p class="meta">${esc(report.crate)} ${esc(report.version)}</p><p class="report-tool">Configured tool: ${esc(report.tool)} ${esc(report.tool_version)}</p>${section("Overview", report.explanation)}${findings.length ? `<section class="report-section"><h2>Findings (${findings.length})</h2>${findings.map((f, i) => finding(f, i, true)).join("")}</section>` : ""}${context()}${section("Environment", report.environment)}<section class="report-section"><h2>Configured proof mappings (${mappings.length})</h2>${rows ? `<table><thead><tr><th>API</th><th>Module / theorem</th><th>Configured precondition</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No API-to-theorem mappings are configured. This draft displays report text only.</p>"}</section>`;
  } else if (path.startsWith("/claim/")) {
    const i = mappings.findIndex((m) => mappingHref(m.id) === path);
    if (i >= 0) {
      const m = mappings[i];
      title = `Configured proof mapping #${i + 1}`;
      content = `<p><a href="/report">← ${esc(report.title)}</a></p><h1>${esc(title)}</h1><dl><dt>API</dt><dd><code>${esc(m.api)}</code></dd><dt>Module</dt><dd><code>${esc(m.module)}</code></dd><dt>Theorem</dt><dd><code>${esc(m.theorem)}</code></dd></dl><section class="report-section"><h2>Configured precondition</h2><p class="plain-text code">${esc(m.precondition || "None stated in configuration")}</p></section>${context()}`;
    } else {
      status = 404;
      content =
        '<h1>Mapping not found</h1><a href="/report">Return to draft</a>';
    }
  } else if (path.startsWith("/finding/")) {
    const i = findings.findIndex((_, i) => `/finding/draft-${i + 1}` === path);
    if (i >= 0) {
      title = findings[i].title.trim();
      content = `<p><a href="/report">← ${esc(report.title)}</a></p>${finding(findings[i], i)}`;
    } else {
      status = 404;
      content =
        '<h1>Finding not found</h1><a href="/report">Return to draft</a>';
    }
  } else {
    status = 404;
    content = '<h1>Page not found</h1><a href="/report">Return to draft</a>';
  }
  return { title, status, body: draftBanner + content };
}
