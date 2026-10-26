import semver from "semver";
import { type Env, rows } from "./core";
import { bounded, safeFetch } from "./imports";

export interface DependencyReport {
  report: number;
  revision: number;
  version: string;
  reviewed?: boolean;
  withdrawn?: boolean;
}
export interface DirectDependency {
  crate: string;
  requirement: string;
  kind: string;
  optional: boolean;
  target: string | null;
  reports: DependencyReport[];
}

// Cargo treats bare versions as caret requirements, including 0.x versions.
export function matchesDependency(version: string, requirement: string) {
  const range = requirement
    .split(",")
    .map((part) => {
      const term = part.trim();
      return /^\d/.test(term) && !/[xX*]/.test(term) ? "^" + term : term;
    })
    .join(" ");
  return semver.satisfies(version, range);
}

export async function dependencyCatalog(
  env: Env,
  crate: string,
  version: string,
  reviews: any[] = [],
): Promise<DirectDependency[] | null> {
  const key = `cache/crates.io/dependencies/${encodeURIComponent(crate)}/${encodeURIComponent(version)}.json`;
  let dependencies: DirectDependency[];
  try {
    const cached = await env.ARCHIVE.get(key);
    if (cached) {
      dependencies = await cached.json<DirectDependency[]>();
      if (!Array.isArray(dependencies)) return null;
    } else {
      if (env.EXTERNAL_FETCH_DISABLED === "true") return null;
      const response = await safeFetch(
        `https://crates.io/api/v1/crates/${encodeURIComponent(crate)}/${encodeURIComponent(version)}/dependencies`,
        ["crates.io"],
        AbortSignal.timeout(5000),
      );
      const data = JSON.parse(
        new TextDecoder().decode(await bounded(response.body!, 1024 * 1024)),
      );
      if (!Array.isArray(data.dependencies)) return null;
      dependencies = data.dependencies.map((d: any) => {
        if (
          typeof d.crate_id !== "string" ||
          typeof d.req !== "string" ||
          !["normal", "build", "dev"].includes(d.kind) ||
          typeof d.optional !== "boolean" ||
          (d.target !== null && typeof d.target !== "string")
        )
          throw Error("Invalid dependency metadata");
        return {
          crate: d.crate_id,
          requirement: d.req,
          kind: d.kind,
          optional: d.optional,
          target: d.target,
          reports: [],
        };
      });
      // Published release metadata is immutable. Cache only successful snapshots,
      // including genuinely empty lists, so older reports work without reimporting.
      // A cache write failure should not hide a successfully fetched list.
      await env.ARCHIVE.put(key, JSON.stringify(dependencies), {
        httpMetadata: { contentType: "application/json" },
      }).catch(() => {});
    }
  } catch {
    return null;
  }
  const available = await rows(
    env.DB,
    `SELECT cr.name crate,rel.version,p.id report,MAX(rr.revision_no) revision
     FROM reports p JOIN releases rel ON rel.id=p.release_id
     JOIN crates cr ON cr.id=rel.crate_id JOIN report_revisions rr ON rr.report_id=p.id
     WHERE p.visibility='public' AND p.withdrawn_at IS NULL
     AND cr.name IN (SELECT value FROM json_each(?)) GROUP BY p.id ORDER BY p.id`,
    JSON.stringify([...new Set(dependencies.map((d) => d.crate))]),
  );
  return dependencies
    .map((d) => {
      const reviewed = reviews
        .filter(
          (r) =>
            r.crate === d.crate &&
            r.report != null &&
            r.revision != null &&
            matchesDependency(r.version, d.requirement),
        )
        .map((r) => ({ ...r, reviewed: true }));
      return {
        ...d,
        reports: [
          ...reviewed,
          ...available.filter(
            (r) =>
              r.crate === d.crate &&
              matchesDependency(r.version, d.requirement) &&
              !reviewed.some((review) => review.report === r.report),
          ),
        ],
      };
    })
    .sort(
      (a, b) => a.crate.localeCompare(b.crate) || a.kind.localeCompare(b.kind),
    );
}
