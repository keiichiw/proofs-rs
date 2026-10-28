import {
  compareToolchains,
  toolchainLabel,
  normalizeRepository,
  type Toolchain,
} from "./toolchain";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Revision-scoped projections copied from immutable Runs; never editorial report text. */
export function savedToolchainLabel(row: any): string | undefined {
  const descriptors: (Toolchain | undefined)[] =
    row.toolchain_json !== undefined
      ? [JSON.parse(row.toolchain_json ?? "null") ?? undefined]
      : JSON.parse(row.toolchains_json ?? "[]").map(
          (v: Toolchain | null) => v ?? undefined,
        );
  compareToolchains(descriptors);
  const labels = descriptors
    .filter((t): t is Toolchain => t !== undefined)
    .map(toolchainLabel);
  return [...new Set(labels)].join(" · ") || undefined;
}
export function renderToolchain(
  t: Toolchain | undefined,
  repository: string,
  commit: string,
): string {
  if (!t) return '<p class="meta">Toolchain source metadata: not recorded.</p>';
  const components = Object.entries(t.components)
    .map(([id, c]) => {
      const s = c.source;
      const content =
        s.kind === "release"
          ? esc(s.release_id)
          : `<a href="${esc(normalizeRepository(s.repository) + "/tree/" + (s.kind === "git" ? s.commit : s.base_commit).toLowerCase())}">${esc(s.repository)}</a><br>${s.kind === "git_patch" ? "Official base" : "Commit"}: <code>${esc(s.kind === "git" ? s.commit : s.base_commit)}</code>${s.kind === "git_patch" ? `<br>Patch: <a href="${esc(repository + "/blob/" + commit + "/" + s.patch.path.split("/").map(encodeURIComponent).join("/"))}">${esc(s.patch.path)}</a><br>SHA-256: <code>${esc(s.patch.sha256)}</code>` : ""}`;
      return `<dt>${esc(id)} (${esc(c.tool)})</dt><dd>${content}${c.materialized ? `<br>Materialized tree: <code>${esc(c.materialized.git_tree)}</code>` : ""}</dd>`;
    })
    .join("");
  const uses = t.uses
    .map(
      (u) =>
        `<li>${esc(u.component)} / ${esc(u.role)}: ${u.observation.kind === "not_run" ? "not run" : u.observation.kind === "dependency_resolved" ? `Lake dependency ${esc(u.observation.dependency_name)} resolved to ${esc(u.observation.subdirectory)}` : `process executed — ${esc(u.observation.reported_version)}`}</li>`,
    )
    .join("");
  return `<h3>${esc(toolchainLabel(t))}</h3><details class="toolchain"><summary>Recorded toolchain sources and use</summary><dl>${components}</dl><ul>${uses}</ul><p>Sources were restored and the Lean dependency was resolved. Rust → Lean translation was not rerun; this does not establish which translator produced the saved Lean. Dependency resolution does not mean every source definition was used. Version output does not authenticate a binary. These are the author's recorded observations; proofs.rs checks submitted consistency.</p></details>`;
}
