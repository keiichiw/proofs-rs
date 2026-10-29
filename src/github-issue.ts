import type { Env } from "./core";
import { bounded, safeFetch } from "./imports";

type RepositoryMetadata = {
  name: string;
  repository: string | null;
  fetchedAt?: number;
};
export type UpstreamRepository =
  | { repository: string; reason?: never }
  | { repository: null; reason: "missing" | "unsupported" | "unavailable" };

const cacheLifetime = 5 * 60 * 1000;

export function githubRepository(value: string): string | null {
  const match =
    /^https:\/\/github\.com\/([a-z0-9-]+)\/([a-z0-9_.-]+)\/?$/i.exec(value);
  if (!match || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(match[1]))
    return null;
  const repository = match[2].replace(/\.git$/i, "");
  if (!repository || repository === "." || repository === "..") return null;
  return `https://github.com/${match[1]}/${repository}`;
}

function metadata(value: any, crate: string): value is RepositoryMetadata {
  return (
    value?.name === crate &&
    (value.repository === null ||
      (typeof value.repository === "string" && value.repository.length <= 2000))
  );
}

export async function upstreamRepository(
  env: Env,
  crate: string,
): Promise<UpstreamRepository> {
  const offline = env.EXTERNAL_FETCH_DISABLED === "true";
  const key = `${offline ? "local-demo" : "cache"}/crates.io/repositories/${encodeURIComponent(crate)}.json`;
  let record: RepositoryMetadata | undefined;
  try {
    const cached = await env.ARCHIVE.get(key);
    const data = cached ? await cached.json<any>() : null;
    if (
      metadata(data, crate) &&
      (offline ||
        (typeof data.fetchedAt === "number" &&
          Date.now() >= data.fetchedAt &&
          Date.now() - data.fetchedAt < cacheLifetime))
    )
      record = data;
  } catch {
    // A failed cache read must not prevent a fresh upstream lookup.
  }
  if (!record && !offline) {
    try {
      const response = await safeFetch(
        `https://crates.io/api/v1/crates/${encodeURIComponent(crate)}`,
        ["crates.io"],
        AbortSignal.timeout(5000),
      );
      const data = JSON.parse(
        new TextDecoder().decode(await bounded(response.body!, 1024 * 1024)),
      );
      if (!metadata(data.crate, crate)) throw Error("Invalid crate metadata");
      record = { name: crate, repository: data.crate.repository };
      await env.ARCHIVE.put(
        key,
        JSON.stringify({ ...record, fetchedAt: Date.now() }),
        { httpMetadata: { contentType: "application/json" } },
      ).catch(() => {});
    } catch {
      return { repository: null, reason: "unavailable" };
    }
  }
  if (!record) return { repository: null, reason: "unavailable" };
  if (!record.repository) return { repository: null, reason: "missing" };
  const repository = githubRepository(record.repository);
  return repository
    ? { repository }
    : { repository: null, reason: "unsupported" };
}

// null means the configuration could not be verified; never overwrite a
// possible upstream template in that case.
export async function githubIssueTemplates(
  env: Env,
  repository: string,
): Promise<boolean | null> {
  const normalized = githubRepository(repository);
  if (!normalized) return null;
  const repo = normalized.slice("https://github.com/".length);
  const offline = env.EXTERNAL_FETCH_DISABLED === "true";
  const key = `${offline ? "local-demo" : "cache"}/github/issue-templates/${repo}.json`;
  try {
    const cached = await env.ARCHIVE.get(key);
    const data = cached
      ? await cached.json<{ hasTemplates?: boolean; fetchedAt?: number }>()
      : null;
    if (
      typeof data?.hasTemplates === "boolean" &&
      (offline ||
        (typeof data.fetchedAt === "number" &&
          Date.now() >= data.fetchedAt &&
          Date.now() - data.fetchedAt < cacheLifetime))
    )
      return data.hasTemplates;
  } catch {}
  if (offline) return null;
  const signal = AbortSignal.timeout(5000);
  const inspect = async (project: string): Promise<boolean> => {
    const results = await Promise.allSettled(
      ["", ".github", "docs"].map(async (path) => {
        const response = await fetch(
          `https://api.github.com/repos/${project}/contents/${path}`,
          {
            redirect: "manual",
            signal,
            headers: {
              "User-Agent": "proofs.rs/0.1",
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (response.status === 404) {
          await response.body?.cancel();
          return [];
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw Error("GitHub repository configuration unavailable");
        }
        const data: unknown = JSON.parse(
          new TextDecoder().decode(await bounded(response.body!, 1024 * 1024)),
        );
        // GitHub caps directory listings at 1,000 entries. An incomplete listing
        // cannot establish that templates are absent.
        if (
          !Array.isArray(data) ||
          data.length >= 1000 ||
          data.some(
            (entry) =>
              typeof entry?.name !== "string" ||
              typeof entry?.type !== "string",
          )
        )
          throw Error("Incomplete GitHub repository configuration");
        return data as { name: string; type: string }[];
      }),
    );
    const listings = results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    return listings.some((entries) =>
      entries.some(
        (entry) =>
          (entry.type === "dir" && entry.name === "ISSUE_TEMPLATE") ||
          (entry.type === "file" &&
            /^ISSUE_TEMPLATE(?:\.(?:md|markdown))?$/i.test(entry.name)),
      ),
    );
  };
  try {
    // GitHub also inherits community templates from the owner's public .github repository.
    const hasTemplates =
      (await inspect(repo)) ||
      (repo.endsWith("/.github")
        ? false
        : await inspect(`${repo.split("/")[0]}/.github`));
    await env.ARCHIVE.put(
      key,
      JSON.stringify({ hasTemplates, fetchedAt: Date.now() }),
      { httpMetadata: { contentType: "application/json" } },
    ).catch(() => {});
    return hasTemplates;
  } catch {
    return null;
  }
}

export function githubIssueDraft(
  finding: {
    title: string;
    body: string;
    report_id: number;
    origin_revision_no: number;
  },
  origin: string,
) {
  const reportURL = new URL(
    `/report/${finding.report_id}?v=${finding.origin_revision_no}`,
    origin,
  ).href;
  const body = [
    finding.body,
    `This issue was discovered as part of formal verification work on proofs.rs; see ${reportURL} for details.`,
  ].join("\n\n");
  return { title: finding.title, body };
}

export function githubIssueURL(
  repository: string,
  draft: { title: string; body: string },
  hasTemplates: boolean | null = false,
) {
  const url = new URL(
    repository +
      (hasTemplates !== false ? "/issues/new/choose" : "/issues/new"),
  );
  url.searchParams.set("title", draft.title);
  if (hasTemplates === false) url.searchParams.set("body", draft.body);
  let prefill: "all" | "title" | "none" = "all";
  if (url.href.length > 8192) {
    url.searchParams.delete("body");
    prefill = "title";
  }
  if (url.href.length > 8192) {
    url.searchParams.delete("title");
    prefill = "none";
  }
  return { url: url.href, prefill };
}
