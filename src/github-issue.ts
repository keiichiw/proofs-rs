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
) {
  const url = new URL(repository + "/issues/new");
  url.searchParams.set("title", draft.title);
  url.searchParams.set("body", draft.body);
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
