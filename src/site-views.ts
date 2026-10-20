import { validLeanSegments } from "../web/formal-evidence";
import { renderMarkdown } from "./markdown";
import { renderAPICatalog } from "../web/api-catalog";

export interface ViewOptions {
  external?: (path: string) => string;
  claim?: (id: string, revision: unknown) => string;
  preview?: boolean;
}
type Crumb = { label: string; href: string };
export function createViews(
  me: any,
  config: any,
  action: (
    name: string,
    fields: Record<string, unknown>,
    label: string,
  ) => string,
  options: ViewOptions = {},
) {
  const enc = encodeURIComponent;
  const external = options.external ?? ((path: string) => path);
  const claimHref =
    options.claim ??
    ((id: string, revision: unknown) =>
      `/claim/${enc(id)}?report_revision=${enc(String(revision))}`);
  const apiHref = (id: string) =>
    options.preview && id.startsWith("preview-api-")
      ? null
      : external(`/api/${enc(id)}`);
  const esc = (v: any) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]!,
    );
  const date = (v: string) =>
    v
      ? new Date(v).toISOString().replace("T", " ").replace(".000Z", " UTC")
      : "";
  const user = (id: string, name: string) =>
    id
      ? `<a class="user-link" href="/user/${enc(id)}">${esc(name || "ghost")}</a>`
      : "ghost";
  function claimItem(c: any) {
    return `<article class="claim-item"><a href="/claim/${enc(c.id)}?report_revision=${c.report_revision}">Claim #${esc(c.claim_number)} — ${esc(c.title)}</a><div class="meta"><code>${esc(c.display_path)}</code>${c.is_unsafe ? " · <strong>unsafe</strong>" : ""}${config.show_star_karma ? ` · ${c.star_count} stars` : ""}</div><p class="meta"><a href="/report/${c.report_id}?v=${c.report_revision}">${esc(c.report_title)} · v${c.report_revision}</a>${config.show_star_karma ? ` · ${c.report_star_count} stars` : ""} · <a href="/report/${c.report_id}#discussion">${c.report_comment_count} comments</a> · ${user(c.author_id, c.username)}${config.show_star_karma ? ` · ${c.author_karma} karma` : ""}${!c.in_current_report ? " · Removed from current report" : ""}${c.withdrawn_at ? " · Withdrawn" : ""}</p></article>`;
  }
  function reportSummary(c: any, hideCrate = false) {
    return `<article class="claim-item"><a href="/report/${c.id}">#${c.id} ${esc(c.title)}</a>${c.withdrawn_at ? " · Withdrawn" : ""}<div class="meta">${hideCrate ? "" : `<a href="${crateHref(c.crate, c.version)}">${esc(c.crate)} ${esc(c.version)}</a> · `}${esc(c.tool)} ${esc(c.tool_version)} · ${c.claim_count} claims · ${c.dependency_count ?? 0} reviewed dependencies</div><p class="meta">${user(c.author_id, c.username)}${config.show_star_karma ? ` · ${c.author_karma} karma` : ""}${config.show_star_karma ? ` · ${c.star_count} stars` : ""} · ${c.comment_count} comments · ${date(c.created_at)}</p></article>`;
  }
  function breadcrumbs(items: Crumb[]) {
    return `<div class="breadcrumbs" role="navigation" aria-label="Breadcrumb">${items.map(({ label, href }) => `<a href="${esc(href)}">${esc(label)}</a>`).join(' <span aria-hidden="true">/</span> ')} <span aria-hidden="true">/</span></div>`;
  }
  function crateHref(name: string, version: string) {
    return `/crate/${enc(name)}?version=${enc(version)}`;
  }
  function crateCrumbs(c: any, section: "apis" | "reports"): Crumb[] {
    const href = crateHref(c.crate, c.version);
    return [
      { label: "crates", href: "/crates" },
      { label: `${c.crate} ${c.version}`, href },
      {
        label: section === "apis" ? "APIs" : "reports",
        href: `${href}#${section}`,
      },
    ];
  }
  function claimCrumbs(c: any): Crumb[] {
    return [
      ...crateCrumbs(c, "reports"),
      {
        label: `Report #${c.report_id} v${c.report_revision}`,
        href: `/report/${c.report_id}?v=${c.report_revision}`,
      },
    ];
  }
  function field(label: string, value: any, code = false) {
    return value
      ? `<dt>${label}</dt><dd class="${code ? "code " : ""}preserve">${esc(value)}</dd>`
      : "";
  }
  function evidence(label: string, value: any) {
    return value
      ? `<dt>${label}</dt><dd><a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a></dd>`
      : "";
  }
  function starButton(kind: string, c: any) {
    if (options.preview || !config.show_star_karma) return "";
    const button = me.user
      ? action(
          "star",
          { kind, id: c.id, on: !c.my_star },
          c.my_star ? "★ Starred" : "☆ Star",
        )
      : `<a href="${esc(config.login_url || "/login")}">☆ Star</a>`;
    return (
      '<div class="star-controls">' +
      button +
      ' <a href="/' +
      kind +
      "/" +
      enc(c.id) +
      '/stars">' +
      c.star_count +
      " stars</a></div>"
    );
  }
  function titleWithStars(kind: string, c: any) {
    return `<div class="title-row"><h1>${kind === "report" ? `Report #${esc(c.id)} — ` : `Claim #${esc(c.claim_number)} — `}${esc(c.title)}</h1>${starButton(kind, c)}</div>`;
  }
  function toolLink(c: any) {
    const label = `${esc(c.tool)} ${esc(c.tool_version)}`;
    return c.tool_version_id
      ? `<a href="${esc(external(`/tool-version/${enc(c.tool_version_id)}`))}">${label}</a>`
      : label;
  }
  function toolLimitations(c: any) {
    if (!c.tool_limitations) return "";
    return `<details class="tool-limitations"><summary>Tool limitations</summary><div class="tool-limitations-body"><p class="plain-text">${esc(c.tool_limitations)}</p>${c.tool_limitations_updated_at ? `<p class="meta">Updated ${date(c.tool_limitations_updated_at)}</p>` : ""}<p><a href="${esc(external(`/tool-version/${enc(c.tool_version_id)}`))}">${esc(c.tool)} ${esc(c.tool_version)} — version details</a></p></div></details>`;
  }
  function reportContent(c: any, stars = false) {
    return `${stars ? titleWithStars("report", c) : `<h1>${esc(c.title)}</h1>`}<p class="report-tool">${toolLink(c)}</p>`;
  }
  function reproduceSection(
    runIds: string[],
    environment?: string,
    recorded = "",
  ) {
    return runIds?.length || environment
      ? `<details class="reproduce" id="reproduce"><summary>Reproduce</summary><div class="reproduce-body">${recorded}</div>${environment ? `<details class="report-environment"><summary>Environment</summary><div class="markdown-body">${renderMarkdown(environment, 2)}</div></details>` : ""}</details>`
      : "";
  }
  function reportBody(c: any, recorded = "") {
    return `${c.explanation ? `<section class="report-section report-explanation"><h2>Overview</h2><div class="markdown-body">${renderMarkdown(c.explanation, 2)}</div></section>` : ""}
    ${c.evidence_url || c.run_ids?.length || c.environment ? `<section class="report-section report-evidence"><h2>Evidence</h2>${c.evidence_url ? `<p><a href="${esc(c.evidence_url)}" target="_blank" rel="noopener noreferrer">${esc(c.evidence_url)}</a></p>` : ""}${reproduceSection(c.run_ids, c.environment, recorded)}</section>` : ""}
    ${c.trusted_assumptions ? `<section class="report-section"><h2>What is trusted</h2><div class="markdown-body">${renderMarkdown(c.trusted_assumptions, 2)}</div></section>` : ""}
    ${c.limitations || c.tool_limitations ? `<section class="report-section report-limitations"><h2>Technical limitations</h2>${c.limitations ? `<div class="markdown-body">${renderMarkdown(c.limitations, 2)}</div>` : ""}${toolLimitations(c)}</section>` : ""}
    ${reportDependencies(c)}
    `;
  }
  function reportDependencies(c: any) {
    const dependencies = c.direct_dependencies;
    const reviews = c.dependencies ?? [];
    const reportLink = (r: any) =>
      r.report != null && r.revision != null
        ? `<a href="${esc(external(`/report/${enc(String(r.report))}?v=${enc(String(r.revision))}`))}">Report #${esc(r.report)} · v${esc(r.revision)}</a>${r.reviewed ? " · reviewed" : ""}${r.withdrawn ? " · <strong>Withdrawn</strong>" : ""}`
        : '<span class="muted">—</span>';
    const catalog =
      dependencies == null
        ? '<p class="muted">Unable to load dependencies from crates.io.</p>'
        : dependencies.length
          ? `<div class="catalog-columns"><span>Crate</span><span>Reports</span></div>${dependencies.map((d: any) => `<div class="catalog-row"><span><a href="https://crates.io/crates/${enc(d.crate)}" target="_blank" rel="noopener noreferrer"><code>${esc(d.crate)}</code></a> <code>${esc(d.requirement)}</code>${d.kind !== "normal" ? ` · ${esc(d.kind)}` : ""}${d.optional ? " · optional" : ""}${d.target ? ` · <code>${esc(d.target)}</code>` : ""}</span><span class="api-claim-count${d.reports.length ? "" : " muted"}">${d.reports.length ? d.reports.map((r: any) => `${reportLink(r)} <span class="meta">(${esc(r.version)})</span>`).join("<br>") : "—"}</span></div>`).join("")}`
          : "<p>No direct dependencies.</p>";
    // Reviews may refer to transitive packages or a verification fork. Keep their
    // pinned evidence accessible without adding those packages to the direct list.
    const otherReviews = reviews.filter(
      (r: any) =>
        !dependencies?.some((d: any) =>
          d.reports.some(
            (p: any) =>
              p.reviewed && p.report === r.report && p.revision === r.revision,
          ),
        ),
    );
    return `<section class="report-section report-dependencies"><h2>Dependencies${dependencies == null ? "" : ` (${dependencies.length})`}</h2>${catalog}${otherReviews.length ? `<details class="dependency-reviews"><summary>Other reviewed evidence (${otherReviews.length})</summary><ul>${otherReviews.map((r: any) => `<li><code>${esc(r.crate)} ${esc(r.version)}</code> · ${reportLink(r)}</li>`).join("")}</ul></details>` : ""}</section>`;
  }
  function reportAPIs(c: any) {
    const groups = new Map<string, any[]>();
    for (const claim of c.claims) {
      if (!groups.has(claim.api_item_id)) groups.set(claim.api_item_id, []);
      groups.get(claim.api_item_id)!.push(claim);
    }
    const apis = [...groups].map(([id, claims]) => ({
      ...claims[0],
      id,
      kind:
        claims[0].kind ||
        (claims[0].signature?.startsWith("impl") ? "method" : "function"),
      claim_count: claims.length,
    }));
    return `<section class="report-apis"><h2>Verified APIs (${apis.length})</h2>${renderAPICatalog(
      apis,
      c.crate,
      {
        hideEmpty: true,
        hideCounts: true,
        expandFamilies: true,
        apiHref: (id) => {
          if (!options.preview || id.startsWith("preview-api-"))
            return apiHref(id);
          const claim = groups.get(id)![0];
          return claimHref(claim.id, claim.report_revision);
        },
        details: (api) =>
          `<div class="report-api-claims"><span class="claim-links">${groups
            .get(api.id)!
            .map(
              (claim) =>
                `<a href="${esc(claimHref(claim.id, claim.report_revision))}">Claim #${esc(claim.claim_number)}</a>`,
            )
            .join(", ")}</span></div>`,
      },
    )}</section>`;
  }
  function claimScope(shared: string, individual: string, links = false) {
    const content = (value: string) =>
      links
        ? `<p><a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a></p>`
        : `<div class="markdown-body">${renderMarkdown(value, 2)}</div>`;
    return `${individual ? content(individual) : ""}${shared ? `<details class="claim-report-context"><summary>From the report</summary>${content(shared)}</details>` : ""}`;
  }
  function formalStatement(f: any) {
    const definitions = new Map<string, any>(
      f.definitions.map((d: any) => [d.name, d]),
    );
    const expression = (text: string, parts?: any[]) => {
      if (!validLeanSegments(text, parts)) return esc(text);
      return parts!
        .map((p) => {
          const definition = p.ref ? definitions.get(p.ref) : null;
          return definition?.source_url
            ? `<a href="${esc(definition.source_url)}" title="${esc(p.ref)}">${esc(p.text)}</a>`
            : esc(p.text);
        })
        .join("");
    };
    const roles: Record<string, string> = {
      variable: "for all",
      hypothesis: "assume",
      instance: "instance",
    };
    return `<section class="report-section formal-statement"><h2>Formal statement</h2><p><code>${esc(f.theorem)}</code></p>
      <div class="lean-readable">
        ${f.binders.map((b: any) => `<div class="lean-row"><span class="lean-role">${roles[b.kind]}</span><span class="lean-expression"><span class="lean-binding">${esc(b.name)} :</span> ${expression(b.type, b.type_segments)}</span></div>`).join("")}
        <div class="lean-row lean-conclusion"><span class="lean-role">then</span><span class="lean-expression">${expression(f.conclusion, f.conclusion_segments)}</span></div>
      </div>
      ${[f.conclusion, ...f.binders.map((b: any) => b.type)].some((s: string) => s.includes("↑")) ? '<p class="meta">In Lean notation, ↑ denotes an implicit type conversion (coercion).</p>' : ""}
      ${f.program ? `<h3>Target program</h3><pre><code>${esc(f.program)}</code></pre>` : ""}
      <details><summary>Complete Lean proposition</summary><button type="button" data-copy-formal>Copy proposition</button><span role="status" data-copy-status></span><pre tabindex="0"><code>${esc(f.statement)}</code></pre></details>
      <p><a href="${esc(f.source_url)}">Theorem source at recorded commit</a> · <a href="${esc(f.check_url)}">Recorded check</a></p>
      <details><summary>Referenced definitions (up to 100 direct references)</summary><ul>${f.definitions.map((d: any) => `<li>${d.source_url ? `<a href="${esc(d.source_url)}"><code>${esc(d.name)}</code></a>` : `<code>${esc(d.name)}</code> · ${esc(d.module)}`}</li>`).join("")}</ul>${f.definitions_truncated ? "<p>Reference limit reached; consult the full theorem source.</p>" : ""}</details>
      <p class="meta">Mapping: ${esc(f.mapping)}. Translation was not rerun by this recording.</p></section>`;
  }
  function claimContent(c: any, stars = false) {
    return `${stars ? titleWithStars("claim", c) : `<h1>Claim #${esc(c.claim_number)} — ${esc(c.title)}</h1>`}
    <p>${apiHref(c.api_item_id) ? `<a href="${esc(apiHref(c.api_item_id))}"><code>${esc(c.display_path)}</code></a>` : `<code>${esc(c.display_path)}</code> · API unverified`}${c.is_unsafe ? " · <strong>unsafe</strong>" : ""}</p>
    <pre class="signature">${esc(c.signature)}</pre><p>Tool: ${toolLink(c)}</p>
    <section class="report-section"><h2>Preconditions</h2><p class="plain-text code">${esc(c.precondition || (c.evidence_ref ? "See the formal statement, including input types and instances, for conditions." : "None stated"))}</p></section>
    ${c.formal_evidence ? formalStatement(c.formal_evidence) : ""}
    ${c.explanation ? `<section class="report-section report-explanation"><h2>Overview</h2><div class="markdown-body">${renderMarkdown(c.explanation, 2)}</div></section>` : ""}
    ${c.evidence_url ? `<section class="report-section"><h2>Evidence</h2><p><a href="${esc(c.evidence_url)}" target="_blank" rel="noopener noreferrer">${esc(c.evidence_url)}</a></p></section>` : ""}
    ${c.shared_trusted_assumptions || c.trusted_assumptions ? `<section class="report-section"><h2>What is trusted</h2>${claimScope(c.shared_trusted_assumptions, c.trusted_assumptions)}</section>` : ""}
    ${c.shared_limitations || c.limitations || c.tool_limitations ? `<section class="report-section report-limitations"><h2>Technical limitations</h2>${claimScope(c.shared_limitations, c.limitations)}${toolLimitations(c)}</section>` : ""}`;
  }
  return {
    esc,
    date,
    user,
    breadcrumbs,
    crateCrumbs,
    claimCrumbs,
    claimItem,
    reportSummary,
    reportContent,
    reportBody,
    reportAPIs,
    reportDependencies,
    claimContent,
    toolLimitations,
  };
}
